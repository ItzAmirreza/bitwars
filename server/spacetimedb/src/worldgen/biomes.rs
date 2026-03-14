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
}

// ── Biome Selection ──

pub fn get_biome(wx: i32, wz: i32, seed: u64) -> Biome {
    let cell_size = 90.0;
    let cx = (wx as f64 / cell_size).floor() as i32;
    let cz = (wz as f64 / cell_size).floor() as i32;

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
                best_biome = match (biome_hash * 5.0) as u32 {
                    0 => Biome::Desert,
                    1 => Biome::Forest,
                    2 => Biome::Urban,
                    3 => Biome::Mountains,
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
    }
}

pub fn biome_subsurface_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => CONCRETE,
        Biome::Mountains => DARK_CONCRETE,
        Biome::Plains => DIRT,
    }
}

pub fn biome_deep_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => DIRT,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
    }
}

pub fn biome_wall_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => BRICK,
    }
}

pub fn biome_floor_block(biome: Biome) -> u8 {
    match biome {
        Biome::Desert => SAND,
        Biome::Forest => WOOD,
        Biome::Urban => DARK_CONCRETE,
        Biome::Mountains => STONE,
        Biome::Plains => DIRT,
    }
}

pub fn in_spawn_safe_zone(wx: i32, wz: i32) -> bool {
    let center = WORLD_SIZE_X as i32 / 2;
    let dx = wx - center;
    let dz = wz - center;
    dx * dx + dz * dz < 28 * 28
}
