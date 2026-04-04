// ── Match Flow ──
// Round timer, intermission, result capture, and round resets.

use std::time::Duration;

use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::map::reset_map;
use crate::tables::*;
use crate::types::{Rotation, ZERO_VEL};
use crate::weapons;

pub const MATCH_STATE_WAITING: u8 = 0;
pub const MATCH_STATE_ACTIVE: u8 = 1;
pub const MATCH_STATE_ENDED: u8 = 2;

#[derive(Clone)]
struct MatchStandingRow {
    identity: Identity,
    username: String,
    kills: u32,
    deaths: u32,
    joined_at_us: u64,
    online: bool,
}

fn next_tick_time(ctx: &ReducerContext) -> ScheduleAt {
    ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1))
}

pub fn schedule_next_match_tick(ctx: &ReducerContext) {
    ctx.db.match_tick().insert(MatchTick {
        scheduled_id: 0,
        scheduled_at: next_tick_time(ctx),
    });
}

pub fn current_match_state(ctx: &ReducerContext) -> Option<MatchState> {
    ctx.db.match_state().id().find(1)
}

pub fn is_match_active(ctx: &ReducerContext) -> bool {
    current_match_state(ctx)
        .map(|state| state.state == MATCH_STATE_ACTIVE)
        .unwrap_or(false)
}

pub fn require_active_match(ctx: &ReducerContext) -> Result<(), String> {
    match current_match_state(ctx) {
        Some(state) if state.state == MATCH_STATE_ACTIVE => Ok(()),
        Some(_) => Err("Weapons are disabled during intermission".to_string()),
        None => Err("Match state unavailable".to_string()),
    }
}

pub fn set_waiting_match_state(ctx: &ReducerContext) {
    set_waiting_match_state_for_round(ctx, 1);
}

pub fn set_waiting_match_state_for_round(ctx: &ReducerContext, round_number: u32) {
    let state = MatchState {
        id: 1,
        round_number: round_number.max(1),
        state: MATCH_STATE_WAITING,
        phase_started_at: ctx.timestamp,
        phase_ends_at: ctx.timestamp,
        time_remaining_secs: 0,
    };

    if current_match_state(ctx).is_some() {
        ctx.db.match_state().id().update(state);
    } else {
        ctx.db.match_state().insert(state);
    }
}

fn has_ready_players(ctx: &ReducerContext) -> bool {
    ctx.db
        .player()
        .iter()
        .any(|player| player.online && !player.username.trim().is_empty())
}

pub fn start_round(ctx: &ReducerContext, round_number: u32) {
    let duration = match_round_duration_secs() as u32;
    let state = MatchState {
        id: 1,
        round_number,
        state: MATCH_STATE_ACTIVE,
        phase_started_at: ctx.timestamp,
        phase_ends_at: ctx.timestamp + Duration::from_secs(match_round_duration_secs()),
        time_remaining_secs: duration,
    };

    if current_match_state(ctx).is_some() {
        ctx.db.match_state().id().update(state);
    } else {
        ctx.db.match_state().insert(state);
    }

    if let Some(config) = ctx.db.world_config().id().find(1) {
        ctx.db.world_config().id().update(WorldConfig {
            round_number,
            round_start: ctx.timestamp,
            ..config
        });
    }
}

fn collect_match_standings(ctx: &ReducerContext) -> Vec<MatchStandingRow> {
    let mut standings: Vec<MatchStandingRow> = ctx
        .db
        .player()
        .iter()
        .filter(|player| {
            !player.username.trim().is_empty()
                && (player.online || player.kills > 0 || player.deaths > 0)
        })
        .map(|player| MatchStandingRow {
            identity: player.identity,
            username: player.username,
            kills: player.kills,
            deaths: player.deaths,
            joined_at_us: timestamp_micros(player.joined_at),
            online: player.online,
        })
        .collect();

    standings.sort_by(|a, b| {
        b.kills
            .cmp(&a.kills)
            .then_with(|| a.deaths.cmp(&b.deaths))
            .then_with(|| b.online.cmp(&a.online))
            .then_with(|| a.joined_at_us.cmp(&b.joined_at_us))
            .then_with(|| a.username.cmp(&b.username))
    });

    standings
}

fn store_match_result(ctx: &ReducerContext, round_number: u32, standings: &[MatchStandingRow]) {
    let winner = standings.first();
    let player_identities = standings.iter().map(|row| row.identity).collect();
    let player_names = standings.iter().map(|row| row.username.clone()).collect();
    let player_kills = standings.iter().map(|row| row.kills).collect();
    let player_deaths = standings.iter().map(|row| row.deaths).collect();

    ctx.db.match_result().insert(MatchResult {
        id: 0,
        round_number,
        winner_name: winner
            .map(|row| row.username.clone())
            .unwrap_or_else(|| "NO WINNER".to_string()),
        winner_kills: winner.map(|row| row.kills).unwrap_or(0),
        player_identities,
        player_names,
        player_kills,
        player_deaths,
        created_at: ctx.timestamp,
    });
}

fn respawn_player_for_intermission(ctx: &ReducerContext, player: Player) {
    let loadout = normalize_or_create_player_loadout(ctx, player.profile_id);
    let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
        player.current_weapon
    } else {
        loadout.slot1
    };
    let spawn_pos = random_spawn_position(ctx, &player.identity);
    let dismounted = dismount_player_internal(ctx, player, true);
    let revived = Player {
        health: max_health(),
        max_health: max_health(),
        pos: spawn_pos.clone(),
        vel: ZERO_VEL,
        rot: Rotation {
            yaw: 0.0,
            pitch: 0.0,
        },
        spawn_protected: false,
        current_weapon,
        mounted_vehicle_id: 0,
        ..dismounted
    };
    ctx.db.player().identity().update(revived.clone());
    sync_player_entity(ctx, &revived);
    weapons::reset_all_ammo(ctx, revived.identity);
    crate::abilities::clear_buffs(ctx, revived.identity);
    init_movement_state(ctx, revived.identity, &spawn_pos);
}

fn revive_dead_players_for_intermission(ctx: &ReducerContext) {
    let dead_players: Vec<Player> = ctx
        .db
        .player()
        .iter()
        .filter(|player| player.health <= 0)
        .collect();
    for player in dead_players {
        respawn_player_for_intermission(ctx, player);
    }

    let grenade_ids: Vec<u64> = ctx
        .db
        .grenade_projectile()
        .iter()
        .map(|row| row.id)
        .collect();
    for id in grenade_ids {
        ctx.db.grenade_projectile().id().delete(&id);
    }
}

pub fn reset_players_for_new_round(ctx: &ReducerContext) {
    let player_ids: Vec<Identity> = ctx
        .db
        .player()
        .iter()
        .map(|player| player.identity)
        .collect();

    for identity in player_ids {
        let Some(player) = ctx.db.player().identity().find(identity) else {
            continue;
        };
        let entity_id = ensure_player_entity(ctx, &player);
        let loadout = normalize_or_create_player_loadout(ctx, player.profile_id);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };
        let is_god = player.max_health >= god_mode_health();
        let spawn_pos = random_spawn_position(ctx, &identity);
        let dismounted = dismount_player_internal(ctx, player, true);
        let reset = Player {
            entity_id,
            health: if is_god {
                god_mode_health()
            } else {
                max_health()
            },
            max_health: if is_god {
                god_mode_health()
            } else {
                max_health()
            },
            pos: spawn_pos.clone(),
            vel: ZERO_VEL,
            rot: Rotation {
                yaw: 0.0,
                pitch: 0.0,
            },
            kills: 0,
            deaths: 0,
            current_streak: 0,
            spawn_protected: true,
            current_weapon,
            mounted_vehicle_id: 0,
            ..dismounted
        };
        ctx.db.player().identity().update(reset.clone());
        sync_player_entity(ctx, &reset);
        weapons::reset_all_ammo(ctx, identity);
        crate::abilities::clear_buffs(ctx, identity);
        init_movement_state(ctx, identity, &spawn_pos);
    }

    let kill_event_ids: Vec<u64> = ctx.db.kill_event().iter().map(|row| row.id).collect();
    for id in kill_event_ids {
        ctx.db.kill_event().id().delete(&id);
    }

    let grenade_ids: Vec<u64> = ctx
        .db
        .grenade_projectile()
        .iter()
        .map(|row| row.id)
        .collect();
    for id in grenade_ids {
        ctx.db.grenade_projectile().id().delete(&id);
    }

    for vehicle in ctx.db.vehicle().iter() {
        let primary_idx = if vehicle.vehicle_type == vehicle_type_fighter_jet() {
            Some(jet_weapon_slot0())
        } else if vehicle.vehicle_type == vehicle_type_anti_air() {
            Some(aa_weapon_slot0())
        } else {
            Some(0)
        };
        let secondary_idx = if vehicle.vehicle_type == vehicle_type_fighter_jet() {
            Some(jet_weapon_slot1())
        } else if vehicle.vehicle_type == vehicle_type_anti_air() {
            None
        } else {
            Some(1)
        };
        let tertiary_idx = if vehicle.vehicle_type == vehicle_type_fighter_jet() {
            Some(jet_weapon_slot2())
        } else {
            None
        };

        let updated = Vehicle {
            weapon_ammo_primary: primary_idx
                .map(|idx| weapons::get_vehicle_weapon(idx).max_ammo)
                .unwrap_or(vehicle.weapon_ammo_primary),
            weapon_ammo_secondary: secondary_idx
                .map(|idx| weapons::get_vehicle_weapon(idx).max_ammo)
                .unwrap_or(vehicle.weapon_ammo_secondary),
            weapon_ammo_tertiary: tertiary_idx
                .map(|idx| weapons::get_vehicle_weapon(idx).max_ammo)
                .unwrap_or(vehicle.weapon_ammo_tertiary),
            weapon_type: 0,
            ..vehicle
        };
        ctx.db.vehicle().entity_id().update(updated);
    }
}

fn enter_intermission(ctx: &ReducerContext, state: MatchState) {
    let standings = collect_match_standings(ctx);
    store_match_result(ctx, state.round_number, &standings);
    revive_dead_players_for_intermission(ctx);

    ctx.db.match_state().id().update(MatchState {
        state: MATCH_STATE_ENDED,
        phase_started_at: ctx.timestamp,
        phase_ends_at: ctx.timestamp + Duration::from_secs(match_intermission_secs()),
        time_remaining_secs: match_intermission_secs() as u32,
        ..state
    });

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender: ctx.sender(),
        sender_name: "[SERVER]".to_string(),
        text: match standings.first() {
            Some(winner) => format!(
                "Round {} complete. {} wins with {} kills. Next round in {}s.",
                state.round_number,
                winner.username,
                winner.kills,
                match_intermission_secs()
            ),
            None => format!(
                "Round {} complete. No winner. Next round in {}s.",
                state.round_number,
                match_intermission_secs()
            ),
        },
        sent_at: ctx.timestamp,
    });
}

#[reducer]
pub fn tick_match(ctx: &ReducerContext, _job: MatchTick) {
    let Some(state) = current_match_state(ctx) else {
        schedule_next_match_tick(ctx);
        return;
    };

    match state.state {
        MATCH_STATE_WAITING => {
            if has_ready_players(ctx) {
                start_round(ctx, state.round_number.max(1));
            }
        }
        MATCH_STATE_ACTIVE => {
            if !has_ready_players(ctx) {
                set_waiting_match_state_for_round(ctx, state.round_number.max(1));
            } else if state.time_remaining_secs <= 1 {
                enter_intermission(ctx, state);
            } else {
                ctx.db.match_state().id().update(MatchState {
                    time_remaining_secs: state.time_remaining_secs - 1,
                    ..state
                });
            }
        }
        MATCH_STATE_ENDED => {
            if !has_ready_players(ctx) {
                set_waiting_match_state_for_round(ctx, state.round_number.max(1));
            } else if state.time_remaining_secs <= 1 {
                reset_map(
                    ctx,
                    MapResetTimer {
                        scheduled_id: 0,
                        scheduled_at: ScheduleAt::Time(ctx.timestamp),
                    },
                );
            } else {
                ctx.db.match_state().id().update(MatchState {
                    time_remaining_secs: state.time_remaining_secs - 1,
                    ..state
                });
            }
        }
        _ => {}
    }

    schedule_next_match_tick(ctx);
}
