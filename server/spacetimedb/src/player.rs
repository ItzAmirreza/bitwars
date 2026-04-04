// ── Player Reducers ──
// Position updates, respawn, username, loadout management.

use std::collections::HashMap;

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
                movement_flags: 0,
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

    weapons::reset_all_ammo(ctx, sender);
    crate::abilities::clear_buffs(ctx, sender);

    init_movement_state(ctx, sender, &spawn_pos);
    Ok(())
}

#[reducer]
pub fn portal_arrive(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let player = dismount_player_internal(ctx, player, true);
    let (spawn_pos, spawn_rot) =
        portal_arrival_pose(ctx).ok_or("Portal landing zone is unavailable")?;

    let arrived = Player {
        pos: spawn_pos.clone(),
        vel: ZERO_VEL,
        rot: spawn_rot,
        spawn_protected: true,
        last_damage_time: ctx.timestamp,
        ..player
    };
    ctx.db.player().identity().update(arrived.clone());
    sync_player_entity(ctx, &arrived);
    emit_player_teleport_event(ctx, sender, &spawn_pos);
    init_movement_state(ctx, sender, &spawn_pos);
    Ok(())
}

const PORTAL_CLEARANCE_HEIGHT: i32 = 7;
const PORTAL_SURFACE_TOLERANCE: i32 = 1;
const PORTAL_PAD_HALF_WIDTH_X: i32 = 1;
const PORTAL_PAD_HALF_WIDTH_Z: i32 = 2;
const PORTAL_CANDIDATES: &[(i32, i32)] =
    &[(-12, 0), (-14, 4), (-14, -4), (-18, 0), (-10, 6), (-10, -6)];

fn portal_arrival_pose(ctx: &ReducerContext) -> Option<(Vec3, Rotation)> {
    let center_x = crate::worldgen::WORLD_SIZE_X as i32 / 2;
    let center_z = crate::worldgen::WORLD_SIZE_Z as i32 / 2;
    let mut chunk_cache = HashMap::new();

    for (offset_x, offset_z) in PORTAL_CANDIDATES {
        let portal_x = center_x + offset_x;
        let portal_z = center_z + offset_z;
        let Some(base_y) = portal_base_y_if_fit(ctx, portal_x, portal_z, &mut chunk_cache) else {
            continue;
        };

        let spawn_pos = Vec3 {
            x: portal_x as f32 + 3.5,
            y: base_y as f32 + player_eye_height(),
            z: portal_z as f32 + 0.5,
        };
        let spawn_rot = Rotation {
            yaw: std::f32::consts::FRAC_PI_2,
            pitch: 0.0,
        };
        return Some((clamp_pos(&spawn_pos), spawn_rot));
    }

    None
}

fn portal_base_y_if_fit(
    ctx: &ReducerContext,
    portal_x: i32,
    portal_z: i32,
    chunk_cache: &mut HashMap<u32, [u8; 4096]>,
) -> Option<i32> {
    let mut min_surface = i32::MAX;
    let mut max_surface = i32::MIN;

    for dx in -PORTAL_PAD_HALF_WIDTH_X..=PORTAL_PAD_HALF_WIDTH_X {
        for dz in -PORTAL_PAD_HALF_WIDTH_Z..=PORTAL_PAD_HALF_WIDTH_Z {
            let sx = portal_x + dx;
            let sz = portal_z + dz;
            let surface = crate::chunks::get_surface_height_generated(ctx, sx, sz, chunk_cache)?;
            min_surface = min_surface.min(surface);
            max_surface = max_surface.max(surface);
        }
    }

    if min_surface == i32::MAX || max_surface - min_surface > PORTAL_SURFACE_TOLERANCE {
        return None;
    }

    let base_y = max_surface + 1;
    if base_y + PORTAL_CLEARANCE_HEIGHT >= crate::worldgen::WORLD_SIZE_Y as i32 - 1 {
        return None;
    }

    for dx in -2..=2 {
        for dz in -3..=3 {
            let sx = portal_x + dx;
            let sz = portal_z + dz;
            for y in base_y..=base_y + PORTAL_CLEARANCE_HEIGHT {
                if !matches!(
                    crate::chunks::get_block_type_generated_cached(ctx, sx, y, sz, chunk_cache),
                    Some(crate::worldgen::AIR)
                ) {
                    return None;
                }
            }
        }
    }

    Some(base_y)
}
