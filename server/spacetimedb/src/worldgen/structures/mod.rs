// ── Structure Generation ──
// Each structure type lives in its own file. To add a new structure:
//   1. Create a new file (e.g. structures/warehouse.rs)
//   2. Implement `pub fn place_warehouse(cb, cx, cy, cz, ox, oz, ...)`
//   3. Add `pub mod warehouse;` here
//   4. Add a match arm in `place_structure_in_chunk`
//   5. Update biome probability tables in `place_biome_structures`

pub mod airstrip;
pub mod barricade;
pub mod outpost;
pub mod building;
pub mod bunker;
pub mod city_block;
pub mod megatower;
pub mod rubble;
pub mod tower;
pub mod vegetation;

use super::biomes::*;
use super::noise::*;
use super::*;

// ── Structure Dispatcher ──

pub fn place_structure_in_chunk(
    cb: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    struct_ox: i32,
    struct_oz: i32,
    struct_type: u8,
    sw: i32,
    sd: i32,
    biome: Biome,
    seed: u64,
) {
    let base_h = biome_height(biome, struct_ox + sw / 2, struct_oz + sd / 2, seed);

    match struct_type {
        0 => building::place_ruined_building(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, sd, base_h, biome, seed,
        ),
        1 => tower::place_tower(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, base_h, biome, seed,
        ),
        2 => bunker::place_bunker(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, sd, base_h, biome, seed,
        ),
        3 => barricade::place_barricade_line(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, base_h, biome, seed,
        ),
        4 => rubble::place_rubble_pile(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, base_h, seed,
        ),
        5 => city_block::place_city_block(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, sd, base_h, seed,
        ),
        _ => megatower::place_megatower(
            cb, chunk_wx, chunk_wy, chunk_wz, struct_ox, struct_oz, sw, sd, base_h, biome, seed,
        ),
    }
}

// Re-export for mod.rs generate_chunk
pub use airstrip::place_airport_layouts;
pub use outpost::place_outpost_layouts;
pub use vegetation::scatter_vegetation;

// ── Shared Helper ──

pub fn fill_urban_base(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    x0: i32,
    z0: i32,
    w: i32,
    d: i32,
    base_y: i32,
    bt: u8,
) {
    for x in 0..w {
        for z in 0..d {
            for y in base_y - 2..=base_y {
                if y < 0 || y >= WORLD_SIZE_Y as i32 {
                    continue;
                }
                set_chunk_block(cb, cx, cy, cz, x0 + x, y, z0 + z, bt);
            }
        }
    }
}

// ── Phase 3a: Urban districts ──

pub fn place_urban_districts(
    chunk_blocks: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    seed: u64,
) {
    let city_grid = 84;
    let city_min_gx = (chunk_wx - city_grid).div_euclid(city_grid) - 1;
    let city_max_gx = (chunk_wx + CHUNK_SIZE as i32 + city_grid).div_euclid(city_grid) + 1;
    let city_min_gz = (chunk_wz - city_grid).div_euclid(city_grid) - 1;
    let city_max_gz = (chunk_wz + CHUNK_SIZE as i32 + city_grid).div_euclid(city_grid) + 1;

    for gx in city_min_gx..=city_max_gx {
        for gz in city_min_gz..=city_max_gz {
            let jitter_x =
                (hash2d_seeded(gx * 17, gz * 29, seed.wrapping_add(5000)) * 18.0) as i32 - 9;
            let jitter_z =
                (hash2d_seeded(gx * 31, gz * 43, seed.wrapping_add(5001)) * 18.0) as i32 - 9;
            let sox = gx * city_grid + city_grid / 2 + jitter_x;
            let soz = gz * city_grid + city_grid / 2 + jitter_z;

            if sox < 0 || sox >= WORLD_SIZE_X as i32 || soz < 0 || soz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if in_spawn_safe_zone(sox, soz) {
                continue;
            }

            let biome = get_biome(sox, soz, seed);
            let district_roll = hash2d_seeded(gx * 107, gz * 113, seed.wrapping_add(5002));

            if biome == Biome::Urban && district_roll > 0.20 {
                let district_w =
                    30 + (hash2d_seeded(gx * 19, gz * 23, seed.wrapping_add(5003)) * 22.0) as i32;
                let district_d =
                    30 + (hash2d_seeded(gx * 41, gz * 47, seed.wrapping_add(5004)) * 22.0) as i32;
                let ox = (sox - district_w / 2).clamp(1, WORLD_SIZE_X as i32 - district_w - 1);
                let oz = (soz - district_d / 2).clamp(1, WORLD_SIZE_Z as i32 - district_d - 1);

                place_structure_in_chunk(
                    chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    ox,
                    oz,
                    5,
                    district_w,
                    district_d,
                    biome,
                    seed,
                );

                if hash2d_seeded(gx * 53, gz * 59, seed.wrapping_add(5005)) > 0.46 {
                    let tw = 14
                        + (hash2d_seeded(gx * 61, gz * 67, seed.wrapping_add(5006)) * 6.0) as i32;
                    let td = 14
                        + (hash2d_seeded(gx * 71, gz * 73, seed.wrapping_add(5007)) * 6.0) as i32;
                    let tox = (ox + district_w / 2 - tw / 2).clamp(1, WORLD_SIZE_X as i32 - tw - 1);
                    let toz = (oz + district_d / 2 - td / 2).clamp(1, WORLD_SIZE_Z as i32 - td - 1);
                    place_structure_in_chunk(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        tox,
                        toz,
                        6,
                        tw,
                        td,
                        biome,
                        seed,
                    );
                }
            }
        }
    }
}

// ── Phase 3b: Dense structures across all biomes ──

pub fn place_biome_structures(
    chunk_blocks: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    seed: u64,
) {
    let grid = 28;
    let min_gx = (chunk_wx - grid).div_euclid(grid) - 1;
    let max_gx = (chunk_wx + CHUNK_SIZE as i32 + grid).div_euclid(grid) + 1;
    let min_gz = (chunk_wz - grid).div_euclid(grid) - 1;
    let max_gz = (chunk_wz + CHUNK_SIZE as i32 + grid).div_euclid(grid) + 1;

    for gx in min_gx..=max_gx {
        for gz in min_gz..=max_gz {
            let sox = gx * grid + grid / 2;
            let soz = gz * grid + grid / 2;
            if sox < 0 || sox >= WORLD_SIZE_X as i32 || soz < 0 || soz >= WORLD_SIZE_Z as i32 {
                continue;
            }
            if in_spawn_safe_zone(sox, soz) {
                continue;
            }

            let biome = get_biome(sox, soz, seed);
            // Airport and MilitaryOutpost biomes have their own dedicated layouts
            if biome == Biome::Airport || biome == Biome::MilitaryOutpost {
                continue;
            }
            let density = match biome {
                Biome::Urban => 0.84,
                Biome::Forest => 0.74,
                Biome::Plains => 0.70,
                Biome::Desert => 0.60,
                Biome::Mountains => 0.64,
                Biome::Airport | Biome::MilitaryOutpost => unreachable!(),
            };
            let roll = hash2d_seeded(gx * 127, gz * 131, seed.wrapping_add(6000));
            if roll > density {
                continue;
            }

            let type_roll = hash2d_seeded(gx * 71, gz * 83, seed.wrapping_add(6001));
            let size_roll = hash2d_seeded(gx * 43, gz * 59, seed.wrapping_add(6002));

            let mut sw = match biome {
                Biome::Urban => 10 + (size_roll * 12.0) as i32,
                Biome::Forest => 8 + (size_roll * 9.0) as i32,
                Biome::Plains => 8 + (size_roll * 10.0) as i32,
                Biome::Desert => 7 + (size_roll * 9.0) as i32,
                Biome::Mountains => 7 + (size_roll * 8.0) as i32,
                Biome::Airport | Biome::MilitaryOutpost => unreachable!(),
            };
            let mut sd = match biome {
                Biome::Urban => {
                    10 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 12.0) as i32
                }
                Biome::Forest => {
                    8 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 9.0) as i32
                }
                Biome::Plains => {
                    8 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 10.0) as i32
                }
                Biome::Desert => {
                    7 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 9.0) as i32
                }
                Biome::Mountains => {
                    7 + (hash2d_seeded(gx * 23, gz * 37, seed.wrapping_add(6003)) * 8.0) as i32
                }
                Biome::Airport | Biome::MilitaryOutpost => unreachable!(),
            };

            let struct_type = match biome {
                Biome::Urban => {
                    if type_roll < 0.24 {
                        0
                    } else if type_roll < 0.43 {
                        1
                    } else if type_roll < 0.58 {
                        2
                    } else if type_roll < 0.72 {
                        3
                    } else if type_roll < 0.88 {
                        5
                    } else if type_roll < 0.95 {
                        6
                    } else {
                        4
                    }
                }
                Biome::Forest => {
                    if type_roll < 0.28 {
                        0
                    } else if type_roll < 0.52 {
                        2
                    } else if type_roll < 0.72 {
                        3
                    } else {
                        4
                    }
                }
                Biome::Desert => {
                    if type_roll < 0.33 {
                        2
                    } else if type_roll < 0.62 {
                        3
                    } else if type_roll < 0.82 {
                        0
                    } else {
                        4
                    }
                }
                Biome::Mountains => {
                    if type_roll < 0.26 {
                        1
                    } else if type_roll < 0.52 {
                        2
                    } else if type_roll < 0.78 {
                        0
                    } else {
                        4
                    }
                }
                Biome::Plains => {
                    if type_roll < 0.25 {
                        0
                    } else if type_roll < 0.50 {
                        2
                    } else if type_roll < 0.70 {
                        3
                    } else if type_roll < 0.86 {
                        5
                    } else {
                        4
                    }
                }
                Biome::Airport | Biome::MilitaryOutpost => unreachable!(),
            };

            if struct_type == 5 {
                sw = sw.max(18);
                sd = sd.max(18);
            } else if struct_type == 6 {
                sw = sw.max(14);
                sd = sd.max(14);
            }

            let ox = (sox - sw / 2).clamp(1, WORLD_SIZE_X as i32 - sw - 1);
            let oz = (soz - sd / 2).clamp(1, WORLD_SIZE_Z as i32 - sd - 1);
            place_structure_in_chunk(
                chunk_blocks,
                chunk_wx,
                chunk_wy,
                chunk_wz,
                ox,
                oz,
                struct_type,
                sw,
                sd,
                biome,
                seed,
            );
        }
    }
}
