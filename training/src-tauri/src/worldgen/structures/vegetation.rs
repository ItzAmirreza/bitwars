// ── Vegetation ──
// Trees, bushes, cacti, boulders — per-biome natural decoration.

use super::super::biomes::*;
use super::super::noise::*;
use super::super::roads::*;
use super::super::*;

pub fn scatter_vegetation(
    chunk_blocks: &mut [u8; 4096],
    chunk_wx: i32,
    chunk_wy: i32,
    chunk_wz: i32,
    wx: i32,
    wz: i32,
    base_h: i32,
    biome: Biome,
    seed: u64,
) {
    if base_h < 1 || base_h >= WORLD_SIZE_Y as i32 - 8 {
        return;
    }
    if in_spawn_safe_zone(wx, wz) {
        return;
    }
    if is_road(wx, wz, seed).is_some() {
        return;
    }

    let flora_roll = hash2d_seeded(wx * 71, wz * 97, seed.wrapping_add(4200));
    match biome {
        Biome::Forest => {
            if flora_roll > 0.58 {
                let trunk_h =
                    3 + (hash2d_seeded(wx * 17, wz * 23, seed.wrapping_add(4201)) * 3.0) as i32;
                for y in 1..=trunk_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }
                let canopy_y = base_h + trunk_h;
                for dx in -2..=2 {
                    for dz in -2..=2 {
                        if dx * dx + dz * dz > 5 {
                            continue;
                        }
                        let bx = wx + dx;
                        let bz = wz + dz;
                        if bx < 0
                            || bx >= WORLD_SIZE_X as i32
                            || bz < 0
                            || bz >= WORLD_SIZE_Z as i32
                        {
                            continue;
                        }
                        if canopy_y < WORLD_SIZE_Y as i32 {
                            set_chunk_block_if_air(
                                chunk_blocks,
                                chunk_wx,
                                chunk_wy,
                                chunk_wz,
                                bx,
                                canopy_y,
                                bz,
                                GRASS,
                            );
                        }
                        if canopy_y + 1 < WORLD_SIZE_Y as i32
                            && hash2d_seeded(bx * 3, bz * 7, seed.wrapping_add(4202)) > 0.35
                        {
                            set_chunk_block_if_air(
                                chunk_blocks,
                                chunk_wx,
                                chunk_wy,
                                chunk_wz,
                                bx,
                                canopy_y + 1,
                                bz,
                                GRASS,
                            );
                        }
                    }
                }
            } else if flora_roll > 0.46 {
                let bush_h =
                    1 + (hash2d_seeded(wx * 5, wz * 11, seed.wrapping_add(4203)) * 2.0) as i32;
                for y in 1..=bush_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        GRASS,
                    );
                }
            }
        }
        Biome::Plains => {
            if flora_roll > 0.75 {
                let stem_h =
                    2 + (hash2d_seeded(wx * 13, wz * 9, seed.wrapping_add(4204)) * 2.0) as i32;
                for y in 1..=stem_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }
                if base_h + stem_h + 1 < WORLD_SIZE_Y as i32 {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + stem_h + 1,
                        wz,
                        GRASS,
                    );
                }
            } else if flora_roll > 0.58 {
                set_chunk_block_if_air(
                    chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    wx,
                    base_h + 1,
                    wz,
                    GRASS,
                );
            }
        }
        Biome::Desert => {
            if flora_roll > 0.92 {
                let cactus_h =
                    2 + (hash2d_seeded(wx * 19, wz * 7, seed.wrapping_add(4205)) * 3.0) as i32;
                for y in 1..=cactus_h {
                    set_chunk_block_if_air(
                        chunk_blocks,
                        chunk_wx,
                        chunk_wy,
                        chunk_wz,
                        wx,
                        base_h + y,
                        wz,
                        WOOD,
                    );
                }
            }
        }
        Biome::Mountains => {
            if flora_roll > 0.88 {
                set_chunk_block_if_air(
                    chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    wx,
                    base_h + 1,
                    wz,
                    STONE,
                );
            }
        }
        Biome::Urban => {}
        Biome::Airport => {}         // No vegetation on airport tarmac
        Biome::MilitaryOutpost => {} // No vegetation on military compound
    }
}
