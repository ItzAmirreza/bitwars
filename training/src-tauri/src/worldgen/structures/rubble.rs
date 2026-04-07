// ── Rubble Pile ──
// Circular mound of mixed debris blocks.

use super::super::noise::*;
use super::super::*;

pub fn place_rubble_pile(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    radius: i32,
    base_y: i32,
    seed: u64,
) {
    let pile_h = 2 + (hash2d_seeded(ox * 3, oz * 7, seed.wrapping_add(2000)) * 4.0) as i32;
    let r = radius.min(6);

    for dx in -r..=r {
        for dz in -r..=r {
            let dist = ((dx * dx + dz * dz) as f64).sqrt();
            if dist > r as f64 {
                continue;
            }
            let x = ox + dx;
            let z = oz + dz;
            if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 {
                continue;
            }

            let py = (pile_h as f64 * (1.0 - dist / r as f64)).floor() as i32;
            for y in 1..=py {
                let by = base_y + y;
                if by >= WORLD_SIZE_Y as i32 {
                    break;
                }
                let r_val = hash2d_seeded(x * 11 + y, z * 17, seed.wrapping_add(2100));
                let bt = if r_val < 0.4 {
                    RUBBLE
                } else if r_val < 0.6 {
                    CONCRETE
                } else if r_val < 0.75 {
                    REBAR
                } else if r_val < 0.9 {
                    BRICK
                } else {
                    DARK_CONCRETE
                };
                set_chunk_block(cb, cx, cy, cz, x, by, z, bt);
            }
        }
    }
}
