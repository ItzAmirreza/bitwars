// ── Entity Operations ──
// Create, sync, and ensure player entities.

use spacetimedb::{ReducerContext, Table};

use crate::constants::*;
use crate::tables::*;
use crate::types::*;

pub fn create_player_entity(ctx: &ReducerContext, pos: &Vec3, vel: &Vec3, rot: &Rotation) -> u64 {
    let row = ctx.db.entity().insert(Entity {
        id: 0,
        kind: ENTITY_KIND_PLAYER,
        subtype: 0,
        pos: pos.clone(),
        vel: vel.clone(),
        rot: rot.clone(),
        scale: 1.0,
        active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    row.id
}

pub fn sync_player_entity(ctx: &ReducerContext, player: &Player) {
    if player.entity_id == 0 {
        return;
    }
    if let Some(entity) = ctx.db.entity().id().find(&player.entity_id) {
        ctx.db.entity().id().update(Entity {
            pos: player.pos.clone(),
            vel: player.vel.clone(),
            rot: player.rot.clone(),
            active: player.online,
            updated_at: ctx.timestamp,
            ..entity
        });
    }
}

pub fn ensure_player_entity(ctx: &ReducerContext, player: &Player) -> u64 {
    if player.entity_id != 0 {
        if ctx.db.entity().id().find(&player.entity_id).is_some() {
            return player.entity_id;
        }
    }
    create_player_entity(ctx, &player.pos, &player.vel, &player.rot)
}

pub fn emit_kill_event(
    ctx: &ReducerContext,
    killer: spacetimedb::Identity,
    victim: spacetimedb::Identity,
    weapon: u8,
) {
    let killer_name = ctx
        .db
        .player()
        .identity()
        .find(killer)
        .map(|p| p.username.clone())
        .unwrap_or_else(|| "???".to_string());
    let victim_name = ctx
        .db
        .player()
        .identity()
        .find(victim)
        .map(|p| p.username.clone())
        .unwrap_or_else(|| "???".to_string());
    ctx.db.kill_event().insert(KillEvent {
        id: 0,
        killer_name,
        victim_name,
        weapon,
        created_at: ctx.timestamp,
    });
}
