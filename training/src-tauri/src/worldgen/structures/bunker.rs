// ── Bunker ──
// Low fortified structure with window slits and partial roof damage.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::*;

pub fn place_bunker(
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
    let h = 4;
    let wall_bt = biome_wall_block(biome);

    for y in 0..h {
        for x in 0..w {
            for z in 0..d {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_roof = y == h - 1;
                let is_floor = y == 0;
                let is_door = (x == w / 2 || x == w / 2 + 1) && z == 0 && y < 3;

                if is_door {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, biome_floor_block(biome));
                } else if is_roof && x > 0 && x < w - 1 && z > 0 && z < d - 1 {
                    let dmg = hash2d_seeded(bx * 11, bz * 13, seed.wrapping_add(1600));
                    if dmg > 0.2 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                } else if is_wall {
                    let is_slit = y == 2 && (x % 3 == 0 || z % 3 == 0);
                    if !is_slit {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                    }
                }
            }
        }
    }
}
