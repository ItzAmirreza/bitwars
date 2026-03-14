// ── Chunk Operations ──
// Block queries, destruction, structural integrity orchestration.

use std::collections::HashMap;

use spacetimedb::{ReducerContext, Table};

use crate::helpers::block_in_bounds;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{self, AIR, CHUNK_SIZE, NUM_CHUNKS_X, NUM_CHUNKS_Y, NUM_CHUNKS_Z};

// ── Chunk Cache Helpers ──

pub fn get_or_generate_chunk(ctx: &ReducerContext, cx: u8, cy: u8, cz: u8) -> Option<WorldChunk> {
    let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
    if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
        return Some(chunk);
    }

    let seed = ctx.db.world_config().id().find(1)?.seed;
    let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, seed);
    Some(ctx.db.world_chunk().insert(WorldChunk {
        chunk_id,
        cx,
        cy,
        cz,
        data,
        version: 1,
    }))
}

pub fn get_block_type_generated_cached(
    ctx: &ReducerContext,
    x: i32,
    y: i32,
    z: i32,
    chunk_cache: &mut HashMap<u32, [u8; 4096]>,
) -> Option<u8> {
    if !block_in_bounds(x, y, z) {
        return Some(AIR);
    }

    let ux = x as usize;
    let uy = y as usize;
    let uz = z as usize;
    let cx = (ux / CHUNK_SIZE) as u8;
    let cy = (uy / CHUNK_SIZE) as u8;
    let cz = (uz / CHUNK_SIZE) as u8;

    let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
    if !chunk_cache.contains_key(&chunk_id) {
        let chunk = get_or_generate_chunk(ctx, cx, cy, cz)?;
        let mut decoded = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
        worldgen::rle_decode(&chunk.data, &mut decoded);
        chunk_cache.insert(chunk_id, decoded);
    }

    let decoded = chunk_cache.get(&chunk_id)?;
    let idx = ux % CHUNK_SIZE
        + (uy % CHUNK_SIZE) * CHUNK_SIZE
        + (uz % CHUNK_SIZE) * CHUNK_SIZE * CHUNK_SIZE;
    Some(decoded[idx])
}

pub fn get_surface_height_generated(
    ctx: &ReducerContext,
    x: i32,
    z: i32,
    chunk_cache: &mut HashMap<u32, [u8; 4096]>,
) -> Option<i32> {
    use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z};

    if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 {
        return None;
    }

    for y in (0..WORLD_SIZE_Y as i32).rev() {
        if matches!(get_block_type_generated_cached(ctx, x, y, z, chunk_cache), Some(bt) if bt != AIR)
        {
            return Some(y);
        }
    }
    None
}

// ── Helicopter Spawn Helpers ──

pub fn helicopter_spawn_y_if_fit(
    ctx: &ReducerContext,
    center_x: i32,
    center_z: i32,
    chunk_cache: &mut HashMap<u32, [u8; 4096]>,
) -> Option<f32> {
    use crate::constants::*;
    use crate::helpers::dist_sq;

    let mut min_surface = i32::MAX;
    let mut max_surface = i32::MIN;

    for dx in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
        for dz in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
            if dx * dx + dz * dz > HELI_SPAWN_CLEARANCE_RADIUS * HELI_SPAWN_CLEARANCE_RADIUS {
                continue;
            }
            if (dx & 1) != 0 || (dz & 1) != 0 {
                continue;
            }

            let sx = center_x + dx;
            let sz = center_z + dz;
            let surf = get_surface_height_generated(ctx, sx, sz, chunk_cache)?;
            min_surface = min_surface.min(surf);
            max_surface = max_surface.max(surf);
        }
    }

    if min_surface == i32::MAX || max_surface - min_surface > 2 {
        return None;
    }

    let base_y = max_surface + 1;
    if base_y + HELI_SPAWN_CLEARANCE_HEIGHT >= crate::worldgen::WORLD_SIZE_Y as i32 - 1 {
        return None;
    }

    for dx in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
        for dz in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
            if dx * dx + dz * dz > HELI_SPAWN_CLEARANCE_RADIUS * HELI_SPAWN_CLEARANCE_RADIUS {
                continue;
            }
            let sx = center_x + dx;
            let sz = center_z + dz;
            for y in base_y..=base_y + HELI_SPAWN_CLEARANCE_HEIGHT {
                if !matches!(
                    get_block_type_generated_cached(ctx, sx, y, sz, chunk_cache),
                    Some(AIR)
                ) {
                    return None;
                }
            }
        }
    }

    let center = crate::types::Vec3 {
        x: center_x as f32 + 0.5,
        y: (base_y as f32) + 1.0,
        z: center_z as f32 + 0.5,
    };

    for p in ctx.db.player().iter() {
        if dist_sq(&p.pos, &center) < HELI_SPAWN_MIN_SEPARATION * HELI_SPAWN_MIN_SEPARATION {
            return None;
        }
    }

    for v in ctx.db.vehicle().iter() {
        if let Some(entity) = ctx.db.entity().id().find(&v.entity_id) {
            if dist_sq(&entity.pos, &center) < HELI_SPAWN_MIN_SEPARATION * HELI_SPAWN_MIN_SEPARATION
            {
                return None;
            }
        }
    }

    Some(center.y)
}

// ── Block Destruction ──

/// Destroy blocks in the world by modifying WorldChunk data.
/// Returns positions and block types of blocks that were actually solid.
pub fn destroy_blocks_in_world(
    ctx: &ReducerContext,
    blocks: &[(i32, i32, i32)],
) -> Vec<(i32, i32, i32, u8)> {
    let mut actually_destroyed = Vec::new();

    let mut chunks_affected: HashMap<u32, Vec<(i32, i32, i32, usize, usize, usize)>> =
        HashMap::new();

    for &(x, y, z) in blocks {
        if !block_in_bounds(x, y, z) {
            continue;
        }
        let cx = (x / CHUNK_SIZE as i32) as u8;
        let cy = (y / CHUNK_SIZE as i32) as u8;
        let cz = (z / CHUNK_SIZE as i32) as u8;
        let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
        let lx = (x % CHUNK_SIZE as i32) as usize;
        let ly = (y % CHUNK_SIZE as i32) as usize;
        let lz = (z % CHUNK_SIZE as i32) as usize;
        chunks_affected
            .entry(chunk_id)
            .or_default()
            .push((x, y, z, lx, ly, lz));
    }

    for (chunk_id, local_blocks) in chunks_affected {
        if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
            let mut block_data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
            worldgen::rle_decode(&chunk.data, &mut block_data);

            let mut modified = false;
            for (x, y, z, lx, ly, lz) in local_blocks {
                let local_idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                let block_type = block_data[local_idx];
                if block_type != AIR {
                    block_data[local_idx] = AIR;
                    actually_destroyed.push((x, y, z, block_type));
                    modified = true;
                }
            }

            if modified {
                let new_data = worldgen::rle_encode(&block_data);
                ctx.db.world_chunk().chunk_id().update(WorldChunk {
                    data: new_data,
                    version: chunk.version + 1,
                    ..chunk
                });
            }
        }
    }

    actually_destroyed
}

// ── Structural Integrity ──

/// Decompress chunks near the given positions into a sparse map.
fn decompress_nearby_chunks(
    ctx: &ReducerContext,
    positions: &[(i32, i32, i32)],
) -> HashMap<u32, [u8; 4096]> {
    let mut needed_chunks = std::collections::HashSet::new();
    let radius = 4i32;

    for &(px, py, pz) in positions {
        let pcx = px / CHUNK_SIZE as i32;
        let pcy = py / CHUNK_SIZE as i32;
        let pcz = pz / CHUNK_SIZE as i32;
        for dcx in -radius..=radius {
            for dcy in -radius..=radius {
                for dcz in -radius..=radius {
                    let cx = pcx + dcx;
                    let cy = pcy + dcy;
                    let cz = pcz + dcz;
                    if cx >= 0
                        && cx < NUM_CHUNKS_X as i32
                        && cy >= 0
                        && cy < NUM_CHUNKS_Y as i32
                        && cz >= 0
                        && cz < NUM_CHUNKS_Z as i32
                    {
                        needed_chunks.insert(worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8));
                    }
                }
            }
        }
    }

    let mut result = HashMap::new();
    for chunk_id in needed_chunks {
        if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
            let mut data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
            worldgen::rle_decode(&chunk.data, &mut data);
            result.insert(chunk_id, data);
        }
    }
    result
}

/// Run structural integrity check after block destruction.
pub fn run_structural_check(ctx: &ReducerContext, destroyed_positions: &[(i32, i32, i32)]) {
    if destroyed_positions.is_empty() {
        return;
    }

    let max_structural_cascade_steps: usize = 6;

    let mut frontier: Vec<(i32, i32, i32)> = destroyed_positions.to_vec();
    let mut total_components = 0usize;
    let mut total_detached = 0usize;

    for _ in 0..max_structural_cascade_steps {
        if frontier.is_empty() {
            break;
        }

        let chunks = decompress_nearby_chunks(ctx, &frontier);
        let collapse_plans = worldgen::check_structural_integrity_sparse(&chunks, &frontier);
        if collapse_plans.is_empty() {
            break;
        }

        let mut candidate_coords: Vec<(i32, i32, i32)> = Vec::new();
        for plan in &collapse_plans {
            candidate_coords.extend(plan.blocks.iter().map(|&(x, y, z, _)| (x, y, z)));
        }

        let actually_detached = destroy_blocks_in_world(ctx, &candidate_coords);
        if actually_detached.is_empty() {
            break;
        }

        let detached_set: std::collections::HashSet<(i32, i32, i32)> = actually_detached
            .iter()
            .map(|&(x, y, z, _)| (x, y, z))
            .collect();

        for plan in collapse_plans {
            let filtered_blocks: Vec<(i32, i32, i32, u8)> = plan
                .blocks
                .into_iter()
                .filter(|(x, y, z, _)| detached_set.contains(&(*x, *y, *z)))
                .collect();
            if filtered_blocks.is_empty() {
                continue;
            }

            let blocks_x: Vec<i32> = filtered_blocks.iter().map(|&(x, _, _, _)| x).collect();
            let blocks_y: Vec<i32> = filtered_blocks.iter().map(|&(_, y, _, _)| y).collect();
            let blocks_z: Vec<i32> = filtered_blocks.iter().map(|&(_, _, z, _)| z).collect();
            let block_types: Vec<u8> = filtered_blocks.iter().map(|&(_, _, _, bt)| bt).collect();

            ctx.db.detach_event().insert(DetachEvent {
                id: 0,
                blocks_x,
                blocks_y,
                blocks_z,
                block_types,
                motion_mode: plan.motion_mode,
                pivot: vec3_from_tuple(plan.pivot),
                axis: vec3_from_tuple(plan.axis),
                drift: vec3_from_tuple(plan.drift),
                fracture_origin: vec3_from_tuple(plan.fracture_origin),
                fracture_dir: vec3_from_tuple(plan.fracture_dir),
                ang_accel: plan.ang_accel,
                initial_ang_vel: plan.initial_ang_vel,
                gravity_scale: plan.gravity_scale,
                fracture_speed: plan.fracture_speed,
                lifetime_ms: plan.lifetime_ms,
                created_at: ctx.timestamp,
            });
            total_components += 1;
        }

        total_detached += actually_detached.len();
        frontier = actually_detached
            .iter()
            .map(|&(x, y, z, _)| (x, y, z))
            .collect();
    }

    if total_detached > 0 {
        log::info!(
            "Structural check: {} components, {} detached blocks",
            total_components,
            total_detached
        );
    }
}
