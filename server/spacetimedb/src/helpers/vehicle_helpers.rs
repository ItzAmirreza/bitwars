// ── Vehicle Helpers ──
// Hitbox calculations, ground height, dismount logic, vehicle damage.

use spacetimedb::{Identity, ReducerContext, Table};

use super::math::*;
use super::vehicle_seats::*;
use super::vehicle_input::clear_vehicle_input_queue;
use crate::constants::*;
use crate::tables::*;
use crate::types::*;

#[derive(Clone, Copy)]
struct LocalHitbox {
    cx: f32,
    cy: f32,
    cz: f32,
    hx: f32,
    hy: f32,
    hz: f32,
}

#[derive(Clone, Copy)]
struct HitboxProfile {
    center_y: f32,
    boxes: &'static [LocalHitbox],
}

// Mild forgiving padding so aiming feels fair without being overly permissive.
const VEHICLE_HITBOX_AIM_PAD: f32 = 0.25;
const VEHICLE_HITBOX_SPLASH_PAD: f32 = 0.35;

// Local vehicle frame:
// - origin: entity.pos
// - +Y up
// - forward at yaw=0 is -Z
// - yaw then pitch are applied from local -> world
const HELI_HITBOXES: [LocalHitbox; 5] = [
    // Main fuselage + cockpit
    LocalHitbox {
        cx: 0.0,
        cy: 2.45,
        cz: -1.20,
        hx: 2.05,
        hy: 1.20,
        hz: 4.10,
    },
    // Tail boom
    LocalHitbox {
        cx: 0.0,
        cy: 2.45,
        cz: 6.20,
        hx: 0.70,
        hy: 0.55,
        hz: 3.00,
    },
    // Main rotor sweep (trimmed; does not include extreme blade tips)
    LocalHitbox {
        cx: 0.0,
        cy: 4.15,
        cz: 0.30,
        hx: 4.80,
        hy: 0.35,
        hz: 2.10,
    },
    // Skids / lower body
    LocalHitbox {
        cx: 0.0,
        cy: 0.95,
        cz: 0.20,
        hx: 1.60,
        hy: 0.35,
        hz: 2.20,
    },
    // Engine hump
    LocalHitbox {
        cx: 0.0,
        cy: 3.55,
        cz: 0.00,
        hx: 1.20,
        hy: 0.55,
        hz: 1.20,
    },
];

const JET_HITBOXES: [LocalHitbox; 5] = [
    // Core fuselage
    LocalHitbox {
        cx: 0.0,
        cy: 2.05,
        cz: 0.40,
        hx: 1.35,
        hy: 1.00,
        hz: 6.20,
    },
    // Nose cone / cockpit front
    LocalHitbox {
        cx: 0.0,
        cy: 2.20,
        cz: -5.90,
        hx: 1.00,
        hy: 0.75,
        hz: 1.30,
    },
    // Main wings
    LocalHitbox {
        cx: 0.0,
        cy: 1.55,
        cz: 2.50,
        hx: 5.30,
        hy: 0.35,
        hz: 3.20,
    },
    // Tailplanes
    LocalHitbox {
        cx: 0.0,
        cy: 2.15,
        cz: 5.80,
        hx: 2.40,
        hy: 0.35,
        hz: 1.10,
    },
    // Vertical stabilizer
    LocalHitbox {
        cx: 0.0,
        cy: 3.10,
        cz: 5.60,
        hx: 0.60,
        hy: 1.20,
        hz: 1.40,
    },
];

const AA_HITBOXES: [LocalHitbox; 5] = [
    // Concrete base + sandbags
    LocalHitbox {
        cx: 0.0,
        cy: 0.90,
        cz: 0.0,
        hx: 3.25,
        hy: 0.95,
        hz: 3.25,
    },
    // Turret body
    LocalHitbox {
        cx: 0.0,
        cy: 3.00,
        cz: 0.0,
        hx: 1.90,
        hy: 1.05,
        hz: 1.90,
    },
    // Barrel sweep envelope (two crossed boxes to approximate rotating turret)
    LocalHitbox {
        cx: 0.0,
        cy: 2.90,
        cz: 0.0,
        hx: 4.10,
        hy: 0.45,
        hz: 0.90,
    },
    LocalHitbox {
        cx: 0.0,
        cy: 2.90,
        cz: 0.0,
        hx: 0.90,
        hy: 0.45,
        hz: 4.10,
    },
    // Radar/hatch top
    LocalHitbox {
        cx: 0.0,
        cy: 4.10,
        cz: 0.0,
        hx: 0.90,
        hy: 0.55,
        hz: 0.90,
    },
];

const HOVER_HITBOXES: [LocalHitbox; 3] = [
    // Hover board / chassis
    LocalHitbox {
        cx: 0.0,
        cy: 0.55,
        cz: 0.0,
        hx: 1.05,
        hy: 0.40,
        hz: 2.40,
    },
    // Rider + handlebar column
    LocalHitbox {
        cx: 0.0,
        cy: 1.35,
        cz: 0.20,
        hx: 0.55,
        hy: 0.70,
        hz: 0.90,
    },
    // Front cowl / nose
    LocalHitbox {
        cx: 0.0,
        cy: 0.90,
        cz: -1.90,
        hx: 0.70,
        hy: 0.50,
        hz: 0.70,
    },
];

fn vehicle_hitbox_profile(entity: &Entity) -> HitboxProfile {
    if entity.subtype == vehicle_type_fighter_jet() {
        HitboxProfile {
            center_y: 2.20,
            boxes: &JET_HITBOXES,
        }
    } else if entity.subtype == vehicle_type_anti_air() {
        HitboxProfile {
            center_y: 2.20,
            boxes: &AA_HITBOXES,
        }
    } else if entity.subtype == vehicle_type_hover() {
        HitboxProfile {
            center_y: 1.0,
            boxes: &HOVER_HITBOXES,
        }
    } else {
        HitboxProfile {
            center_y: 2.45,
            boxes: &HELI_HITBOXES,
        }
    }
}

fn point_world_to_vehicle_local(entity: &Entity, world: &Vec3) -> Vec3 {
    let dx = world.x - entity.pos.x;
    let dy = world.y - entity.pos.y;
    let dz = world.z - entity.pos.z;

    let (sin_y, cos_y) = entity.rot.yaw.sin_cos();
    let x1 = dx * cos_y - dz * sin_y;
    let z1 = dx * sin_y + dz * cos_y;

    let (sin_p, cos_p) = entity.rot.pitch.sin_cos();
    Vec3 {
        x: x1,
        y: dy * cos_p + z1 * sin_p,
        z: -dy * sin_p + z1 * cos_p,
    }
}

fn dir_world_to_vehicle_local(entity: &Entity, world: &Vec3) -> Vec3 {
    let (sin_y, cos_y) = entity.rot.yaw.sin_cos();
    let x1 = world.x * cos_y - world.z * sin_y;
    let z1 = world.x * sin_y + world.z * cos_y;

    let (sin_p, cos_p) = entity.rot.pitch.sin_cos();
    Vec3 {
        x: x1,
        y: world.y * cos_p + z1 * sin_p,
        z: -world.y * sin_p + z1 * cos_p,
    }
}

pub fn point_vehicle_local_to_world(entity: &Entity, local: &Vec3) -> Vec3 {
    let (sin_p, cos_p) = entity.rot.pitch.sin_cos();
    let y1 = local.y * cos_p - local.z * sin_p;
    let z1 = local.y * sin_p + local.z * cos_p;

    let (sin_y, cos_y) = entity.rot.yaw.sin_cos();
    let x2 = local.x * cos_y + z1 * sin_y;
    let z2 = -local.x * sin_y + z1 * cos_y;

    Vec3 {
        x: entity.pos.x + x2,
        y: entity.pos.y + y1,
        z: entity.pos.z + z2,
    }
}

fn hitbox_local_bounds(hb: &LocalHitbox, pad: f32) -> (Vec3, Vec3) {
    (
        Vec3 {
            x: hb.cx - (hb.hx + pad),
            y: hb.cy - (hb.hy + pad),
            z: hb.cz - (hb.hz + pad),
        },
        Vec3 {
            x: hb.cx + (hb.hx + pad),
            y: hb.cy + (hb.hy + pad),
            z: hb.cz + (hb.hz + pad),
        },
    )
}

fn point_aabb_dist_sq(point: &Vec3, min: &Vec3, max: &Vec3) -> f32 {
    let dx = if point.x < min.x {
        min.x - point.x
    } else if point.x > max.x {
        point.x - max.x
    } else {
        0.0
    };
    let dy = if point.y < min.y {
        min.y - point.y
    } else if point.y > max.y {
        point.y - max.y
    } else {
        0.0
    };
    let dz = if point.z < min.z {
        min.z - point.z
    } else if point.z > max.z {
        point.z - max.z
    } else {
        0.0
    };
    dx * dx + dy * dy + dz * dz
}

pub fn vehicle_hitbox_center(entity: &Entity) -> Vec3 {
    let profile = vehicle_hitbox_profile(entity);
    Vec3 {
        x: entity.pos.x,
        y: entity.pos.y + profile.center_y,
        z: entity.pos.z,
    }
}

pub fn vehicle_hitbox_center_y(entity: &Entity) -> f32 {
    vehicle_hitbox_profile(entity).center_y
}

pub fn vehicle_hitbox_max_half(entity: &Entity) -> f32 {
    let profile = vehicle_hitbox_profile(entity);
    profile
        .boxes
        .iter()
        .map(|hb| {
            let dx = hb.cx.abs() + hb.hx;
            let dy = (hb.cy - profile.center_y).abs() + hb.hy;
            let dz = hb.cz.abs() + hb.hz;
            (dx * dx + dy * dy + dz * dz).sqrt()
        })
        .fold(0.0, f32::max)
}

pub fn vehicle_hitbox_bounds(entity: &Entity) -> (Vec3, Vec3) {
    let center = vehicle_hitbox_center(entity);
    let r = vehicle_hitbox_max_half(entity);
    (
        Vec3 {
            x: center.x - r,
            y: center.y - r,
            z: center.z - r,
        },
        Vec3 {
            x: center.x + r,
            y: center.y + r,
            z: center.z + r,
        },
    )
}

pub fn vehicle_hitbox_ray_t(
    origin: &Vec3,
    normalized_dir: &Vec3,
    entity: &Entity,
    max_range: f32,
) -> Option<f32> {
    if max_range <= 0.0 {
        return None;
    }

    let profile = vehicle_hitbox_profile(entity);
    let local_origin = point_world_to_vehicle_local(entity, origin);
    let local_dir = dir_world_to_vehicle_local(entity, normalized_dir);

    let mut best_t = f32::INFINITY;
    for hb in profile.boxes {
        let (hb_min, hb_max) = hitbox_local_bounds(hb, VEHICLE_HITBOX_AIM_PAD);
        let Some(t) = ray_aabb_t(&local_origin, &local_dir, &hb_min, &hb_max) else {
            continue;
        };
        if t >= 0.0 && t <= max_range && t < best_t {
            best_t = t;
        }
    }

    if best_t.is_finite() {
        Some(best_t)
    } else {
        None
    }
}

pub fn vehicle_hitbox_intersects_sphere(entity: &Entity, center: &Vec3, radius: f32) -> bool {
    let r2 = radius.max(0.0).powi(2);
    let local_center = point_world_to_vehicle_local(entity, center);
    let profile = vehicle_hitbox_profile(entity);

    for hb in profile.boxes {
        let (hb_min, hb_max) = hitbox_local_bounds(hb, VEHICLE_HITBOX_SPLASH_PAD);
        if point_aabb_dist_sq(&local_center, &hb_min, &hb_max) <= r2 {
            return true;
        }
    }
    false
}

pub fn helicopter_ground_rest_height(ctx: &ReducerContext, x: f32, z: f32) -> f32 {
    use crate::worldgen::{AIR, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z};

    let sx = x.floor() as i32;
    let sz = z.floor() as i32;
    if sx < 0 || sx >= WORLD_SIZE_X as i32 || sz < 0 || sz >= WORLD_SIZE_Z as i32 {
        return 3.0;
    }
    for y in (0..WORLD_SIZE_Y as i32).rev() {
        if matches!(get_block_type(ctx, sx, y, sz), Some(bt) if bt != AIR) {
            // Ground surface for players standing on terrain (top solid + 1.0).
            return y as f32 + 1.0;
        }
    }
    3.0
}

pub fn clamp_vehicle_axis(v: f32) -> f32 {
    v.clamp(-1.0, 1.0)
}

pub fn dismount_player_internal(
    ctx: &ReducerContext,
    player: Player,
    force_to_ground: bool,
) -> Player {
    let mut next = player;
    if next.mounted_vehicle_id == 0 {
        return next;
    }

    let mut dismount_pos = next.pos.clone();
    let occupant = vehicle_occupant_for_player(ctx, &next);
    let seat_index = occupant.as_ref().map(|row| row.seat_index).unwrap_or(0);
    remove_vehicle_occupant(ctx, next.identity);

    if let Some(entity) = ctx.db.entity().id().find(&next.mounted_vehicle_id) {
        if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&next.mounted_vehicle_id) {
            let was_pilot = vehicle.pilot_identity == Some(next.identity);
            if was_pilot {
                clear_vehicle_input_queue(ctx, next.mounted_vehicle_id);
                let cleared = Vehicle {
                    pilot_identity: None,
                    input_forward: 0.0,
                    input_strafe: 0.0,
                    input_lift: 0.0,
                    input_yaw: 0.0,
                    boosting: false,
                    input_seq: 0,
                    acked_input_seq: 0,
                    sim_tick: 0,
                    sim_updated_at: ctx.timestamp,
                    weapon_type: if vehicle.vehicle_type == vehicle_type_hover() {
                        0
                    } else {
                        vehicle.weapon_type
                    },
                    ..vehicle
                };
                ctx.db.vehicle().entity_id().update(cleared.clone());
                let _ = promote_next_vehicle_pilot(ctx, cleared);
            }
            dismount_pos =
                vehicle_dismount_world_position(&entity, vehicle.vehicle_type, seat_index);
        }
    }

    if force_to_ground {
        let gy = helicopter_ground_rest_height(ctx, dismount_pos.x, dismount_pos.z)
            + player_eye_height();
        dismount_pos.y = gy.max(0.0);
    }

    next.pos = clamp_pos(&dismount_pos);
    next.vel = ZERO_VEL;
    next.mounted_vehicle_id = 0;
    next
}

pub fn dismount_all_vehicle_occupants(
    ctx: &ReducerContext,
    vehicle_id: u64,
    force_to_ground: bool,
) {
    let Some(vehicle) = ctx.db.vehicle().entity_id().find(&vehicle_id) else {
        return;
    };
    let occupants = vehicle_occupants_for_vehicle(ctx, &vehicle);
    for occupant in occupants {
        if let Some(player) = ctx.db.player().identity().find(occupant.identity) {
            let dismounted = dismount_player_internal(ctx, player, force_to_ground);
            ctx.db.player().identity().update(dismounted.clone());
            super::player_state::init_movement_state(ctx, dismounted.identity, &dismounted.pos);
            super::entity_ops::sync_player_entity(ctx, &dismounted);
        } else {
            remove_vehicle_occupant(ctx, occupant.identity);
        }
    }
}

pub fn apply_vehicle_damage(
    ctx: &ReducerContext,
    attacker: Identity,
    vehicle_id: u64,
    damage: i32,
    hit_weapon: u8,
) {
    let Some(vehicle) = ctx.db.vehicle().entity_id().find(&vehicle_id) else {
        return;
    };
    let Some(entity) = ctx.db.entity().id().find(&vehicle_id) else {
        return;
    };
    if !entity.active || vehicle.health <= 0 {
        return;
    }

    let vehicle_center = vehicle_hitbox_center(&entity);

    let next_health = (vehicle.health - damage).max(0);
    if next_health > 0 {
        ctx.db.vehicle().entity_id().update(Vehicle {
            health: next_health,
            ..vehicle
        });
        ctx.db.explosion_event().insert(ExplosionEvent {
            id: 0,
            origin: attacker,
            pos: vehicle_center.clone(),
            radius: 1.4,
            weapon: hit_weapon,
            destroyed_blocks: Vec::new(),
            created_at: ctx.timestamp,
        });
        crate::grenades::push_grenades_from_explosion(ctx, &vehicle_center, 1.4, 0);
        return;
    }

    clear_vehicle_input_queue(ctx, vehicle_id);
    ctx.db.vehicle().entity_id().update(Vehicle {
        pilot_identity: None,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        health: 0,
        ..vehicle
    });

    // Huge blast: carve surrounding blocks + splash nearby players/vehicles.
    // Run before dismounting so the crew is shielded from their own wreck, then
    // eject them at the vehicle's current position (including altitude).
    crate::combat::emit_vehicle_destruction_explosion(ctx, attacker, vehicle_id, &vehicle_center);
    dismount_all_vehicle_occupants(ctx, vehicle_id, false);

    ctx.db.vehicle_destroy_event().insert(VehicleDestroyEvent {
        id: 0,
        entity_id: vehicle_id,
        vehicle_type: vehicle.vehicle_type,
        pos: entity.pos.clone(),
        rot: entity.rot.clone(),
        created_at: ctx.timestamp,
    });

    ctx.db.vehicle().entity_id().delete(&vehicle_id);
    ctx.db.entity().id().delete(&vehicle_id);
}
