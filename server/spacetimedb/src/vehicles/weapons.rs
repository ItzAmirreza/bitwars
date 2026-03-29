// ── Vehicle Weapons ──
// Fire, reload, switch for vehicle-mounted weapons.

use spacetimedb::{reducer, Identity, ReducerContext, Table};

use crate::combat::*;
use crate::constants;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

/// Map a vehicle's weapon slot to the actual vehicleWeapons index.
/// Helicopter: slot 0 → index 0 (MINIGUN), slot 1 → index 1 (ROCKETS)
/// Fighter Jet: slot 0 → index 2 (KINETIC PENETRATOR), slot 1 → index 3 (CARPET BOMB), slot 2 → index 6 (AIR MISSILE)
fn resolve_vehicle_weapon_index(vehicle_type: u8, slot: u8) -> u8 {
    if vehicle_type == constants::vehicle_type_fighter_jet() {
        match slot {
            0 => constants::jet_weapon_slot0(),
            1 => constants::jet_weapon_slot1(),
            _ => constants::jet_weapon_slot2(),
        }
    } else if vehicle_type == constants::vehicle_type_anti_air() {
        if slot == 0 {
            constants::aa_weapon_slot0()
        } else {
            constants::aa_weapon_slot1()
        }
    } else {
        // Helicopter: slot == index
        slot
    }
}

/// Get ammo for a given weapon slot from the vehicle row.
fn get_slot_ammo(vehicle: &Vehicle, slot: u8) -> i32 {
    match slot {
        0 => vehicle.weapon_ammo_primary,
        1 => vehicle.weapon_ammo_secondary,
        _ => vehicle.weapon_ammo_tertiary,
    }
}

/// Return updated ammo tuple (primary, secondary, tertiary) after decrementing the given slot.
fn deduct_slot_ammo(vehicle: &Vehicle, slot: u8) -> (i32, i32, i32) {
    match slot {
        0 => (
            vehicle.weapon_ammo_primary - 1,
            vehicle.weapon_ammo_secondary,
            vehicle.weapon_ammo_tertiary,
        ),
        1 => (
            vehicle.weapon_ammo_primary,
            vehicle.weapon_ammo_secondary - 1,
            vehicle.weapon_ammo_tertiary,
        ),
        _ => (
            vehicle.weapon_ammo_primary,
            vehicle.weapon_ammo_secondary,
            vehicle.weapon_ammo_tertiary - 1,
        ),
    }
}

#[reducer]
pub fn switch_vehicle_weapon(ctx: &ReducerContext, weapon_index: u8) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.mounted_vehicle_id == 0 {
        return Err("Not in a vehicle".to_string());
    }
    let vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle not found")?;
    if vehicle.pilot_identity != Some(sender) {
        return Err("Not the pilot".to_string());
    }
    // Max slots: 2 for helicopter, 3 for jet
    let max_slots: u8 = if vehicle.vehicle_type == constants::vehicle_type_fighter_jet() {
        3
    } else {
        2
    };
    if weapon_index >= max_slots {
        return Err("Invalid vehicle weapon slot".to_string());
    }
    ctx.db.vehicle().entity_id().update(Vehicle {
        weapon_type: weapon_index,
        ..vehicle
    });
    Ok(())
}

#[reducer]
pub fn fire_vehicle_weapon(
    ctx: &ReducerContext,
    direction: Vec3,
    hit_players: Vec<Identity>,
    hit_vehicles: Vec<u64>,
    hit_blocks: Vec<Vec3>,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.health <= 0 {
        return Err("Cannot fire while dead".to_string());
    }
    if player.mounted_vehicle_id == 0 {
        return Err("Not in a vehicle".to_string());
    }

    let vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle not found")?;
    if vehicle.pilot_identity != Some(sender) {
        return Err("Not the pilot".to_string());
    }
    if vehicle.health <= 0 {
        return Err("Vehicle is destroyed".to_string());
    }

    let slot = vehicle.weapon_type;
    let resolved_idx = resolve_vehicle_weapon_index(vehicle.vehicle_type, slot);
    if resolved_idx >= weapons::num_vehicle_weapons() {
        return Err("Invalid vehicle weapon".to_string());
    }
    let def = weapons::get_vehicle_weapon(resolved_idx);

    // Shared fire rate check
    weapons::check_fire_rate(ctx, vehicle.weapon_last_fire, def.fire_rate)?;

    // Ammo check
    let current_ammo = get_slot_ammo(&vehicle, slot);
    if current_ammo <= 0 {
        return Err("No ammo".to_string());
    }

    // Origin validation
    let entity = ctx
        .db
        .entity()
        .id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle entity not found")?;
    let (normalized_dir, dir_len) = normalize_direction(&direction);
    if dir_len <= 0.01 {
        return Err("Invalid shot direction".to_string());
    }

    // Server-authoritative muzzle origin from current vehicle pose.
    // Extrapolate from the last vehicle sim snapshot to reducer time so fast
    // vehicles don't appear to fire from a noticeably stale position.
    let now_us = timestamp_micros(ctx.timestamp);
    let updated_us = timestamp_micros(entity.updated_at);
    let age_us = now_us.saturating_sub(updated_us);
    let max_extrap_us = (crate::constants::HELI_TICK_INTERVAL_MS * 1000 * 2) as u64;
    let dt = (age_us.min(max_extrap_us) as f32) / 1_000_000.0;
    let muzzle_base = Vec3 {
        x: entity.pos.x + entity.vel.x * dt,
        y: entity.pos.y + entity.vel.y * dt,
        z: entity.pos.z + entity.vel.z * dt,
    };

    // Kinetic penetrator: fires straight down from jet position
    let (origin, shot_direction) = if resolved_idx == constants::jet_weapon_slot0() {
        let kp_origin = Vec3 {
            x: muzzle_base.x,
            y: muzzle_base.y - 1.0,
            z: muzzle_base.z,
        };
        let kp_dir = Vec3 {
            x: 0.0,
            y: -1.0,
            z: 0.0,
        };
        (kp_origin, kp_dir)
    // Carpet bomb: compute origin from jet position, direction straight down
    // with forward velocity inheritance. Alternate left/right offset.
    } else if resolved_idx == constants::jet_weapon_slot1() {
        let side = if current_ammo % 2 == 0 {
            1.0f32
        } else {
            -1.0f32
        };
        let right_x = entity.rot.yaw.cos();
        let right_z = -entity.rot.yaw.sin();
        let bomb_origin = Vec3 {
            x: muzzle_base.x + right_x * side * 2.5,
            y: muzzle_base.y - 1.0,
            z: muzzle_base.z + right_z * side * 2.5,
        };
        // Direction: straight down + forward velocity inheritance
        let fwd_x = -entity.rot.yaw.sin();
        let fwd_z = -entity.rot.yaw.cos();
        let speed = (entity.vel.x * entity.vel.x + entity.vel.z * entity.vel.z).sqrt();
        let bomb_dir = Vec3 {
            x: fwd_x * speed * 0.3,
            y: -1.0,
            z: fwd_z * speed * 0.3,
        };
        (bomb_origin, bomb_dir)
    } else if vehicle.vehicle_type == constants::vehicle_type_anti_air() && slot == 1 {
        // SAM missile: larger offset to clear AA hitbox
        let origin = Vec3 {
            x: muzzle_base.x + normalized_dir.x * 6.0,
            y: muzzle_base.y + 2.0,
            z: muzzle_base.z + normalized_dir.z * 6.0,
        };
        (origin, direction.clone())
    } else {
        let origin = Vec3 {
            x: muzzle_base.x + normalized_dir.x * 3.5,
            y: muzzle_base.y + 1.0,
            z: muzzle_base.z + normalized_dir.z * 3.5,
        };
        (origin, direction.clone())
    };

    // Deduct ammo
    let (new_ammo_primary, new_ammo_secondary, new_ammo_tertiary) =
        deduct_slot_ammo(&vehicle, slot);
    let vehicle_id = vehicle.entity_id;
    ctx.db.vehicle().entity_id().update(Vehicle {
        weapon_ammo_primary: new_ammo_primary,
        weapon_ammo_secondary: new_ammo_secondary,
        weapon_ammo_tertiary: new_ammo_tertiary,
        weapon_last_fire: ctx.timestamp,
        ..vehicle
    });

    let weapon_code = 100 + resolved_idx;

    // Projectile weapons: just record shot
    if !def.is_hitscan() {
        ctx.db.shot_event().insert(ShotEvent {
            id: 0,
            shooter: sender,
            origin,
            direction: shot_direction,
            hit_pos: ZERO_VEL,
            has_hit: false,
            weapon: weapon_code,
            source_vehicle: vehicle_id,
            fired_at: ctx.timestamp,
        });
        return Ok(());
    }

    // Kinetic Penetrator: hitscan downward strike — delegate to specialized handler
    if resolved_idx == constants::jet_weapon_slot0() {
        let mut validated_impact: Option<Vec3> = None;
        if !hit_blocks.is_empty() {
            let impact = &hit_blocks[0];
            // Validate: impact must be directly below the server-authoritative origin
            let horiz_dist_sq = (impact.x - origin.x).powi(2) + (impact.z - origin.z).powi(2);
            let max_horiz_tolerance = 5.0; // Allow small drift from extrapolation
            let vert_dist = origin.y - impact.y;
            if horiz_dist_sq <= max_horiz_tolerance * max_horiz_tolerance
                && vert_dist >= 0.0
                && vert_dist <= def.max_range
                && block_in_bounds(impact.x as i32, impact.y as i32, impact.z as i32)
            {
                crate::combat::kinetic_penetrator::kinetic_penetrator_strike(
                    ctx,
                    sender,
                    impact,
                    def.damage,
                    def.radius,
                    weapon_code,
                    vehicle_id,
                );
                validated_impact = Some(impact.clone());
            } else {
                log::warn!(
                    "[KINETIC_PENETRATOR] Rejected impact: origin=({:.1},{:.1},{:.1}) impact=({:.1},{:.1},{:.1}) hdist={:.1} vdist={:.1}",
                    origin.x, origin.y, origin.z,
                    impact.x, impact.y, impact.z,
                    horiz_dist_sq.sqrt(), vert_dist,
                );
            }
        }
        // Emit shot event so remote clients see the beam VFX
        ctx.db.shot_event().insert(ShotEvent {
            id: 0,
            shooter: sender,
            origin: origin.clone(),
            direction: shot_direction,
            hit_pos: validated_impact.clone().unwrap_or(ZERO_VEL),
            has_hit: validated_impact.is_some(),
            weapon: weapon_code,
            source_vehicle: vehicle_id,
            fired_at: ctx.timestamp,
        });
        return Ok(());
    }

    // Standard hitscan path (minigun)
    apply_hitscan_player_damage(
        ctx,
        sender,
        &origin,
        &shot_direction,
        dir_len,
        &hit_players,
        def.damage,
        def.max_range,
        weapon_code,
    );
    let first_vehicle_hit_pos = apply_hitscan_vehicle_damage(
        ctx,
        sender,
        &origin,
        &normalized_dir,
        &hit_vehicles,
        vehicle_id,
        def.damage,
        def.max_range,
        weapon_code,
    );
    let actually_destroyed =
        destroy_and_check_blocks(ctx, &origin, &hit_blocks, def.max_range + 5.0);
    let (shot_hit_pos, shot_has_hit) = determine_hit_pos(
        ctx,
        &actually_destroyed,
        &hit_players,
        first_vehicle_hit_pos,
    );

    ctx.db.shot_event().insert(ShotEvent {
        id: 0,
        shooter: sender,
        origin: origin.clone(),
        direction: shot_direction,
        hit_pos: shot_hit_pos,
        has_hit: shot_has_hit,
        weapon: weapon_code,
        source_vehicle: vehicle_id,
        fired_at: ctx.timestamp,
    });

    Ok(())
}

#[reducer]
pub fn vehicle_projectile_impact(
    ctx: &ReducerContext,
    shot_origin: Vec3,
    impact_pos: Vec3,
    _direction: Vec3,
    vehicle_weapon: u8,
    travel_time_ms: u32,
    _hit_players: Vec<Identity>,
    _hit_vehicles: Vec<u64>,
    _hit_blocks: Vec<Vec3>,
    shot_event_id: u64,
    source_vehicle_id: u64,
) -> Result<(), String> {
    let sender = ctx.sender();
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if source_vehicle_id == 0 {
        return Err("Invalid source vehicle".to_string());
    }
    let source_vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&source_vehicle_id)
        .ok_or("Source vehicle not found")?;
    if source_vehicle.pilot_identity != Some(sender) {
        return Err("Not pilot of source vehicle".to_string());
    }

    // The client sends the weapon_code (100 + resolved_idx). Extract the resolved index.
    let resolved_idx = if vehicle_weapon >= 100 {
        vehicle_weapon - 100
    } else {
        vehicle_weapon
    };
    if resolved_idx >= weapons::num_vehicle_weapons() {
        return Err("Invalid vehicle weapon".to_string());
    }

    let def = weapons::get_vehicle_weapon(resolved_idx);
    if def.is_hitscan() {
        return Err("Not a projectile weapon".to_string());
    }

    let weapon_code = 100 + resolved_idx;
    let shot = find_valid_shot_by_id(
        ctx,
        shot_event_id,
        sender,
        weapon_code,
        def.projectile_speed,
        def.max_range,
        &impact_pos,
        &shot_origin,
        travel_time_ms,
        Some(source_vehicle_id),
        true,
    )
    .or_else(|| {
        find_matching_projectile_shot(
            ctx,
            sender,
            weapon_code,
            def.projectile_speed,
            def.max_range,
            &impact_pos,
            &shot_origin,
            travel_time_ms,
            Some(source_vehicle_id),
            true,
        )
    });
    let Some(shot) = shot else {
        log::debug!(
            "Ignoring unmatched vehicle projectile impact (player={:?}, weapon={}, shot_id={}, vehicle={}, pos=({:.2},{:.2},{:.2}))",
            sender,
            resolved_idx,
            shot_event_id,
            source_vehicle_id,
            impact_pos.x,
            impact_pos.y,
            impact_pos.z
        );
        return Ok(());
    };

    let max_range = def.max_range + 10.0;
    if dist_sq(&shot.origin, &impact_pos) > max_range * max_range {
        return Err("Impact too far from origin".to_string());
    }

    weapons::validate_travel_time(
        &shot.origin,
        &impact_pos,
        def.projectile_speed,
        travel_time_ms,
    );

    consume_projectile_shot(ctx, shot, &impact_pos);

    // Standard projectile impact (rockets, carpet bomb, etc.)
    let hit_players = collect_all_player_ids(ctx);
    let hit_vehicles = collect_all_vehicle_ids(ctx);
    apply_splash_player_damage(
        ctx,
        sender,
        &impact_pos,
        &hit_players,
        def.damage,
        def.radius,
        weapon_code,
    );
    apply_splash_vehicle_damage(
        ctx,
        sender,
        &impact_pos,
        &hit_vehicles,
        source_vehicle_id,
        def.damage,
        def.radius,
        weapon_code,
    );

    let actually_destroyed =
        destroy_spherical_blocks(ctx, &impact_pos, def.radius, (def.radius * 0.5).max(0.1));

    if def.radius > 0.0 {
        emit_explosion(
            ctx,
            sender,
            &impact_pos,
            def.radius,
            weapon_code,
            &actually_destroyed,
        );
    }

    Ok(())
}

#[reducer]
pub fn reload_vehicle_weapon(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    if player.mounted_vehicle_id == 0 {
        return Err("Not in a vehicle".to_string());
    }

    let vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle not found")?;
    if vehicle.pilot_identity != Some(sender) {
        return Err("Not the pilot".to_string());
    }

    let slot = vehicle.weapon_type;
    let resolved_idx = resolve_vehicle_weapon_index(vehicle.vehicle_type, slot);
    if resolved_idx >= weapons::num_vehicle_weapons() {
        return Err("Invalid vehicle weapon".to_string());
    }
    let def = weapons::get_vehicle_weapon(resolved_idx);

    let new_ammo_primary = if slot == 0 {
        def.max_ammo
    } else {
        vehicle.weapon_ammo_primary
    };
    let new_ammo_secondary = if slot == 1 {
        def.max_ammo
    } else {
        vehicle.weapon_ammo_secondary
    };
    let new_ammo_tertiary = if slot == 2 {
        def.max_ammo
    } else {
        vehicle.weapon_ammo_tertiary
    };

    ctx.db.vehicle().entity_id().update(Vehicle {
        weapon_ammo_primary: new_ammo_primary,
        weapon_ammo_secondary: new_ammo_secondary,
        weapon_ammo_tertiary: new_ammo_tertiary,
        ..vehicle
    });

    Ok(())
}
