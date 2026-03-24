// ── Weapon Fire Reducer ──
// Infantry weapon firing: hitscan + projectile paths.

use std::collections::HashSet;

use spacetimedb::{reducer, Identity, ReducerContext, Table};

use crate::combat::damage::*;
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

#[reducer]
pub fn fire_weapon(
    ctx: &ReducerContext,
    origin: Vec3,
    direction: Vec3,
    weapon: u8,
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

    if weapon >= weapons::num_weapons() {
        return Err("Invalid weapon".to_string());
    }
    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    if !weapon_in_loadout(&loadout, weapon) {
        return Err("Weapon not in loadout".to_string());
    }
    if player.health <= 0 {
        return Err("Cannot fire while dead".to_string());
    }
    if player.spawn_protected {
        return Err("Cannot fire while spawn protected".to_string());
    }
    if player.mounted_vehicle_id != 0 {
        return Err("Cannot fire while piloting".to_string());
    }

    let def = weapons::get_weapon(weapon);

    // Shared fire validation
    let last_fire = weapons::get_last_fire_time(ctx, sender);
    weapons::check_fire_rate(ctx, last_fire, def.fire_rate)?;

    let current_ammo = weapons::get_ammo(ctx, sender, weapon);
    if current_ammo <= 0 {
        return Err("No ammo".to_string());
    }

    if dist_sq(&origin, &player.pos) > max_shot_origin_dist_sq() {
        return Err("Shot origin too far from player".to_string());
    }

    // Deduct ammo + update fire time
    weapons::set_ammo(ctx, sender, weapon, current_ammo - 1);
    weapons::set_last_fire_time(ctx, sender);

    // ── Projectile path ──
    if def.is_projectile() {
        if def.is_server_projectile() {
            let (norm_dir, _) = normalize_direction(&direction);
            let final_dir = if norm_dir == ZERO_VEL {
                Vec3 {
                    x: 0.0,
                    y: 0.0,
                    z: -1.0,
                }
            } else {
                norm_dir
            };
            ctx.db.grenade_projectile().insert(GrenadeProjectile {
                id: 0,
                owner: sender,
                pos: origin.clone(),
                vel: Vec3 {
                    x: final_dir.x * def.projectile_speed,
                    y: final_dir.y * def.projectile_speed,
                    z: final_dir.z * def.projectile_speed,
                },
                fuse_remaining_ms: grenade_fuse_ms(),
                created_at: ctx.timestamp,
            });
        }
        ctx.db.shot_event().insert(ShotEvent {
            id: 0,
            shooter: sender,
            origin,
            direction,
            hit_pos: ZERO_VEL,
            has_hit: false,
            weapon,
            source_vehicle: 0,
            fired_at: ctx.timestamp,
        });
        return Ok(());
    }

    // ── Hitscan path ──
    let (normalized_dir, dir_len) = normalize_direction(&direction);

    apply_hitscan_player_damage(
        ctx,
        sender,
        &origin,
        &direction,
        dir_len,
        &hit_players,
        def.damage,
        def.max_range,
        weapon,
    );

    // Vehicle hits (with extra direction check for infantry)
    let mut first_vehicle_hit_pos: Option<Vec3> = None;
    let mut seen_vehicle_hits = HashSet::new();
    for vehicle_id in &hit_vehicles {
        if !seen_vehicle_hits.insert(*vehicle_id) {
            continue;
        }
        let Some(entity) = ctx.db.entity().id().find(vehicle_id) else {
            continue;
        };
        if !entity.active
            || entity.kind != entity_kind_vehicle()
            || entity.subtype != vehicle_type_helicopter()
        {
            continue;
        }

        let center = Vec3 {
            x: entity.pos.x,
            y: entity.pos.y + heli_hitbox_center_y(),
            z: entity.pos.z,
        };
        let max_vehicle_range = def.max_range + heli_hitbox_half_x() + 3.0;
        if dist_sq(&origin, &center) > max_vehicle_range * max_vehicle_range {
            continue;
        }

        let to_x = center.x - origin.x;
        let to_y = center.y - origin.y;
        let to_z = center.z - origin.z;
        let to_len = (to_x * to_x + to_y * to_y + to_z * to_z).sqrt();
        if dir_len <= 0.01 || to_len <= 0.1 {
            continue;
        }
        let dot =
            (to_x * direction.x + to_y * direction.y + to_z * direction.z) / (to_len * dir_len);
        if dot < hitscan_dot_threshold_vehicle() {
            continue;
        }

        let (hb_min, hb_max) = helicopter_hitbox_bounds(&entity);
        let Some(t) = ray_aabb_t(&origin, &normalized_dir, &hb_min, &hb_max) else {
            continue;
        };
        if t > max_vehicle_range {
            continue;
        }

        if first_vehicle_hit_pos.is_none() {
            first_vehicle_hit_pos = Some(center.clone());
        }
        apply_vehicle_damage(ctx, sender, *vehicle_id, def.damage, weapon, center);
    }

    let actually_destroyed =
        destroy_and_check_blocks(ctx, &origin, &hit_blocks, def.max_range + 5.0);
    if !hit_blocks.is_empty() {
        log::info!(
            "[FIRE] player={:?} weapon={} requested_blocks={} actually_destroyed={}",
            sender.to_hex(),
            weapon,
            hit_blocks.len(),
            actually_destroyed.len(),
        );
    }
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
        direction,
        hit_pos: shot_hit_pos,
        has_hit: shot_has_hit,
        weapon,
        source_vehicle: 0,
        fired_at: ctx.timestamp,
    });

    if def.radius > 0.0 && !actually_destroyed.is_empty() {
        let c = &actually_destroyed[0];
        let explosion_pos = Vec3 {
            x: c.0 as f32,
            y: c.1 as f32,
            z: c.2 as f32,
        };
        emit_explosion(
            ctx,
            sender,
            &explosion_pos,
            def.radius,
            weapon,
            &actually_destroyed,
        );
    }

    Ok(())
}

#[reducer]
pub fn reload_weapon(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;
    let weapon = player.current_weapon;
    if weapon >= weapons::num_weapons() {
        return Err("Invalid weapon".to_string());
    }
    let def = weapons::get_weapon(weapon);
    weapons::set_ammo(ctx, sender, weapon, def.max_ammo);
    Ok(())
}
