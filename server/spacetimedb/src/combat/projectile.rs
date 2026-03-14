// ── Projectile Impact Reducer ──
// Server-side projectile hit resolution (RPG, etc).

use spacetimedb::{reducer, Identity, ReducerContext};

use crate::combat::damage::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;
use crate::weapons;

#[reducer]
pub fn projectile_impact(
    ctx: &ReducerContext,
    shot_origin: Vec3,
    impact_pos: Vec3,
    _direction: Vec3,
    weapon: u8,
    travel_time_ms: u32,
    hit_players: Vec<Identity>,
    hit_vehicles: Vec<u64>,
    hit_blocks: Vec<Vec3>,
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

    // Shared travel time validation
    weapons::validate_travel_time(
        &shot_origin,
        &impact_pos,
        def.projectile_speed,
        travel_time_ms,
    );

    let max_range = def.max_range + 10.0;
    if dist_sq(&shot_origin, &impact_pos) > max_range * max_range {
        return Err("Impact too far from origin".to_string());
    }

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

    let actually_destroyed =
        destroy_and_check_blocks(ctx, &impact_pos, &hit_blocks, def.radius + 5.0);

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
