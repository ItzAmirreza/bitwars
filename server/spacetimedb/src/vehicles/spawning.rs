// ── Vehicle Spawning ──
// Spawn logic for all vehicle types.

use std::collections::HashMap;
use std::f32::consts::TAU;

use spacetimedb::{ReducerContext, Table};

use crate::chunks::helicopter_spawn_y_if_fit;
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

/// Spawn a single helicopter entity + vehicle row.
pub fn spawn_helicopter(ctx: &ReducerContext, pos: Vec3, yaw: f32) -> u64 {
    let entity = ctx.db.entity().insert(Entity {
        id: 0,
        kind: entity_kind_vehicle(),
        subtype: vehicle_type_helicopter(),
        pos,
        vel: ZERO_VEL,
        rot: Rotation { yaw, pitch: 0.0 },
        scale: heli_scale(),
        active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    let minigun = weapons::get_vehicle_weapon(0);
    let rockets = weapons::get_vehicle_weapon(1);

    ctx.db.vehicle().insert(Vehicle {
        entity_id: entity.id,
        vehicle_type: vehicle_type_helicopter(),
        pilot_identity: None,
        seat_count: 4,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        rotor_spin: 0.0,
        health: heli_health_max(),
        weapon_type: 0,
        weapon_ammo_primary: minigun.max_ammo,
        weapon_ammo_secondary: rockets.max_ammo,
        weapon_last_fire: ctx.timestamp,
        created_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
    });

    entity.id
}

/// Spawn helicopters at random flat locations across the map.
pub fn spawn_sandbox_helicopters(ctx: &ReducerContext) {
    let seed = timestamp_micros(ctx.timestamp) ^ 0x6a09e667f3bcc909;
    let margin = (HELI_SPAWN_CLEARANCE_RADIUS + 12).max(10);
    let span_x = (WORLD_SIZE_X as i32 - margin * 2).max(8);
    let span_z = (WORLD_SIZE_Z as i32 - margin * 2).max(8);
    let mut chunk_cache: HashMap<u32, [u8; 4096]> = HashMap::new();

    let mut spawned = 0usize;
    for attempt in 0..320u64 {
        if spawned >= SANDBOX_HELICOPTER_COUNT {
            break;
        }

        let rx = hash_u64(seed ^ attempt.wrapping_mul(0x9e3779b97f4a7c15));
        let rz = hash_u64(seed ^ attempt.wrapping_mul(0xd1b54a32d192ed03));
        let x = margin + (rx % span_x as u64) as i32;
        let z = margin + (rz % span_z as u64) as i32;

        let Some(y) = helicopter_spawn_y_if_fit(ctx, x, z, &mut chunk_cache) else {
            continue;
        };

        let yaw = unit_from_seed(seed ^ attempt.wrapping_mul(0x94d049bb133111eb)) * TAU;
        spawn_helicopter(
            ctx,
            Vec3 {
                x: x as f32 + 0.5,
                y,
                z: z as f32 + 0.5,
            },
            yaw,
        );
        spawned += 1;
    }

    log::info!("Spawned {} sandbox helicopters", spawned);
}
