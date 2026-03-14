// ── Player State Helpers ──
// Movement state, loadout management. Ammo is now in weapons module.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::constants::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

/// Initialize weapon ammo + fire state for a player. Delegates to weapons module.
pub fn init_weapon_state(ctx: &ReducerContext, identity: Identity) {
    weapons::init_all_ammo(ctx, identity);
}

pub fn init_movement_state(ctx: &ReducerContext, identity: Identity, pos: &Vec3) {
    if ctx.db.player_movement().identity().find(identity).is_none() {
        ctx.db.player_movement().insert(PlayerMovementState {
            identity,
            last_pos: pos.clone(),
            last_update: ctx.timestamp,
            violation_count: 0,
        });
    } else {
        ctx.db
            .player_movement()
            .identity()
            .update(PlayerMovementState {
                identity,
                last_pos: pos.clone(),
                last_update: ctx.timestamp,
                violation_count: 0,
            });
    }
}

pub fn loadout_slots_valid(slot1: u8, slot2: u8, slot3: u8) -> bool {
    slot1 < weapons::num_weapons()
        && slot2 < weapons::num_weapons()
        && slot3 < weapons::num_weapons()
        && slot1 != slot2
        && slot1 != slot3
        && slot2 != slot3
}

pub fn weapon_in_loadout(loadout: &PlayerLoadout, weapon: u8) -> bool {
    weapon == loadout.slot1 || weapon == loadout.slot2 || weapon == loadout.slot3
}

pub fn normalize_character_preset(preset: u8) -> u8 {
    if preset < num_character_presets() {
        preset
    } else {
        0
    }
}

pub fn normalize_or_create_player_loadout(ctx: &ReducerContext, username: &str) -> PlayerLoadout {
    let key = username.to_string();
    if let Some(existing) = ctx.db.player_loadout().username().find(&key) {
        if loadout_slots_valid(existing.slot1, existing.slot2, existing.slot3) {
            return existing;
        }
        ctx.db.player_loadout().username().update(PlayerLoadout {
            username: key.clone(),
            slot1: default_loadout()[0],
            slot2: default_loadout()[1],
            slot3: default_loadout()[2],
            updated_at: ctx.timestamp,
        });
        return PlayerLoadout {
            username: key,
            slot1: default_loadout()[0],
            slot2: default_loadout()[1],
            slot3: default_loadout()[2],
            updated_at: ctx.timestamp,
        };
    }
    ctx.db.player_loadout().insert(PlayerLoadout {
        username: key,
        slot1: default_loadout()[0],
        slot2: default_loadout()[1],
        slot3: default_loadout()[2],
        updated_at: ctx.timestamp,
    })
}
