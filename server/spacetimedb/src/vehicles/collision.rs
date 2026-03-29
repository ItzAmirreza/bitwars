// ── Vehicle Block Collision ──
// Checks if a vehicle's collision volume overlaps solid blocks.
// Destroys those blocks, damages the vehicle, and reduces its speed.

use spacetimedb::{ReducerContext, Table};

use crate::chunks::{destroy_blocks_in_world, run_structural_check};
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::worldgen::{AIR, BEDROCK};

/// Check vehicle-block collision at the entity's current position.
/// Destroys overlapping blocks, applies damage, and reduces velocity.
/// If vehicle is destroyed, handles full cleanup and returns true via the second return value.
/// Returns (blocks_destroyed, vehicle_was_destroyed).
pub fn check_vehicle_block_collision(
    ctx: &ReducerContext,
    entity: &mut Entity,
    vehicle: &mut Vehicle,
    terrain: &mut TerrainSampler,
) -> (u32, bool) {
    // Compute speed
    let speed_sq = entity.vel.x * entity.vel.x
        + entity.vel.y * entity.vel.y
        + entity.vel.z * entity.vel.z;
    let min_speed = vehicle_collision_min_speed();
    if speed_sq < min_speed * min_speed {
        return (0, false);
    }

    // Get collision AABB (scaled-down combat hitbox)
    let scale = vehicle_collision_hitbox_scale();
    let (half_x, half_y, half_z, center_y_offset) = collision_half_extents(entity, scale);

    let center_y = entity.pos.y + center_y_offset;

    let min_x = (entity.pos.x - half_x).floor() as i32;
    let max_x = (entity.pos.x + half_x).ceil() as i32;
    let min_y = (center_y - half_y).floor() as i32;
    let max_y = (center_y + half_y).ceil() as i32;
    let min_z = (entity.pos.z - half_z).floor() as i32;
    let max_z = (entity.pos.z + half_z).ceil() as i32;

    let max_blocks = vehicle_collision_max_blocks();
    let mut blocks_to_destroy: Vec<(i32, i32, i32)> = Vec::new();

    for bx in min_x..=max_x {
        for by in min_y..=max_y {
            for bz in min_z..=max_z {
                if blocks_to_destroy.len() >= max_blocks {
                    break;
                }
                if let Some(bt) = terrain.get_block_type(ctx, bx, by, bz) {
                    if bt != AIR && bt != BEDROCK {
                        blocks_to_destroy.push((bx, by, bz));
                    }
                }
            }
        }
    }

    if blocks_to_destroy.is_empty() {
        return (0, false);
    }

    // Destroy blocks in world
    let destroyed = destroy_blocks_in_world(ctx, &blocks_to_destroy);
    let destroyed_positions: Vec<(i32, i32, i32)> =
        destroyed.iter().map(|&(x, y, z, _)| (x, y, z)).collect();
    run_structural_check(ctx, &destroyed_positions);

    let actually_destroyed = destroyed.len() as u32;
    if actually_destroyed == 0 {
        return (0, false);
    }

    // Apply damage
    let damage = vehicle_collision_damage_per_block() * actually_destroyed as i32;
    vehicle.health -= damage;

    // Apply speed reduction (compound per block)
    let retain = vehicle_collision_speed_retain();
    let speed_factor = retain.powi(actually_destroyed as i32);
    entity.vel.x *= speed_factor;
    entity.vel.y *= speed_factor;
    entity.vel.z *= speed_factor;

    log::info!(
        "[VEHICLE_COLLISION] entity_id={} blocks={} damage={} health={} speed_factor={:.3}",
        vehicle.entity_id,
        actually_destroyed,
        damage,
        vehicle.health,
        speed_factor,
    );

    // If destroyed, handle full cleanup
    if vehicle.health <= 0 {
        destroy_vehicle_from_collision(ctx, vehicle, entity);
        return (actually_destroyed, true);
    }

    (actually_destroyed, false)
}

/// Handle vehicle destruction caused by block collision.
/// Mirrors the destruction path in apply_vehicle_damage but uses local data.
fn destroy_vehicle_from_collision(
    ctx: &ReducerContext,
    vehicle: &Vehicle,
    entity: &Entity,
) {
    let vehicle_id = vehicle.entity_id;

    // Clear input queue
    for row in ctx
        .db
        .vehicle_input_cmd()
        .idx_vehicle_input_by_vehicle()
        .filter(&vehicle_id)
    {
        ctx.db.vehicle_input_cmd().id().delete(&row.id);
    }

    // Dismount pilot
    if let Some(pilot_id) = vehicle.pilot_identity {
        if let Some(player) = ctx.db.player().identity().find(pilot_id) {
            let dismounted = dismount_player_internal(ctx, player, true);
            ctx.db.player().identity().update(dismounted.clone());
            init_movement_state(ctx, dismounted.identity, &dismounted.pos);
            sync_player_entity(ctx, &dismounted);
        }
    }

    // Emit explosion at vehicle position
    ctx.db.explosion_event().insert(ExplosionEvent {
        id: 0,
        origin: vehicle.pilot_identity.unwrap_or(ctx.sender()),
        pos: entity.pos.clone(),
        radius: 6.0,
        weapon: 4,
        destroyed_blocks: Vec::new(),
        created_at: ctx.timestamp,
    });
    crate::grenades::push_grenades_from_explosion(ctx, &entity.pos, 6.0, 0);

    // Emit destroy event for client VFX
    ctx.db.vehicle_destroy_event().insert(VehicleDestroyEvent {
        id: 0,
        entity_id: vehicle_id,
        vehicle_type: vehicle.vehicle_type,
        pos: entity.pos.clone(),
        rot: entity.rot.clone(),
        created_at: ctx.timestamp,
    });

    // Delete vehicle and entity
    ctx.db.vehicle().entity_id().delete(&vehicle_id);
    ctx.db.entity().id().delete(&vehicle_id);
}

/// Get collision half-extents for a vehicle type, scaled by the given factor.
fn collision_half_extents(entity: &Entity, scale: f32) -> (f32, f32, f32, f32) {
    if entity.subtype == vehicle_type_fighter_jet() {
        (
            jet_hitbox_half_x() * scale,
            jet_hitbox_half_y() * scale,
            jet_hitbox_half_z() * scale,
            jet_hitbox_center_y(),
        )
    } else if entity.subtype == vehicle_type_anti_air() {
        (
            aa_hitbox_half_x() * scale,
            aa_hitbox_half_y() * scale,
            aa_hitbox_half_z() * scale,
            aa_hitbox_center_y(),
        )
    } else {
        (
            heli_hitbox_half_x() * scale,
            heli_hitbox_half_y() * scale,
            heli_hitbox_half_z() * scale,
            heli_hitbox_center_y(),
        )
    }
}
