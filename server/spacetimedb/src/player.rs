// ── Player Reducers ──
// Position updates, respawn, username, loadout management.

use spacetimedb::{reducer, ReducerContext, Table};

use crate::admin::is_admin;
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

#[reducer]
pub fn set_username(
    ctx: &ReducerContext,
    username: String,
    character_preset: u8,
) -> Result<(), String> {
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 20 {
        return Err("Username must be 1-20 characters".to_string());
    }
    let character_preset = normalize_character_preset(character_preset);

    let sender = ctx.sender();
    for p in ctx.db.player().iter() {
        if p.username == username && p.identity != sender {
            return Err("Username already taken".to_string());
        }
    }

    let loadout = normalize_or_create_player_loadout(ctx, &username);

    if let Some(player) = ctx.db.player().identity().find(sender) {
        let entity_id = ensure_player_entity(ctx, &player);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };

        ctx.db.player().identity().update(Player {
            username,
            current_weapon,
            character_preset,
            entity_id,
            ..player
        });
    } else {
        let base_rot = Rotation {
            yaw: 0.0,
            pitch: 0.0,
        };
        let entity_id = create_player_entity(ctx, &SPAWN_POS, &ZERO_VEL, &base_rot);
        ctx.db.player().insert(Player {
            identity: sender,
            entity_id,
            username,
            character_preset,
            pos: SPAWN_POS,
            vel: ZERO_VEL,
            rot: base_rot,
            health: max_health(),
            max_health: max_health(),
            current_weapon: loadout.slot1,
            kills: 0,
            deaths: 0,
            spawn_protected: true,
            online: true,
            mounted_vehicle_id: 0,
            joined_at: ctx.timestamp,
            last_damage_time: ctx.timestamp,
        });
        init_weapon_state(ctx, sender);
    }

    init_movement_state(ctx, sender, &SPAWN_POS);
    if let Some(updated) = ctx.db.player().identity().find(sender) {
        sync_player_entity(ctx, &updated);
    }
    Ok(())
}

#[reducer]
pub fn update_position(
    ctx: &ReducerContext,
    pos: Vec3,
    vel: Vec3,
    rot: Rotation,
    weapon: u8,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    let selected_weapon = if weapon_in_loadout(&loadout, weapon) {
        weapon
    } else {
        loadout.slot1
    };

    // Mounted player handling
    if player.mounted_vehicle_id != 0 {
        if let Some(vehicle) = ctx
            .db
            .vehicle()
            .entity_id()
            .find(&player.mounted_vehicle_id)
        {
            if vehicle.pilot_identity != Some(sender) {
                return Err("Vehicle occupied".to_string());
            }
        } else {
            let dismounted = Player {
                mounted_vehicle_id: 0,
                ..player
            };
            ctx.db.player().identity().update(dismounted.clone());
            sync_player_entity(ctx, &dismounted);
            return Ok(());
        }

        if let Some(vehicle_entity) = ctx.db.entity().id().find(&player.mounted_vehicle_id) {
            let mounted = Player {
                pos: Vec3 {
                    x: vehicle_entity.pos.x,
                    y: vehicle_entity.pos.y + heli_pilot_seat_height(),
                    z: vehicle_entity.pos.z,
                },
                vel: vehicle_entity.vel.clone(),
                rot,
                current_weapon: selected_weapon,
                spawn_protected: false,
                ..player
            };
            ctx.db.player().identity().update(mounted.clone());
            sync_player_entity(ctx, &mounted);
        }
        return Ok(());
    }

    let clamped_pos = clamp_pos(&pos);
    let admin_bypass = is_admin(&player.username);

    // Keep movement history for diagnostics / future validation, but avoid
    // server-side snapback for normal infantry movement.
    if !admin_bypass {
        if ctx.db.player_movement().identity().find(sender).is_some() {
            ctx.db
                .player_movement()
                .identity()
                .update(PlayerMovementState {
                    identity: sender,
                    last_pos: clamped_pos.clone(),
                    last_update: ctx.timestamp,
                    violation_count: 0,
                });
        } else {
            init_movement_state(ctx, sender, &clamped_pos);
        }
    }

    let spawn_protected = if player.spawn_protected {
        !is_grounded(ctx, &clamped_pos)
    } else {
        false
    };

    let updated = Player {
        pos: clamped_pos,
        vel,
        rot,
        current_weapon: selected_weapon,
        spawn_protected,
        ..player
    };
    ctx.db.player().identity().update(updated.clone());
    sync_player_entity(ctx, &updated);

    Ok(())
}

#[reducer]
pub fn set_loadout(ctx: &ReducerContext, slot1: u8, slot2: u8, slot3: u8) -> Result<(), String> {
    if !loadout_slots_valid(slot1, slot2, slot3) {
        return Err("Loadout must contain 3 unique valid weapons".to_string());
    }

    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.username.trim().is_empty() {
        return Err("Set username first".to_string());
    }

    let username = player.username.clone();
    let updated = PlayerLoadout {
        username: username.clone(),
        slot1,
        slot2,
        slot3,
        updated_at: ctx.timestamp,
    };

    if ctx.db.player_loadout().username().find(&username).is_some() {
        ctx.db.player_loadout().username().update(updated);
    } else {
        ctx.db.player_loadout().insert(updated);
    }

    if !weapon_in_loadout(
        &PlayerLoadout {
            username,
            slot1,
            slot2,
            slot3,
            updated_at: ctx.timestamp,
        },
        player.current_weapon,
    ) {
        let switched = Player {
            current_weapon: slot1,
            ..player
        };
        ctx.db.player().identity().update(switched.clone());
        sync_player_entity(ctx, &switched);
    }

    Ok(())
}

#[reducer]
pub fn respawn(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    let respawn_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
        player.current_weapon
    } else {
        loadout.slot1
    };

    let player = dismount_player_internal(ctx, player, true);

    let respawned = Player {
        health: max_health(),
        pos: SPAWN_POS,
        vel: ZERO_VEL,
        spawn_protected: true,
        current_weapon: respawn_weapon,
        rot: Rotation {
            yaw: 0.0,
            pitch: 0.0,
        },
        ..player
    };
    ctx.db.player().identity().update(respawned.clone());
    sync_player_entity(ctx, &respawned);

    weapons::reset_all_ammo(ctx, sender);

    init_movement_state(ctx, sender, &SPAWN_POS);
    Ok(())
}
