use std::collections::HashMap;
use std::sync::Arc;

use crate::worldgen;

/// Packed chunk ID matching server format: cx | (cy << 8) | (cz << 16)
pub fn pack_chunk_id(cx: u8, cy: u8, cz: u8) -> u32 {
    cx as u32 | ((cy as u32) << 8) | ((cz as u32) << 16)
}

/// RLE decode matching server's rle_decode
fn rle_decode(data: &[u8]) -> [u8; 4096] {
    let mut out = [0u8; 4096];
    let mut i = 0;
    let mut pos = 0;
    while i + 1 < data.len() && pos < 4096 {
        let val = data[i];
        let count = data[i + 1] as usize;
        for _ in 0..count {
            if pos < 4096 {
                out[pos] = val;
                pos += 1;
            }
        }
        i += 2;
    }
    out
}

/// Shared base terrain: all chunks pre-generated and decoded.
/// This is read-only and shared across all environments via Arc.
pub struct BaseTerrain {
    pub chunks: HashMap<u32, [u8; 4096]>,
    #[allow(dead_code)]
    pub seed: u64,
}

impl BaseTerrain {
    /// Generate the full world terrain. This takes a few seconds.
    pub fn generate(seed: u64) -> Self {
        let num_cx = worldgen::NUM_CHUNKS_X;
        let num_cy = worldgen::NUM_CHUNKS_Y;
        let num_cz = worldgen::NUM_CHUNKS_Z;
        let total = num_cx * num_cy * num_cz;

        let mut chunks = HashMap::with_capacity(total);

        for cx in 0..num_cx {
            for cy in 0..num_cy {
                for cz in 0..num_cz {
                    let rle_data = worldgen::generate_chunk(cx, cy, cz, seed);
                    let decoded = rle_decode(&rle_data);
                    let id = pack_chunk_id(cx as u8, cy as u8, cz as u8);
                    chunks.insert(id, decoded);
                }
            }
        }

        log::info!("Generated {} chunks for seed {}", chunks.len(), seed);
        BaseTerrain { chunks, seed }
    }
}

/// Per-environment terrain with copy-on-write semantics.
/// Reads from shared base terrain; only clones chunks that get modified.
pub struct EnvTerrain {
    base: Arc<BaseTerrain>,
    /// Chunks that have been modified in this environment.
    modified: HashMap<u32, [u8; 4096]>,
}

impl EnvTerrain {
    pub fn new(base: Arc<BaseTerrain>) -> Self {
        EnvTerrain {
            base,
            modified: HashMap::new(),
        }
    }

    /// Reset to base terrain (drop all modifications).
    pub fn reset(&mut self) {
        self.modified.clear();
    }

    /// Get the decoded chunk data (modified or base).
    pub fn get_chunk(&self, chunk_id: u32) -> Option<&[u8; 4096]> {
        self.modified
            .get(&chunk_id)
            .or_else(|| self.base.chunks.get(&chunk_id))
    }

    /// Get a mutable chunk (clones from base on first write).
    pub fn get_chunk_mut(&mut self, chunk_id: u32) -> Option<&mut [u8; 4096]> {
        if !self.modified.contains_key(&chunk_id) {
            if let Some(base_chunk) = self.base.chunks.get(&chunk_id) {
                self.modified.insert(chunk_id, *base_chunk);
            } else {
                return None;
            }
        }
        self.modified.get_mut(&chunk_id)
    }

    /// Get block type at world coordinates. Returns AIR (0) for out-of-bounds.
    pub fn get_block(&self, x: i32, y: i32, z: i32) -> u8 {
        if x < 0
            || y < 0
            || z < 0
            || x >= worldgen::WORLD_SIZE_X as i32
            || y >= worldgen::WORLD_SIZE_Y as i32
            || z >= worldgen::WORLD_SIZE_Z as i32
        {
            return worldgen::AIR;
        }

        let cx = (x as usize) / worldgen::CHUNK_SIZE;
        let cy = (y as usize) / worldgen::CHUNK_SIZE;
        let cz = (z as usize) / worldgen::CHUNK_SIZE;
        let lx = (x as usize) % worldgen::CHUNK_SIZE;
        let ly = (y as usize) % worldgen::CHUNK_SIZE;
        let lz = (z as usize) % worldgen::CHUNK_SIZE;

        let chunk_id = pack_chunk_id(cx as u8, cy as u8, cz as u8);
        match self.get_chunk(chunk_id) {
            Some(data) => data[lx + ly * worldgen::CHUNK_SIZE + lz * worldgen::CHUNK_SIZE * worldgen::CHUNK_SIZE],
            None => worldgen::AIR,
        }
    }

    /// Set block type at world coordinates. Triggers CoW on the chunk.
    pub fn set_block(&mut self, x: i32, y: i32, z: i32, block_type: u8) {
        if x < 0
            || y < 0
            || z < 0
            || x >= worldgen::WORLD_SIZE_X as i32
            || y >= worldgen::WORLD_SIZE_Y as i32
            || z >= worldgen::WORLD_SIZE_Z as i32
        {
            return;
        }

        let cx = (x as usize) / worldgen::CHUNK_SIZE;
        let cy = (y as usize) / worldgen::CHUNK_SIZE;
        let cz = (z as usize) / worldgen::CHUNK_SIZE;
        let lx = (x as usize) % worldgen::CHUNK_SIZE;
        let ly = (y as usize) % worldgen::CHUNK_SIZE;
        let lz = (z as usize) % worldgen::CHUNK_SIZE;

        let chunk_id = pack_chunk_id(cx as u8, cy as u8, cz as u8);
        if let Some(data) = self.get_chunk_mut(chunk_id) {
            data[lx + ly * worldgen::CHUNK_SIZE + lz * worldgen::CHUNK_SIZE * worldgen::CHUNK_SIZE] = block_type;
        }
    }

    /// Get highest solid block at (x, z) scanning down from scan_y.
    /// Returns the Y coordinate of the block, or -1 if none found.
    /// Matches client's VoxelWorld.getGroundHeightBelow().
    pub fn get_ground_height_below(&self, x: f32, foot_y: f32, z: f32) -> i32 {
        let bx = x.floor() as i32;
        let bz = z.floor() as i32;
        if bx < 0
            || bx >= worldgen::WORLD_SIZE_X as i32
            || bz < 0
            || bz >= worldgen::WORLD_SIZE_Z as i32
        {
            return -1;
        }
        let start_y = (foot_y.floor() as i32).min(worldgen::WORLD_SIZE_Y as i32 - 1);
        for y in (0..=start_y).rev() {
            if self.get_block(bx, y, bz) != worldgen::AIR {
                return y;
            }
        }
        -1
    }

    /// Get a HashMap view of nearby chunks for structural integrity checks.
    /// Matches the server's decompress_nearby_chunks pattern.
    pub fn get_chunks_in_radius(
        &self,
        positions: &[(i32, i32, i32)],
        chunk_radius: usize,
    ) -> HashMap<u32, [u8; 4096]> {
        let mut result = HashMap::new();
        let mut seen_chunks = std::collections::HashSet::new();

        for &(x, y, z) in positions {
            let cx_center = (x as usize) / worldgen::CHUNK_SIZE;
            let cy_center = (y as usize) / worldgen::CHUNK_SIZE;
            let cz_center = (z as usize) / worldgen::CHUNK_SIZE;

            let cx_min = cx_center.saturating_sub(chunk_radius);
            let cy_min = cy_center.saturating_sub(chunk_radius);
            let cz_min = cz_center.saturating_sub(chunk_radius);
            let cx_max = (cx_center + chunk_radius).min(worldgen::NUM_CHUNKS_X - 1);
            let cy_max = (cy_center + chunk_radius).min(worldgen::NUM_CHUNKS_Y - 1);
            let cz_max = (cz_center + chunk_radius).min(worldgen::NUM_CHUNKS_Z - 1);

            for cx in cx_min..=cx_max {
                for cy in cy_min..=cy_max {
                    for cz in cz_min..=cz_max {
                        let id = pack_chunk_id(cx as u8, cy as u8, cz as u8);
                        if seen_chunks.insert(id) {
                            if let Some(chunk) = self.get_chunk(id) {
                                result.insert(id, *chunk);
                            }
                        }
                    }
                }
            }
        }
        result
    }

    /// Get a reference to the modified chunks map.
    pub fn modified_chunks(&self) -> &HashMap<u32, [u8; 4096]> {
        &self.modified
    }
}
