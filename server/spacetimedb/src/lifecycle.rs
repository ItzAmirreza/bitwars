// ── Lifecycle Reducers ──
// init, client_connected, client_disconnected.

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

use crate::abilities;
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::vehicles::{spawn_aa_at_outposts, spawn_jets_at_airstrips, spawn_sandbox_helicopters};

use crate::worldgen::{self, NUM_CHUNKS_X, NUM_CHUNKS_Y, NUM_CHUNKS_Z};

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

    // Pregenerate entire world
    let mut chunk_count = 0u32;
    for cx in 0..NUM_CHUNKS_X {
        for cz in 0..NUM_CHUNKS_Z {
            for cy in 0..NUM_CHUNKS_Y {
                let data = worldgen::generate_chunk(cx, cy, cz, seed);
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
        "World generation complete: {} chunks stored (seed={})",
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
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1800)),
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
    spawn_aa_at_outposts(ctx, seed);

    abilities::spawning::spawn_initial_ability_pickups(ctx, seed);
    ctx.db.ability_tick().insert(AbilityTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(ability_tick_interval_ms()),
        ),
    });

    log::info!(
        "Environment initialized: time={:.1}h, weather={}",
        initial_time,
        initial_weather
    );
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    let profile = ensure_player_profile(ctx, sender);
    if let Some(player) = ctx.db.player().identity().find(sender) {
        let entity_id = ensure_player_entity(ctx, &player);
        let loadout = normalize_or_create_player_loadout(ctx, profile.profile_id);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };
        let character_preset = normalize_character_preset(player.character_preset);
        let spawn_pos = random_spawn_position(ctx, &sender);

        ctx.db.player().identity().update(Player {
            profile_id: profile.profile_id,
            username: profile.display_name.clone(),
            online: true,
            pos: spawn_pos.clone(),
            vel: ZERO_VEL,
            health: max_health(),
            spawn_protected: true,
            current_weapon,
            current_streak: 0,
            character_preset,
            entity_id,
            mounted_vehicle_id: 0,
            session_started_at: ctx.timestamp,
            ..player
        });
        if let Some(updated) = ctx.db.player().identity().find(sender) {
            sync_player_entity(ctx, &updated);
        }
        // Reset ammo to max on reconnect (player gets a fresh start)
        crate::weapons::reset_all_ammo(ctx, sender);
        init_movement_state(ctx, sender, &spawn_pos);
        log::info!("Player reconnected: {:?}", sender);
    } else if !profile.display_name.trim().is_empty() {
        let base_rot = Rotation {
            yaw: 0.0,
            pitch: 0.0,
        };
        let spawn_pos = random_spawn_position(ctx, &sender);
        let entity_id = create_player_entity(ctx, &spawn_pos, &ZERO_VEL, &base_rot);
        let loadout = normalize_or_create_player_loadout(ctx, profile.profile_id);

        ctx.db.player().insert(Player {
            identity: sender,
            profile_id: profile.profile_id,
            entity_id,
            username: profile.display_name.clone(),
            character_preset: 0,
            pos: spawn_pos.clone(),
            movement_flags: 0,
            vel: ZERO_VEL,
            rot: base_rot,
            health: max_health(),
            max_health: max_health(),
            current_weapon: loadout.slot1,
            kills: 0,
            deaths: 0,
            current_streak: 0,
            spawn_protected: true,
            online: true,
            mounted_vehicle_id: 0,
            joined_at: ctx.timestamp,
            session_started_at: ctx.timestamp,
            last_damage_time: ctx.timestamp,
        });
        init_weapon_state(ctx, sender);
        init_movement_state(ctx, sender, &spawn_pos);
        if let Some(created) = ctx.db.player().identity().find(sender) {
            sync_player_entity(ctx, &created);
        }
        log::info!("Player resumed from profile: {:?}", sender);
    }

    touch_player_profile(ctx, profile.profile_id);
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(sender) {
        let disconnected = dismount_player_internal(ctx, player, true);
        close_player_session(ctx, &disconnected);
        let disconnected = Player {
            online: false,
            current_streak: 0,
            ..disconnected
        };
        ctx.db.player().identity().update(disconnected.clone());
        sync_player_entity(ctx, &disconnected);
        abilities::clear_buffs(ctx, sender);
        log::info!("Player disconnected: {:?}", sender);
    }
}
