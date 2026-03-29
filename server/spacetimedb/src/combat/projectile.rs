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

fn projectile_match_score(age_ms: f32, target_ms: f32, origin_dist_sq: f32) -> f32 {
    // Network transit usually makes the authoritative age slightly later than the
    // client-reported travel time. Keep a modest bias against "too-early"
    // candidates so rapid-fire projectiles don't steal earlier impacts, without
    // making normal slightly-early arrivals lose to the previous shot.
    let timing_penalty = if age_ms >= target_ms {
        age_ms - target_ms
    } else {
        (target_ms - age_ms) * 1.5
    };
    timing_penalty + origin_dist_sq * 0.35
}

/// Find the best matching, not-yet-consumed projectile shot event for an impact.
pub fn find_matching_projectile_shot(
    ctx: &ReducerContext,
    sender: Identity,
    weapon_code: u8,
    projectile_speed: f32,
    max_range: f32,
    impact_pos: &Vec3,
    client_shot_origin: &Vec3,
    reported_travel_time_ms: u32,
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
        if age_us > weapons::shot_event_retention_us(weapon_code) {
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
        let min_dir_dot = if shot.source_vehicle == 0 { 0.45 } else { 0.05 };
        if dir_dot < min_dir_dot {
            continue;
        }

        let expected_ms = impact_len / projectile_speed * 1000.0;
        let age_ms = age_us as f32 / 1000.0;
        let target_ms = if reported_travel_time_ms > 0 {
            reported_travel_time_ms as f32
        } else {
            expected_ms
        };
        let early_slack_ms = if shot.source_vehicle == 0 {
            250.0
        } else {
            1_200.0
        };
        let late_slack_ms = if shot.source_vehicle == 0 {
            1_200.0
        } else {
            2_500.0
        };
        let min_ms = (target_ms - early_slack_ms).max(0.0);
        let max_ms = target_ms + late_slack_ms;
        if age_ms < min_ms || age_ms > max_ms {
            continue;
        }

        let origin_dist_sq = dist_sq(&shot.origin, client_shot_origin);
        let score = projectile_match_score(age_ms, target_ms, origin_dist_sq);
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
pub fn collect_capped_ellipsoid_block_coords(
    impact_pos: &Vec3,
    horizontal_radius: f32,
    vertical_radius: f32,
    max_blocks: usize,
) -> Vec<(i32, i32, i32)> {
    let hr = horizontal_radius.max(0.1);
    let vr = vertical_radius.max(0.1);
    let hr2 = hr * hr;
    let vr2 = vr * vr;

    let mut candidates: Vec<((i32, i32, i32), f32)> = Vec::new();
    for bx in (impact_pos.x - hr).floor() as i32..=(impact_pos.x + hr).ceil() as i32 {
        for by in (impact_pos.y - vr).floor() as i32..=(impact_pos.y + vr).ceil() as i32 {
            for bz in (impact_pos.z - hr).floor() as i32..=(impact_pos.z + hr).ceil() as i32 {
                let dx = bx as f32 - impact_pos.x;
                let dy = by as f32 - impact_pos.y;
                let dz = bz as f32 - impact_pos.z;
                let normalized_dist = (dx * dx + dz * dz) / hr2 + (dy * dy) / vr2;
                if normalized_dist <= 1.0 && block_in_bounds(bx, by, bz) {
                    candidates.push(((bx, by, bz), normalized_dist));
                }
            }
        }
    }

    candidates.sort_by(|a, b| {
        let ((ax, ay, az), ad) = a;
        let ((bx, by, bz), bd) = b;
        ad.total_cmp(bd)
            .then_with(|| ax.cmp(bx))
            .then_with(|| ay.cmp(by))
            .then_with(|| az.cmp(bz))
    });
    candidates.truncate(max_blocks);
    candidates.into_iter().map(|(coord, _)| coord).collect()
}

pub fn destroy_spherical_blocks(
    ctx: &ReducerContext,
    impact_pos: &Vec3,
    horizontal_radius: f32,
    vertical_radius: f32,
) -> Vec<(i32, i32, i32, u8)> {
    let max_blocks = max_block_destroy_per_call();
    let block_coords = collect_capped_ellipsoid_block_coords(
        impact_pos,
        horizontal_radius,
        vertical_radius,
        max_blocks,
    );

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    actually_destroyed
}

#[cfg(test)]
mod tests {
    use super::{collect_capped_ellipsoid_block_coords, projectile_match_score};
    use crate::types::Vec3;

    #[test]
    fn large_sphere_fits_current_cap_without_truncation() {
        let center = Vec3 {
            x: 50.5,
            y: 24.5,
            z: 50.5,
        };

        let coords = collect_capped_ellipsoid_block_coords(&center, 8.0, 8.0, 2_500);
        assert_eq!(coords.len(), 2_176);
    }

    #[test]
    fn capped_selection_keeps_both_sides_of_blast() {
        let center = Vec3 {
            x: 50.5,
            y: 24.5,
            z: 50.5,
        };

        let coords = collect_capped_ellipsoid_block_coords(&center, 8.0, 8.0, 500);
        assert_eq!(coords.len(), 500);
        assert!(coords.iter().any(|&(x, _, _)| x < center.x.floor() as i32));
        assert!(coords.iter().any(|&(x, _, _)| x > center.x.floor() as i32));
        assert!(coords.iter().any(|&(_, _, z)| z < center.z.floor() as i32));
        assert!(coords.iter().any(|&(_, _, z)| z > center.z.floor() as i32));
    }

    #[test]
    fn slightly_late_true_shot_beats_slightly_early_later_shot() {
        let true_shot_score = projectile_match_score(1_460.0, 1_400.0, 0.0);
        let later_shot_score = projectile_match_score(1_360.0, 1_400.0, 25.0);

        assert!(true_shot_score < later_shot_score);
    }

    #[test]
    fn near_on_time_shot_still_beats_very_late_candidate() {
        let near_on_time_score = projectile_match_score(1_430.0, 1_400.0, 0.0);
        let very_late_score = projectile_match_score(1_900.0, 1_400.0, 0.0);

        assert!(near_on_time_score < very_late_score);
    }

    #[test]
    fn slightly_early_true_shot_beats_previous_late_shot() {
        let true_shot_score = projectile_match_score(1_350.0, 1_400.0, 0.0);
        let previous_shot_score = projectile_match_score(1_500.0, 1_400.0, 25.0);

        assert!(true_shot_score < previous_shot_score);
    }
}

#[reducer]
pub fn projectile_impact(
    ctx: &ReducerContext,
    shot_origin: Vec3,
    impact_pos: Vec3,
    _direction: Vec3,
    weapon: u8,
    travel_time_ms: u32,
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
        travel_time_ms,
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

    weapons::validate_travel_time(
        &shot.origin,
        &impact_pos,
        def.projectile_speed,
        travel_time_ms,
    );

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
