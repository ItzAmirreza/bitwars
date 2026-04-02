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
        // Helicopter skids sit ~0.525u below entity origin in the model.
        // Place origin at surface + 0.475 so skids rest on the ground.
        self.surface_height(ctx, x, z) + 0.475
    }

    pub fn helicopter_ground_rest_height_below(
        &mut self,
        ctx: &ReducerContext,
        x: f32,
        z: f32,
        max_y: f32,
    ) -> f32 {
        self.surface_height_below(ctx, x, z, max_y) + 0.475
    }

    pub fn fighter_jet_ground_height(&mut self, ctx: &ReducerContext, x: f32, z: f32) -> f32 {
        self.surface_height(ctx, x, z) + 1.0
    }

    pub fn fighter_jet_ground_height_below(
        &mut self,
        ctx: &ReducerContext,
        x: f32,
        z: f32,
        max_y: f32,
    ) -> f32 {
        self.surface_height_below(ctx, x, z, max_y) + 1.0
    }

    pub fn ground_surface_height(&mut self, ctx: &ReducerContext, x: f32, z: f32) -> f32 {
        self.surface_height(ctx, x, z)
    }

    pub fn ground_surface_height_below(
        &mut self,
        ctx: &ReducerContext,
        x: f32,
        z: f32,
        max_y: f32,
    ) -> f32 {
        self.surface_height_below(ctx, x, z, max_y)
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

    fn surface_height_below(&mut self, ctx: &ReducerContext, x: f32, z: f32, max_y: f32) -> f32 {
        let sx = x.floor() as i32;
        let sz = z.floor() as i32;
        if sx < 0 || sx >= WORLD_SIZE_X as i32 || sz < 0 || sz >= WORLD_SIZE_Z as i32 {
            return 3.0;
        }

        let start_y = max_y.floor() as i32;
        if start_y < 0 {
            return 3.0;
        }

        for y in (0..=start_y.min(WORLD_SIZE_Y as i32 - 1)).rev() {
            if matches!(self.get_block_type(ctx, sx, y, sz), Some(bt) if bt != AIR) {
                return y as f32;
            }
        }

        3.0
    }

    /// Invalidate cached surface heights for all columns overlapping the given block range.
    /// Call this after destroying blocks so subsequent ground-height queries see the updated terrain.
    pub fn invalidate_surface_range(&mut self, min_x: i32, max_x: i32, min_z: i32, max_z: i32) {
        self.surface_cache
            .retain(|&(sx, sz), _| sx < min_x || sx > max_x || sz < min_z || sz > max_z);
    }

    /// Invalidate the cached chunk data for all chunks overlapping the given block range.
    /// Call this after `destroy_blocks_in_world` so subsequent block queries see updated data.
    pub fn invalidate_chunk_range(
        &mut self,
        min_x: i32,
        max_x: i32,
        min_y: i32,
        max_y: i32,
        min_z: i32,
        max_z: i32,
    ) {
        // Compute chunk coordinate ranges
        let cx_min = (min_x.max(0) as usize) / CHUNK_SIZE;
        let cx_max = (max_x.max(0) as usize) / CHUNK_SIZE;
        let cy_min = (min_y.max(0) as usize) / CHUNK_SIZE;
        let cy_max = (max_y.max(0) as usize) / CHUNK_SIZE;
        let cz_min = (min_z.max(0) as usize) / CHUNK_SIZE;
        let cz_max = (max_z.max(0) as usize) / CHUNK_SIZE;

        for cx in cx_min..=cx_max {
            for cy in cy_min..=cy_max {
                for cz in cz_min..=cz_max {
                    let chunk_id = worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                    self.chunk_cache.remove(&chunk_id);
                }
            }
        }
    }
    pub fn get_block_type(&mut self, ctx: &ReducerContext, x: i32, y: i32, z: i32) -> Option<u8> {
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
