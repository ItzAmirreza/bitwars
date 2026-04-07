// ── City Block ──
// Urban district with internal road grid and multiple tower buildings.

use super::super::noise::*;
use super::super::roads::*;
use super::super::*;
use super::fill_urban_base;

pub fn place_city_block(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
    seed: u64,
) {
    if w < 12 || d < 12 {
        return;
    }

    fill_urban_base(cb, cx, cy, cz, ox, oz, w, d, base_y, DARK_CONCRETE);

    let road_cut = 3;
    for x in 0..w {
        for z in 0..d {
            let is_road = x < road_cut || z < road_cut || x >= w - road_cut || z >= d - road_cut;
            if is_road {
                set_chunk_block(cb, cx, cy, cz, ox + x, base_y + 1, oz + z, ASPHALT);
            }
        }
    }

    let towers = 3 + (hash2d_seeded(ox * 31, oz * 37, seed.wrapping_add(4300)) * 2.0) as i32;
    for i in 0..towers {
        let tx_noise = hash2d_seeded(ox * 59 + i * 13, oz * 61, seed.wrapping_add(4301));
        let tz_noise = hash2d_seeded(ox * 41, oz * 43 + i * 17, seed.wrapping_add(4302));
        let tx = ox + road_cut + 1 + (tx_noise * (w - road_cut * 2 - 6).max(1) as f64) as i32;
        let tz = oz + road_cut + 1 + (tz_noise * (d - road_cut * 2 - 6).max(1) as f64) as i32;
        let tw = 4 + (hash2d_seeded(tx * 7, tz * 11, seed.wrapping_add(4303)) * 4.0) as i32;
        let td = 4 + (hash2d_seeded(tx * 13, tz * 5, seed.wrapping_add(4304)) * 4.0) as i32;
        let th = 10 + (hash2d_seeded(tx * 17, tz * 19, seed.wrapping_add(4305)) * 16.0) as i32;

        for x in 0..tw {
            for z in 0..td {
                for y in 0..th {
                    let bx = tx + x;
                    let bz = tz + z;
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
                    let floor = y % 4 == 0;
                    if edge {
                        let window = y > 1
                            && !floor
                            && ((x + z + y + i) % 3 != 0)
                            && hash2d_seeded(bx * 3 + by, bz * 5 + by, seed.wrapping_add(4306))
                                > 0.22;
                        if !window {
                            let wall_bt = if y > th - 4 { BRICK } else { CONCRETE };
                            set_chunk_block(cb, cx, cy, cz, bx, by, bz, wall_bt);
                        }
                    } else if floor {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, DARK_CONCRETE);
                    }
                }
            }
        }

        let roof_y = base_y + 1 + th;
        place_rooftop_lantern(cb, cx, cy, cz, tx, roof_y, tz);
        place_rooftop_lantern(cb, cx, cy, cz, tx + tw - 1, roof_y, tz);
        place_rooftop_lantern(cb, cx, cy, cz, tx, roof_y, tz + td - 1);
        place_rooftop_lantern(cb, cx, cy, cz, tx + tw - 1, roof_y, tz + td - 1);

        for x in -1..=tw {
            for z in -1..=td {
                let bx = tx + x;
                let bz = tz + z;
                if bx < 0 || bx >= WORLD_SIZE_X as i32 || bz < 0 || bz >= WORLD_SIZE_Z as i32 {
                    continue;
                }
                if hash2d_seeded(bx * 29, bz * 31, seed.wrapping_add(4307)) > 0.86 {
                    set_chunk_block(cb, cx, cy, cz, bx, base_y + 1, bz, RUBBLE);
                }
            }
        }
    }
}
