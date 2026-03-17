// ── Projectile Impact Reducer ──
// Server-side projectile hit resolution (RPG, etc).

use spacetimedb::{reducer, Identity, ReducerContext, Table};

use crate::chunks::{destroy_blocks_in_world, run_structural_check};
use crate::combat::damage::*;
use crate::constants::max_block_destroy_per_call;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

/// Find the best matching, not-yet-consumed projectile shot event for an impact.
pub fn find_matching_projectile_shot(
    ctx: &ReducerContext,
    sender: Identity,
    weapon_code: u8,
    projectile_speed: f32,
    max_range: f32,
    impact_pos: &Vec3,
    client_shot_origin: &Vec3,
    source_vehicle_filter: Option<u64>,
    require_vehicle_source: bool,
) -> Option<ShotEvent> {
    if projectile_speed <= 0.01 {
        return None;
    }

    let now_us = timestamp_micros(ctx.timestamp);
    let mut best: Option<(ShotEvent, f32)> = None;

    for shot in ctx.db.shot_event().iter() {
        if shot.shooter != sender || shot.weapon != weapon_code || shot.has_hit {
            continue;
        }
        if let Some(source_vehicle_id) = source_vehicle_filter {
            if shot.source_vehicle != source_vehicle_id {
                continue;
            }
        } else if require_vehicle_source && shot.source_vehicle == 0 {
            continue;
        }

        let fired_at_us = timestamp_micros(shot.fired_at);
        let age_us = now_us.saturating_sub(fired_at_us);
        // Keep this in sync with shot event cleanup TTL (+ headroom).
        if age_us > 8_000_000 {
            continue;
        }

        // Client-reported origin can diverge from authoritative server pose,
        // especially for fast vehicles. Allow a wider envelope for vehicle shots.
        let origin_tol_sq = if shot.source_vehicle == 0 {
            64.0
        } else {
            625.0
        };
        if dist_sq(&shot.origin, client_shot_origin) > origin_tol_sq {
            continue;
        }

        let to_impact = Vec3 {
            x: impact_pos.x - shot.origin.x,
            y: impact_pos.y - shot.origin.y,
            z: impact_pos.z - shot.origin.z,
        };
        let (impact_dir, impact_len) = normalize_direction(&to_impact);
        if impact_len <= 0.01 {
            continue;
        }
        if impact_len > max_range + 10.0 {
            continue;
        }

        let (shot_dir, shot_dir_len) = normalize_direction(&shot.direction);
        if shot_dir_len <= 0.01 {
            continue;
        }
        let dir_dot =
            shot_dir.x * impact_dir.x + shot_dir.y * impact_dir.y + shot_dir.z * impact_dir.z;
        let min_dir_dot = if shot.source_vehicle == 0 { 0.45 } else { 0.35 };
        if dir_dot < min_dir_dot {
            continue;
        }

        let expected_ms = impact_len / projectile_speed * 1000.0;
        let age_ms = age_us as f32 / 1000.0;
        let min_ms = (expected_ms * 0.2).max(15.0);
        let max_ms = expected_ms * 3.2 + 600.0;
        if age_ms < min_ms || age_ms > max_ms {
            continue;
        }

        let origin_dist_sq = dist_sq(&shot.origin, client_shot_origin);
        let score = (age_ms - expected_ms).abs() + origin_dist_sq * 0.35;
        match &best {
            Some((_, best_score)) if score >= *best_score => {}
            _ => best = Some((shot, score)),
        }
    }

    best.map(|(shot, _)| shot)
}

/// Mark a projectile shot as consumed by an authoritative impact.
pub fn consume_projectile_shot(ctx: &ReducerContext, shot: ShotEvent, impact_pos: &Vec3) {
    ctx.db.shot_event().id().update(ShotEvent {
        has_hit: true,
        hit_pos: impact_pos.clone(),
        ..shot
    });
}

pub fn collect_all_player_ids(ctx: &ReducerContext) -> Vec<Identity> {
    ctx.db.player().iter().map(|p| p.identity).collect()
}

pub fn collect_all_vehicle_ids(ctx: &ReducerContext) -> Vec<u64> {
    ctx.db.vehicle().iter().map(|v| v.entity_id).collect()
}

/// Server-side block destruction volume for projectile explosions.
/// Uses an ellipsoid (horizontal + vertical radii) and authoritative block checks.
pub fn destroy_spherical_blocks(
    ctx: &ReducerContext,
    impact_pos: &Vec3,
    horizontal_radius: f32,
    vertical_radius: f32,
) -> Vec<(i32, i32, i32, u8)> {
    let hr = horizontal_radius.max(0.1);
    let vr = vertical_radius.max(0.1);
    let hr2 = hr * hr;
    let vr2 = vr * vr;
    let max_blocks = max_block_destroy_per_call();

    let mut block_coords: Vec<(i32, i32, i32)> = Vec::new();
    for bx in (impact_pos.x - hr).floor() as i32..=(impact_pos.x + hr).ceil() as i32 {
        for by in (impact_pos.y - vr).floor() as i32..=(impact_pos.y + vr).ceil() as i32 {
            for bz in (impact_pos.z - hr).floor() as i32..=(impact_pos.z + hr).ceil() as i32 {
                let dx = bx as f32 - impact_pos.x;
                let dy = by as f32 - impact_pos.y;
                let dz = bz as f32 - impact_pos.z;
                if ((dx * dx + dz * dz) / hr2 + (dy * dy) / vr2 <= 1.0)
                    && block_in_bounds(bx, by, bz)
                {
                    block_coords.push((bx, by, bz));
                    if block_coords.len() >= max_blocks {
                        break;
                    }
                }
            }
            if block_coords.len() >= max_blocks {
                break;
            }
        }
        if block_coords.len() >= max_blocks {
            break;
        }
    }

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    actually_destroyed
}

#[reducer]
pub fn projectile_impact(
    ctx: &ReducerContext,
    shot_origin: Vec3,
    impact_pos: Vec3,
    _direction: Vec3,
    weapon: u8,
    _travel_time_ms: u32,
    _hit_players: Vec<Identity>,
    _hit_vehicles: Vec<u64>,
    _hit_blocks: Vec<Vec3>,
) -> Result<(), String> {
    let sender = ctx.sender();
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if weapon >= weapons::num_weapons() {
        return Err("Invalid weapon".to_string());
    }
    let def = weapons::get_weapon(weapon);
    if !def.is_projectile() {
        return Err("Not a projectile weapon".to_string());
    }
    if def.is_server_projectile() {
        return Err("Grenade impacts are server-authoritative".to_string());
    }

    let Some(shot) = find_matching_projectile_shot(
        ctx,
        sender,
        weapon,
        def.projectile_speed,
        def.max_range,
        &impact_pos,
        &shot_origin,
        Some(0),
        false,
    ) else {
        log::debug!(
            "Ignoring unmatched projectile impact (player={:?}, weapon={}, pos=({:.2},{:.2},{:.2}))",
            sender,
            weapon,
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

    consume_projectile_shot(ctx, shot, &impact_pos);

    let hit_players = collect_all_player_ids(ctx);
    let hit_vehicles = collect_all_vehicle_ids(ctx);

    apply_splash_player_damage(
        ctx,
        sender,
        &impact_pos,
        &hit_players,
        def.damage,
        def.radius,
        weapon,
    );
    apply_splash_vehicle_damage(
        ctx,
        sender,
        &impact_pos,
        &hit_vehicles,
        0,
        def.damage,
        def.radius,
        weapon,
    );

    let actually_destroyed = destroy_spherical_blocks(ctx, &impact_pos, def.radius, def.radius);

    if def.radius > 0.0 {
        emit_explosion(
            ctx,
            sender,
            &impact_pos,
            def.radius,
            weapon,
            &actually_destroyed,
        );
    }

    Ok(())
}
