// ── Hover Vehicle Physics ──
// Sleek, fast hoverbike. Floats a fixed clearance above whatever surface is
// below it, automatically rising and falling as the terrain does. It skims
// over the voxel world instead of colliding with it, so normal terrain never
// damages or stops it. Fast on flat/open ground, slightly slower over rough,
// rising terrain. Driver cannot fire weapons.

use std::f32::consts::TAU;

use spacetimedb::ReducerContext;

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

/// Simulate one tick of hover vehicle physics.
pub fn tick_hover(
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

    // ── Input ──
    let (forward_input, strafe_input, yaw_input) = if has_pilot {
        (
            clamp_vehicle_axis(vehicle.input_forward),
            clamp_vehicle_axis(vehicle.input_strafe),
            clamp_vehicle_axis(vehicle.input_yaw),
        )
    } else {
        (0.0, 0.0, 0.0)
    };

    // ── Steering ──
    entity.rot.yaw += yaw_input * hover_max_yaw_rate() * dt;
    if entity.rot.yaw > std::f32::consts::PI {
        entity.rot.yaw -= TAU;
    }
    if entity.rot.yaw < -std::f32::consts::PI {
        entity.rot.yaw += TAU;
    }

    let fx = -entity.rot.yaw.sin();
    let fz = -entity.rot.yaw.cos();
    let rx = entity.rot.yaw.cos();
    let rz = -entity.rot.yaw.sin();

    // ── Terrain-aware hover sampling (anticipatory) ──
    // Sample the rest surface directly below and a short distance ahead in the
    // travel direction. `max(here, ahead)` lets the craft start climbing before
    // it reaches rising ground; the difference drives the rough-terrain slowdown.
    let probe = hover_roughness_probe();
    let gnd_here = terrain.ground_vehicle_rest_height_below(ctx, entity.pos.x, entity.pos.z, entity.pos.y);
    let gnd_ahead = terrain.ground_vehicle_rest_height_below(
        ctx,
        entity.pos.x + fx * probe,
        entity.pos.z + fz * probe,
        entity.pos.y + probe,
    );
    let target_surface = gnd_here.max(gnd_ahead);
    let roughness = (gnd_ahead - gnd_here).abs();
    let speed_factor =
        (1.0 - roughness * hover_roughness_penalty()).clamp(hover_min_speed_factor(), 1.0);

    // ── Horizontal velocity (drive + strafe, scaled by terrain roughness) ──
    let forward_speed = forward_input * hover_cruise_speed() * speed_factor;
    let strafe_speed = strafe_input * hover_strafe_speed() * speed_factor;

    let target_vx = fx * forward_speed + rx * strafe_speed;
    let target_vz = fz * forward_speed + rz * strafe_speed;

    let horiz_blend = if has_pilot { hover_horiz_blend() } else { 0.08 };
    entity.vel.x += (target_vx - entity.vel.x) * horiz_blend;
    entity.vel.z += (target_vz - entity.vel.z) * horiz_blend;

    let drag = if has_pilot {
        hover_drag_piloted()
    } else {
        hover_drag_unpiloted()
    };
    entity.vel.x *= drag;
    entity.vel.z *= drag;

    // ── Horizontal integration ──
    let mut nx = entity.pos.x + entity.vel.x * dt;
    let mut nz = entity.pos.z + entity.vel.z * dt;

    // ── World bounds ──
    let min_x = 2.0;
    let max_x = WORLD_SIZE_X as f32 - 2.0;
    let min_z = 2.0;
    let max_z = WORLD_SIZE_Z as f32 - 2.0;
    if nx < min_x {
        nx = min_x;
        entity.vel.x = entity.vel.x.abs() * 0.2;
    }
    if nx > max_x {
        nx = max_x;
        entity.vel.x = -entity.vel.x.abs() * 0.2;
    }
    if nz < min_z {
        nz = min_z;
        entity.vel.z = entity.vel.z.abs() * 0.2;
    }
    if nz > max_z {
        nz = max_z;
        entity.vel.z = -entity.vel.z.abs() * 0.2;
    }

    entity.pos.x = nx;
    entity.pos.z = nz;

    // ── Vertical hover (spring-damper toward the target float height) ──
    // No gravity and no block collision: the craft is held aloft by the spring
    // and clamped above the surface, so terrain can never destroy it.
    let target_y = target_surface + hover_height();
    entity.vel.y += (target_y - entity.pos.y) * hover_stiffness() * dt;
    entity.vel.y *= hover_damping();
    entity.pos.y += entity.vel.y * dt;

    let floor = target_surface + hover_min_clearance();
    if entity.pos.y < floor {
        entity.pos.y = floor;
        if entity.vel.y < 0.0 {
            entity.vel.y = 0.0;
        }
    }
    if entity.pos.y > hover_max_altitude() {
        entity.pos.y = hover_max_altitude();
        if entity.vel.y > 0.0 {
            entity.vel.y = 0.0;
        }
    }

    // Keep pitch level (the craft self-levels over terrain).
    entity.rot.pitch = 0.0;

    entity.sim_tick = next_sim_tick;
    entity.updated_at = ctx.timestamp;

    // ── Turbine spin visual (reuses rotor_spin field) ──
    let speed = (entity.vel.x * entity.vel.x + entity.vel.z * entity.vel.z).sqrt();
    let spin_rate = if has_pilot { 6.0 + speed * 0.4 } else { 2.0 };
    vehicle.rotor_spin = (vehicle.rotor_spin + spin_rate * dt) % TAU;

    vehicle.sim_tick = next_sim_tick;
    vehicle.sim_updated_at = ctx.timestamp;

    // ── Commit ──
    ctx.db.entity().id().update(entity.clone());
    ctx.db.vehicle().entity_id().update(vehicle.clone());

    sync_vehicle_occupants(ctx, &vehicle, &entity, mounted_updates);
}
