// ── World Generation ──
// Procedural biome-based world generation for a 250x48x250 world.
// Chunks are generated lazily (on-demand) using a deterministic seed.
//
// To add a new biome:  biomes.rs → add variant + height/block functions
// To add a structure:  structures.rs → add placement fn + wire in generate_chunk
// To add a block type: add constant here + match client BlockType

pub mod biomes;
pub mod noise;
pub mod roads;
pub mod structural;
pub mod structures;

// Re-export everything for backward compat
pub use biomes::*;
pub use noise::*;
pub use structural::{check_structural_integrity_sparse, StructuralCollapsePlan};

// ── World Constants ──

pub const WORLD_SIZE_X: usize = 250;
pub const WORLD_SIZE_Y: usize = 48;
pub const WORLD_SIZE_Z: usize = 250;
pub const CHUNK_SIZE: usize = 16;
pub const NUM_CHUNKS_X: usize = (WORLD_SIZE_X + CHUNK_SIZE - 1) / CHUNK_SIZE;
pub const NUM_CHUNKS_Y: usize = (WORLD_SIZE_Y + CHUNK_SIZE - 1) / CHUNK_SIZE;
pub const NUM_CHUNKS_Z: usize = (WORLD_SIZE_Z + CHUNK_SIZE - 1) / CHUNK_SIZE;

// ── Block Types (must match client BlockType) ──

pub const AIR: u8 = 0;
pub const CONCRETE: u8 = 1;
pub const DARK_CONCRETE: u8 = 2;
pub const ASPHALT: u8 = 3;
pub const REBAR: u8 = 4;
pub const BRICK: u8 = 5;
pub const METAL: u8 = 6;
pub const RUBBLE: u8 = 7;
pub const DIRT: u8 = 8;
pub const SAND: u8 = 9;
pub const GRASS: u8 = 10;
pub const WOOD: u8 = 11;
pub const STONE: u8 = 12;
pub const SNOW: u8 = 13;
pub const LANTERN: u8 = 14;

// ── RLE Compression ──

pub fn rle_encode(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let val = data[i];
        let mut run: u8 = 1;
        while (i + run as usize) < data.len() && data[i + run as usize] == val && run < 255 {
            run += 1;
        }
        result.push(val);
        result.push(run);
        i += run as usize;
    }
    result
}

pub fn rle_decode(data: &[u8], output: &mut [u8]) {
    let mut out_idx = 0;
    let mut i = 0;
    while i + 1 < data.len() && out_idx < output.len() {
        let val = data[i];
        let run = data[i + 1] as usize;
        for _ in 0..run {
            if out_idx >= output.len() {
                break;
            }
            output[out_idx] = val;
            out_idx += 1;
        }
        i += 2;
    }
}

// ── Chunk ID Helpers ──

pub fn pack_chunk_id(cx: u8, cy: u8, cz: u8) -> u32 {
    cx as u32 | ((cy as u32) << 8) | ((cz as u32) << 16)
}

pub fn unpack_chunk_id(id: u32) -> (u8, u8, u8) {
    (
        (id & 0xFF) as u8,
        ((id >> 8) & 0xFF) as u8,
        ((id >> 16) & 0xFF) as u8,
    )
}

pub fn inject_chunk(blocks: &mut [u8], cx: usize, cy: usize, cz: usize, chunk_data: &[u8]) {
    for lz in 0..CHUNK_SIZE {
        for ly in 0..CHUNK_SIZE {
            for lx in 0..CHUNK_SIZE {
                let gx = cx * CHUNK_SIZE + lx;
                let gy = cy * CHUNK_SIZE + ly;
                let gz = cz * CHUNK_SIZE + lz;
                let global_idx = gx + gy * WORLD_SIZE_X + gz * WORLD_SIZE_X * WORLD_SIZE_Y;
                let local_idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                blocks[global_idx] = chunk_data[local_idx];
            }
        }
    }
}

// ── Chunk Block Helpers (used by structures) ──

pub fn set_chunk_block(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    wy: i32,
    wz: i32,
    bt: u8,
) {
    let lx = wx - cx;
    let ly = wy - cy;
    let lz = wz - cz;
    if lx >= 0
        && lx < CHUNK_SIZE as i32
        && ly >= 0
        && ly < CHUNK_SIZE as i32
        && lz >= 0
        && lz < CHUNK_SIZE as i32
    {
        let idx = lx as usize + ly as usize * CHUNK_SIZE + lz as usize * CHUNK_SIZE * CHUNK_SIZE;
        if cb[idx] == AIR || bt != AIR {
            cb[idx] = bt;
        }
    }
}

pub fn set_chunk_block_if_air(
    cb: &mut [u8; 4096],
    cx: i32,
    cy: i32,
    cz: i32,
    wx: i32,
    wy: i32,
    wz: i32,
    bt: u8,
) {
    let lx = wx - cx;
    let ly = wy - cy;
    let lz = wz - cz;
    if lx >= 0
        && lx < CHUNK_SIZE as i32
        && ly >= 0
        && ly < CHUNK_SIZE as i32
        && lz >= 0
        && lz < CHUNK_SIZE as i32
    {
        let idx = lx as usize + ly as usize * CHUNK_SIZE + lz as usize * CHUNK_SIZE * CHUNK_SIZE;
        if cb[idx] == AIR {
            cb[idx] = bt;
        }
    }
}

// ── Core Chunk Generation ──

pub fn generate_chunk(cx: usize, cy: usize, cz: usize, seed: u64) -> Vec<u8> {
    let mut chunk_blocks = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
    let chunk_wx = (cx * CHUNK_SIZE) as i32;
    let chunk_wy = (cy * CHUNK_SIZE) as i32;
    let chunk_wz = (cz * CHUNK_SIZE) as i32;

    // Phase 1: Base terrain
    for lx in 0..CHUNK_SIZE {
        for lz in 0..CHUNK_SIZE {
            let wx = chunk_wx + lx as i32;
            let wz = chunk_wz + lz as i32;
            if wx < 0 || wx >= WORLD_SIZE_X as i32 || wz < 0 || wz >= WORLD_SIZE_Z as i32 {
                continue;
            }

            let biome = biomes::get_biome(wx, wz, seed);
            let h = biomes::biome_height(biome, wx, wz, seed);
            let surface = biomes::biome_surface_block(biome);
            let subsurface = biomes::biome_subsurface_block(biome);
            let deep = biomes::biome_deep_block(biome);

            for ly in 0..CHUNK_SIZE {
                let wy = chunk_wy + ly as i32;
                if wy > h {
                    break;
                }
                let bt = if wy == h {
                    surface
                } else if wy >= h - 2 {
                    subsurface
                } else {
                    deep
                };
                chunk_blocks[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] = bt;
            }

            // Roads
            if let Some(road_bt) = roads::is_road(wx, wz, seed) {
                let ly = h - chunk_wy;
                if ly >= 0 && ly < CHUNK_SIZE as i32 {
                    chunk_blocks[lx + ly as usize * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] =
                        road_bt;
                }
            }

            // Road lanterns
            if roads::should_place_road_lantern(wx, wz, biome, seed) {
                roads::place_lantern_post(
                    &mut chunk_blocks,
                    chunk_wx,
                    chunk_wy,
                    chunk_wz,
                    wx,
                    h,
                    wz,
                );
            }

            // Snow cap
            if biome == Biome::Mountains && h > 18 {
                let ly = h - chunk_wy;
                if ly >= 0 && ly < CHUNK_SIZE as i32 {
                    chunk_blocks[lx + ly as usize * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE] =
                        SNOW;
                }
            }

            // Vegetation
            structures::scatter_vegetation(
                &mut chunk_blocks,
                chunk_wx,
                chunk_wy,
                chunk_wz,
                wx,
                wz,
                h,
                biome,
                seed,
            );
        }
    }

    // Phase 3a: Urban districts
    structures::place_urban_districts(&mut chunk_blocks, chunk_wx, chunk_wy, chunk_wz, seed);

    // Phase 3b: Dense structures across all biomes
    structures::place_biome_structures(&mut chunk_blocks, chunk_wx, chunk_wy, chunk_wz, seed);

    rle_encode(&chunk_blocks)
}
