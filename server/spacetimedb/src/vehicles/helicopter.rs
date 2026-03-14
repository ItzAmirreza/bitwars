// ── Helicopter Physics ──
// All helicopter-specific physics simulation.
// Extracted so adding a tank/boat/plane is just a new file.

use std::f32::consts::TAU;

use spacetimedb::ReducerContext;

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

/// Simulate one tick of helicopter physics.
/// Modifies vehicle + entity in DB, pushes mounted player updates to `mounted_updates`.
pub fn tick_helicopter(
    ctx: &ReducerContext,
    mut vehicle: Vehicle,
    mut entity: Entity,
    mounted_updates: &mut Vec<Player>,
) {
    let dt = HELI_TICK_INTERVAL_MS as f32 / 1000.0;
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
    let strafe_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_strafe)
    } else {
        0.0
    };
    let lift_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_lift)
    } else {
        0.0
    };

    // ── Rotation ──
    let yaw_step = yaw_input * heli_max_yaw_rate() * dt;
    let target_pitch = if has_pilot {
        -forward_input * 0.25
    } else {
        0.0
    };
    let pitch_step = (target_pitch - entity.rot.pitch)
        .clamp(-heli_max_pitch_rate() * dt, heli_max_pitch_rate() * dt);
    entity.rot.pitch += pitch_step;

    // ── Velocity ──
    let forward_speed = forward_input * heli_cruise_speed();
    let strafe_speed = strafe_input * heli_strafe_speed();
    let lift_speed = lift_input * heli_lift_speed();

    let fx = -entity.rot.yaw.sin();
    let fz = -entity.rot.yaw.cos();
    let rx = entity.rot.yaw.cos();
    let rz = -entity.rot.yaw.sin();

    let target_vx = fx * forward_speed + rx * strafe_speed;
    let target_vz = fz * forward_speed + rz * strafe_speed;
    let target_vy = if has_pilot { lift_speed } else { -2.2 };

    let horiz_blend = if has_pilot { 0.28 } else { 0.09 };
    let vert_blend = if has_pilot { 0.22 } else { 0.06 };
    entity.vel.x += (target_vx - entity.vel.x) * horiz_blend;
    entity.vel.z += (target_vz - entity.vel.z) * horiz_blend;
    entity.vel.y += (target_vy - entity.vel.y) * vert_blend;

    let drag = if has_pilot { 0.992 } else { 0.962 };
    entity.vel.x *= drag;
    entity.vel.z *= drag;
    if !has_pilot {
        entity.vel.y *= 0.995;
    }

    // ── Yaw wrap ──
    entity.rot.yaw += yaw_step;
    if entity.rot.yaw > std::f32::consts::PI {
        entity.rot.yaw -= TAU;
    }
    if entity.rot.yaw < -std::f32::consts::PI {
        entity.rot.yaw += TAU;
    }

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

    // ── Ground collision ──
    let ground = helicopter_ground_rest_height(ctx, next_pos.x, next_pos.z);
    let min_alt = ground + heli_min_altitude_from_ground();
    if next_pos.y < min_alt {
        next_pos.y = min_alt;
        if entity.vel.y < 0.0 {
            entity.vel.y *= -0.08;
        }
        if !has_pilot {
            entity.vel.y = 0.0;
            entity.vel.x *= 0.93;
            entity.vel.z *= 0.93;
        }
    }
    if next_pos.y > heli_max_altitude() {
        next_pos.y = heli_max_altitude();
        if entity.vel.y > 0.0 {
            entity.vel.y *= 0.15;
        }
    }

    entity.pos = next_pos;
    entity.updated_at = ctx.timestamp;

    // ── Rotor spin visual ──
    let spin_target = if has_pilot {
        10.0 + (forward_input.abs() + strafe_input.abs()) * 4.0 + lift_input.abs() * 2.0
    } else {
        2.4
    };
    vehicle.rotor_spin = (vehicle.rotor_spin + spin_target * dt) % TAU;

    // ── Commit ──
    ctx.db.entity().id().update(entity.clone());
    ctx.db.vehicle().entity_id().update(vehicle.clone());

    // ── Mounted pilot position sync ──
    if let Some(pilot_id) = vehicle.pilot_identity {
        if let Some(pilot) = ctx.db.player().identity().find(pilot_id) {
            mounted_updates.push(Player {
                pos: Vec3 {
                    x: entity.pos.x,
                    y: entity.pos.y + heli_pilot_seat_height(),
                    z: entity.pos.z,
                },
                vel: entity.vel.clone(),
                spawn_protected: false,
                ..pilot
            });
        }
    }
}
