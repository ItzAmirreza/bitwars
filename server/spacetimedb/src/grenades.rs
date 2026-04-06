// ── Grenade Physics ──
// Server-authoritative grenade simulation: bounce, fuse, detonation.

use std::time::Duration;

use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table};

use crate::chunks::{destroy_blocks_in_world, run_structural_check};
use crate::combat::projectile::collect_capped_ellipsoid_block_coords;
use crate::combat::{apply_splash_player_damage, apply_splash_vehicle_damage};
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;
use crate::worldgen::{AIR, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z};

/// Push all nearby grenades away from an explosion.
pub fn push_grenades_from_explosion(
    ctx: &ReducerContext,
    pos: &Vec3,
    radius: f32,
    exclude_grenade_id: u64,
) {
    let push_range = radius + 3.0;
    let push_range_sq = push_range * push_range;
    let other_grenades: Vec<GrenadeProjectile> = ctx
        .db
        .grenade_projectile()
        .iter()
        .filter(|g| g.id != exclude_grenade_id && dist_sq(pos, &g.pos) <= push_range_sq)
        .collect();
    for other in other_grenades {
        let dx = other.pos.x - pos.x;
        let dy = other.pos.y - pos.y;
        let dz = other.pos.z - pos.z;
        let dist = (dx * dx + dy * dy + dz * dz).sqrt().max(0.5);
        let force = (1.0 - dist / push_range).max(0.0) * 25.0;
        let nx = dx / dist;
        let ny = (dy / dist).max(0.3);
        let nz = dz / dist;
        ctx.db.grenade_projectile().id().update(GrenadeProjectile {
            vel: Vec3 {
                x: other.vel.x + nx * force,
                y: other.vel.y + ny * force,
                z: other.vel.z + nz * force,
            },
            ..other
        });
    }
}

/// Explode a single grenade: damage, blocks, VFX.
fn explode_grenade(ctx: &ReducerContext, grenade: &GrenadeProjectile) {
    let def = weapons::get_weapon(grenade_weapon_index());
    let pos = &grenade.pos;
    let owner = grenade.owner;

    // Damage players
    let players: Vec<Player> = ctx.db.player().iter().collect();
    let player_ids: Vec<Identity> = players
        .iter()
        .filter(|p| {
            p.health > 0 && p.online && !p.spawn_protected && p.max_health < god_mode_health()
        })
        .filter(|p| dist_sq(pos, &p.pos) <= (def.radius + 2.0).powi(2))
        .map(|p| p.identity)
        .collect();
    apply_splash_player_damage(
        ctx,
        owner,
        pos,
        &player_ids,
        def.damage,
        def.radius,
        grenade_weapon_index(),
        None,
        0.0,
        1.0,
    );

    // Damage vehicles
    let vehicle_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();
    apply_splash_vehicle_damage(
        ctx,
        owner,
        pos,
        &vehicle_ids,
        0,
        def.damage,
        def.radius,
        grenade_weapon_index(),
        None,
        0.0,
        1.0,
    );

    // Destroy blocks
    let r = def.radius;
    let block_coords =
        collect_capped_ellipsoid_block_coords(pos, r, r, max_block_destroy_per_call());
    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    // Emit explosion event
    ctx.db.explosion_event().insert(ExplosionEvent {
        id: 0,
        origin: owner,
        pos: pos.clone(),
        radius: def.radius,
        weapon: grenade_weapon_index(),
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

    push_grenades_from_explosion(ctx, pos, def.radius, grenade.id);
}

/// Scheduled grenade physics tick.
#[reducer]
pub fn tick_grenades(ctx: &ReducerContext, _job: GrenadeTick) {
    let dt = grenade_tick_interval_ms() as f32 / 1000.0;
    let tick_ms = grenade_tick_interval_ms() as u32;

    let grenades: Vec<GrenadeProjectile> = ctx.db.grenade_projectile().iter().collect();

    for mut g in grenades {
        if g.fuse_remaining_ms <= tick_ms {
            explode_grenade(ctx, &g);
            ctx.db.grenade_projectile().id().delete(&g.id);
            continue;
        }
        g.fuse_remaining_ms -= tick_ms;

        // Gravity
        g.vel.y -= grenade_gravity() * dt;

        let mut new_pos = Vec3 {
            x: g.pos.x + g.vel.x * dt,
            y: g.pos.y + g.vel.y * dt,
            z: g.pos.z + g.vel.z * dt,
        };

        let bx = new_pos.x.floor() as i32;
        let bz = new_pos.z.floor() as i32;

        // Y collision
        let block_below =
            get_block_type(ctx, bx, (new_pos.y - grenade_radius()).floor() as i32, bz);
        let block_above = get_block_type(ctx, bx, (new_pos.y + grenade_radius()).ceil() as i32, bz);
        if matches!(block_below, Some(bt) if bt != AIR) && g.vel.y < 0.0 {
            new_pos.y = (new_pos.y - grenade_radius()).floor() as f32 + 1.0 + grenade_radius();
            if g.vel.y.abs() < grenade_min_bounce_vel() {
                g.vel.y = 0.0;
                g.vel.x *= grenade_ground_friction();
                g.vel.z *= grenade_ground_friction();
            } else {
                g.vel.y = -g.vel.y * grenade_bounce_restitution();
                g.vel.x *= grenade_bounce_friction();
                g.vel.z *= grenade_bounce_friction();
            }
        } else if matches!(block_above, Some(bt) if bt != AIR) && g.vel.y > 0.0 {
            new_pos.y = (new_pos.y + grenade_radius()).ceil() as f32 - grenade_radius();
            g.vel.y = -g.vel.y * grenade_bounce_restitution();
        }

        // X collision
        let check_x_neg = get_block_type(
            ctx,
            (new_pos.x - grenade_radius()).floor() as i32,
            new_pos.y.floor() as i32,
            bz,
        );
        let check_x_pos = get_block_type(
            ctx,
            (new_pos.x + grenade_radius()).ceil() as i32,
            new_pos.y.floor() as i32,
            bz,
        );
        if matches!(check_x_neg, Some(bt) if bt != AIR) && g.vel.x < 0.0 {
            new_pos.x = (new_pos.x - grenade_radius()).floor() as f32 + 1.0 + grenade_radius();
            g.vel.x = -g.vel.x * grenade_bounce_restitution();
            g.vel.z *= grenade_bounce_friction();
        } else if matches!(check_x_pos, Some(bt) if bt != AIR) && g.vel.x > 0.0 {
            new_pos.x = (new_pos.x + grenade_radius()).ceil() as f32 - grenade_radius();
            g.vel.x = -g.vel.x * grenade_bounce_restitution();
            g.vel.z *= grenade_bounce_friction();
        }

        // Z collision
        let check_z_neg = get_block_type(
            ctx,
            bx,
            new_pos.y.floor() as i32,
            (new_pos.z - grenade_radius()).floor() as i32,
        );
        let check_z_pos = get_block_type(
            ctx,
            bx,
            new_pos.y.floor() as i32,
            (new_pos.z + grenade_radius()).ceil() as i32,
        );
        if matches!(check_z_neg, Some(bt) if bt != AIR) && g.vel.z < 0.0 {
            new_pos.z = (new_pos.z - grenade_radius()).floor() as f32 + 1.0 + grenade_radius();
            g.vel.z = -g.vel.z * grenade_bounce_restitution();
            g.vel.x *= grenade_bounce_friction();
        } else if matches!(check_z_pos, Some(bt) if bt != AIR) && g.vel.z > 0.0 {
            new_pos.z = (new_pos.z + grenade_radius()).ceil() as f32 - grenade_radius();
            g.vel.z = -g.vel.z * grenade_bounce_restitution();
            g.vel.x *= grenade_bounce_friction();
        }

        // World bounds
        new_pos.x = new_pos.x.clamp(0.5, WORLD_SIZE_X as f32 - 0.5);
        new_pos.z = new_pos.z.clamp(0.5, WORLD_SIZE_Z as f32 - 0.5);

        if new_pos.y < -5.0 {
            explode_grenade(ctx, &g);
            ctx.db.grenade_projectile().id().delete(&g.id);
            continue;
        }

        if new_pos.y > WORLD_SIZE_Y as f32 + 20.0 {
            new_pos.y = WORLD_SIZE_Y as f32 + 20.0;
            if g.vel.y > 0.0 {
                g.vel.y = -g.vel.y * grenade_bounce_restitution();
            }
        }

        let speed_sq = g.vel.x * g.vel.x + g.vel.z * g.vel.z;
        if speed_sq < 0.01 {
            g.vel.x = 0.0;
            g.vel.z = 0.0;
        }

        g.pos = new_pos;
        ctx.db.grenade_projectile().id().update(g);
    }

    ctx.db.grenade_tick().insert(GrenadeTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(
            ctx.timestamp + Duration::from_millis(grenade_tick_interval_ms()),
        ),
    });
}
