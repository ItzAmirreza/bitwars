// ── Vehicle Destruction Explosion ──
// Shared "huge explosion" emitted when any vehicle is destroyed (weapon damage
// or a fatal block collision). Unlike the previous cosmetic-only blast, this
// actually carves a TNT-style crater out of the surrounding world and splash-
// damages nearby players and vehicles. All clients render the blast + flying
// debris from the `destroyed_blocks` list on the emitted ExplosionEvent.

use spacetimedb::{Identity, ReducerContext, Table};

use super::damage::{apply_splash_player_damage, apply_splash_vehicle_damage, emit_explosion};
use super::projectile::destroy_spherical_blocks;
use crate::constants::*;
use crate::helpers::*;
use crate::tables::*;
use crate::types::*;

/// Detonate a destroyed vehicle: destroy a sphere of surrounding blocks, splash
/// nearby players/vehicles, and broadcast the explosion to every client.
///
/// `origin` is credited with any resulting kills (the attacker, or the pilot for
/// a self-inflicted crash). `self_vehicle_id` is excluded from the vehicle splash
/// so the wreck never damages itself.
///
/// Call this BEFORE dismounting the wreck's occupants: still-mounted players are
/// shielded from splash, so a crew is never killed by the blast that ejected them.
pub fn emit_vehicle_destruction_explosion(
    ctx: &ReducerContext,
    origin: Identity,
    self_vehicle_id: u64,
    center: &Vec3,
) {
    let radius = vehicle_destruction_explosion_radius();
    let damage = vehicle_destruction_splash_damage();
    // Reuse the grenade VFX/audio profile so the originating client also renders
    // the blast (grenades are server-authoritative and never skipped client-side).
    let weapon = grenade_weapon_index();

    // Carve the crater (server-authoritative sphere, capped per call).
    let actually_destroyed = destroy_spherical_blocks(ctx, center, radius, radius);

    // Splash nearby players (mounted players are shielded inside the helper).
    let player_ids: Vec<Identity> = ctx
        .db
        .player()
        .iter()
        .filter(|p| {
            p.health > 0 && p.online && !p.spawn_protected && p.max_health < god_mode_health()
        })
        .filter(|p| dist_sq(center, &p.pos) <= (radius + 5.0).powi(2))
        .map(|p| p.identity)
        .collect();
    apply_splash_player_damage(
        ctx,
        origin,
        center,
        &player_ids,
        damage,
        radius,
        weapon,
        None,
        0.0,
        1.0,
    );

    // Splash nearby vehicles (can chain-detonate; each vehicle dies at most once
    // because a destroyed vehicle has health 0 and is skipped on re-entry).
    let vehicle_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();
    apply_splash_vehicle_damage(
        ctx,
        origin,
        center,
        &vehicle_ids,
        self_vehicle_id,
        damage,
        radius,
        weapon,
        None,
        0.0,
        1.0,
    );

    // Broadcast the blast (with destroyed blocks) so all clients render VFX +
    // debris. emit_explosion also pushes loose grenades away from the blast.
    emit_explosion(ctx, origin, center, radius, weapon, &actually_destroyed);
}
