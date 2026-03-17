use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::helpers::block_in_bounds;
use crate::tables::*;
use crate::worldgen::{self, AIR, CHUNK_SIZE, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z};

pub struct TerrainSampler {
    chunk_cache: HashMap<u32, [u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE]>,
    surface_cache: HashMap<(i32, i32), i32>,
}

impl TerrainSampler {
    pub fn new() -> Self {
        Self {
            chunk_cache: HashMap::new(),
            surface_cache: HashMap::new(),
        }
    }

    pub fn helicopter_ground_rest_height(&mut self, ctx: &ReducerContext, x: f32, z: f32) -> f32 {
        self.surface_height(ctx, x, z) + 2.0
    }

    pub fn fighter_jet_ground_height(&mut self, ctx: &ReducerContext, x: f32, z: f32) -> f32 {
        self.surface_height(ctx, x, z) + 1.0
    }

    fn surface_height(&mut self, ctx: &ReducerContext, x: f32, z: f32) -> f32 {
        let sx = x.floor() as i32;
        let sz = z.floor() as i32;
        if sx < 0 || sx >= WORLD_SIZE_X as i32 || sz < 0 || sz >= WORLD_SIZE_Z as i32 {
            return 3.0;
        }

        if let Some(y) = self.surface_cache.get(&(sx, sz)) {
            return *y as f32;
        }

        let mut found = 2i32;
        for y in (0..WORLD_SIZE_Y as i32).rev() {
            if matches!(self.get_block_type(ctx, sx, y, sz), Some(bt) if bt != AIR) {
                found = y;
                break;
            }
        }

        self.surface_cache.insert((sx, sz), found);
        found as f32
    }

    fn get_block_type(&mut self, ctx: &ReducerContext, x: i32, y: i32, z: i32) -> Option<u8> {
        if !block_in_bounds(x, y, z) {
            return Some(AIR);
        }

        let ux = x as usize;
        let uy = y as usize;
        let uz = z as usize;
        let cx = (ux / CHUNK_SIZE) as u8;
        let cy = (uy / CHUNK_SIZE) as u8;
        let cz = (uz / CHUNK_SIZE) as u8;
        let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);

        if !self.chunk_cache.contains_key(&chunk_id) {
            let chunk = ctx.db.world_chunk().chunk_id().find(chunk_id)?;
            let mut decoded = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
            worldgen::rle_decode(&chunk.data, &mut decoded);
            self.chunk_cache.insert(chunk_id, decoded);
        }

        let decoded = self.chunk_cache.get(&chunk_id)?;
        Some(
            decoded[ux % CHUNK_SIZE
                + (uy % CHUNK_SIZE) * CHUNK_SIZE
                + (uz % CHUNK_SIZE) * CHUNK_SIZE * CHUNK_SIZE],
        )
    }
}
