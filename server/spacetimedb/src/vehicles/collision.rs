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
    let speed_sq =
        entity.vel.x * entity.vel.x + entity.vel.y * entity.vel.y + entity.vel.z * entity.vel.z;
    let min_speed = vehicle_collision_min_speed();
    if speed_sq < min_speed * min_speed {
        return (0, false);
    }
    let speed = speed_sq.sqrt();

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

    let max_blocks = effective_max_destroyed_blocks(speed);
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

    // Invalidate terrain caches so the subsequent ground-height check
    // sees the hole we just punched through (vehicle passes through, not over).
    terrain.invalidate_surface_range(min_x, max_x, min_z, max_z);
    terrain.invalidate_chunk_range(min_x, max_x, min_y, max_y, min_z, max_z);
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
        "[VEHICLE_COLLISION] entity_id={} blocks={} max_blocks={} speed={:.2} damage={} health={} speed_factor={:.3}",
        vehicle.entity_id,
        actually_destroyed,
        max_blocks,
        speed,
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
fn destroy_vehicle_from_collision(ctx: &ReducerContext, vehicle: &Vehicle, entity: &Entity) {
    let vehicle_id = vehicle.entity_id;

    clear_vehicle_input_queue(ctx, vehicle_id);

    // Huge blast: carve surrounding blocks + splash nearby players/vehicles.
    // Run before dismounting so the crew is shielded from their own wreck, then
    // eject them at the vehicle's current position (including altitude).
    let origin = vehicle.pilot_identity.unwrap_or(ctx.sender());
    let center = vehicle_hitbox_center(entity);
    crate::combat::emit_vehicle_destruction_explosion(ctx, origin, vehicle_id, &center);
    dismount_all_vehicle_occupants(ctx, vehicle_id, false);

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
    } else if entity.subtype == vehicle_type_hover() {
        (
            hover_hitbox_half_x() * scale,
            hover_hitbox_half_y() * scale,
            hover_hitbox_half_z() * scale,
            hover_hitbox_center_y(),
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

fn effective_max_destroyed_blocks(speed: f32) -> usize {
    let max_blocks = vehicle_collision_max_blocks();
    if max_blocks <= 1 {
        return max_blocks;
    }

    let min_speed = vehicle_collision_min_speed();
    let reference_speed = vehicle_collision_speed_destroy_reference().max(min_speed + 0.001);
    let min_fraction = vehicle_collision_min_destroy_fraction().clamp(0.0, 1.0);
    let t = ((speed - min_speed) / (reference_speed - min_speed)).clamp(0.0, 1.0);
    let fraction = min_fraction + (1.0 - min_fraction) * t;
    ((max_blocks as f32) * fraction).round().max(1.0) as usize
}
