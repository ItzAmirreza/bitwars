// ── Scheduled Cleanup ──
// Periodic cleanup of stale events and health regeneration.

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;

#[reducer]
pub fn cleanup_shots_scheduled(ctx: &ReducerContext, _job: ShotCleanup) {
    let now_micros = timestamp_micros(ctx.timestamp);

    // Clean stale shot events (> 2s)
    let stale_shots: Vec<u64> = ctx
        .db
        .shot_event()
        .iter()
        .filter(|s| {
            now_micros.saturating_sub(timestamp_micros(s.fired_at))
                > crate::weapons::shot_event_retention_us(s.weapon)
        })
        .map(|s| s.id)
        .collect();
    for id in stale_shots {
        ctx.db.shot_event().id().delete(&id);
    }

    // Clean stale explosion events (> 3s)
    let stale_explosions: Vec<u64> = ctx
        .db
        .explosion_event()
        .iter()
        .filter(|e| now_micros.saturating_sub(timestamp_micros(e.created_at)) > 3_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale_explosions {
        ctx.db.explosion_event().id().delete(&id);
    }

    // Clean stale vehicle destroy events (> 4s)
    let stale_vehicle_destroys: Vec<u64> = ctx
        .db
        .vehicle_destroy_event()
        .iter()
        .filter(|e| now_micros.saturating_sub(timestamp_micros(e.created_at)) > 4_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale_vehicle_destroys {
        ctx.db.vehicle_destroy_event().id().delete(&id);
    }

    // Clean stale grenade projectiles (> 10s safety net)
    let stale_grenades: Vec<u64> = ctx
        .db
        .grenade_projectile()
        .iter()
        .filter(|g| now_micros.saturating_sub(timestamp_micros(g.created_at)) > 10_000_000)
        .map(|g| g.id)
        .collect();
    for id in stale_grenades {
        ctx.db.grenade_projectile().id().delete(&id);
    }

    // Clean stale kill events (> 10s)
    let stale_kills: Vec<u64> = ctx
        .db
        .kill_event()
        .iter()
        .filter(|e| now_micros.saturating_sub(timestamp_micros(e.created_at)) > 10_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale_kills {
        ctx.db.kill_event().id().delete(&id);
    }

    // Clean stale admin teleport events (> 10s)
    let stale_admin_teleports: Vec<u64> = ctx
        .db
        .admin_teleport_event()
        .iter()
        .filter(|e| now_micros.saturating_sub(timestamp_micros(e.created_at)) > 10_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale_admin_teleports {
        ctx.db.admin_teleport_event().id().delete(&id);
    }

    ctx.db.shot_cleanup().insert(ShotCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(3)),
    });
}

#[reducer]
pub fn cleanup_detach_events(ctx: &ReducerContext, _job: DetachCleanup) {
    let now_micros = timestamp_micros(ctx.timestamp);
    let stale: Vec<u64> = ctx
        .db
        .detach_event()
        .iter()
        .filter(|e| now_micros.saturating_sub(timestamp_micros(e.created_at)) > 5_000_000)
        .map(|e| e.id)
        .collect();
    for id in stale {
        ctx.db.detach_event().id().delete(&id);
    }

    ctx.db.detach_cleanup().insert(DetachCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(5)),
    });
}

#[reducer]
pub fn tick_health_regen(ctx: &ReducerContext, _job: HealthRegenTick) {
    let now_us = timestamp_micros(ctx.timestamp);
    let regen_delay_us = health_regen_delay_secs() * 1_000_000;

    let eligible: Vec<spacetimedb::Identity> = ctx
        .db
        .player()
        .iter()
        .filter(|p| {
            p.online
                && p.health > 0
                && p.health < p.max_health
                && p.max_health < god_mode_health()
                && now_us.saturating_sub(timestamp_micros(p.last_damage_time)) > regen_delay_us
        })
        .map(|p| p.identity)
        .collect();

    for id in eligible {
        if let Some(p) = ctx.db.player().identity().find(id) {
            let new_health = (p.health + health_regen_rate()).min(p.max_health);
            let healed = Player {
                health: new_health,
                ..p
            };
            ctx.db.player().identity().update(healed.clone());
            sync_player_entity(ctx, &healed);
        }
    }

    ctx.db.health_regen_tick().insert(HealthRegenTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1)),
    });
}
