// ── Vehicle Interaction ──
// Mount/dismount and input reducers.

use spacetimedb::{reducer, ReducerContext, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

#[reducer]
pub fn interact_vehicle(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    // Dismount if already mounted
    if player.mounted_vehicle_id != 0 {
        let dismounted = dismount_player_internal(ctx, player, true);
        ctx.db.player().identity().update(dismounted.clone());
        init_movement_state(ctx, sender, &dismounted.pos);
        sync_player_entity(ctx, &dismounted);
        return Ok(());
    }

    // Find nearest mountable vehicle
    let mut best_vehicle: Option<(u64, Vec3, f32)> = None;
    for v in ctx.db.vehicle().iter() {
        if v.vehicle_type != vehicle_type_helicopter() {
            continue;
        }
        if v.pilot_identity.is_some() {
            continue;
        }
        let Some(entity) = ctx.db.entity().id().find(&v.entity_id) else {
            continue;
        };
        if !entity.active {
            continue;
        }

        let d2 = dist_sq(&player.pos, &entity.pos);
        if d2 > heli_mount_range() * heli_mount_range() {
            continue;
        }

        match &best_vehicle {
            Some((_, _, best_d2)) if *best_d2 <= d2 => {}
            _ => best_vehicle = Some((v.entity_id, entity.pos.clone(), d2)),
        }
    }

    let (vehicle_id, vehicle_pos, _) = best_vehicle.ok_or("No vehicle in range")?;

    if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&vehicle_id) {
        ctx.db.vehicle().entity_id().update(Vehicle {
            pilot_identity: Some(sender),
            input_forward: 0.0,
            input_strafe: 0.0,
            input_lift: 0.0,
            input_yaw: 0.0,
            boosting: false,
            last_input_at: ctx.timestamp,
            ..vehicle
        });
    }

    let mounted = Player {
        mounted_vehicle_id: vehicle_id,
        spawn_protected: false,
        pos: Vec3 {
            x: vehicle_pos.x,
            y: vehicle_pos.y + heli_pilot_seat_height(),
            z: vehicle_pos.z,
        },
        vel: ZERO_VEL,
        ..player
    };
    ctx.db.player().identity().update(mounted.clone());
    init_movement_state(ctx, sender, &mounted.pos);
    sync_player_entity(ctx, &mounted);

    Ok(())
}

#[reducer]
pub fn update_vehicle_input(
    ctx: &ReducerContext,
    forward: f32,
    strafe: f32,
    lift: f32,
    yaw: f32,
    boosting: bool,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.mounted_vehicle_id == 0 {
        return Err("Not mounted".to_string());
    }

    let mut vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle not found")?;
    if vehicle.pilot_identity != Some(sender) {
        return Err("Not pilot".to_string());
    }

    vehicle.input_forward = clamp_vehicle_axis(forward);
    vehicle.input_strafe = clamp_vehicle_axis(strafe);
    vehicle.input_lift = clamp_vehicle_axis(lift);
    vehicle.input_yaw = clamp_vehicle_axis(yaw);
    vehicle.boosting = boosting;
    vehicle.last_input_at = ctx.timestamp;
    ctx.db.vehicle().entity_id().update(vehicle);

    Ok(())
}
