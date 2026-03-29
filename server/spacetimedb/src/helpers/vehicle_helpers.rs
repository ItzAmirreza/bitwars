// ── Vehicle Helpers ──
// Hitbox calculations, ground height, dismount logic, vehicle damage.

use spacetimedb::{Identity, ReducerContext, Table};

use super::math::*;
use crate::constants::*;
use crate::tables::*;
use crate::types::*;

pub fn helicopter_hitbox_bounds(entity: &Entity) -> (Vec3, Vec3) {
    let center = Vec3 {
        x: entity.pos.x,
        y: entity.pos.y + heli_hitbox_center_y(),
        z: entity.pos.z,
    };
    (
        Vec3 {
            x: center.x - heli_hitbox_half_x(),
            y: center.y - heli_hitbox_half_y(),
            z: center.z - heli_hitbox_half_z(),
        },
        Vec3 {
            x: center.x + heli_hitbox_half_x(),
            y: center.y + heli_hitbox_half_y(),
            z: center.z + heli_hitbox_half_z(),
        },
    )
}

pub fn fighter_jet_hitbox_bounds(entity: &Entity) -> (Vec3, Vec3) {
    let center = Vec3 {
        x: entity.pos.x,
        y: entity.pos.y + jet_hitbox_center_y(),
        z: entity.pos.z,
    };
    (
        Vec3 {
            x: center.x - jet_hitbox_half_x(),
            y: center.y - jet_hitbox_half_y(),
            z: center.z - jet_hitbox_half_z(),
        },
        Vec3 {
            x: center.x + jet_hitbox_half_x(),
            y: center.y + jet_hitbox_half_y(),
            z: center.z + jet_hitbox_half_z(),
        },
    )
}

pub fn anti_air_hitbox_bounds(entity: &Entity) -> (Vec3, Vec3) {
    let center = Vec3 {
        x: entity.pos.x,
        y: entity.pos.y + aa_hitbox_center_y(),
        z: entity.pos.z,
    };
    (
        Vec3 {
            x: center.x - aa_hitbox_half_x(),
            y: center.y - aa_hitbox_half_y(),
            z: center.z - aa_hitbox_half_z(),
        },
        Vec3 {
            x: center.x + aa_hitbox_half_x(),
            y: center.y + aa_hitbox_half_y(),
            z: center.z + aa_hitbox_half_z(),
        },
    )
}

pub fn vehicle_hitbox_bounds(entity: &Entity) -> (Vec3, Vec3) {
    if entity.subtype == vehicle_type_fighter_jet() {
        fighter_jet_hitbox_bounds(entity)
    } else if entity.subtype == vehicle_type_anti_air() {
        anti_air_hitbox_bounds(entity)
    } else {
        helicopter_hitbox_bounds(entity)
    }
}

pub fn vehicle_hitbox_center_y(entity: &Entity) -> f32 {
    if entity.subtype == vehicle_type_fighter_jet() {
        jet_hitbox_center_y()
    } else if entity.subtype == vehicle_type_anti_air() {
        aa_hitbox_center_y()
    } else {
        heli_hitbox_center_y()
    }
}

pub fn vehicle_hitbox_max_half(entity: &Entity) -> f32 {
    if entity.subtype == vehicle_type_fighter_jet() {
        jet_hitbox_half_x().max(jet_hitbox_half_z())
    } else if entity.subtype == vehicle_type_anti_air() {
        aa_hitbox_half_x().max(aa_hitbox_half_z())
    } else {
        heli_hitbox_half_x().max(heli_hitbox_half_z())
    }
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
            return y as f32 + 2.0;
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
    if let Some(entity) = ctx.db.entity().id().find(&next.mounted_vehicle_id) {
        if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&next.mounted_vehicle_id) {
            for row in ctx
                .db
                .vehicle_input_cmd()
                .idx_vehicle_input_by_vehicle()
                .filter(&next.mounted_vehicle_id)
            {
                ctx.db.vehicle_input_cmd().id().delete(&row.id);
            }
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
                ..vehicle
            });
        }
        let right_x = entity.rot.yaw.cos();
        let right_z = -entity.rot.yaw.sin();
        dismount_pos = Vec3 {
            x: entity.pos.x + right_x * 3.4,
            y: entity.pos.y,
            z: entity.pos.z + right_z * 3.4,
        };
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

pub fn apply_vehicle_damage(
    ctx: &ReducerContext,
    attacker: Identity,
    vehicle_id: u64,
    damage: i32,
    hit_weapon: u8,
    impact_pos: Vec3,
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

    let center_y = vehicle_hitbox_center_y(&entity);
    let vehicle_center = Vec3 {
        x: entity.pos.x,
        y: entity.pos.y + center_y,
        z: entity.pos.z,
    };

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

    let pilot = vehicle.pilot_identity;
    for row in ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
    {
        ctx.db.vehicle_input_cmd().id().delete(&row.id);
    }
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

    if let Some(pilot_id) = pilot {
        if let Some(player) = ctx.db.player().identity().find(pilot_id) {
            let dismounted = dismount_player_internal(ctx, player, true);
            ctx.db.player().identity().update(dismounted.clone());
            super::player_state::init_movement_state(ctx, dismounted.identity, &dismounted.pos);
            super::entity_ops::sync_player_entity(ctx, &dismounted);
        }
    }

    ctx.db.explosion_event().insert(ExplosionEvent {
        id: 0,
        origin: attacker,
        pos: impact_pos.clone(),
        radius: 6.0,
        weapon: 4,
        destroyed_blocks: Vec::new(),
        created_at: ctx.timestamp,
    });
    crate::grenades::push_grenades_from_explosion(ctx, &impact_pos, 6.0, 0);

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
