// ── Map Management ──
// Map reset, chunk requests.

use std::time::Duration;

use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::vehicles::spawn_sandbox_helicopters;

use crate::worldgen::{self, CHUNK_SIZE, NUM_CHUNKS_X, NUM_CHUNKS_Y, NUM_CHUNKS_Z};

#[reducer]
pub fn request_chunks(ctx: &ReducerContext, chunk_ids: Vec<u32>) -> Result<(), String> {
    let _sender = ctx.sender();
    ctx.db
        .player()
        .identity()
        .find(_sender)
        .ok_or("Not registered")?;

    if chunk_ids.len() > 20 {
        return Err("Too many chunks requested (max 20)".to_string());
    }

    let config = ctx
        .db
        .world_config()
        .id()
        .find(1)
        .ok_or("World not initialized")?;

    for chunk_id in chunk_ids {
        if ctx.db.world_chunk().chunk_id().find(chunk_id).is_some() {
            continue;
        }

        let (cx, cy, cz) = worldgen::unpack_chunk_id(chunk_id);
        if (cx as usize) >= NUM_CHUNKS_X
            || (cy as usize) >= NUM_CHUNKS_Y
            || (cz as usize) >= NUM_CHUNKS_Z
        {
            continue;
        }

        let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, config.seed);
        ctx.db.world_chunk().insert(WorldChunk {
            chunk_id,
            cx,
            cy,
            cz,
            data,
            version: 1,
        });
    }

    Ok(())
}

#[reducer]
pub fn reset_map(ctx: &ReducerContext, _timer: MapResetTimer) {
    log::info!("MAP RESET triggered!");

    // Delete all chunks
    let chunk_ids: Vec<u32> = ctx.db.world_chunk().iter().map(|c| c.chunk_id).collect();
    for id in chunk_ids {
        ctx.db.world_chunk().chunk_id().delete(&id);
    }

    let new_seed = timestamp_micros(ctx.timestamp);

    if let Some(config) = ctx.db.world_config().id().find(1) {
        ctx.db.world_config().id().update(WorldConfig {
            seed: new_seed,
            round_number: config.round_number + 1,
            round_start: ctx.timestamp,
            ..config
        });
    }

    // Respawn all online players
    let player_ids: Vec<Identity> = ctx
        .db
        .player()
        .iter()
        .filter(|p| p.online)
        .map(|p| p.identity)
        .collect();
    for id in player_ids {
        if let Some(p) = ctx.db.player().identity().find(id) {
            let entity_id = ensure_player_entity(ctx, &p);
            let loadout = normalize_or_create_player_loadout(ctx, &p.username);
            let current_weapon = if weapon_in_loadout(&loadout, p.current_weapon) {
                p.current_weapon
            } else {
                loadout.slot1
            };
            let p = dismount_player_internal(ctx, p, true);
            let reset = Player {
                entity_id,
                health: max_health(),
                max_health: max_health(),
                pos: SPAWN_POS,
                vel: ZERO_VEL,
                kills: 0,
                deaths: 0,
                spawn_protected: true,
                current_weapon,
                ..p
            };
            ctx.db.player().identity().update(reset.clone());
            sync_player_entity(ctx, &reset);
            init_weapon_state(ctx, id);
            init_movement_state(ctx, id, &SPAWN_POS);
        }
    }

    // Remove old vehicles
    let vehicle_entity_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();
    for id in vehicle_entity_ids {
        ctx.db.vehicle().entity_id().delete(&id);
    }
    let entity_ids: Vec<u64> = ctx
        .db
        .entity()
        .iter()
        .filter(|e| e.kind == entity_kind_vehicle())
        .map(|e| e.id)
        .collect();
    for id in entity_ids {
        ctx.db.entity().id().delete(&id);
    }

    // Generate spawn-area chunks
    let center_cx = (crate::worldgen::WORLD_SIZE_X / 2 / CHUNK_SIZE) as i32;
    let center_cz = (crate::worldgen::WORLD_SIZE_Z / 2 / CHUNK_SIZE) as i32;
    for dcx in -2..=2 {
        for dcz in -2..=2 {
            let cx = center_cx + dcx;
            let cz = center_cz + dcz;
            if cx < 0 || cx >= NUM_CHUNKS_X as i32 || cz < 0 || cz >= NUM_CHUNKS_Z as i32 {
                continue;
            }
            for cy in 0..NUM_CHUNKS_Y as i32 {
                let data =
                    worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, new_seed);
                let chunk_id = worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                ctx.db.world_chunk().insert(WorldChunk {
                    chunk_id,
                    cx: cx as u8,
                    cy: cy as u8,
                    cz: cz as u8,
                    data,
                    version: 1,
                });
            }
        }
    }

    spawn_sandbox_helicopters(ctx);

    // Clean up stale events
    let event_ids: Vec<u64> = ctx.db.detach_event().iter().map(|e| e.id).collect();
    for id in event_ids {
        ctx.db.detach_event().id().delete(&id);
    }
    let shot_ids: Vec<u64> = ctx.db.shot_event().iter().map(|s| s.id).collect();
    for id in shot_ids {
        ctx.db.shot_event().id().delete(&id);
    }
    let explosion_ids: Vec<u64> = ctx.db.explosion_event().iter().map(|e| e.id).collect();
    for id in explosion_ids {
        ctx.db.explosion_event().id().delete(&id);
    }
    let vehicle_destroy_ids: Vec<u64> = ctx
        .db
        .vehicle_destroy_event()
        .iter()
        .map(|e| e.id)
        .collect();
    for id in vehicle_destroy_ids {
        ctx.db.vehicle_destroy_event().id().delete(&id);
    }

    ctx.db.map_reset_timer().insert(MapResetTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(300)),
    });

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender: ctx.sender(),
        sender_name: "[SERVER]".to_string(),
        text: "MAP RESET! New world generated. New round starting!".to_string(),
        sent_at: ctx.timestamp,
    });

    log::info!(
        "Map reset complete. New seed: {}, round: {}",
        new_seed,
        ctx.db
            .world_config()
            .id()
            .find(1)
            .map(|c| c.round_number)
            .unwrap_or(0)
    );
}
