// ── Ruined Building ──
// Multi-story damaged building with rubble debris around base.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::*;

pub fn place_ruined_building(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let floors = 2 + (hash2d_seeded(ox * 11, oz * 13, seed.wrapping_add(900)) * 3.0) as i32;
    let story_h = 4;
    let total_h = floors * story_h;
    let wall_bt = biome_wall_block(biome);
    let floor_bt = biome_floor_block(biome);

    for x in 0..w {
        for z in 0..d {
            for y in 0..total_h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx < 0
                    || bx >= WORLD_SIZE_X as i32
                    || bz < 0
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_floor = y > 0 && y % story_h == 0;
                let is_door = (x == w / 2 || x == w / 2 + 1) && z == 0 && y < 3;
                let destruction =
                    hash2d_seeded(bx * 17 + by, bz * 31 + by, seed.wrapping_add(1000));

                if is_door {
                    continue;
                }

                if is_floor && !is_wall {
                    if destruction > 0.25 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, floor_bt);
                    }
                } else if is_wall {
                    let dmg_threshold = if y > story_h * 2 {
                        0.30
                    } else if y > story_h {
                        0.18
                    } else {
                        0.08
                    };
                    if destruction > dmg_threshold {
                        let bt = if destruction > 0.85 { BRICK } else { wall_bt };
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                    } else if y > total_h - 3
                        && hash2d_seeded(bx * 3, bz * 5 + by, seed.wrapping_add(1100)) > 0.5
                    {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, REBAR);
                    }
                }
            }
        }
    }

    for dx in -2..=(w + 1) {
        for dz in -2..=(d + 1) {
            let bx = ox + dx;
            let bz = oz + dz;
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if dx >= 0 && dx < w && dz >= 0 && dz < d {
                continue;
            }
            if hash2d_seeded(bx * 19, bz * 23, seed.wrapping_add(1200)) < 0.35 {
                let by = biome_height(biome, bx, bz, seed) + 1;
                if by < WORLD_SIZE_Y as i32 {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, RUBBLE);
                }
            }
        }
    }
}
