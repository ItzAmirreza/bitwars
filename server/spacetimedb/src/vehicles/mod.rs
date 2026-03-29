// ── Vehicle System ──
// Trait-based vehicle physics. To add a new vehicle type:
//   1. Create a new file (e.g. vehicles/tank.rs)
//   2. Implement the physics + spawn logic
//   3. Add it to the tick_vehicles dispatcher
//   4. Add a new VEHICLE_TYPE_* constant in constants.rs

pub mod anti_air;
pub mod fighter_jet;
pub mod helicopter;
pub mod interaction;
pub mod spawning;
pub mod weapons;

// Re-export for convenience
pub use anti_air::tick_anti_air;
pub use fighter_jet::tick_fighter_jet;
pub use helicopter::tick_helicopter;
pub use interaction::{interact_vehicle, update_vehicle_input};
pub use spawning::spawn_anti_air;
pub use spawning::spawn_fighter_jet;
pub use spawning::spawn_helicopter;
pub use spawning::spawn_jets_at_airstrips;
pub use spawning::spawn_sandbox_helicopters;
pub use weapons::{
    fire_vehicle_weapon, reload_vehicle_weapon, switch_vehicle_weapon, vehicle_projectile_impact,
};

use std::time::Duration;

use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;

/// Master vehicle tick — dispatches to per-type physics.
/// When you add a new vehicle type, add a branch here.
#[reducer]
pub fn tick_vehicles(ctx: &ReducerContext, job: VehicleTick) {
    let vehicle_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();
    let num_vehicles = vehicle_ids.len();

    let mut mounted_updates: Vec<Player> = Vec::new();
    let mut terrain = TerrainSampler::new();
    let mut total_queue_depth: usize = 0;

    for entity_id in vehicle_ids {
        let Some(vehicle) = ctx.db.vehicle().entity_id().find(&entity_id) else {
            continue;
        };
        let Some(entity) = ctx.db.entity().id().find(&entity_id) else {
            continue;
        };
        if !entity.active {
            continue;
        }

        let queue_depth: usize = ctx
            .db
            .vehicle_input_cmd()
            .idx_vehicle_input_by_vehicle()
            .filter(&entity_id)
            .count();
        total_queue_depth += queue_depth;

        if vehicle.vehicle_type == vehicle_type_helicopter() {
            tick_helicopter(ctx, vehicle, entity, &mut mounted_updates, &mut terrain);
        } else if vehicle.vehicle_type == vehicle_type_fighter_jet() {
            tick_fighter_jet(ctx, vehicle, entity, &mut mounted_updates, &mut terrain);
        } else if vehicle.vehicle_type == vehicle_type_anti_air() {
            tick_anti_air(ctx, vehicle, entity, &mut mounted_updates, &mut terrain);
        }
    }

    let num_mounted = mounted_updates.len();
    for mounted in mounted_updates {
        ctx.db.player().identity().update(mounted.clone());
        init_movement_state(ctx, mounted.identity, &mounted.pos);
        sync_player_entity(ctx, &mounted);
    }

    // Log every 30 ticks (~1 second)
    let tick_number = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_millis()
        / HELI_TICK_INTERVAL_MS as u128;
    if tick_number % 30 == 0 {
        log::info!(
            "[VEHICLE_TICK] vehicles={} mounted={} queue_depth={}",
            num_vehicles,
            num_mounted,
            total_queue_depth,
        );
    }

    // Reschedule from the INTENDED tick time, not actual execution time.
    // This prevents cumulative drift from scheduler overhead.
    let intended_time = match job.scheduled_at {
        ScheduleAt::Time(t) => t,
        _ => ctx.timestamp,
    };
    let next_tick = intended_time + Duration::from_millis(HELI_TICK_INTERVAL_MS);
    // If we fell too far behind (>5 ticks), reset to now to avoid burst catch-up
    let next_tick = if next_tick + Duration::from_millis(HELI_TICK_INTERVAL_MS * 5) < ctx.timestamp {
        ctx.timestamp + Duration::from_millis(HELI_TICK_INTERVAL_MS)
    } else {
        next_tick
    };
    ctx.db.vehicle_tick().insert(VehicleTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(next_tick),
    });
}
