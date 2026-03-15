// ── Lifecycle Reducers ──
// init, client_connected, client_disconnected.

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::vehicles::{spawn_jets_at_airstrips, spawn_sandbox_helicopters};

use crate::worldgen::{self, CHUNK_SIZE, NUM_CHUNKS_X, NUM_CHUNKS_Y, NUM_CHUNKS_Z};

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    log::info!("BitWars module initialized — generating world...");

    let seed = timestamp_micros(ctx.timestamp);

    ctx.db.world_config().insert(WorldConfig {
        id: 1,
        seed,
        round_number: 1,
        round_start: ctx.timestamp,
    });

    // Generate spawn-area chunks
    let center_cx = (crate::worldgen::WORLD_SIZE_X / 2 / CHUNK_SIZE) as i32;
    let center_cz = (crate::worldgen::WORLD_SIZE_Z / 2 / CHUNK_SIZE) as i32;
    let mut chunk_count = 0;
    for dcx in -2..=2 {
        for dcz in -2..=2 {
            let cx = center_cx + dcx;
            let cz = center_cz + dcz;
            if cx < 0 || cx >= NUM_CHUNKS_X as i32 || cz < 0 || cz >= NUM_CHUNKS_Z as i32 {
                continue;
            }
            for cy in 0..NUM_CHUNKS_Y as i32 {
                let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, seed);
                let chunk_id = worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                ctx.db.world_chunk().insert(WorldChunk {
                    chunk_id,
                    cx: cx as u8,
                    cy: cy as u8,
                    cz: cz as u8,
                    data,
                    version: 1,
                });
                chunk_count += 1;
            }
        }
    }

    log::info!(
        "World generation complete: {} spawn-area chunks stored (seed={})",
        chunk_count,
        seed
    );

    // Schedule periodic tasks
    ctx.db.detach_cleanup().insert(DetachCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(5)),
    });
    ctx.db.shot_cleanup().insert(ShotCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(3)),
    });
    ctx.db.map_reset_timer().insert(MapResetTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(300)),
    });

    // Initialize world environment
    let initial_time = ((seed % 2400) as f32) / 100.0;
    let initial_weather = ((seed / 2400) % NUM_WEATHER_TYPES as u64) as u8;
    let preset = &weather_presets()[initial_weather as usize];
    let wind = preset.wind_speed + ((seed % 20) as f32) / 100.0;
    let cloud = preset.cloud_density + ((seed % 20) as f32) / 100.0;
    let fog = preset.fog_density;

    ctx.db.world_environment().insert(WorldEnvironment {
        id: 1,
        time_of_day: initial_time,
        weather: initial_weather,
        wind_speed: wind,
        cloud_density: cloud,
        fog_density: fog,
        last_weather_change: ctx.timestamp,
    });

    ctx.db.environment_tick().insert(EnvironmentTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(10)),
    });
    ctx.db.health_regen_tick().insert(HealthRegenTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1)),
    });
    ctx.db.vehicle_tick().insert(VehicleTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(HELI_TICK_INTERVAL_MS),
        ),
    });
    ctx.db.grenade_tick().insert(GrenadeTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(grenade_tick_interval_ms()),
        ),
    });

    spawn_sandbox_helicopters(ctx);
    spawn_jets_at_airstrips(ctx, seed);

    log::info!(
        "Environment initialized: time={:.1}h, weather={}",
        initial_time,
        initial_weather
    );
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    let Some(conn_id) = ctx.connection_id() else {
        // Defensive: host-invoked contexts may not have a connection id.
        return;
    };

    if let Some(existing) = ctx.db.player_session().identity().find(sender) {
        ctx.db.player_session().identity().update(PlayerSession {
            connection_id: conn_id,
            connected_at: ctx.timestamp,
            ..existing
        });
    } else {
        ctx.db.player_session().insert(PlayerSession {
            identity: sender,
            connection_id: conn_id,
            connected_at: ctx.timestamp,
        });
    }

    if let Some(player) = ctx.db.player().identity().find(sender) {
        // Defensive cleanup for stale mount state (e.g. abrupt disconnect where
        // pilot linkage survived). Reconnecting players always respawn on foot.
        if player.mounted_vehicle_id != 0 {
            if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&player.mounted_vehicle_id) {
                if vehicle.pilot_identity == Some(sender) {
                    ctx.db.vehicle().entity_id().update(Vehicle {
                        pilot_identity: None,
                        input_forward: 0.0,
                        input_strafe: 0.0,
                        input_lift: 0.0,
                        input_yaw: 0.0,
                        boosting: false,
                        ..vehicle
                    });
                }
            }
        }

        let entity_id = ensure_player_entity(ctx, &player);
        let loadout = normalize_or_create_player_loadout(ctx, &player.username);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };
        let character_preset = normalize_character_preset(player.character_preset);

        ctx.db.player().identity().update(Player {
            online: true,
            pos: SPAWN_POS,
            vel: ZERO_VEL,
            health: max_health(),
            spawn_protected: true,
            current_weapon,
            character_preset,
            entity_id,
            mounted_vehicle_id: 0,
            ..player
        });
        if let Some(updated) = ctx.db.player().identity().find(sender) {
            sync_player_entity(ctx, &updated);
        }
        init_weapon_state(ctx, sender);
        init_movement_state(ctx, sender, &SPAWN_POS);
        log::info!("Player reconnected: {:?}", sender);
    }
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    if let Some(session) = ctx.db.player_session().identity().find(sender) {
        if let Some(conn_id) = ctx.connection_id() {
            if session.connection_id == conn_id {
                ctx.db.player_session().identity().delete(&session.identity);
            }
        }
    }
    if let Some(player) = ctx.db.player().identity().find(sender) {
        let disconnected = dismount_player_internal(ctx, player, true);
        let disconnected = Player {
            online: false,
            ..disconnected
        };
        ctx.db.player().identity().update(disconnected.clone());
        sync_player_entity(ctx, &disconnected);
        log::info!("Player disconnected: {:?}", sender);
    }
}
