// ── Ability Pickup Spawning ──
// Scatter ability pickups across the map at init.

use spacetimedb::{ReducerContext, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{
    self, AIR, ASPHALT, BRICK, CONCRETE, DARK_CONCRETE, DIRT, GRASS, METAL, RUBBLE,
    SAND, SNOW, STONE, WORLD_SIZE_X, WORLD_SIZE_Z,
};

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

        // Find open ground-level surface at this position.
        let Some(y) = find_surface_y(ctx, seed, x, z) else {
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

/// Find a walkable ground-level surface with open headroom at a given XZ.
fn find_surface_y(ctx: &ReducerContext, seed: u64, x: i32, z: i32) -> Option<i32> {
    let biome = worldgen::get_biome(x, z, seed);
    let surface_y = worldgen::biome_height(biome, x, z, seed);
    let surface_bt = get_block_type(ctx, x, surface_y, z)?;
    if !is_walkable_surface(surface_bt) {
        return None;
    }

    for clearance_y in (surface_y + 1)..=(surface_y + 3) {
        if !matches!(get_block_type(ctx, x, clearance_y, z), Some(AIR)) {
            return None;
        }
    }

    Some(surface_y)
}

fn is_walkable_surface(block_type: u8) -> bool {
    matches!(
        block_type,
        CONCRETE
            | DARK_CONCRETE
            | ASPHALT
            | BRICK
            | METAL
            | RUBBLE
            | DIRT
            | SAND
            | GRASS
            | STONE
            | SNOW
    )
}
