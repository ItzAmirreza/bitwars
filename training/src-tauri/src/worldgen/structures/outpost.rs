// ── Military Outpost Layout ──
// Hardcoded layout for the MilitaryOutpost biome.
// A flat concrete compound with sandbag perimeter walls, a watchtower,
// an ammo bunker, and a central vehicle pad where the AA vehicle spawns.
//
// Layout (relative to biome cell center):
//   - Compound: 60x60 block area, concrete surface, elevated at y=7
//   - Perimeter wall: 2-block-high concrete walls with firing slits
//   - Watchtower: 12-block-tall tower in NW corner for spotting
//   - Ammo bunker: reinforced bunker in SE corner
//   - Vehicle pad: marked 12x12 concrete pad at center (AA spawn point)
//   - Sandbag positions: 4 firing positions at cardinal edges

use super::super::biomes::*;
use super::super::noise::*;
use super::super::*;

/// Compound half-size (the total compound is COMPOUND_HALF*2 on each side).
const COMPOUND_HALF: i32 = 30;

/// Called from generate_chunk. Iterates biome grid to find MilitaryOutpost
/// cells and places the hardcoded layout for each one.
pub fn place_outpost_layouts(
    cb: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    seed: u64,
) {
    let cell_size = 90i32;
    let scan_range = cell_size + COMPOUND_HALF * 2;
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
            if biome != Biome::MilitaryOutpost {
                continue;
            }

            let base_y = biome_height(biome, center_x, center_z, seed);
            place_single_outpost(
                cb, chunk_wx, chunk_wy, chunk_wz, center_x, center_z, base_y, seed,
            );
        }
    }
}

/// Returns the AA vehicle spawn position for a given outpost biome cell center.
/// The vehicle spawns at the center of the compound on the vehicle pad.
pub fn outpost_vehicle_spawn(center_x: i32, center_z: i32, base_y: i32) -> (i32, i32, i32) {
    (center_x, base_y + 1, center_z)
}

fn place_single_outpost(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    center_x: i32,
    center_z: i32,
    base_y: i32,
    seed: u64,
) {
    let x0 = center_x - COMPOUND_HALF;
    let x1 = center_x + COMPOUND_HALF;
    let z0 = center_z - COMPOUND_HALF;
    let z1 = center_z + COMPOUND_HALF;
    let clear_top = base_y + 16;

    // ── Ground preparation: flatten entire compound ──
    let pad = 4;
    for x in (x0 - pad)..=(x1 + pad) {
        for z in (z0 - pad)..=(z1 + pad) {
            for y in 0..=base_y {
                let bt = if y == base_y {
                    CONCRETE
                } else if y >= base_y - 2 {
                    DARK_CONCRETE
                } else {
                    STONE
                };
                set_chunk_block(cb, cx, cy, cz, x, y, z, bt);
            }
            for y in (base_y + 1)..=clear_top {
                force_chunk_block(cb, cx, cy, cz, x, y, z, AIR);
            }
        }
    }

    // ── Perimeter walls (2 blocks high with firing slits) ──
    for x in x0..=x1 {
        for z in z0..=z1 {
            let on_edge = x == x0 || x == x1 || z == z0 || z == z1;
            if !on_edge {
                continue;
            }

            // Wall base (y+1)
            set_chunk_block(cb, cx, cy, cz, x, base_y + 1, z, CONCRETE);

            // Wall top (y+2) — with firing slits every 4 blocks
            let along_wall = if x == x0 || x == x1 { z - z0 } else { x - x0 };
            let is_slit = along_wall % 4 == 2;
            // Leave gaps at gate positions (center of each wall, 6 blocks wide)
            let gate_x = (x - center_x).abs() <= 3 && (z == z0 || z == z1);
            let gate_z = (z - center_z).abs() <= 3 && (x == x0 || x == x1);
            let is_gate = gate_x || gate_z;

            if is_gate {
                // No wall at gate openings
                force_chunk_block(cb, cx, cy, cz, x, base_y + 1, z, AIR);
            } else if !is_slit {
                set_chunk_block(cb, cx, cy, cz, x, base_y + 2, z, CONCRETE);
            }
        }
    }

    // ── Corner reinforcements (3x3 pillars, 3 blocks high) ──
    let corners = [(x0, z0), (x0, z1 - 2), (x1 - 2, z0), (x1 - 2, z1 - 2)];
    for (corner_x, corner_z) in corners {
        for dx in 0..3 {
            for dz in 0..3 {
                for dy in 1..=3 {
                    set_chunk_block(
                        cb,
                        cx,
                        cy,
                        cz,
                        corner_x + dx,
                        base_y + dy,
                        corner_z + dz,
                        DARK_CONCRETE,
                    );
                }
                // Lantern on top of corner pillars
                if dx == 1 && dz == 1 {
                    set_chunk_block(
                        cb,
                        cx,
                        cy,
                        cz,
                        corner_x + 1,
                        base_y + 4,
                        corner_z + 1,
                        LANTERN,
                    );
                }
            }
        }
    }

    // ── Vehicle pad (12x12, marked with dark concrete border) ──
    let pad_half = 6;
    for x in (center_x - pad_half)..=(center_x + pad_half) {
        for z in (center_z - pad_half)..=(center_z + pad_half) {
            let on_pad_edge = x == center_x - pad_half
                || x == center_x + pad_half
                || z == center_z - pad_half
                || z == center_z + pad_half;
            let bt = if on_pad_edge { DARK_CONCRETE } else { ASPHALT };
            set_chunk_block(cb, cx, cy, cz, x, base_y, z, bt);
        }
    }

    // ── Watchtower (NW corner, 12 blocks tall) ──
    let tower_x = x0 + 5;
    let tower_z = z0 + 5;
    place_watchtower(cb, cx, cy, cz, tower_x, tower_z, base_y, seed);

    // ── Ammo bunker (SE area) ──
    let bunker_x = x1 - 16;
    let bunker_z = z1 - 14;
    place_ammo_bunker(cb, cx, cy, cz, bunker_x, bunker_z, 10, 8, base_y, seed);

    // ── Barracks (NE area) ──
    let barracks_x = x1 - 16;
    let barracks_z = z0 + 5;
    place_barracks(cb, cx, cy, cz, barracks_x, barracks_z, 12, 8, base_y, seed);

    // ── Sandbag firing positions at each gate ──
    // North gate
    place_sandbag_position(cb, cx, cy, cz, center_x, z0 - 3, base_y, true);
    // South gate
    place_sandbag_position(cb, cx, cy, cz, center_x, z1 + 1, base_y, true);
    // West gate
    place_sandbag_position(cb, cx, cy, cz, x0 - 3, center_z, base_y, false);
    // East gate
    place_sandbag_position(cb, cx, cy, cz, x1 + 1, center_z, base_y, false);
}

fn place_watchtower(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    ox: i32,
    oz: i32,
    base_y: i32,
    _seed: u64,
) {
    let size = 5;
    let h = 12;

    for x in 0..size {
        for z in 0..size {
            for y in 0..h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if by >= WORLD_SIZE_Y as i32 {
                    continue;
                }

                let is_corner = (x == 0 || x == size - 1) && (z == 0 || z == size - 1);
                let is_wall = x == 0 || x == size - 1 || z == 0 || z == size - 1;
                let is_platform = y >= h - 3;
                let is_roof = y == h - 1;
                let is_floor = y == 0;

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    // Open roof with railing
                    if is_wall {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, METAL);
                    }
                    // Lantern at center of roof
                    if x == size / 2 && z == size / 2 {
                        set_chunk_block(cb, cx, cy, cz, bx, by + 1, bz, LANTERN);
                    }
                } else if is_platform && is_wall && !is_corner {
                    // Observation level: walls with window gaps
                    if y == h - 2 {
                        // Window row — leave open
                    } else {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                    }
                } else if is_platform && is_corner {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if !is_platform && is_corner {
                    // Support pillars below the platform
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, REBAR);
                } else if y == h - 3 && !is_corner {
                    // Platform floor
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, METAL);
                }
                // Interior ladder (center column)
                if x == size / 2 && z == size / 2 && y < h - 3 {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, REBAR);
                }
            }
        }
    }
}

fn place_ammo_bunker(
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
    let h = 4;
    for x in 0..w {
        for z in 0..d {
            for y in 0..h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if by >= WORLD_SIZE_Y as i32 {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_roof = y == h - 1;
                let is_floor = y == 0;
                let is_door = z == 0 && x > 2 && x < w - 3 && y < 3;
                let is_slit = is_wall && y == 2 && (x % 4 == 0 || z % 4 == 0);

                if is_door || is_slit {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    // Reinforced roof with some damage
                    let dmg = hash2d_seeded(bx * 13, bz * 17, seed.wrapping_add(9900));
                    if dmg > 0.08 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, DARK_CONCRETE);
                    }
                } else if is_wall {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                }
            }
        }
    }
}

fn place_barracks(
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
    let h = 5;
    for x in 0..w {
        for z in 0..d {
            for y in 0..h {
                let bx = ox + x;
                let bz = oz + z;
                let by = base_y + 1 + y;
                if by >= WORLD_SIZE_Y as i32 {
                    continue;
                }

                let is_wall = x == 0 || x == w - 1 || z == 0 || z == d - 1;
                let is_roof = y == h - 1;
                let is_floor = y == 0;
                let is_door = z == d - 1 && x > 1 && x < w - 2 && y < 3;
                let is_window = is_wall && y == 2 && (x % 5 == 2 || z % 5 == 2);

                if is_door || is_window {
                    continue;
                }

                if is_floor {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                } else if is_roof {
                    let dmg = hash2d_seeded(bx * 11, bz * 19, seed.wrapping_add(9950));
                    if dmg > 0.06 {
                        set_chunk_block(cb, cx, cy, cz, bx, by, bz, METAL);
                    }
                } else if is_wall {
                    set_chunk_block(cb, cx, cy, cz, bx, by, bz, CONCRETE);
                }
            }
        }
    }
}

fn place_sandbag_position(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    center_x: i32,
    center_z: i32,
    base_y: i32,
    along_x: bool,
) {
    // A U-shaped sandbag wall (2 blocks high) providing cover
    let half = 2;
    for dx in -half..=half {
        for dz in -half..=half {
            let x = center_x + dx;
            let z = center_z + dz;

            // U-shape: walls on 3 sides, open toward the compound
            let is_sandbag = if along_x {
                dx == -half || dx == half || dz == -half || dz == half
            } else {
                dx == -half || dx == half || dz == -half || dz == half
            };

            // Leave one side open (facing the compound)
            let is_open = if along_x {
                dz == half // open toward compound (south/north)
            } else {
                dx == half // open toward compound (east/west)
            };

            if is_sandbag && !is_open {
                set_chunk_block(cb, cx, cy, cz, x, base_y + 1, z, SAND);
                set_chunk_block(cb, cx, cy, cz, x, base_y + 2, z, SAND);
            }
        }
    }
}
