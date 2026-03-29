// ── Fighter Jet Physics ──
// Fixed-wing aircraft: no hover, needs forward speed for lift.
// W=throttle, S=brake, A/D=yaw, Space/Shift=pitch up/down.

use std::f32::consts::TAU;

use spacetimedb::ReducerContext;

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

pub fn tick_fighter_jet(
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

    // ── Input ──
    let throttle = if has_pilot {
        clamp_vehicle_axis(vehicle.input_forward).max(0.0)
    } else {
        0.0
    };
    let brake = if has_pilot {
        (-clamp_vehicle_axis(vehicle.input_forward)).max(0.0)
    } else {
        0.0
    };
    let yaw_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_yaw)
    } else {
        0.0
    };
    let pitch_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_lift)
    } else {
        0.0
    };
    // Strafe input controls roll for visual flair (no actual strafing)
    let _roll_input = if has_pilot {
        clamp_vehicle_axis(vehicle.input_strafe)
    } else {
        0.0
    };

    // ── Current forward speed ──
    let fx = -entity.rot.yaw.sin();
    let fz = -entity.rot.yaw.cos();
    let cos_pitch = entity.rot.pitch.cos();
    let forward_x = fx * cos_pitch;
    let forward_y = entity.rot.pitch.sin(); // positive pitch (nose up) → upward
    let forward_z = fz * cos_pitch;

    let current_speed =
        (entity.vel.x * forward_x + entity.vel.y * forward_y + entity.vel.z * forward_z).max(0.0);

    // ── Speed control ──
    let mut target_speed = current_speed;
    if has_pilot {
        // Throttle accelerates toward max speed
        target_speed += throttle * jet_acceleration() * dt;
        // Brake decelerates
        target_speed -= brake * jet_brake_deceleration() * dt;
        // Idle deceleration when not throttling
        if throttle < 0.1 && brake < 0.1 {
            target_speed -= jet_idle_deceleration() * dt;
        }
        // Clamp to [0, maxSpeed] when piloted (allow sitting still on runway)
        target_speed = target_speed.clamp(0.0, jet_max_speed());
    } else {
        // Unpiloted: glide and slow down
        target_speed -= jet_idle_deceleration() * 2.0 * dt;
        target_speed = target_speed.max(0.0);
    }

    // ── Rotation ──
    let yaw_step = yaw_input * jet_max_yaw_rate() * dt;
    entity.rot.yaw += yaw_step;
    if entity.rot.yaw > std::f32::consts::PI {
        entity.rot.yaw -= TAU;
    }
    if entity.rot.yaw < -std::f32::consts::PI {
        entity.rot.yaw += TAU;
    }

    // ── Stall mechanics (computed before pitch so pitch authority scales with speed) ──
    let stall_factor = if current_speed < jet_stall_speed() {
        (current_speed / jet_stall_speed()).max(0.0)
    } else {
        1.0
    };

    // Pitch: Space = pull up (positive pitch_input), Shift = push down
    let on_ground = entity.pos.y
        < terrain.fighter_jet_ground_height(ctx, entity.pos.x, entity.pos.z)
            + jet_min_altitude()
            + 1.0;
    let pitch_target = if has_pilot {
        pitch_input * 0.7 * stall_factor // Pitch authority scales with speed
    } else if on_ground || current_speed < 2.0 {
        0.0 // Parked: level nose
    } else {
        0.15 // Gliding unpiloted: gentle nose drop
    };
    let pitch_step = (pitch_target - entity.rot.pitch)
        .clamp(-jet_max_pitch_rate() * dt, jet_max_pitch_rate() * dt);
    entity.rot.pitch += pitch_step;
    entity.rot.pitch = entity.rot.pitch.clamp(-1.0, 1.0);

    // ── Velocity from forward direction * speed ──
    let new_fx = -entity.rot.yaw.sin();
    let new_fz = -entity.rot.yaw.cos();
    let new_cos_pitch = entity.rot.pitch.cos();
    let new_forward_x = new_fx * new_cos_pitch;
    let new_forward_y = entity.rot.pitch.sin(); // positive pitch (nose up) → upward
    let new_forward_z = new_fz * new_cos_pitch;

    // Blend velocity toward forward direction * target_speed
    let blend = if has_pilot { jet_velocity_blend() } else { 0.1 };
    let target_vx = new_forward_x * target_speed;
    let target_vy = new_forward_y * target_speed * stall_factor;
    let target_vz = new_forward_z * target_speed;

    entity.vel.x += (target_vx - entity.vel.x) * blend;
    entity.vel.z += (target_vz - entity.vel.z) * blend;

    // Vertical: lift from speed, gravity pulls down
    let lift = current_speed * jet_lift_factor() * stall_factor;
    let gravity_pull = jet_gravity() * (1.0 - stall_factor * 0.7);
    entity.vel.y += (target_vy - entity.vel.y) * blend;
    entity.vel.y += (lift - gravity_pull) * dt * 0.5;

    // When stalling, gravity dominates
    if stall_factor < 0.5 {
        entity.vel.y -= jet_gravity() * (1.0 - stall_factor) * dt;
    }

    // Drag
    let drag = if has_pilot {
        jet_drag_piloted()
    } else {
        jet_drag_unpiloted()
    };
    entity.vel.x *= drag;
    entity.vel.z *= drag;
    entity.vel.y *= drag;

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
    let ground = terrain.fighter_jet_ground_height(ctx, next_pos.x, next_pos.z);
    let min_alt = ground + jet_min_altitude();
    if next_pos.y < min_alt {
        next_pos.y = min_alt;
        if entity.vel.y < 0.0 {
            entity.vel.y *= -0.05;
        }
        if !has_pilot {
            entity.vel.y = 0.0;
            entity.vel.x *= 0.90;
            entity.vel.z *= 0.90;
        }
    }
    // On the ground at low speed: zero vertical velocity to prevent bouncing
    if next_pos.y <= min_alt + 0.5 && current_speed < jet_stall_speed() {
        entity.vel.y = 0.0;
    }
    if next_pos.y > jet_max_altitude() {
        next_pos.y = jet_max_altitude();
        if entity.vel.y > 0.0 {
            entity.vel.y *= 0.1;
        }
    }

    entity.pos = next_pos;
    entity.sim_tick = next_sim_tick;
    entity.updated_at = ctx.timestamp;

    // ── Block collision ──
    let (_blocks_hit, destroyed) =
        super::collision::check_vehicle_block_collision(ctx, &mut entity, &mut vehicle, terrain);
    if destroyed {
        return;
    }

    // ── Rotor spin (reused for jet engine visual) ──
    let spin_target = if has_pilot {
        8.0 + throttle * 10.0
    } else {
        current_speed.min(5.0)
    };
    vehicle.rotor_spin = (vehicle.rotor_spin + spin_target * dt) % TAU;

    // Stamp the current input sequence consumed by this physics tick.
    // If no new command arrived, this remains the last consumed sequence.
    vehicle.sim_tick = next_sim_tick;
    vehicle.sim_updated_at = ctx.timestamp;

    // ── Commit ──
    ctx.db.entity().id().update(entity.clone());
    ctx.db.vehicle().entity_id().update(vehicle.clone());

    // ── Mounted pilot sync ──
    if let Some(pilot_id) = vehicle.pilot_identity {
        if let Some(pilot) = ctx.db.player().identity().find(pilot_id) {
            mounted_updates.push(Player {
                pos: Vec3 {
                    x: entity.pos.x,
                    y: entity.pos.y + jet_pilot_seat_height(),
                    z: entity.pos.z,
                },
                vel: entity.vel.clone(),
                spawn_protected: false,
                ..pilot
            });
        }
    }
}
