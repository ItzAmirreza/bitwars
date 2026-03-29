// ── Biome System ──
// Biome selection, per-biome height functions, surface/subsurface block types.
// To add a new biome: add a variant, implement height + block functions,
// update get_biome hash mapping.

use super::noise::*;
use super::*;

#[derive(Clone, Copy, PartialEq)]
pub enum Biome {
    Desert,
    Forest,
    Urban,
    Mountains,
    Plains,
    Airport,
    MilitaryOutpost,
}

const BIOME_CELL_SIZE: i32 = 90;

fn hash_u64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

fn airport_cell(seed: u64) -> Option<(i32, i32)> {
    let min_cx = 1;
    let min_cz = 1;
    let max_cx = ((WORLD_SIZE_X as i32 - 1) / BIOME_CELL_SIZE) - 1;
    let max_cz = ((WORLD_SIZE_Z as i32 - 1) / BIOME_CELL_SIZE) - 1;
    if max_cx < min_cx || max_cz < min_cz {
        return None;
    }

    let span_x = (max_cx - min_cx + 1) as u64;
    let span_z = (max_cz - min_cz + 1) as u64;
    let mut cx = min_cx + (hash_u64(seed ^ 0x93c4_67e3_5f2a_101d) % span_x) as i32;
    let mut cz = min_cz + (hash_u64(seed ^ 0x1f0d_ea72_c95b_8841) % span_z) as i32;

    let world_cx = WORLD_SIZE_X as i32 / 2;
    let world_cz = WORLD_SIZE_Z as i32 / 2;
    let center_x = cx * BIOME_CELL_SIZE + BIOME_CELL_SIZE / 2;
    let center_z = cz * BIOME_CELL_SIZE + BIOME_CELL_SIZE / 2;
    let dx = center_x - world_cx;
    let dz = center_z - world_cz;

    // Keep the airport away from the forced-Urban center gameplay zone.
    if dx * dx + dz * dz < 120 * 120 {
        let mid_x = (min_cx + max_cx) / 2;
        let mid_z = (min_cz + max_cz) / 2;
        cx = if cx <= mid_x { min_cx } else { max_cx };
        cz = if cz <= mid_z { min_cz } else { max_cz };
    }

    Some((cx, cz))
}

fn outpost_cell(seed: u64) -> Option<(i32, i32)> {
    let min_cx = 1;
    let min_cz = 1;
    let max_cx = ((WORLD_SIZE_X as i32 - 1) / BIOME_CELL_SIZE) - 1;
    let max_cz = ((WORLD_SIZE_Z as i32 - 1) / BIOME_CELL_SIZE) - 1;
    if max_cx < min_cx || max_cz < min_cz {
        return None;
    }

    let span_x = (max_cx - min_cx + 1) as u64;
    let span_z = (max_cz - min_cz + 1) as u64;
    // Use different hash constants than airport to get a different cell
    let mut cx = min_cx + (hash_u64(seed ^ 0xa1b2_c3d4_e5f6_7890) % span_x) as i32;
    let mut cz = min_cz + (hash_u64(seed ^ 0x1234_5678_9abc_def0) % span_z) as i32;

    let world_cx = WORLD_SIZE_X as i32 / 2;
    let world_cz = WORLD_SIZE_Z as i32 / 2;
    let center_x = cx * BIOME_CELL_SIZE + BIOME_CELL_SIZE / 2;
    let center_z = cz * BIOME_CELL_SIZE + BIOME_CELL_SIZE / 2;
    let dx = center_x - world_cx;
    let dz = center_z - world_cz;

    // Keep outpost away from the forced-Urban center gameplay zone.
    if dx * dx + dz * dz < 120 * 120 {
        let mid_x = (min_cx + max_cx) / 2;
        let mid_z = (min_cz + max_cz) / 2;
        cx = if cx <= mid_x { max_cx } else { min_cx };
        cz = if cz <= mid_z { max_cz } else { min_cz };
    }

    // Avoid overlapping with the airport: the runway is 160 blocks long (±80
    // from cell center) and the outpost compound is 60 blocks wide (±30), so
    // adjacent cells (90 blocks apart) can still overlap.  Require Chebyshev
    // distance >= 2 (i.e. at least 180 blocks between cell centres).
    if let Some((acx, acz)) = airport_cell(seed) {
        let dx_cells = (cx - acx).abs();
        let dz_cells = (cz - acz).abs();
        if dx_cells < 2 && dz_cells < 2 {
            // Push outpost to the opposite side of the map from the airport.
            cx = if acx <= (min_cx + max_cx) / 2 { max_cx } else { min_cx };
            cz = if acz <= (min_cz + max_cz) / 2 { max_cz } else { min_cz };
        }
    }

    Some((cx, cz))
}

// ── Biome Selection ──

pub fn get_biome(wx: i32, wz: i32, seed: u64) -> Biome {
    let cell_size = BIOME_CELL_SIZE as f64;
    let cx = (wx as f64 / cell_size).floor() as i32;
    let cz = (wz as f64 / cell_size).floor() as i32;

    // Reserve exactly one biome cell for the airport.
    if let Some((airport_cx, airport_cz)) = airport_cell(seed) {
        if cx == airport_cx && cz == airport_cz {
            return Biome::Airport;
        }
    }

    // Reserve exactly one biome cell for the military outpost.
    if let Some((outpost_cx, outpost_cz)) = outpost_cell(seed) {
        if cx == outpost_cx && cz == outpost_cz {
            return Biome::MilitaryOutpost;
        }
    }

    let mut best_dist = f64::MAX;
    let mut best_biome = Biome::Plains;

    for dci in -1..=1 {
        for dcj in -1..=1 {
            let ci = cx + dci;
            let cj = cz + dcj;
            let jx = hash2d_seeded(ci * 31, cj * 17, seed.wrapping_add(100));
            let jz = hash2d_seeded(ci * 53, cj * 41, seed.wrapping_add(200));
            let center_x = (ci as f64 + 0.3 + jx * 0.4) * cell_size;
            let center_z = (cj as f64 + 0.3 + jz * 0.4) * cell_size;

            let dx = wx as f64 - center_x;
            let dz = wz as f64 - center_z;
            let dist = dx * dx + dz * dz;

            if dist < best_dist {
                best_dist = dist;
                let biome_hash = hash2d_seeded(ci * 97, cj * 89, seed.wrapping_add(300));
                best_biome = match (biome_hash * 100.0) as u32 {
                    0..=19 => Biome::Desert,
                    20..=39 => Biome::Forest,
                    40..=59 => Biome::Urban,
                    60..=79 => Biome::Mountains,
                    _ => Biome::Plains,
                };
            }
        }
    }

    // Force center area to Urban for gameplay
    let center = WORLD_SIZE_X as f64 / 2.0;
    let dx = wx as f64 - center;
    let dz = wz as f64 - center;
    if dx * dx + dz * dz < 44.0 * 44.0 {
        return Biome::Urban;
    }

    best_biome
}

// ── Per-Biome Height ──

pub fn biome_height(biome: Biome, wx: i32, wz: i32, seed: u64) -> i32 {
    let nx = wx as f64 / 96.0;
    let nz = wz as f64 / 96.0;

    let h = match biome {
        Biome::Desert => {
            let base = 4.0 + fbm_seeded(nx * 2.4, nz * 2.4, 4, seed.wrapping_add(10)) * 4.6;
            base.max(3.0).min(9.0)
        }
        Biome::Forest => {
            let base = 4.0 + fbm_seeded(nx * 3.4, nz * 3.4, 4, seed.wrapping_add(20)) * 6.6;
            base.max(4.0).min(12.0)
        }
        Biome::Urban => {
            let base = 4.5 + fbm_seeded(nx * 4.8, nz * 4.8, 3, seed.wrapping_add(30)) * 1.7;
            let center = WORLD_SIZE_X as f64 / 2.0;
            let dx = wx as f64 - center;
            let dz = wz as f64 - center;
            let cd = (dx * dx + dz * dz).sqrt();
            if cd < 28.0 {
                lrp(5.0, base, sm(cd / 28.0))
            } else {
                base
            }
            .max(4.0)
            .min(8.0)
        }
        Biome::Mountains => {
            let base = 6.0 + fbm_seeded(nx * 2.8, nz * 2.8, 5, seed.wrapping_add(40)) * 20.0;
            base.max(5.0).min(25.0)
        }
        Biome::Plains => {
            let base = 3.0 + fbm_seeded(nx * 3.4, nz * 3.4, 3, seed.wrapping_add(50)) * 3.8;
            base.max(3.0).min(6.0)
        }
        Biome::Airport => {
            let base: f64 = 4.0;
            base.max(4.0).min(4.0)
        }
        Biome::MilitaryOutpost => {
            // Slightly elevated flat terrain — good vantage for AA
            let base: f64 = 7.0;
            base.max(7.0).min(7.0)
        }
    };
    h.floor() as i32
}

fn sm(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

// ── Per-Biome Block Types ──

pub fn biome_surface_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => GRASS,
        Biome::Urban => ASPHALT,
        Biome::Mountains => STONE,
        Biome::Plains => GRASS,
        Biome::Airport => ASPHALT,
        Biome::MilitaryOutpost => CONCRETE,
    }
}

pub fn biome_subsurface_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => CONCRETE,
        Biome::Mountains => DARK_CONCRETE,
        Biome::Plains => DIRT,
        Biome::Airport => CONCRETE,
        Biome::MilitaryOutpost => DARK_CONCRETE,
    }
}

pub fn biome_deep_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
        Biome::Airport => DARK_CONCRETE,
        Biome::MilitaryOutpost => DARK_CONCRETE,
    }
}

pub fn biome_wall_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => BRICK,
        Biome::Airport => METAL,
        Biome::MilitaryOutpost => CONCRETE,
    }
}

pub fn biome_floor_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
        Biome::Airport => CONCRETE,
        Biome::MilitaryOutpost => DARK_CONCRETE,
    }
}

pub fn in_spawn_safe_zone(wx: i32, wz: i32) -> bool {
    let center = WORLD_SIZE_X as i32 / 2;
    let dx = wx - center;
    let dz = wz - center;
    dx * dx + dz * dz < 28 * 28
}
