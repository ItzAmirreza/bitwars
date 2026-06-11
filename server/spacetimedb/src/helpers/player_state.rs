// ── Player State Helpers ──
// Movement state, loadout management, spawn helpers. Ammo is now in weapons module.

use spacetimedb::{Identity, ReducerContext, Table};

use crate::constants::*;
use crate::helpers::math::{clamp_pos, dist_sq, hash_u64, is_grounded, timestamp_micros};
use crate::helpers::terrain_cache::TerrainSampler;
use crate::tables::*;
use crate::types::*;
use crate::weapons;
use crate::worldgen::{biome_height, get_biome, AIR, WORLD_SIZE_X, WORLD_SIZE_Z};

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

pub fn ensure_player_profile(ctx: &ReducerContext, identity: Identity) -> PlayerProfile {
    if let Some(link) = ctx.db.identity_link().identity().find(identity) {
        if let Some(profile) = ctx.db.player_profile().profile_id().find(link.profile_id) {
            return profile;
        }
        ctx.db.identity_link().identity().delete(&identity);
    }

    let profile = ctx.db.player_profile().insert(PlayerProfile {
        profile_id: 0,
        display_name: String::new(),
        total_kills: 0,
        total_deaths: 0,
        time_played_secs: 0,
        best_streak: 0,
        created_at: ctx.timestamp,
        last_seen_at: ctx.timestamp,
    });
    ctx.db.identity_link().insert(IdentityLink {
        identity,
        profile_id: profile.profile_id,
        linked_at: ctx.timestamp,
    });
    profile
}

pub fn find_profile_by_display_name(
    ctx: &ReducerContext,
    display_name: &str,
) -> Option<PlayerProfile> {
    let needle = display_name.trim();
    ctx.db
        .player_profile()
        .iter()
        .find(|profile| profile.display_name.eq_ignore_ascii_case(needle))
}

pub fn is_profile_online(ctx: &ReducerContext, profile_id: u64) -> bool {
    ctx.db
        .player()
        .iter()
        .any(|player| player.profile_id == profile_id && player.online)
}

/// Frees a display name held by an offline profile so a new player can claim
/// it. The stale profile keeps its stats under "<name>.<profile_id>" and its
/// offline player rows return to name selection on their next connect.
pub fn release_display_name(ctx: &ReducerContext, profile: &PlayerProfile) {
    let root: String = profile.display_name.chars().take(13).collect();
    let fallback = format!("{}.{}", root, profile.profile_id);
    ctx.db.player_profile().profile_id().update(PlayerProfile {
        display_name: fallback,
        ..profile.clone()
    });

    let stale_players: Vec<Player> = ctx
        .db
        .player()
        .iter()
        .filter(|player| player.profile_id == profile.profile_id)
        .collect();
    for stale_player in stale_players {
        ctx.db.player().identity().update(Player {
            username: String::new(),
            ..stale_player
        });
    }
}

pub fn relink_identity_to_profile(ctx: &ReducerContext, identity: Identity, profile_id: u64) {
    let stale_players: Vec<Player> = ctx
        .db
        .player()
        .iter()
        .filter(|player| player.profile_id == profile_id && player.identity != identity)
        .collect();
    for stale_player in stale_players {
        ctx.db.player().identity().update(Player {
            username: String::new(),
            online: false,
            current_streak: 0,
            ..stale_player
        });
    }

    let duplicate_links: Vec<Identity> = ctx
        .db
        .identity_link()
        .iter()
        .filter(|link| link.profile_id == profile_id && link.identity != identity)
        .map(|link| link.identity)
        .collect();
    for linked_identity in duplicate_links {
        ctx.db.identity_link().identity().delete(&linked_identity);
    }

    if let Some(link) = ctx.db.identity_link().identity().find(identity) {
        ctx.db.identity_link().identity().update(IdentityLink {
            profile_id,
            linked_at: ctx.timestamp,
            ..link
        });
    } else {
        ctx.db.identity_link().insert(IdentityLink {
            identity,
            profile_id,
            linked_at: ctx.timestamp,
        });
    }
}

pub fn prune_profile_if_unlinked(ctx: &ReducerContext, profile_id: u64) {
    let still_linked = ctx
        .db
        .identity_link()
        .iter()
        .any(|link| link.profile_id == profile_id);
    let still_has_player = ctx
        .db
        .player()
        .iter()
        .any(|player| player.profile_id == profile_id);
    if still_linked || still_has_player {
        return;
    }

    let Some(profile) = ctx.db.player_profile().profile_id().find(profile_id) else {
        return;
    };
    let is_empty = profile.display_name.trim().is_empty()
        && profile.total_kills == 0
        && profile.total_deaths == 0
        && profile.time_played_secs == 0
        && profile.best_streak == 0;
    if !is_empty {
        return;
    }

    if ctx
        .db
        .player_loadout()
        .profile_id()
        .find(profile_id)
        .is_some()
    {
        ctx.db.player_loadout().profile_id().delete(&profile_id);
    }
    ctx.db.player_profile().profile_id().delete(&profile_id);
}

pub fn touch_player_profile(ctx: &ReducerContext, profile_id: u64) {
    if let Some(profile) = ctx.db.player_profile().profile_id().find(profile_id) {
        ctx.db.player_profile().profile_id().update(PlayerProfile {
            last_seen_at: ctx.timestamp,
            ..profile
        });
    }
}

pub fn close_player_session(ctx: &ReducerContext, player: &Player) {
    if let Some(profile) = ctx.db.player_profile().profile_id().find(player.profile_id) {
        let elapsed_secs = timestamp_micros(ctx.timestamp)
            .saturating_sub(timestamp_micros(player.session_started_at))
            / 1_000_000;
        ctx.db.player_profile().profile_id().update(PlayerProfile {
            time_played_secs: profile.time_played_secs.saturating_add(elapsed_secs),
            last_seen_at: ctx.timestamp,
            ..profile
        });
    }
}

pub fn record_profile_kill(ctx: &ReducerContext, profile_id: u64, streak: u32) {
    if let Some(profile) = ctx.db.player_profile().profile_id().find(profile_id) {
        ctx.db.player_profile().profile_id().update(PlayerProfile {
            total_kills: profile.total_kills + 1,
            best_streak: profile.best_streak.max(streak),
            last_seen_at: ctx.timestamp,
            ..profile
        });
    }
}

pub fn record_profile_death(ctx: &ReducerContext, profile_id: u64) {
    if let Some(profile) = ctx.db.player_profile().profile_id().find(profile_id) {
        ctx.db.player_profile().profile_id().update(PlayerProfile {
            total_deaths: profile.total_deaths + 1,
            last_seen_at: ctx.timestamp,
            ..profile
        });
    }
}

pub fn random_spawn_position(ctx: &ReducerContext, identity: &Identity) -> Vec3 {
    let span_x = (WORLD_SIZE_X as i32 - PLAYER_SPAWN_MARGIN * 2).max(8);
    let span_z = (WORLD_SIZE_Z as i32 - PLAYER_SPAWN_MARGIN * 2).max(8);
    let world_seed = ctx
        .db
        .world_config()
        .id()
        .find(1)
        .map(|c| c.seed)
        .unwrap_or(0);
    let base_seed = world_seed
        ^ timestamp_micros(ctx.timestamp)
        ^ identity_seed(identity)
        ^ 0x51bf_4a9d_7c15_d3e9;
    let mut terrain = TerrainSampler::new();

    for attempt in 0..PLAYER_SPAWN_ATTEMPTS {
        let rx = hash_u64(base_seed ^ attempt.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        let rz = hash_u64(base_seed ^ attempt.wrapping_mul(0xd1b5_4a32_d192_ed03));
        let x = PLAYER_SPAWN_MARGIN + (rx % span_x as u64) as i32;
        let z = PLAYER_SPAWN_MARGIN + (rz % span_z as u64) as i32;

        let Some(candidate) = spawn_candidate_position(ctx, &mut terrain, world_seed, x, z) else {
            continue;
        };

        if spawn_separated_from_players(ctx, identity, &candidate) {
            return candidate;
        }
    }

    SPAWN_POS
}

fn identity_seed(identity: &Identity) -> u64 {
    let mut seed = 0xcbf2_9ce4_8422_2325u64;
    for byte in format!("{identity:?}").bytes() {
        seed ^= byte as u64;
        seed = seed.wrapping_mul(0x0000_0100_0000_01b3);
    }
    seed
}

fn spawn_candidate_position(
    ctx: &ReducerContext,
    terrain: &mut TerrainSampler,
    world_seed: u64,
    x: i32,
    z: i32,
) -> Option<Vec3> {
    let biome = get_biome(x, z, world_seed);
    let terrain_floor_y = biome_height(biome, x, z, world_seed) as f32;
    let pos = Vec3 {
        x: x as f32 + 0.5,
        y: terrain.ground_surface_height_below(
            ctx,
            x as f32 + 0.5,
            z as f32 + 0.5,
            terrain_floor_y,
        ) + 1.0
            + player_eye_height(),
        z: z as f32 + 0.5,
    };

    if !spawn_has_headroom(ctx, terrain, &pos) || !is_grounded(ctx, &pos) {
        return None;
    }

    Some(clamp_pos(&pos))
}

fn spawn_has_headroom(ctx: &ReducerContext, terrain: &mut TerrainSampler, pos: &Vec3) -> bool {
    let foot_y = pos.y - player_eye_height();
    let top_y = foot_y + player_hitbox_height();
    let probe_radius = player_hitbox_half_width().max(player_foot_radius());
    let probes = [
        (pos.x, pos.z),
        (pos.x - probe_radius, pos.z - probe_radius),
        (pos.x + probe_radius, pos.z - probe_radius),
        (pos.x - probe_radius, pos.z + probe_radius),
        (pos.x + probe_radius, pos.z + probe_radius),
    ];
    let min_y = foot_y.floor() as i32;
    let max_y = (top_y - 0.001).floor() as i32;

    for y in min_y..=max_y {
        for (px, pz) in probes {
            let bx = px.floor() as i32;
            let bz = pz.floor() as i32;
            if !matches!(terrain.get_block_type(ctx, bx, y, bz), Some(bt) if bt == AIR) {
                return false;
            }
        }
    }

    true
}

fn spawn_separated_from_players(ctx: &ReducerContext, identity: &Identity, pos: &Vec3) -> bool {
    ctx.db.player().iter().filter(|p| p.online).all(|player| {
        player.identity == *identity
            || dist_sq(&player.pos, pos)
                >= PLAYER_SPAWN_MIN_SEPARATION * PLAYER_SPAWN_MIN_SEPARATION
    })
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

pub fn normalize_or_create_player_loadout(ctx: &ReducerContext, profile_id: u64) -> PlayerLoadout {
    if let Some(existing) = ctx.db.player_loadout().profile_id().find(profile_id) {
        if loadout_slots_valid(existing.slot1, existing.slot2, existing.slot3) {
            return existing;
        }
        ctx.db.player_loadout().profile_id().update(PlayerLoadout {
            profile_id,
            slot1: default_loadout()[0],
            slot2: default_loadout()[1],
            slot3: default_loadout()[2],
            updated_at: ctx.timestamp,
        });
        return PlayerLoadout {
            profile_id,
            slot1: default_loadout()[0],
            slot2: default_loadout()[1],
            slot3: default_loadout()[2],
            updated_at: ctx.timestamp,
        };
    }
    ctx.db.player_loadout().insert(PlayerLoadout {
        profile_id,
        slot1: default_loadout()[0],
        slot2: default_loadout()[1],
        slot3: default_loadout()[2],
        updated_at: ctx.timestamp,
    })
}
