// ── Structural Integrity (Load + Topple Model) ──
// Works on sparse chunk windows and produces deterministic collapse plans.

use super::*;
use std::collections::{HashMap, HashSet};

const MAX_BFS_NODES: usize = 20000;
const MAX_BFS_RADIUS: i32 = 36;
const MIN_COLLAPSE_BLOCKS: usize = 1;

const N6: [(i32, i32, i32); 6] = [
    (1, 0, 0),
    (-1, 0, 0),
    (0, 1, 0),
    (0, -1, 0),
    (0, 0, 1),
    (0, 0, -1),
];

fn pack_coord(x: i32, y: i32, z: i32) -> u64 {
    ((x as u64) & 0x3FF) | (((y as u64) & 0xFF) << 10) | (((z as u64) & 0x3FF) << 18)
}

fn block_in_world(x: i32, y: i32, z: i32) -> bool {
    x >= 0
        && (x as usize) < WORLD_SIZE_X
        && y >= 0
        && (y as usize) < WORLD_SIZE_Y
        && z >= 0
        && (z as usize) < WORLD_SIZE_Z
}

fn get_block_sparse(chunks: &HashMap<u32, [u8; 4096]>, x: i32, y: i32, z: i32) -> Option<u8> {
    if !block_in_world(x, y, z) {
        return Some(AIR);
    }
    let cx = (x / CHUNK_SIZE as i32) as u8;
    let cy = (y / CHUNK_SIZE as i32) as u8;
    let cz = (z / CHUNK_SIZE as i32) as u8;
    let chunk_id = pack_chunk_id(cx, cy, cz);
    if let Some(data) = chunks.get(&chunk_id) {
        let lx = (x % CHUNK_SIZE as i32) as usize;
        let ly = (y % CHUNK_SIZE as i32) as usize;
        let lz = (z % CHUNK_SIZE as i32) as usize;
        Some(data[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE])
    } else {
        None // Chunk not loaded — treat as unknown
    }
}

pub struct StructuralCollapsePlan {
    pub blocks: Vec<(i32, i32, i32, u8)>,
    /// 0 = free-fall shear, 1 = rotational topple
    pub motion_mode: u8,
    pub pivot: (f32, f32, f32),
    pub axis: (f32, f32, f32),
    pub drift: (f32, f32, f32),
    pub fracture_origin: (f32, f32, f32),
    pub fracture_dir: (f32, f32, f32),
    pub ang_accel: f32,
    pub initial_ang_vel: f32,
    pub gravity_scale: f32,
    pub fracture_speed: f32,
    pub lifetime_ms: u32,
}

struct ComponentScan {
    blocks: Vec<(i32, i32, i32, u8)>,
    visited: Vec<u64>,
}

fn block_weight(bt: u8) -> f32 {
    match bt {
        CONCRETE => 3.0,
        DARK_CONCRETE => 3.5,
        ASPHALT => 2.5,
        REBAR => 4.0,
        BRICK => 2.0,
        METAL => 5.0,
        RUBBLE => 1.5,
        DIRT => 1.2,
        SAND => 1.0,
        GRASS => 1.0,
        WOOD => 1.6,
        STONE => 3.2,
        SNOW => 0.4,
        LANTERN => 0.45,
        _ => 2.0,
    }
}

fn normalize2(x: f32, z: f32) -> (f32, f32) {
    let len = (x * x + z * z).sqrt();
    if len < 0.0001 {
        (1.0, 0.0)
    } else {
        (x / len, z / len)
    }
}

fn scan_component_sparse(
    chunks: &HashMap<u32, [u8; 4096]>,
    start_x: i32,
    start_y: i32,
    start_z: i32,
    global_visited: &HashSet<u64>,
) -> ComponentScan {
    let mut queue = vec![(start_x, start_y, start_z)];
    let mut visited = Vec::new();
    let mut result_blocks = Vec::new();
    let mut local_visited = HashSet::new();
    let mut q_head = 0;

    let start_key = pack_coord(start_x, start_y, start_z);
    local_visited.insert(start_key);
    visited.push(start_key);

    let r2 = MAX_BFS_RADIUS * MAX_BFS_RADIUS;

    while q_head < queue.len() && result_blocks.len() < MAX_BFS_NODES {
        let (x, y, z) = queue[q_head];
        q_head += 1;

        let dx = x - start_x;
        let dy = y - start_y;
        let dz = z - start_z;
        if dx * dx + dy * dy + dz * dz > r2 {
            continue;
        }

        let bt = match get_block_sparse(chunks, x, y, z) {
            Some(b) => b,
            None => {
                continue;
            }
        };
        if bt == AIR {
            continue;
        }

        result_blocks.push((x, y, z, bt));

        for &(ox, oy, oz) in &N6 {
            let nx = x + ox;
            let ny = y + oy;
            let nz = z + oz;
            if !block_in_world(nx, ny, nz) {
                continue;
            }

            let nkey = pack_coord(nx, ny, nz);
            if local_visited.contains(&nkey) || global_visited.contains(&nkey) {
                continue;
            }

            match get_block_sparse(chunks, nx, ny, nz) {
                Some(b) if b != AIR => {
                    local_visited.insert(nkey);
                    visited.push(nkey);
                    queue.push((nx, ny, nz));
                }
                None => {}
                Some(_) => {}
            }
        }
    }

    ComponentScan {
        blocks: result_blocks,
        visited,
    }
}

fn analyze_component_for_collapse(
    chunks: &HashMap<u32, [u8; 4096]>,
    component: &ComponentScan,
) -> Option<StructuralCollapsePlan> {
    if component.blocks.len() < MIN_COLLAPSE_BLOCKS {
        return None;
    }

    let mut block_keys = HashSet::new();
    for &(x, y, z, _) in &component.blocks {
        block_keys.insert(pack_coord(x, y, z));
    }

    let mut total_w = 0.0f32;
    let mut com_x = 0.0f32;
    let mut com_z = 0.0f32;

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut min_z = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut max_z = i32::MIN;

    let mut support_points: Vec<(f32, f32, f32)> = Vec::new();
    for &(x, y, z, bt) in &component.blocks {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        min_z = min_z.min(z);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
        max_z = max_z.max(z);

        let w = block_weight(bt);
        total_w += w;
        com_x += (x as f32 + 0.5) * w;
        com_z += (z as f32 + 0.5) * w;

        if y == 0 {
            support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            continue;
        }

        let below_key = pack_coord(x, y - 1, z);
        if block_keys.contains(&below_key) {
            continue;
        }

        match get_block_sparse(chunks, x, y - 1, z) {
            Some(b) if b != AIR => {
                support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            }
            None => {
                support_points.push((x as f32 + 0.5, z as f32 + 0.5, y as f32 + 0.5));
            }
            Some(_) => {}
        }
    }

    if total_w <= 0.0 {
        return None;
    }

    com_x /= total_w;
    com_z /= total_w;

    let size = component.blocks.len() as f32;
    let footprint_w = (max_x - min_x + 1).max(1) as f32;
    let footprint_d = (max_z - min_z + 1).max(1) as f32;
    let footprint_area = footprint_w * footprint_d;
    let height = (max_y - min_y + 1).max(1) as f32;

    if support_points.is_empty() {
        let (dir_x, dir_z) = normalize2(
            com_x - (min_x as f32 + max_x as f32) * 0.5,
            com_z - (min_z as f32 + max_z as f32) * 0.5,
        );
        let fracture_origin = (
            if dir_x >= 0.0 {
                min_x as f32
            } else {
                (max_x + 1) as f32
            },
            min_y as f32,
            if dir_z >= 0.0 {
                min_z as f32
            } else {
                (max_z + 1) as f32
            },
        );
        return Some(StructuralCollapsePlan {
            blocks: component.blocks.clone(),
            motion_mode: 0,
            pivot: (com_x, min_y as f32 + 0.5, com_z),
            axis: (0.0, 0.0, 1.0),
            drift: (dir_x * 0.35, -0.8, dir_z * 0.35),
            fracture_origin,
            fracture_dir: (dir_x, 0.0, dir_z),
            ang_accel: 0.0,
            initial_ang_vel: 0.0,
            gravity_scale: 1.0,
            fracture_speed: 6.0,
            lifetime_ms: 5600,
        });
    }

    let mut support_x = 0.0f32;
    let mut support_z = 0.0f32;
    let mut support_y = 0.0f32;
    for &(sx, sz, sy) in &support_points {
        support_x += sx;
        support_z += sz;
        support_y += sy;
    }
    support_x /= support_points.len() as f32;
    support_z /= support_points.len() as f32;
    support_y /= support_points.len() as f32;

    let mut support_radius = 0.0f32;
    for &(sx, sz, _) in &support_points {
        let dx = sx - support_x;
        let dz = sz - support_z;
        support_radius = support_radius.max((dx * dx + dz * dz).sqrt());
    }
    support_radius = support_radius.max(0.75);

    let support_density = (support_points.len() as f32 / footprint_area).min(1.0);
    let mass_per_support = total_w / support_points.len() as f32;
    let slenderness = height / footprint_area.sqrt().max(1.0);

    let load_dx = com_x - support_x;
    let load_dz = com_z - support_z;
    let overload_dist = (load_dx * load_dx + load_dz * load_dz).sqrt();
    let overload_ratio = overload_dist / (support_radius + 0.25);

    let instability = overload_ratio * 1.05
        + (0.62 - support_density).max(0.0) * 0.95
        + (mass_per_support * 0.017)
        + (slenderness * 0.08);

    if instability < 1.18 && overload_ratio < 1.02 {
        return None;
    }

    let (load_dir_x, load_dir_z) = normalize2(load_dx, load_dz);
    let fracture_dir_x = -load_dir_x;
    let fracture_dir_z = -load_dir_z;
    let axis_x = load_dir_z;
    let axis_z = -load_dir_x;

    let collapse_strength = (instability - 0.95).max(0.0);
    let ang_accel = (0.18 + collapse_strength * 0.85 + slenderness * 0.02).min(2.4);
    let initial_ang_vel = (0.03 + overload_ratio * 0.2).min(0.5);
    let lateral_drift = (0.10 + overload_ratio * 0.25).min(0.65);
    let fracture_speed = (2.2 + support_density * 2.0 + (size / 150.0)).min(8.0);

    let lifetime_ms =
        (5200.0 + height * 55.0 + collapse_strength * 900.0).clamp(4200.0, 9800.0) as u32;

    let fracture_origin = (
        if fracture_dir_x >= 0.0 {
            min_x as f32
        } else {
            (max_x + 1) as f32
        },
        min_y as f32,
        if fracture_dir_z >= 0.0 {
            min_z as f32
        } else {
            (max_z + 1) as f32
        },
    );

    Some(StructuralCollapsePlan {
        blocks: component.blocks.clone(),
        motion_mode: 1,
        pivot: (support_x, support_y, support_z),
        axis: (axis_x, 0.0, axis_z),
        drift: (
            load_dir_x * lateral_drift,
            -0.55,
            load_dir_z * lateral_drift,
        ),
        fracture_origin,
        fracture_dir: (fracture_dir_x, 0.0, fracture_dir_z),
        ang_accel,
        initial_ang_vel,
        gravity_scale: 0.85,
        fracture_speed,
        lifetime_ms,
    })
}

/// Check structural integrity using sparse chunk data.
/// Takes a map of nearby decompressed chunks and positions of destroyed blocks.
/// Returns deterministic collapse plans for unsupported/overloaded structures.
pub fn check_structural_integrity_sparse(
    chunks: &HashMap<u32, [u8; 4096]>,
    destroyed_positions: &[(i32, i32, i32)],
) -> Vec<StructuralCollapsePlan> {
    let mut plans = Vec::new();
    let mut global_visited = HashSet::new();

    for &(px, py, pz) in destroyed_positions {
        for &(dx, dy, dz) in &N6 {
            let nx = px + dx;
            let ny = py + dy;
            let nz = pz + dz;

            if !block_in_world(nx, ny, nz) {
                continue;
            }

            let bt = match get_block_sparse(chunks, nx, ny, nz) {
                Some(b) => b,
                None => continue,
            };
            if bt == AIR {
                continue;
            }

            let key = pack_coord(nx, ny, nz);
            if global_visited.contains(&key) {
                continue;
            }

            let result = scan_component_sparse(chunks, nx, ny, nz, &global_visited);
            for &k in &result.visited {
                global_visited.insert(k);
            }

            if let Some(plan) = analyze_component_for_collapse(chunks, &result) {
                plans.push(plan);
            }
        }
    }

    plans
}
