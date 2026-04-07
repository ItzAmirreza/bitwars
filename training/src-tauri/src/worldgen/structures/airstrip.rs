// ── Airport Layout ──
// Hardcoded airport layout for the Airport biome.
// Each Airport biome cell gets a single long runway through its center
// with buildings placed only at the far edges, well clear of the flight path.
//
// Layout (relative to biome cell center):
//   - Runway: runs along X axis, centered at Z=center, 82 blocks long, 7 wide
//   - Clearance zone: 22 blocks on each side of the runway — no structures
//   - Hangars: placed at z < center-22 or z > center+22
//   - Control tower: at one corner
//   - Edge lighting: lanterns along the runway

use super::super::biomes::*;
use super::super::noise::*;
use super::super::*;

/// Clearance zone on each side of runway (no structures within this distance).
const RUNWAY_CLEARANCE: i32 = 22;
/// The runway half-width (blocks on each side of centerline).
const RUNWAY_HALF_W: i32 = 3;

/// Runway length (along X axis).
pub const RUNWAY_LENGTH: i32 = 160;

/// Called from generate_chunk. Iterates biome grid to find Airport cells
/// and places the hardcoded airport layout for each one.
pub fn place_airport_layouts(
    cb: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    seed: u64,
) {
    // Iterate biome cells that could overlap this chunk.
    // Biome cell_size = 90 (matching get_biome).
    let cell_size = 90i32;
    let scan_range = cell_size + RUNWAY_LENGTH; // conservative overlap check
    let min_cx = (chunk_wx - scan_range).div_euclid(cell_size) - 1;
    let max_cx = (chunk_wx + CHUNK_SIZE as i32 + scan_range).div_euclid(cell_size) + 1;
    let min_cz = (chunk_wz - scan_range).div_euclid(cell_size) - 1;
    let max_cz = (chunk_wz + CHUNK_SIZE as i32 + scan_range).div_euclid(cell_size) + 1;

    for bcx in min_cx..=max_cx {
        for bcz in min_cz..=max_cz {
            let center_x = bcx * cell_size + cell_size / 2;
            let center_z = bcz * cell_size + cell_size / 2;
            if center_x < 0
                || center_x >= WORLD_SIZE_X as i32
                || center_z < 0
                || center_z >= WORLD_SIZE_Z as i32
            {
                continue;
            }

            let biome = get_biome(center_x, center_z, seed);
            if biome != Biome::Airport {
                continue;
            }

            let base_y = biome_height(biome, center_x, center_z, seed);
            place_single_airport(
                cb, chunk_wx, chunk_wy, chunk_wz, center_x, center_z, base_y, seed,
            );
        }
    }
}

/// Returns the runway start position for a given Airport biome cell center.
/// Used by spawning.rs to place the jet at the start of the runway.
pub fn airport_runway_start(center_x: i32, center_z: i32, base_y: i32) -> (i32, i32, i32) {
    let runway_start_x = center_x - RUNWAY_LENGTH / 2 + 4;
    (runway_start_x, base_y + 1, center_z)
}

fn place_single_airport(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    center_x: i32,
    center_z: i32,
    base_y: i32,
    seed: u64,
) {
    let runway_x0 = center_x - RUNWAY_LENGTH / 2;
    let runway_x1 = center_x + RUNWAY_LENGTH / 2;
    let runway_z0 = center_z - RUNWAY_HALF_W;
    let runway_z1 = center_z + RUNWAY_HALF_W;

    // ── Ground preparation ──
    // Flatten and clear the entire airport zone so neighboring biomes
    // don't intrude with hills, trees, or wrong surface blocks.
    // Zone covers: full runway length × clearance width on each side.
    let pad = 4; // extra buffer beyond clearance for a smooth edge
    let clear_z0 = center_z - RUNWAY_CLEARANCE - pad;
    let clear_z1 = center_z + RUNWAY_CLEARANCE + pad;
    let clear_x0 = runway_x0 - pad;
    let clear_x1 = runway_x1 + pad;
    let clear_top = base_y + 14; // clear well above runway for flight path

    for x in clear_x0..=clear_x1 {
        for z in clear_z0..=clear_z1 {
            // Fill ground up to base_y with airport materials
            for y in 0..=base_y {
                let bt = if y == base_y {
                    ASPHALT
                } else if y >= base_y - 2 {
                    CONCRETE
                } else {
                    DARK_CONCRETE
                };
                set_chunk_block(cb, cx, cy, cz, x, y, z, bt);
            }
            // Clear everything above base_y (remove intruding terrain)
            for y in (base_y + 1)..=clear_top {
                force_chunk_block(cb, cx, cy, cz, x, y, z, AIR);
            }
        }
    }

    // ── Runway surface ──
    for x in runway_x0..=runway_x1 {
        for z in runway_z0..=runway_z1 {
            // Sub-surface foundation (2 layers)
            for fy in (base_y - 1)..=base_y {
                if fy >= 0 {
                    set_chunk_block(cb, cx, cy, cz, x, fy, z, CONCRETE);
                }
            }
            // Surface: asphalt with center line markings
            set_chunk_block(cb, cx, cy, cz, x, base_y, z, ASPHALT);

            // Center line (dashed dark concrete)
            if z == center_z && (x - runway_x0) % 8 < 4 {
                set_chunk_block(cb, cx, cy, cz, x, base_y, z, DARK_CONCRETE);
            }

            // Threshold markings at ends
            let from_start = x - runway_x0;
            let from_end = runway_x1 - x;
            if (from_start < 5 || from_end < 5) && (z == runway_z0 + 1 || z == runway_z1 - 1) {
                set_chunk_block(cb, cx, cy, cz, x, base_y, z, DARK_CONCRETE);
            }
        }

        // Concrete shoulders (1 block each side)
        set_chunk_block(cb, cx, cy, cz, x, base_y, runway_z0 - 1, CONCRETE);
        set_chunk_block(cb, cx, cy, cz, x, base_y, runway_z1 + 1, CONCRETE);
    }

    // ── Runway edge lights (lanterns every 10 blocks) ──
    for x in (runway_x0..=runway_x1).step_by(10) {
        for &z in &[runway_z0 - 2, runway_z1 + 2] {
            set_chunk_block(cb, cx, cy, cz, x, base_y + 1, z, LANTERN);
        }
    }

    // ── Taxiway connecting to hangar area ──
    let taxi_z0 = center_z + RUNWAY_HALF_W + 2;
    let taxi_z1 = center_z + RUNWAY_CLEARANCE - 2;
    let taxi_x = center_x;
    for z in taxi_z0..=taxi_z1 {
        for dx in -2..=2 {
            set_chunk_block(cb, cx, cy, cz, taxi_x + dx, base_y, z, ASPHALT);
        }
    }

    // ── Hangar (south side, well clear of runway) ──
    let hangar_z = center_z + RUNWAY_CLEARANCE;
    let hangar_w = 14;
    let hangar_d = 10;
    let hangar_h = 7;
    let hangar_x0 = center_x - hangar_w / 2;
    place_hangar(
        cb, cx, cy, cz, hangar_x0, hangar_z, hangar_w, hangar_d, hangar_h, base_y, seed,
    );

    // ── Control tower (north side, near runway start) ──
    let tower_x = runway_x0 + 6;
    let tower_z = center_z - RUNWAY_CLEARANCE - 4;
    place_control_tower(cb, cx, cy, cz, tower_x, tower_z, base_y);

    // ── Small bunker (south side, near runway end) ──
    let bunker_x = runway_x1 - 12;
    let bunker_z = center_z + RUNWAY_CLEARANCE + 2;
    place_small_bunker(cb, cx, cy, cz, bunker_x, bunker_z, 8, 6, base_y);

    // ── Apron / parking area near hangar ──
    let apron_x0 = center_x - 10;
    let apron_z0 = center_z + RUNWAY_CLEARANCE - 3;
    for x in apron_x0..(apron_x0 + 20) {
        for z in apron_z0..(apron_z0 + 5) {
            set_chunk_block(cb, cx, cy, cz, x, base_y, z, ASPHALT);
        }
    }
}

fn place_hangar(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    h: i32,
    base_y: i32,
    seed: u64,
) {
    for x in 0..w {
        for z in 0..d {
            for y in 0..h {
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
                let is_door = z == 0 && x > 2 && x < w - 3 && y < h - 1;

                if is_door {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    let dmg = hash2d_seeded(bx * 11, bz * 13, seed.wrapping_add(8800));
                    if dmg > 0.12 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, METAL);
                    }
                } else if is_wall {
                    let dmg = hash2d_seeded(bx * 7, bz * 11, seed.wrapping_add(8801));
                    if dmg > 0.08 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, METAL);
                    }
                }
            }
        }
    }
}

fn place_control_tower(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    base_y: i32,
) {
    let size = 5;
    let h = 10;

    for x in 0..size {
        for z in 0..size {
            for y in 0..h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if bx >= WORLD_SIZE_X as i32
                    || bz >= WORLD_SIZE_Z as i32
                    || by >= WORLD_SIZE_Y as i32
                {
                    continue;
                }

                let is_wall = x == 0 || x == size - 1 || z == 0 || z == size - 1;
                let is_roof = y == h - 1;
                let is_floor = y == 0;
                let is_door = z == size - 1 && (x == 1 || x == 2) && y < 3;
                let is_observation = y >= h - 3 && y < h - 1;

                if is_door {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, DARK_CONCRETE);
                    if x == size / 2 && z == size / 2 {
                        set_chunk_block(cb, cx, cy, cz, bx, by + 1, bz, LANTERN);
                    }
                } else if is_wall {
                    if is_observation
                        && y == h - 2
                        && ((x > 0 && x < size - 1) || (z > 0 && z < size - 1))
                    {
                        continue;
                    }
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                }
            }
        }
    }
}

fn place_small_bunker(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    w: i32,
    d: i32,
    base_y: i32,
) {
    let h = 4;
    for x in 0..w {
        for z in 0..d {
            for y in 0..h {
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
                let is_door = z == 0 && x == w / 2 && y < 3;
                let is_slit = is_wall && y == 2 && (x % 3 == 0 || z % 3 == 0);

                if is_door || is_slit {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, DARK_CONCRETE);
                } else if is_wall {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                }
            }
        }
    }
}
