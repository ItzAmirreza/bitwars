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
        let mount_range = if v.vehicle_type == vehicle_type_helicopter() {
            heli_mount_range()
        } else if v.vehicle_type == vehicle_type_fighter_jet() {
            jet_mount_range()
        } else if v.vehicle_type == vehicle_type_anti_air() {
            aa_mount_range()
        } else {
            continue; // unknown vehicle type
        };
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
        if d2 > mount_range * mount_range {
            continue;
        }

        match &best_vehicle {
            Some((_, _, best_d2)) if *best_d2 <= d2 => {}
            _ => best_vehicle = Some((v.entity_id, entity.pos.clone(), d2)),
        }
    }

    let (vehicle_id, vehicle_pos, _) = best_vehicle.ok_or("No vehicle in range")?;

    let vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&vehicle_id)
        .ok_or("Vehicle not found")?;
    let seat_height = if vehicle.vehicle_type == vehicle_type_helicopter() {
        heli_pilot_seat_height()
    } else if vehicle.vehicle_type == vehicle_type_anti_air() {
        aa_pilot_seat_height()
    } else {
        jet_pilot_seat_height()
    };
    for row in ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
    {
        ctx.db.vehicle_input_cmd().id().delete(&row.id);
    }
    ctx.db.vehicle().entity_id().update(Vehicle {
        pilot_identity: Some(sender),
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
        ..vehicle
    });

    let mounted = Player {
        mounted_vehicle_id: vehicle_id,
        spawn_protected: false,
        pos: Vec3 {
            x: vehicle_pos.x,
            y: vehicle_pos.y + seat_height,
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
    input_seq: u32,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.mounted_vehicle_id == 0 {
        return Ok(());
    }

    // Ignore stale/duplicate commands to avoid unnecessary queue churn.
    if input_seq <= 1 {
        return Ok(());
    }

    let Some(mut vehicle) = ctx.db.vehicle().entity_id().find(&player.mounted_vehicle_id) else {
        return Ok(());
    };
    if vehicle.pilot_identity != Some(sender) {
        return Ok(());
    }

    // Monotonic guard: ignore stale/out-of-order input packets.
    // WebSocket is ordered, but this protects against edge cases and
    // preserves a strict sequence contract for client reconciliation.
    if input_seq <= vehicle.input_seq {
        return Ok(());
    }

    let forward = clamp_vehicle_axis(forward);
    let strafe = clamp_vehicle_axis(strafe);
    let lift = clamp_vehicle_axis(lift);
    let yaw = clamp_vehicle_axis(yaw);

    // Queue this input command for deterministic one-command-per-tick
    // consumption in tick_vehicles.
    ctx.db.vehicle_input_cmd().insert(VehicleInputCmd {
        id: 0,
        vehicle_id: player.mounted_vehicle_id,
        seq: input_seq,
        forward,
        strafe,
        lift,
        yaw,
        boosting,
        received_at: ctx.timestamp,
    });
    let queue_before_trim: usize = ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&player.mounted_vehicle_id)
        .count();
    trim_vehicle_input_queue(ctx, player.mounted_vehicle_id);

    // Log every 30th input to track arrival rate and queue growth
    if input_seq % 30 == 0 {
        log::info!(
            "[VEHICLE_INPUT] vehicle={} seq={} queue_depth={} acked={}",
            player.mounted_vehicle_id,
            input_seq,
            queue_before_trim,
            vehicle.acked_input_seq,
        );
    }

    vehicle.input_forward = forward;
    vehicle.input_strafe = strafe;
    vehicle.input_lift = lift;
    vehicle.input_yaw = yaw;
    vehicle.boosting = boosting;
    vehicle.input_seq = input_seq;
    vehicle.last_input_at = ctx.timestamp;
    ctx.db.vehicle().entity_id().update(vehicle);

    Ok(())
}
