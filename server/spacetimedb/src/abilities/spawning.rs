// ── Ability Pickup Spawning ──
// Scatter ability pickups across the map at init.

use spacetimedb::{ReducerContext, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

/// Spawn initial ability pickups scattered across the map.
/// Uses deterministic hash-based RNG from the world seed.
pub fn spawn_initial_ability_pickups(ctx: &ReducerContext, seed: u64) {
    let max_pickups = ability_max_active_pickups();
    let margin = 20;
    let span_x = (WORLD_SIZE_X as i32 - margin * 2).max(8);
    let span_z = (WORLD_SIZE_Z as i32 - margin * 2).max(8);
    let num_ability_types = 4u8;

    let base_seed = seed ^ 0xab115eed00000000;
    let mut spawned = 0usize;

    for attempt in 0..640u64 {
        if spawned >= max_pickups {
            break;
        }

        let rx = hash_u64(base_seed ^ attempt.wrapping_mul(0x9e3779b97f4a7c15));
        let rz = hash_u64(base_seed ^ attempt.wrapping_mul(0xd1b54a32d192ed03));
        let x = margin + (rx % span_x as u64) as i32;
        let z = margin + (rz % span_z as u64) as i32;

        // Find ground Y at this position
        let Some(y) = find_surface_y(ctx, x, z) else {
            continue;
        };

        let ability_type = (hash_u64(base_seed ^ attempt.wrapping_mul(0x94d049bb133111eb))
            % num_ability_types as u64) as u8;

        ctx.db.ability_pickup().insert(AbilityPickup {
            id: 0,
            ability_type,
            pos: Vec3 {
                x: x as f32 + 0.5,
                y: y as f32 + 1.5, // Float above ground
                z: z as f32 + 0.5,
            },
            active: true,
            respawn_at: ctx.timestamp,
            created_at: ctx.timestamp,
        });
        spawned += 1;
    }

    log::info!("Spawned {} ability pickups", spawned);
}

/// Find the surface Y at a given XZ position by scanning chunks.
fn find_surface_y(ctx: &ReducerContext, x: i32, z: i32) -> Option<i32> {
    use crate::worldgen::{self, WORLD_SIZE_Y};

    let chunk_size = 16;
    let cx = (x / chunk_size) as u8;
    let cz = (z / chunk_size) as u8;
    let local_x = (x % chunk_size) as usize;
    let local_z = (z % chunk_size) as usize;

    // Scan from top down to find first solid block
    let num_cy = (WORLD_SIZE_Y / chunk_size as usize) as u8;
    for cy in (0..num_cy).rev() {
        let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
        let Some(chunk) = ctx.db.world_chunk().chunk_id().find(&chunk_id) else {
            continue;
        };

        let mut blocks = [0u8; 4096];
        worldgen::rle_decode(&chunk.data, &mut blocks);
        // Scan local Y from top (15) down
        for local_y in (0..chunk_size as usize).rev() {
            let idx = local_y * chunk_size as usize * chunk_size as usize
                + local_z * chunk_size as usize
                + local_x;
            if idx < blocks.len() && blocks[idx] != 0 {
                let world_y = cy as i32 * chunk_size + local_y as i32;
                return Some(world_y);
            }
        }
    }

    None
}
