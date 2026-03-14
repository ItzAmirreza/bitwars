// ── Block & Entity Reducers ──
// Physics block destruction and entity sync.

use spacetimedb::{reducer, ReducerContext};

use crate::chunks::{destroy_blocks_in_world, run_structural_check};
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

#[reducer]
pub fn destroy_blocks_physics(ctx: &ReducerContext, blocks: Vec<Vec3>) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if blocks.len() > max_block_destroy_per_call() {
        return Err("Too many blocks in one call".to_string());
    }

    // Range check: blocks must be near the player
    let max_range_sq = max_block_destroy_range() * max_block_destroy_range();
    let block_coords: Vec<(i32, i32, i32)> = blocks
        .iter()
        .filter(|b| {
            block_in_bounds(b.x as i32, b.y as i32, b.z as i32)
                && dist_sq(&player.pos, b) <= max_range_sq
        })
        .map(|b| (b.x as i32, b.y as i32, b.z as i32))
        .collect();

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    Ok(())
}

#[reducer]
pub fn sync_entity_transform(
    ctx: &ReducerContext,
    entity_id: u64,
    pos: Vec3,
    vel: Vec3,
    rot: Rotation,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.entity_id != entity_id {
        return Err("Entity mismatch".to_string());
    }

    if let Some(entity) = ctx.db.entity().id().find(&entity_id) {
        if entity.kind != entity_kind_player() {
            return Err("Not a player entity".to_string());
        }
        ctx.db.entity().id().update(Entity {
            pos,
            vel,
            rot,
            active: player.online,
            updated_at: ctx.timestamp,
            ..entity
        });
    }

    Ok(())
}
