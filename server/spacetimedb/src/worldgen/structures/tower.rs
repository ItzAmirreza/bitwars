// ── Watch Tower ──
// Tall narrow tower with damaged top and mid-level platforms.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::roads::*;
use super::super::*;

pub fn place_tower(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    base_y: i32,
    biome: Biome,
    seed: u64,
) {
    let height = 10 + (hash2d_seeded(ox * 29, oz * 37, seed.wrapping_add(1300)) * 8.0) as i32;
    let tw = 5;
    let wall_bt = biome_wall_block(biome);

    for y in 0..height {
        for x in 0..tw {
            for z in 0..tw {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == tw - 1 || z == 0 || z == tw - 1;
                if !is_wall {
                    continue;
                }

                if y > height - 4 {
                    let keep = hash2d_seeded(bx * 13 + y, bz * 7 + y, seed.wrapping_add(1400));
                    if keep < 0.4 {
                        continue;
                    }
                    let bt = if keep > 0.8 { REBAR } else { wall_bt };
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                } else {
                    let collapse = if x == 0 && y > height / 2 { 0.35 } else { 0.05 };
                    if hash2d_seeded(bx * 11 + y, bz * 17, seed.wrapping_add(1500)) > collapse {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                }
            }
        }
    }

    for x in 0..tw {
        for z in 0..tw {
            let bx = ox + x;
            let bz = oz + z;
            if bx >= WORLD_SIZE_X as i32 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, biome_floor_block(biome));
            let mid_y = base_y + 1 + height / 2;
            if mid_y < WORLD_SIZE_Y as i32 {
                set_chunk_block(cb, cx, cy, cz, bx, mid_y, bz, biome_floor_block(biome));
            }
        }
    }

    let tower_top = base_y + height;
    place_rooftop_lantern(cb, cx, cy, cz, ox, tower_top, oz);
    place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, tower_top, oz);
    place_rooftop_lantern(cb, cx, cy, cz, ox, tower_top, oz + tw - 1);
    place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, tower_top, oz + tw - 1);
}
