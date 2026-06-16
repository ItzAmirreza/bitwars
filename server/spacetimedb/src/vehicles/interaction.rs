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

    // Dismount if already mounted. Eject at the vehicle's current position
    // (including altitude) so bailing out of a flying vehicle drops the player
    // from where it actually was, rather than teleporting them to the ground.
    if player.mounted_vehicle_id != 0 {
        let dismounted = dismount_player_internal(ctx, player, false);
        ctx.db.player().identity().update(dismounted.clone());
        init_movement_state(ctx, sender, &dismounted.pos);
        sync_player_entity(ctx, &dismounted);
        return Ok(());
    }

    // Find nearest mountable vehicle
    let mut best_vehicle: Option<(u64, f32)> = None;
    for v in ctx.db.vehicle().iter() {
        let mount_range = if v.vehicle_type == vehicle_type_helicopter() {
            heli_mount_range()
        } else if v.vehicle_type == vehicle_type_fighter_jet() {
            jet_mount_range()
        } else if v.vehicle_type == vehicle_type_anti_air() {
            aa_mount_range()
        } else if v.vehicle_type == vehicle_type_hover() {
            hover_mount_range()
        } else {
            continue; // unknown vehicle type
        };
        if !vehicle_has_free_seat(ctx, &v) {
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
            Some((_, best_d2)) if *best_d2 <= d2 => {}
            _ => best_vehicle = Some((v.entity_id, d2)),
        }
    }

    let (vehicle_id, _) = best_vehicle.ok_or("No vehicle in range")?;

    let vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&vehicle_id)
        .ok_or("Vehicle not found")?;
    let seat_index = vehicle_next_free_seat(ctx, &vehicle).ok_or("Vehicle is full")?;
    let mut mounted_vehicle = vehicle.clone();
    if seat_index == 0 {
        clear_vehicle_input_queue(ctx, vehicle_id);
        mounted_vehicle = Vehicle {
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
        };
        ctx.db.vehicle().entity_id().update(mounted_vehicle.clone());
    }
    upsert_vehicle_occupant(ctx, sender, vehicle_id, seat_index);

    let mounted = Player {
        mounted_vehicle_id: vehicle_id,
        spawn_protected: false,
        pos: vehicle_seat_world_position(
            &ctx.db
                .entity()
                .id()
                .find(&vehicle_id)
                .ok_or("Vehicle entity missing")?,
            mounted_vehicle.vehicle_type,
            seat_index,
        ),
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

    let Some(mut vehicle) = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
    else {
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
