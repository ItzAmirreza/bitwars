use spacetimedb::{ReducerContext, Table};

use crate::constants::*;
use crate::tables::*;
use crate::types::*;

use super::vehicle_helpers::point_vehicle_local_to_world;

const HELI_SEAT_POSITIONS: [Vec3; 4] = [
    Vec3 {
        x: -0.65,
        y: 1.8,
        z: -0.95,
    },
    Vec3 {
        x: 0.65,
        y: 1.8,
        z: -0.95,
    },
    Vec3 {
        x: -0.85,
        y: 1.45,
        z: 0.8,
    },
    Vec3 {
        x: 0.85,
        y: 1.45,
        z: 0.8,
    },
];

const JET_SEAT_POSITIONS: [Vec3; 1] = [Vec3 {
    x: 0.0,
    y: 1.6,
    z: -0.4,
}];

const AA_SEAT_POSITIONS: [Vec3; 1] = [Vec3 {
    x: 0.0,
    y: 2.8,
    z: 0.0,
}];

const HOVER_SEAT_POSITIONS: [Vec3; 2] = [
    // Driver — forward saddle
    Vec3 {
        x: 0.0,
        y: 1.35,
        z: -0.5,
    },
    // Passenger — rear saddle
    Vec3 {
        x: 0.0,
        y: 1.3,
        z: 0.95,
    },
];

fn seat_positions_for_vehicle(vehicle_type: u8) -> &'static [Vec3] {
    if vehicle_type == vehicle_type_fighter_jet() {
        &JET_SEAT_POSITIONS
    } else if vehicle_type == vehicle_type_anti_air() {
        &AA_SEAT_POSITIONS
    } else if vehicle_type == vehicle_type_hover() {
        &HOVER_SEAT_POSITIONS
    } else {
        &HELI_SEAT_POSITIONS
    }
}

pub fn vehicle_seat_local_position(vehicle_type: u8, seat_index: u8) -> Vec3 {
    let seats = seat_positions_for_vehicle(vehicle_type);
    seats
        .get(seat_index as usize)
        .cloned()
        .unwrap_or_else(|| {
            seats.first().cloned().unwrap_or(Vec3 {
            x: 0.0,
            y: 1.8,
            z: 0.0,
            })
        })
}

pub fn vehicle_seat_world_position(entity: &Entity, vehicle_type: u8, seat_index: u8) -> Vec3 {
    let local = vehicle_seat_local_position(vehicle_type, seat_index);
    point_vehicle_local_to_world(entity, &local)
}

pub fn vehicle_dismount_world_position(entity: &Entity, vehicle_type: u8, seat_index: u8) -> Vec3 {
    let seat = vehicle_seat_local_position(vehicle_type, seat_index);
    let side_sign = if seat.x <= 0.0 { -1.0 } else { 1.0 };
    let exit_local = Vec3 {
        x: seat.x + side_sign * 2.8,
        y: seat.y,
        z: seat.z + if seat_index >= 2 { 0.6 } else { 0.0 },
    };
    point_vehicle_local_to_world(entity, &exit_local)
}

pub fn vehicle_occupants_for_vehicle(ctx: &ReducerContext, vehicle: &Vehicle) -> Vec<VehicleOccupant> {
    let mut rows: Vec<VehicleOccupant> = ctx
        .db
        .vehicle_occupant()
        .idx_vehicle_occupant_by_vehicle()
        .filter(&vehicle.entity_id)
        .collect();

    if let Some(pilot_id) = vehicle.pilot_identity {
        if !rows.iter().any(|row| row.identity == pilot_id) {
            rows.push(VehicleOccupant {
                identity: pilot_id,
                vehicle_id: vehicle.entity_id,
                seat_index: 0,
                mounted_at: vehicle.created_at,
            });
        }
    }

    rows.sort_by_key(|row| row.seat_index);
    rows
}

pub fn vehicle_occupant_for_player(
    ctx: &ReducerContext,
    player: &Player,
) -> Option<VehicleOccupant> {
    if let Some(row) = ctx.db.vehicle_occupant().identity().find(player.identity) {
        return Some(row);
    }
    if player.mounted_vehicle_id == 0 {
        return None;
    }
    let vehicle = ctx.db.vehicle().entity_id().find(&player.mounted_vehicle_id)?;
    if vehicle.pilot_identity == Some(player.identity) {
        return Some(VehicleOccupant {
            identity: player.identity,
            vehicle_id: vehicle.entity_id,
            seat_index: 0,
            mounted_at: vehicle.created_at,
        });
    }
    None
}

pub fn upsert_vehicle_occupant(
    ctx: &ReducerContext,
    identity: spacetimedb::Identity,
    vehicle_id: u64,
    seat_index: u8,
) {
    let row = VehicleOccupant {
        identity,
        vehicle_id,
        seat_index,
        mounted_at: ctx.timestamp,
    };
    if ctx.db.vehicle_occupant().identity().find(identity).is_some() {
        ctx.db.vehicle_occupant().identity().update(row);
    } else {
        ctx.db.vehicle_occupant().insert(row);
    }
}

pub fn remove_vehicle_occupant(ctx: &ReducerContext, identity: spacetimedb::Identity) {
    if ctx.db.vehicle_occupant().identity().find(identity).is_some() {
        ctx.db.vehicle_occupant().identity().delete(&identity);
    }
}

pub fn vehicle_next_free_seat(ctx: &ReducerContext, vehicle: &Vehicle) -> Option<u8> {
    let seat_count = vehicle.seat_count.max(1) as usize;
    let mut occupied = vec![false; seat_count];
    for row in vehicle_occupants_for_vehicle(ctx, vehicle) {
        let idx = row.seat_index as usize;
        if idx < seat_count {
            occupied[idx] = true;
        }
    }
    occupied
        .iter()
        .position(|taken| !*taken)
        .map(|idx| idx as u8)
}

pub fn vehicle_has_free_seat(ctx: &ReducerContext, vehicle: &Vehicle) -> bool {
    vehicle_next_free_seat(ctx, vehicle).is_some()
}

pub fn sync_vehicle_occupants(
    ctx: &ReducerContext,
    vehicle: &Vehicle,
    entity: &Entity,
    mounted_updates: &mut Vec<Player>,
) {
    for occupant in vehicle_occupants_for_vehicle(ctx, vehicle) {
        let Some(player) = ctx.db.player().identity().find(occupant.identity) else {
            continue;
        };
        mounted_updates.push(Player {
            pos: vehicle_seat_world_position(entity, vehicle.vehicle_type, occupant.seat_index),
            vel: entity.vel.clone(),
            spawn_protected: false,
            ..player
        });
    }
}

pub fn promote_next_vehicle_pilot(ctx: &ReducerContext, vehicle: Vehicle) -> Vehicle {
    if vehicle.pilot_identity.is_some() {
        return vehicle;
    }

    let mut occupants = vehicle_occupants_for_vehicle(ctx, &vehicle);
    occupants.sort_by_key(|row| row.seat_index);
    let Some(next_pilot) = occupants.into_iter().next() else {
        return vehicle;
    };

    if let Some(mut persisted) = ctx.db.vehicle_occupant().identity().find(next_pilot.identity) {
        if persisted.seat_index != 0 {
            persisted.seat_index = 0;
            ctx.db.vehicle_occupant().identity().update(persisted);
        }
    }

    let promoted = Vehicle {
        pilot_identity: Some(next_pilot.identity),
        ..vehicle
    };
    ctx.db.vehicle().entity_id().update(promoted.clone());
    promoted
}
