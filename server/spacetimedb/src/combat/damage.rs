// ── Damage Resolution ──
// Shared combat helpers: hitscan, splash, kill tracking, block destruction.

use std::collections::HashSet;

use spacetimedb::{Identity, ReducerContext, Table};

use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

/// Apply hitscan damage to players (direction-validated).
pub fn apply_hitscan_player_damage(
    ctx: &ReducerContext,
    sender: Identity,
    origin: &Vec3,
    direction: &Vec3,
    dir_len: f32,
    hit_players: &[Identity],
    damage: i32,
    max_range: f32,
    weapon: u8,
) {
    for target_id in hit_players {
        if *target_id == sender {
            continue;
        }

        if let Some(target) = ctx.db.player().identity().find(*target_id) {
            if target.health <= 0 || !target.online || target.spawn_protected {
                continue;
            }
            if target.max_health >= GOD_MODE_HEALTH {
                continue;
            }

            let range = max_range + 3.0;
            if dist_sq(origin, &target.pos) > range * range {
                continue;
            }

            if dir_len > 0.01 {
                let to_x = target.pos.x - origin.x;
                let to_y = target.pos.y - origin.y;
                let to_z = target.pos.z - origin.z;
                let to_len = (to_x * to_x + to_y * to_y + to_z * to_z).sqrt();
                if to_len > 0.1 {
                    let dot = (to_x * direction.x + to_y * direction.y + to_z * direction.z)
                        / (to_len * dir_len);
                    if dot < HITSCAN_DOT_THRESHOLD_PLAYER {
                        continue;
                    }
                }
            }

            let new_health = (target.health - damage).max(0);
            ctx.db.player().identity().update(Player {
                health: new_health,
                last_damage_time: ctx.timestamp,
                ..target
            });
            if new_health == 0 {
                resolve_kill(ctx, sender, *target_id, weapon);
            }
        }
    }
}

/// Apply splash damage to players within a radius.
pub fn apply_splash_player_damage(
    ctx: &ReducerContext,
    sender: Identity,
    impact_pos: &Vec3,
    hit_players: &[Identity],
    damage: i32,
    radius: f32,
    weapon: u8,
) {
    let hit_range_sq = (radius + 5.0).powi(2);

    for target_id in hit_players {
        if *target_id == sender {
            continue;
        }

        if let Some(target) = ctx.db.player().identity().find(*target_id) {
            if target.health <= 0 || !target.online || target.spawn_protected {
                continue;
            }
            if target.max_health >= GOD_MODE_HEALTH {
                continue;
            }
            if dist_sq(impact_pos, &target.pos) > hit_range_sq {
                continue;
            }

            let new_health = (target.health - damage).max(0);
            ctx.db.player().identity().update(Player {
                health: new_health,
                last_damage_time: ctx.timestamp,
                ..target
            });
            if new_health == 0 {
                resolve_kill(ctx, sender, *target_id, weapon);
            }
        }
    }
}

/// Apply hitscan hits to vehicles. Returns the first hit position if any.
pub fn apply_hitscan_vehicle_damage(
    ctx: &ReducerContext,
    sender: Identity,
    origin: &Vec3,
    normalized_dir: &Vec3,
    hit_vehicles: &[u64],
    self_vehicle_id: u64,
    damage: i32,
    max_range: f32,
    weapon: u8,
) -> Option<Vec3> {
    let mut first_hit_pos: Option<Vec3> = None;
    let mut seen = HashSet::new();

    for &target_vehicle_id in hit_vehicles {
        if target_vehicle_id == self_vehicle_id {
            continue;
        }
        if !seen.insert(target_vehicle_id) {
            continue;
        }

        let Some(entity) = ctx.db.entity().id().find(&target_vehicle_id) else {
            continue;
        };
        if !entity.active
            || entity.kind != ENTITY_KIND_VEHICLE
            || entity.subtype != VEHICLE_TYPE_HELICOPTER
        {
            continue;
        }

        let center = Vec3 {
            x: entity.pos.x,
            y: entity.pos.y + HELI_HITBOX_CENTER_Y,
            z: entity.pos.z,
        };
        let max_vehicle_range = max_range + HELI_HITBOX_HALF_X + 3.0;
        if dist_sq(origin, &center) > max_vehicle_range * max_vehicle_range {
            continue;
        }

        let (hb_min, hb_max) = helicopter_hitbox_bounds(&entity);
        let Some(t) = ray_aabb_t(origin, normalized_dir, &hb_min, &hb_max) else {
            continue;
        };
        if t > max_vehicle_range {
            continue;
        }

        if first_hit_pos.is_none() {
            first_hit_pos = Some(center.clone());
        }
        apply_vehicle_damage(ctx, sender, target_vehicle_id, damage, weapon, center);
    }

    first_hit_pos
}

/// Apply splash damage to vehicles within a radius.
pub fn apply_splash_vehicle_damage(
    ctx: &ReducerContext,
    sender: Identity,
    impact_pos: &Vec3,
    hit_vehicles: &[u64],
    self_vehicle_id: u64,
    damage: i32,
    radius: f32,
    weapon: u8,
) {
    let mut seen = HashSet::new();
    let explosion_range_sq = (radius + HELI_HITBOX_HALF_X + 2.0).powi(2);

    for &target_vehicle_id in hit_vehicles {
        if target_vehicle_id == self_vehicle_id {
            continue;
        }
        if !seen.insert(target_vehicle_id) {
            continue;
        }

        let Some(entity) = ctx.db.entity().id().find(&target_vehicle_id) else {
            continue;
        };
        if !entity.active
            || entity.kind != ENTITY_KIND_VEHICLE
            || entity.subtype != VEHICLE_TYPE_HELICOPTER
        {
            continue;
        }

        let center = Vec3 {
            x: entity.pos.x,
            y: entity.pos.y + HELI_HITBOX_CENTER_Y,
            z: entity.pos.z,
        };
        if dist_sq(impact_pos, &center) > explosion_range_sq {
            continue;
        }

        apply_vehicle_damage(
            ctx,
            sender,
            target_vehicle_id,
            damage,
            weapon,
            impact_pos.clone(),
        );
    }
}

/// Resolve a kill: increment stats and emit kill event.
pub fn resolve_kill(ctx: &ReducerContext, killer: Identity, victim: Identity, weapon: u8) {
    if let Some(attacker) = ctx.db.player().identity().find(killer) {
        ctx.db.player().identity().update(Player {
            kills: attacker.kills + 1,
            ..attacker
        });
    }
    if let Some(dead) = ctx.db.player().identity().find(victim) {
        ctx.db.player().identity().update(Player {
            deaths: dead.deaths + 1,
            ..dead
        });
    }
    emit_kill_event(ctx, killer, victim, weapon);
}

/// Validate and destroy blocks, run structural check.
pub fn destroy_and_check_blocks(
    ctx: &ReducerContext,
    origin: &Vec3,
    hit_blocks: &[Vec3],
    max_range: f32,
) -> Vec<(i32, i32, i32, u8)> {
    use crate::chunks::{destroy_blocks_in_world, run_structural_check};

    if hit_blocks.len() > 500 {
        return Vec::new();
    }

    let block_coords: Vec<(i32, i32, i32)> = hit_blocks
        .iter()
        .filter(|block| {
            block_in_bounds(block.x as i32, block.y as i32, block.z as i32)
                && dist_sq(origin, block) <= max_range * max_range
        })
        .map(|b| (b.x as i32, b.y as i32, b.z as i32))
        .collect();

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    actually_destroyed
}

/// Determine shot hit position for remote VFX.
pub fn determine_hit_pos(
    ctx: &ReducerContext,
    actually_destroyed: &[(i32, i32, i32, u8)],
    hit_players: &[Identity],
    vehicle_hit_pos: Option<Vec3>,
) -> (Vec3, bool) {
    if !actually_destroyed.is_empty() {
        let first = &actually_destroyed[0];
        (
            Vec3 {
                x: first.0 as f32,
                y: first.1 as f32,
                z: first.2 as f32,
            },
            true,
        )
    } else if !hit_players.is_empty() {
        if let Some(target) = ctx.db.player().identity().find(hit_players[0]) {
            (target.pos.clone(), true)
        } else {
            (ZERO_VEL, false)
        }
    } else if let Some(vhp) = vehicle_hit_pos {
        (vhp, true)
    } else {
        (ZERO_VEL, false)
    }
}

/// Emit explosion event with destroyed blocks.
pub fn emit_explosion(
    ctx: &ReducerContext,
    sender: Identity,
    pos: &Vec3,
    radius: f32,
    weapon: u8,
    actually_destroyed: &[(i32, i32, i32, u8)],
) {
    ctx.db.explosion_event().insert(ExplosionEvent {
        id: 0,
        origin: sender,
        pos: pos.clone(),
        radius,
        weapon,
        destroyed_blocks: actually_destroyed
            .iter()
            .map(|&(x, y, z, bt)| DestroyedBlock {
                x: x as f32,
                y: y as f32,
                z: z as f32,
                block_type: bt,
            })
            .collect(),
        created_at: ctx.timestamp,
    });
    crate::grenades::push_grenades_from_explosion(ctx, pos, radius, 0);
}
