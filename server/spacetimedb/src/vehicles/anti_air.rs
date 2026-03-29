// ── Anti-Air Emplacement Physics ──
// Stationary ground emplacement with rotating turret. Does not move.
// Pilot aims via mouse (turret yaw/pitch). Uses the same input queue
// contract as helicopter/jet for acked_input_seq coherence.

use std::f32::consts::TAU;

use spacetimedb::ReducerContext;

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

/// Simulate one tick of anti-air vehicle physics.
pub fn tick_anti_air(
    ctx: &ReducerContext,
    mut vehicle: Vehicle,
    mut entity: Entity,
    mounted_updates: &mut Vec<Player>,
    terrain: &mut TerrainSampler,
) {
    let dt = HELI_TICK_INTERVAL_MS as f32 / 1000.0;
    let next_sim_tick = entity.sim_tick.saturating_add(VEHICLE_SIM_TICK_INCREMENT);
    let entity_id = vehicle.entity_id;

    // Eject dead/offline pilots
    if let Some(pilot_id) = vehicle.pilot_identity {
        match ctx.db.player().identity().find(pilot_id) {
            Some(pilot) if pilot.online && pilot.health > 0 => {}
            Some(pilot) => {
                let dismounted = dismount_player_internal(ctx, pilot, true);
                ctx.db.player().identity().update(dismounted.clone());
                init_movement_state(ctx, dismounted.identity, &dismounted.pos);
                sync_player_entity(ctx, &dismounted);
                if let Some(v) = ctx.db.vehicle().entity_id().find(&entity_id) {
                    vehicle = v;
                }
            }
            None => {
                vehicle.pilot_identity = None;
                vehicle.input_forward = 0.0;
                vehicle.input_strafe = 0.0;
                vehicle.input_lift = 0.0;
                vehicle.input_yaw = 0.0;
                vehicle.boosting = false;
            }
        }
    }

    let has_pilot = vehicle.pilot_identity.is_some();

    // Consume exactly one queued command per simulation tick.
    if has_pilot {
        if let Some(cmd) = pop_next_vehicle_input(ctx, entity_id) {
            vehicle.input_forward = clamp_vehicle_axis(cmd.forward);
            vehicle.input_strafe = clamp_vehicle_axis(cmd.strafe);
            vehicle.input_lift = clamp_vehicle_axis(cmd.lift);
            vehicle.input_yaw = clamp_vehicle_axis(cmd.yaw);
            vehicle.boosting = cmd.boosting;
            vehicle.acked_input_seq = cmd.seq;
        }
    }

    // ── Stationary emplacement — no movement, only turret aim via pilot look ──
    // Zero out velocity (emplacement doesn't move)
    entity.vel.x = 0.0;
    entity.vel.z = 0.0;
    entity.vel.y = 0.0;

    // Ground snap (surface_height is the top solid block Y; +1.0 is the
    // walkable top surface where the AA base should rest).
    let ground =
        terrain.ground_surface_height(ctx, entity.pos.x, entity.pos.z) + aa_min_altitude() + 1.0;
    entity.pos.y = ground;

    // Keep pitch level
    entity.rot.pitch = 0.0;
    entity.sim_tick = next_sim_tick;
    entity.updated_at = ctx.timestamp;

    // ── Rotor spin (reused for radar animation on client) ──
    let spin_target = if has_pilot { 4.0 } else { 0.5 };
    vehicle.rotor_spin = (vehicle.rotor_spin + spin_target * dt) % TAU;

    vehicle.sim_tick = next_sim_tick;
    vehicle.sim_updated_at = ctx.timestamp;

    // ── Commit ──
    ctx.db.entity().id().update(entity.clone());
    ctx.db.vehicle().entity_id().update(vehicle.clone());

    // ── Mounted pilot position sync ──
    if let Some(pilot_id) = vehicle.pilot_identity {
        if let Some(pilot) = ctx.db.player().identity().find(pilot_id) {
            mounted_updates.push(Player {
                pos: Vec3 {
                    x: entity.pos.x,
                    y: entity.pos.y + aa_pilot_seat_height(),
                    z: entity.pos.z,
                },
                vel: entity.vel.clone(),
                spawn_protected: false,
                ..pilot
            });
        }
    }
}
