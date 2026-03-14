// ── Barricade Line ──
// Linear defensive wall following terrain height.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::*;

pub fn place_barricade_line(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    len: i32,
    _base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let h = 2 + (hash2d_seeded(ox * 47, oz * 53, seed.wrapping_add(1700)) * 2.0) as i32;
    let is_ns = hash2d_seeded(ox * 61, oz * 67, seed.wrapping_add(1800)) > 0.5;
    let wall_bt = biome_wall_block(biome);

    for i in 0..len {
        let x = if is_ns { ox } else { ox + i };
        let z = if is_ns { oz + i } else { oz };
        if x >= WORLD_SIZE_X as i32 || z >= WORLD_SIZE_Z as i32 {
            continue;
        }
        let local_base = biome_height(biome, x, z, seed);

        for y in 1..=h {
            let by = local_base + y;
            if by >= WORLD_SIZE_Y as i32 {
                break;
            }
            let bt = if hash2d_seeded(x * 5 + y, z * 9, seed.wrapping_add(1900)) > 0.4 {
                SAND
            } else {
                wall_bt
            };
            set_chunk_block(cb, cx, cy, cz, x, by, z, bt);
        }
    }
}
