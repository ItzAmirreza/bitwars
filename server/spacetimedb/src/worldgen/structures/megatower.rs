// ── Megatower ──
// Massive high-rise with lobby, antenna, and rubble perimeter.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::roads::*;
use super::super::*;
use super::fill_urban_base;

pub fn place_megatower(
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
    let tw = w.max(12).min(22);
    let td = d.max(12).min(22);
    let tower_h = 22 + (hash2d_seeded(ox * 73, oz * 79, seed.wrapping_add(4400)) * 20.0) as i32;
    let wall_bt = if biome == Biome::Urban {
        METAL
    } else {
        biome_wall_block(biome)
    };
    let floor_bt = if biome == Biome::Urban {
        DARK_CONCRETE
    } else {
        biome_floor_block(biome)
    };

    fill_urban_base(
        cb,
        cx,
        cy,
        cz,
        ox - 2,
        oz - 2,
        tw + 4,
        td + 4,
        base_y,
        DARK_CONCRETE,
    );

    for x in 0..tw {
        for z in 0..td {
            for y in 0..tower_h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 2 + y;
                if bx < 0
                    || bx >= WORLD_SIZE_X as i32
                    || bz < 0
                    || bz >= WORLD_SIZE_Z as i32
                    || by < 0
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let edge = x == 0 || x == tw - 1 || z == 0 || z == td - 1;
                let floor = y % 5 == 0;
                let lobby = y < 4;

                if edge {
                    let is_window = y > 2
                        && !floor
                        && !lobby
                        && ((x + z + y) % 3 != 0)
                        && hash2d_seeded(bx * 7 + by, bz * 11 + by, seed.wrapping_add(4401)) > 0.18;
                    if !is_window {
                        let bt = if y > tower_h - 5 { BRICK } else { wall_bt };
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, bt);
                    }
                } else if floor || lobby {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, floor_bt);
                }
            }
        }
    }

    let roof_y = base_y + 1 + tower_h;
    if roof_y < WORLD_SIZE_Y as i32 {
        for x in 0..tw {
            for z in 0..td {
                set_chunk_block(cb, cx, cy, cz, ox + x, roof_y, oz + z, METAL);
            }
        }
        place_rooftop_lantern(cb, cx, cy, cz, ox, roof_y, oz);
        place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, roof_y, oz);
        place_rooftop_lantern(cb, cx, cy, cz, ox, roof_y, oz + td - 1);
        place_rooftop_lantern(cb, cx, cy, cz, ox + tw - 1, roof_y, oz + td - 1);

        let antenna_h = 2 + (hash2d_seeded(ox * 83, oz * 89, seed.wrapping_add(4402)) * 4.0) as i32;
        let ax = ox + tw / 2;
        let az = oz + td / 2;
        for ay in 1..=antenna_h {
            let by = roof_y + ay;
            if by >= WORLD_SIZE_Y as i32 {
                break;
            }
            set_chunk_block(cb, cx, cy, cz, ax, by, az, REBAR);
        }
        place_rooftop_lantern(cb, cx, cy, cz, ax, roof_y + antenna_h, az);
    }

    for x in -2..=(tw + 1) {
        for z in -2..=(td + 1) {
            let bx = ox + x;
            let bz = oz + z;
            if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if hash2d_seeded(bx * 97, bz * 101, seed.wrapping_add(4403)) > 0.9 {
                set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, RUBBLE);
            }
        }
    }
}
