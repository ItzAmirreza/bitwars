// ── Player Reducers ──
// Position updates, respawn, username, loadout management.

use spacetimedb::{reducer, ReducerContext, Table};

use crate::admin::is_admin;
use crate::constants::*;
use crate::helpers::*;
use crate::matchmaking::{current_match_state, start_round, MATCH_STATE_WAITING};
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
    let profile = ensure_player_profile(ctx, sender);
    if let Some(conflicting_profile) = find_profile_by_display_name(ctx, &username) {
        if conflicting_profile.profile_id != profile.profile_id {
            return Err("Username already taken".to_string());
        }
    }

    let profile = PlayerProfile {
        display_name: username.clone(),
        last_seen_at: ctx.timestamp,
        ..profile
    };
    ctx.db.player_profile().profile_id().update(profile.clone());

    let loadout = normalize_or_create_player_loadout(ctx, profile.profile_id);

    if let Some(player) = ctx.db.player().identity().find(sender) {
        let entity_id = ensure_player_entity(ctx, &player);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };

        ctx.db.player().identity().update(Player {
            profile_id: profile.profile_id,
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
        let spawn_pos = random_spawn_position(ctx, &sender);
        let entity_id = create_player_entity(ctx, &spawn_pos, &ZERO_VEL, &base_rot);
        ctx.db.player().insert(Player {
            identity: sender,
            profile_id: profile.profile_id,
            entity_id,
            username,
            character_preset,
            pos: spawn_pos.clone(),
            movement_flags: 0,
            vel: ZERO_VEL,
            rot: base_rot,
            health: max_health(),
            max_health: max_health(),
            current_weapon: loadout.slot1,
            kills: 0,
            deaths: 0,
            current_streak: 0,
            spawn_protected: true,
            online: true,
            mounted_vehicle_id: 0,
            joined_at: ctx.timestamp,
            session_started_at: ctx.timestamp,
            last_damage_time: ctx.timestamp,
        });
        init_weapon_state(ctx, sender);
        emit_player_teleport_event(ctx, sender, &spawn_pos);
    }

    if let Some(updated) = ctx.db.player().identity().find(sender) {
        init_movement_state(ctx, sender, &updated.pos);
    }
    if let Some(updated) = ctx.db.player().identity().find(sender) {
        sync_player_entity(ctx, &updated);
    }
    if current_match_state(ctx)
        .map(|state| state.state == MATCH_STATE_WAITING)
        .unwrap_or(false)
    {
        start_round(ctx, 1);
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
    movement_flags: u8,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let loadout = normalize_or_create_player_loadout(ctx, player.profile_id);
    let selected_weapon = if weapon_in_loadout(&loadout, weapon) {
        weapon
    } else {
        loadout.slot1
    };

    // Mounted player handling
    if player.mounted_vehicle_id != 0 {
        let Some(vehicle) = ctx
            .db
            .vehicle()
            .entity_id()
            .find(&player.mounted_vehicle_id)
        else {
            let dismounted = Player {
                mounted_vehicle_id: 0,
                ..player
            };
            ctx.db.player().identity().update(dismounted.clone());
            sync_player_entity(ctx, &dismounted);
            return Ok(());
        };

        let Some(occupant) = vehicle_occupant_for_player(ctx, &player) else {
            let dismounted = Player {
                mounted_vehicle_id: 0,
                ..player
            };
            ctx.db.player().identity().update(dismounted.clone());
            sync_player_entity(ctx, &dismounted);
            return Ok(());
        };

        let Some(vehicle_entity) = ctx.db.entity().id().find(&player.mounted_vehicle_id) else {
            let dismounted = Player {
                mounted_vehicle_id: 0,
                ..player
            };
            ctx.db.player().identity().update(dismounted.clone());
            sync_player_entity(ctx, &dismounted);
            return Ok(());
        };

        let mounted = Player {
            movement_flags: 0,
            pos: vehicle_seat_world_position(
                &vehicle_entity,
                vehicle.vehicle_type,
                occupant.seat_index,
            ),
            vel: vehicle_entity.vel.clone(),
            rot,
            current_weapon: selected_weapon,
            spawn_protected: false,
            ..player
        };
        ctx.db.player().identity().update(mounted.clone());
        sync_player_entity(ctx, &mounted);
        return Ok(());
    }

    let clamped_pos = clamp_pos(&pos);

    // Movement history tracking — always updated for all players (including
    // admins) so movement state stays fresh for when distance-budget
    // anti-cheat is re-enabled.
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

    // Admins skip grounding check — they may be flying (/fly) and would
    // otherwise stay permanently spawn-protected, which blocks firing.
    let spawn_protected =
        player.spawn_protected && !is_admin(&player.username) && !is_grounded(ctx, &clamped_pos);

    let updated = Player {
        pos: clamped_pos,
        vel,
        rot,
        current_weapon: selected_weapon,
        movement_flags,
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
    if player.username.trim().is_empty() || player.profile_id == 0 {
        return Err("Set username first".to_string());
    }

    let updated = PlayerLoadout {
        profile_id: player.profile_id,
        slot1,
        slot2,
        slot3,
        updated_at: ctx.timestamp,
    };

    if ctx
        .db
        .player_loadout()
        .profile_id()
        .find(player.profile_id)
        .is_some()
    {
        ctx.db.player_loadout().profile_id().update(updated);
    } else {
        ctx.db.player_loadout().insert(updated);
    }

    if !weapon_in_loadout(
        &PlayerLoadout {
            profile_id: player.profile_id,
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

    let loadout = normalize_or_create_player_loadout(ctx, player.profile_id);
    let respawn_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
        player.current_weapon
    } else {
        loadout.slot1
    };

    let player = dismount_player_internal(ctx, player, true);
    let spawn_pos = random_spawn_position(ctx, &sender);

    let respawned = Player {
        health: max_health(),
        pos: spawn_pos.clone(),
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
    emit_player_teleport_event(ctx, sender, &spawn_pos);

    weapons::reset_all_ammo(ctx, sender);
    crate::abilities::clear_buffs(ctx, sender);

    init_movement_state(ctx, sender, &spawn_pos);
    Ok(())
}

