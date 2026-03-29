// ── Abilities System ──
// Ability pickups spawn around the world and grant temporary buffs.
// tick_abilities handles proximity pickup, buff expiry, and respawning.

pub mod spawning;

use std::time::Duration;

use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;

/// Returns the damage multiplier for an attacker (2.0 with DoubleDamage buff).
pub fn damage_multiplier(ctx: &ReducerContext, identity: Identity) -> f32 {
    let now_us = timestamp_micros(ctx.timestamp);
    for buff in ctx.db.player_buff().idx_buff_identity().filter(&identity) {
        if buff.ability_type == ability_type_double_damage() {
            if timestamp_micros(buff.expires_at) > now_us {
                return double_damage_multiplier();
            }
        }
    }
    1.0
}

/// Returns the damage reduction factor for a target (0.5 with Shield buff).
pub fn defense_multiplier(ctx: &ReducerContext, identity: Identity) -> f32 {
    let now_us = timestamp_micros(ctx.timestamp);
    for buff in ctx.db.player_buff().idx_buff_identity().filter(&identity) {
        if buff.ability_type == ability_type_shield() {
            if timestamp_micros(buff.expires_at) > now_us {
                return shield_damage_reduction();
            }
        }
    }
    1.0
}

/// Returns the speed multiplier for a player (1.6 with SpeedBoost buff).
pub fn speed_multiplier(ctx: &ReducerContext, identity: Identity) -> f32 {
    let now_us = timestamp_micros(ctx.timestamp);
    for buff in ctx.db.player_buff().idx_buff_identity().filter(&identity) {
        if buff.ability_type == ability_type_speed_boost() {
            if timestamp_micros(buff.expires_at) > now_us {
                return speed_boost_multiplier();
            }
        }
    }
    1.0
}

/// Clear all buffs for a player (on death/respawn/disconnect).
pub fn clear_buffs(ctx: &ReducerContext, identity: Identity) {
    let buff_ids: Vec<u64> = ctx
        .db
        .player_buff()
        .idx_buff_identity()
        .filter(&identity)
        .map(|b| b.id)
        .collect();
    for id in buff_ids {
        ctx.db.player_buff().id().delete(&id);
    }
}

/// Apply a buff, refreshing duration if already active.
fn apply_buff(ctx: &ReducerContext, identity: Identity, ability_type: u8, duration_secs: u64) {
    let expires_at = ctx.timestamp + Duration::from_secs(duration_secs);

    // Refresh existing buff of same type
    for existing in ctx.db.player_buff().idx_buff_identity().filter(&identity) {
        if existing.ability_type == ability_type {
            ctx.db.player_buff().id().update(PlayerBuff {
                expires_at,
                ..existing
            });
            return;
        }
    }

    ctx.db.player_buff().insert(PlayerBuff {
        id: 0,
        identity,
        ability_type,
        expires_at,
        created_at: ctx.timestamp,
    });
}

/// Client-triggered instant pickup: validate proximity, then collect.
#[reducer]
pub fn collect_ability(ctx: &ReducerContext, pickup_id: u64) -> Result<(), String> {
    let player = ctx
        .db
        .player()
        .identity()
        .find(ctx.sender())
        .ok_or("Player not found")?;
    if player.health <= 0 {
        return Err("Dead players cannot collect pickups".to_string());
    }
    if player.mounted_vehicle_id != 0 {
        return Err("Cannot collect while mounted".to_string());
    }
    let pickup = ctx
        .db
        .ability_pickup()
        .id()
        .find(&pickup_id)
        .ok_or("Pickup not found")?;
    if !pickup.active {
        return Err("Pickup not active".to_string());
    }
    let radius_sq = ability_pickup_radius() * ability_pickup_radius();
    if dist_sq(&pickup.pos, &player.pos) > radius_sq {
        return Err("Too far from pickup".to_string());
    }
    collect_pickup(ctx, pickup, &player);
    Ok(())
}

/// Collect an ability pickup: apply the buff/heal and emit event.
fn collect_pickup(ctx: &ReducerContext, pickup: AbilityPickup, player: &Player) {
    let ability_type = pickup.ability_type;

    if ability_type == ability_type_health_regen() {
        // Instant heal to full
        if player.health < player.max_health {
            ctx.db.player().identity().update(Player {
                health: player.max_health,
                ..player.clone()
            });
        }
    } else if ability_type == ability_type_double_damage() {
        apply_buff(
            ctx,
            player.identity,
            ability_type,
            double_damage_duration_secs(),
        );
    } else if ability_type == ability_type_speed_boost() {
        apply_buff(
            ctx,
            player.identity,
            ability_type,
            speed_boost_duration_secs(),
        );
    } else if ability_type == ability_type_shield() {
        apply_buff(
            ctx,
            player.identity,
            ability_type,
            shield_duration_secs(),
        );
    }

    // Mark pickup as inactive, set respawn time
    ctx.db.ability_pickup().id().update(AbilityPickup {
        active: false,
        respawn_at: ctx.timestamp + Duration::from_secs(ability_pickup_respawn_secs()),
        ..pickup.clone()
    });

    // Emit event for client VFX
    ctx.db
        .ability_pickup_event()
        .insert(AbilityPickupEvent {
            id: 0,
            player: player.identity,
            ability_type,
            pos: pickup.pos.clone(),
            created_at: ctx.timestamp,
        });
}

#[reducer]
pub fn tick_abilities(ctx: &ReducerContext, _job: AbilityTick) {
    let now_us = timestamp_micros(ctx.timestamp);

    // 1. Expire buffs
    let expired: Vec<u64> = ctx
        .db
        .player_buff()
        .iter()
        .filter(|b| timestamp_micros(b.expires_at) <= now_us)
        .map(|b| b.id)
        .collect();
    for id in expired {
        ctx.db.player_buff().id().delete(&id);
    }

    // 2. Respawn pickups
    let respawnable: Vec<u64> = ctx
        .db
        .ability_pickup()
        .iter()
        .filter(|p| !p.active && timestamp_micros(p.respawn_at) <= now_us)
        .map(|p| p.id)
        .collect();
    for id in respawnable {
        if let Some(pickup) = ctx.db.ability_pickup().id().find(&id) {
            ctx.db.ability_pickup().id().update(AbilityPickup {
                active: true,
                ..pickup
            });
        }
    }

    // 3. Clean stale pickup events (> 3s)
    let stale_events: Vec<u64> = ctx
        .db
        .ability_pickup_event()
        .iter()
        .filter(|e| now_us.saturating_sub(timestamp_micros(e.created_at)) > 3_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale_events {
        ctx.db.ability_pickup_event().id().delete(&id);
    }

    // Reschedule
    ctx.db.ability_tick().insert(AbilityTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(ability_tick_interval_ms()),
        ),
    });
}
