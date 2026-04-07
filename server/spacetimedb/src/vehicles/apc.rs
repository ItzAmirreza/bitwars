// ── APC (Armored Personnel Carrier) Physics ──
// Heavy ground vehicle with tread-based movement. Cannot fly.
// Strong collision resistance — plows through blocks with minimal speed loss.
// Driver cannot fire weapons; this is a transport/ramming vehicle.

use std::f32::consts::TAU;

use spacetimedb::ReducerContext;

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

/// Simulate one tick of APC ground vehicle physics.
pub fn tick_apc(
    ctx: &ReducerContext,
    mut vehicle: Vehicle,
    mut entity: Entity,
    mounted_updates: &mut Vec<Player>,
    terrain: &mut TerrainSampler,
) {
    let dt = HELI_TICK_INTERVAL_MS as f32 / 1000.0;
    let next_sim_tick = entity.sim_tick.saturating_add(VEHICLE_SIM_TICK_INCREMENT);
    let entity_id = vehicle.entity_id;

    // ── Eject dead/offline pilots ──
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

    // ── Consume one queued command per tick ──
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

    // ── Input Processing ──
    let yaw_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_yaw)
    } else {
        0.0
    };
    let forward_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_forward)
    } else {
        0.0
    };

    // ── Rotation (treads steer) ──
    let yaw_step = yaw_input * apc_max_yaw_rate() * dt;
    entity.rot.yaw += yaw_step;
    if entity.rot.yaw > std::f32::consts::PI {
        entity.rot.yaw -= TAU;
    }
    if entity.rot.yaw < -std::f32::consts::PI {
        entity.rot.yaw += TAU;
    }

    // ── Velocity (tread-driven, forward/backward only, no strafing) ──
    let forward_speed = forward_input * apc_cruise_speed();

    let fx = -entity.rot.yaw.sin();
    let fz = -entity.rot.yaw.cos();

    let target_vx = fx * forward_speed;
    let target_vz = fz * forward_speed;

    let horiz_blend = if has_pilot { apc_horiz_blend() } else { 0.08 };
    entity.vel.x += (target_vx - entity.vel.x) * horiz_blend;
    entity.vel.z += (target_vz - entity.vel.z) * horiz_blend;

    // Gravity
    entity.vel.y -= apc_gravity() * dt;

    let drag = if has_pilot {
        apc_drag_piloted()
    } else {
        apc_drag_unpiloted()
    };
    entity.vel.x *= drag;
    entity.vel.z *= drag;

    // ── Position integration ──
    let mut next_pos = Vec3 {
        x: entity.pos.x + entity.vel.x * dt,
        y: entity.pos.y + entity.vel.y * dt,
        z: entity.pos.z + entity.vel.z * dt,
    };

    // ── World bounds ──
    let min_x = 2.0;
    let max_x = WORLD_SIZE_X as f32 - 2.0;
    let min_z = 2.0;
    let max_z = WORLD_SIZE_Z as f32 - 2.0;

    if next_pos.x < min_x {
        next_pos.x = min_x;
        entity.vel.x = entity.vel.x.abs() * 0.2;
    }
    if next_pos.x > max_x {
        next_pos.x = max_x;
        entity.vel.x = -entity.vel.x.abs() * 0.2;
    }
    if next_pos.z < min_z {
        next_pos.z = min_z;
        entity.vel.z = entity.vel.z.abs() * 0.2;
    }
    if next_pos.z > max_z {
        next_pos.z = max_z;
        entity.vel.z = -entity.vel.z.abs() * 0.2;
    }

    entity.pos = next_pos;

    // ── Block collision (BEFORE ground clamping) ──
    let (_blocks_hit, destroyed) =
        super::collision::check_vehicle_block_collision(ctx, &mut entity, &mut vehicle, terrain);
    if destroyed {
        return;
    }

    // ── Ground collision ──
    // Scan downward from current Y to match client prediction (which also scans from footY).
    let ground = terrain.ground_vehicle_rest_height_below(ctx, entity.pos.x, entity.pos.z, entity.pos.y);
    let min_alt = ground + apc_min_altitude();
    if entity.pos.y < min_alt {
        entity.pos.y = min_alt;
        if entity.vel.y < 0.0 {
            entity.vel.y = 0.0;
        }
    }
    if entity.pos.y > apc_max_altitude() {
        entity.pos.y = apc_max_altitude();
    }

    // Keep pitch level (ground vehicle)
    entity.rot.pitch = 0.0;

    entity.sim_tick = next_sim_tick;
    entity.updated_at = ctx.timestamp;

    // ── Tread spin visual (reusing rotor_spin field) ──
    let speed_sq =
        entity.vel.x * entity.vel.x + entity.vel.z * entity.vel.z;
    let speed = speed_sq.sqrt();
    let spin_rate = if has_pilot { speed * 0.3 } else { 0.0 };
    vehicle.rotor_spin = (vehicle.rotor_spin + spin_rate * dt) % TAU;

    vehicle.sim_tick = next_sim_tick;
    vehicle.sim_updated_at = ctx.timestamp;

    // ── Commit ──
    ctx.db.entity().id().update(entity.clone());
    ctx.db.vehicle().entity_id().update(vehicle.clone());

    sync_vehicle_occupants(ctx, &vehicle, &entity, mounted_updates);
}
