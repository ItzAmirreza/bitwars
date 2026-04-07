// ── Vehicle Spawning ──
// Spawn logic for all vehicle types.

use std::collections::HashMap;
use std::f32::consts::TAU;

use spacetimedb::{ReducerContext, Table};

use crate::chunks::{ground_vehicle_spawn_y_if_fit, helicopter_spawn_y_if_fit};
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
        sim_tick: 0,
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
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        rotor_spin: 0.0,
        health: heli_health_max(),
        weapon_type: 0,
        weapon_ammo_primary: minigun.max_ammo,
        weapon_ammo_secondary: rockets.max_ammo,
        weapon_ammo_tertiary: 0,
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

/// Spawn a single anti-air vehicle entity + vehicle row.
pub fn spawn_anti_air(ctx: &ReducerContext, pos: Vec3, yaw: f32) -> u64 {
    let entity = ctx.db.entity().insert(Entity {
        id: 0,
        kind: entity_kind_vehicle(),
        subtype: vehicle_type_anti_air(),
        pos,
        vel: ZERO_VEL,
        rot: Rotation { yaw, pitch: 0.0 },
        scale: aa_scale(),
        active: true,
        sim_tick: 0,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    let cram = weapons::get_vehicle_weapon(aa_weapon_slot0());

    ctx.db.vehicle().insert(Vehicle {
        entity_id: entity.id,
        vehicle_type: vehicle_type_anti_air(),
        pilot_identity: None,
        seat_count: 1,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        rotor_spin: 0.0,
        health: aa_health_max(),
        weapon_type: 0,
        weapon_ammo_primary: cram.max_ammo,
        weapon_ammo_secondary: 0,
        weapon_ammo_tertiary: 0,
        weapon_last_fire: ctx.timestamp,
        created_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
    });

    entity.id
}

/// Spawn a single fighter jet entity + vehicle row.
pub fn spawn_fighter_jet(ctx: &ReducerContext, pos: Vec3, yaw: f32) -> u64 {
    let entity = ctx.db.entity().insert(Entity {
        id: 0,
        kind: entity_kind_vehicle(),
        subtype: vehicle_type_fighter_jet(),
        pos,
        vel: ZERO_VEL,
        rot: Rotation { yaw, pitch: 0.0 },
        scale: jet_scale(),
        active: true,
        sim_tick: 0,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    let bb = weapons::get_vehicle_weapon(jet_weapon_slot0());
    let cb = weapons::get_vehicle_weapon(jet_weapon_slot1());
    let am = weapons::get_vehicle_weapon(jet_weapon_slot2());

    ctx.db.vehicle().insert(Vehicle {
        entity_id: entity.id,
        vehicle_type: vehicle_type_fighter_jet(),
        pilot_identity: None,
        seat_count: 1,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        rotor_spin: 0.0,
        health: jet_health_max(),
        weapon_type: 0,
        weapon_ammo_primary: bb.max_ammo,
        weapon_ammo_secondary: cb.max_ammo,
        weapon_ammo_tertiary: am.max_ammo,
        weapon_last_fire: ctx.timestamp,
        created_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
    });

    entity.id
}

/// Spawn a single APC entity + vehicle row.
pub fn spawn_apc(ctx: &ReducerContext, pos: Vec3, yaw: f32) -> u64 {
    let entity = ctx.db.entity().insert(Entity {
        id: 0,
        kind: entity_kind_vehicle(),
        subtype: vehicle_type_apc(),
        pos,
        vel: ZERO_VEL,
        rot: Rotation { yaw, pitch: 0.0 },
        scale: apc_scale(),
        active: true,
        sim_tick: 0,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    // APC has no vehicle weapons — driver cannot fire.
    ctx.db.vehicle().insert(Vehicle {
        entity_id: entity.id,
        vehicle_type: vehicle_type_apc(),
        pilot_identity: None,
        seat_count: 4,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        input_seq: 0,
        acked_input_seq: 0,
        sim_tick: 0,
        sim_updated_at: ctx.timestamp,
        rotor_spin: 0.0,
        health: apc_health_max(),
        weapon_type: 0,
        weapon_ammo_primary: 0,
        weapon_ammo_secondary: 0,
        weapon_ammo_tertiary: 0,
        weapon_last_fire: ctx.timestamp,
        created_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
    });

    entity.id
}

/// Spawn APCs at random flat locations across the map.
pub fn spawn_apcs_on_flat_ground(ctx: &ReducerContext) {
    let seed = timestamp_micros(ctx.timestamp) ^ 0xb7e151628aed2a6b;
    let margin = (APC_SPAWN_CLEARANCE_RADIUS + 12).max(10);
    let span_x = (WORLD_SIZE_X as i32 - margin * 2).max(8);
    let span_z = (WORLD_SIZE_Z as i32 - margin * 2).max(8);
    let mut chunk_cache: HashMap<u32, [u8; 4096]> = HashMap::new();

    let mut spawned = 0usize;
    for attempt in 0..320u64 {
        if spawned >= SANDBOX_APC_COUNT {
            break;
        }

        let rx = hash_u64(seed ^ attempt.wrapping_mul(0x9e3779b97f4a7c15));
        let rz = hash_u64(seed ^ attempt.wrapping_mul(0xd1b54a32d192ed03));
        let x = margin + (rx % span_x as u64) as i32;
        let z = margin + (rz % span_z as u64) as i32;

        let Some(y) = ground_vehicle_spawn_y_if_fit(
            ctx,
            x,
            z,
            APC_SPAWN_CLEARANCE_RADIUS,
            APC_SPAWN_CLEARANCE_HEIGHT,
            APC_SPAWN_MIN_SEPARATION,
            &mut chunk_cache,
        ) else {
            continue;
        };

        let yaw = unit_from_seed(seed ^ attempt.wrapping_mul(0x94d049bb133111eb)) * TAU;
        spawn_apc(
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

    log::info!("Spawned {} APCs on flat ground", spawned);
}

/// Spawn fighter jets at the START of each Airport biome runway.
/// Uses `airport_runway_start` to get the exact hardcoded position that
/// matches the runway laid down by `place_airport_layouts`.
pub fn spawn_jets_at_airstrips(ctx: &ReducerContext, world_seed: u64) {
    use crate::worldgen::biomes::{biome_height, get_biome, Biome};
    use crate::worldgen::structures::airstrip::airport_runway_start;

    let cell_size = 90i32;
    let num_cells_x = (WORLD_SIZE_X as i32 / cell_size) + 1;
    let num_cells_z = (WORLD_SIZE_Z as i32 / cell_size) + 1;
    let mut spawned = 0usize;

    'outer: for cx in 0..num_cells_x {
        for cz in 0..num_cells_z {
            let center_x = cx * cell_size + cell_size / 2;
            let center_z = cz * cell_size + cell_size / 2;
            if center_x < 0
                || center_x >= WORLD_SIZE_X as i32
                || center_z < 0
                || center_z >= WORLD_SIZE_Z as i32
            {
                continue;
            }

            if spawned >= SANDBOX_JET_COUNT {
                break 'outer;
            }

            let biome = get_biome(center_x, center_z, world_seed);
            if biome != Biome::Airport {
                continue;
            }

            let base_y = biome_height(biome, center_x, center_z, world_seed);
            let (rx, ry, rz) = airport_runway_start(center_x, center_z, base_y);

            spawn_fighter_jet(
                ctx,
                Vec3 {
                    x: rx as f32 + 0.5,
                    // airport_runway_start returns runway surface Y. Spawn at
                    // surface + jet minAltitude (0.95) so wheels start grounded.
                    y: ry as f32 + 0.95,
                    z: rz as f32 + 0.5,
                },
                -std::f32::consts::FRAC_PI_2, // yaw=-PI/2 → forward is +X (down the runway)
            );
            spawned += 1;
        }
    }

    log::info!("Spawned {} jets at airport runways", spawned);
}

/// Spawn anti-air vehicles at military outpost biome cells.
/// Uses `outpost_vehicle_spawn` to get the center pad position.
pub fn spawn_aa_at_outposts(ctx: &ReducerContext, world_seed: u64) {
    use crate::worldgen::biomes::{biome_height, get_biome, Biome};
    use crate::worldgen::structures::outpost::outpost_vehicle_spawn;

    let cell_size = 90i32;
    let num_cells_x = (WORLD_SIZE_X as i32 / cell_size) + 1;
    let num_cells_z = (WORLD_SIZE_Z as i32 / cell_size) + 1;
    let mut spawned = 0usize;

    'outer: for cx in 0..num_cells_x {
        for cz in 0..num_cells_z {
            let center_x = cx * cell_size + cell_size / 2;
            let center_z = cz * cell_size + cell_size / 2;
            if center_x < 0
                || center_x >= WORLD_SIZE_X as i32
                || center_z < 0
                || center_z >= WORLD_SIZE_Z as i32
            {
                continue;
            }

            if spawned >= SANDBOX_AA_COUNT {
                break 'outer;
            }

            let biome = get_biome(center_x, center_z, world_seed);
            if biome != Biome::MilitaryOutpost {
                continue;
            }

            let base_y = biome_height(biome, center_x, center_z, world_seed);
            let (sx, sy, sz) = outpost_vehicle_spawn(center_x, center_z, base_y);

            spawn_anti_air(
                ctx,
                Vec3 {
                    x: sx as f32 + 0.5,
                    y: sy as f32,
                    z: sz as f32 + 0.5,
                },
                0.0, // facing north
            );
            spawned += 1;
        }
    }

    log::info!("Spawned {} anti-air vehicles at military outposts", spawned);
}
