// ── Vehicle System ──
// Trait-based vehicle physics. To add a new vehicle type:
//   1. Create a new file (e.g. vehicles/tank.rs)
//   2. Implement the physics + spawn logic
//   3. Add it to the tick_vehicles dispatcher
//   4. Add a new VEHICLE_TYPE_* constant in constants.rs

pub mod helicopter;
pub mod interaction;
pub mod weapons;
pub mod spawning;

// Re-export for convenience
pub use helicopter::tick_helicopter;
pub use interaction::{interact_vehicle, update_vehicle_input};
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
pub fn tick_vehicles(ctx: &ReducerContext, _job: VehicleTick) {
    let vehicle_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();

    let mut mounted_updates: Vec<Player> = Vec::new();

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

        // Dispatch to per-vehicle-type physics
        match vehicle.vehicle_type {
            VEHICLE_TYPE_HELICOPTER => {
                tick_helicopter(ctx, vehicle, entity, &mut mounted_updates);
            }
            // Future: VEHICLE_TYPE_TANK => tick_tank(ctx, vehicle, entity, &mut mounted_updates),
            // Future: VEHICLE_TYPE_BOAT => tick_boat(ctx, vehicle, entity, &mut mounted_updates),
            _ => {}
        }
    }

    // Apply mounted player position updates
    for mounted in mounted_updates {
        ctx.db.player().identity().update(mounted.clone());
        init_movement_state(ctx, mounted.identity, &mounted.pos);
        sync_player_entity(ctx, &mounted);
    }

    // Reschedule
    ctx.db.vehicle_tick().insert(VehicleTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(HELI_TICK_INTERVAL_MS),
        ),
    });
}
