// ── Weapon Registry ──
// To add a new weapon:
//   1. Create a new file (e.g. weapons/flamethrower.rs)
//   2. Define `pub const DEF: WeaponDef = WeaponDef { ... }`
//   3. Add `pub mod flamethrower;` here
//   4. Add it to WEAPON_REGISTRY
//   That's it. Ammo storage is normalized — no schema changes needed.

pub mod grenade_launcher;
pub mod machinegun;
pub mod rifle;
pub mod rpg;
pub mod shotgun;
pub mod vehicle_minigun;
pub mod vehicle_rockets;

use spacetimedb::{Identity, ReducerContext, Table, Timestamp};

use crate::tables::*;

// ── Delivery Method ──

#[derive(Clone, Copy, PartialEq)]
pub enum DeliveryMethod {
    Hitscan,
    Projectile,
    ServerProjectile,
}

// ── Infantry Weapon Definition ──

pub struct WeaponDef {
    pub name: &'static str,
    pub index: u8,
    pub damage: i32,
    pub radius: f32,
    pub fire_rate: f32,
    pub max_ammo: i32,
    pub max_range: f32,
    pub projectile_speed: f32,
    pub delivery: DeliveryMethod,
}

impl WeaponDef {
    pub fn is_hitscan(&self) -> bool {
        self.delivery == DeliveryMethod::Hitscan
    }
    pub fn is_projectile(&self) -> bool {
        matches!(
            self.delivery,
            DeliveryMethod::Projectile | DeliveryMethod::ServerProjectile
        )
    }
    pub fn is_server_projectile(&self) -> bool {
        self.delivery == DeliveryMethod::ServerProjectile
    }
}

// ── Weapon Registry ──

pub const NUM_WEAPONS: u8 = 5;

pub const WEAPON_REGISTRY: [&WeaponDef; 5] = [
    &rifle::DEF,
    &shotgun::DEF,
    &rpg::DEF,
    &machinegun::DEF,
    &grenade_launcher::DEF,
];

pub fn get_weapon(index: u8) -> &'static WeaponDef {
    WEAPON_REGISTRY[index as usize]
}

// ── Vehicle Weapon Definition ──

pub struct VehicleWeaponDef {
    pub name: &'static str,
    pub index: u8,
    pub damage: i32,
    pub radius: f32,
    pub fire_rate: f32,
    pub max_ammo: i32,
    pub max_range: f32,
    pub projectile_speed: f32,
    pub gravity: f32,
    pub delivery: DeliveryMethod,
}

impl VehicleWeaponDef {
    pub fn is_hitscan(&self) -> bool {
        self.delivery == DeliveryMethod::Hitscan
    }
}

pub const NUM_VEHICLE_WEAPONS: u8 = 2;

pub const VEHICLE_WEAPON_REGISTRY: [&VehicleWeaponDef; 2] =
    [&vehicle_minigun::DEF, &vehicle_rockets::DEF];

pub fn get_vehicle_weapon(index: u8) -> &'static VehicleWeaponDef {
    VEHICLE_WEAPON_REGISTRY[index as usize]
}

// ── Normalized Ammo Accessors ──
// These work with the PlayerAmmo table (1 row per player+weapon).
// Adding a new weapon does NOT require changes here.

pub fn get_ammo(ctx: &ReducerContext, identity: Identity, weapon: u8) -> i32 {
    for row in ctx.db.player_ammo().iter() {
        if row.identity == identity && row.weapon_index == weapon {
            return row.ammo;
        }
    }
    0
}

pub fn set_ammo(ctx: &ReducerContext, identity: Identity, weapon: u8, ammo: i32) {
    for row in ctx.db.player_ammo().iter() {
        if row.identity == identity && row.weapon_index == weapon {
            ctx.db.player_ammo().id().update(PlayerAmmo { ammo, ..row });
            return;
        }
    }
    // Row doesn't exist yet — create it
    ctx.db.player_ammo().insert(PlayerAmmo {
        id: 0,
        identity,
        weapon_index: weapon,
        ammo,
    });
}

/// Get the last fire time for a player.
pub fn get_last_fire_time(ctx: &ReducerContext, identity: Identity) -> Timestamp {
    ctx.db
        .player_fire_state()
        .identity()
        .find(identity)
        .map(|s| s.last_fire_time)
        .unwrap_or(ctx.timestamp)
}

/// Update the last fire time.
pub fn set_last_fire_time(ctx: &ReducerContext, identity: Identity) {
    if let Some(state) = ctx.db.player_fire_state().identity().find(identity) {
        ctx.db
            .player_fire_state()
            .identity()
            .update(PlayerFireState {
                last_fire_time: ctx.timestamp,
                ..state
            });
    } else {
        ctx.db.player_fire_state().insert(PlayerFireState {
            identity,
            last_fire_time: ctx.timestamp,
        });
    }
}

/// Initialize all ammo for a player from the weapon registry. Idempotent.
pub fn init_all_ammo(ctx: &ReducerContext, identity: Identity) {
    // Fire state
    if ctx
        .db
        .player_fire_state()
        .identity()
        .find(identity)
        .is_none()
    {
        ctx.db.player_fire_state().insert(PlayerFireState {
            identity,
            last_fire_time: ctx.timestamp,
        });
    }

    // Create ammo rows for any weapons that don't have one yet
    for def in WEAPON_REGISTRY {
        let has_row = ctx
            .db
            .player_ammo()
            .iter()
            .any(|r| r.identity == identity && r.weapon_index == def.index);
        if !has_row {
            ctx.db.player_ammo().insert(PlayerAmmo {
                id: 0,
                identity,
                weapon_index: def.index,
                ammo: def.max_ammo,
            });
        }
    }
}

/// Reset all ammo to max for a player (respawn / reload all).
pub fn reset_all_ammo(ctx: &ReducerContext, identity: Identity) {
    for def in WEAPON_REGISTRY {
        set_ammo(ctx, identity, def.index, def.max_ammo);
    }
}

/// Set all ammo to a specific value (admin /ammo).
pub fn set_all_ammo_value(ctx: &ReducerContext, identity: Identity, value: i32) {
    for def in WEAPON_REGISTRY {
        set_ammo(ctx, identity, def.index, value);
    }
}

// ── Shared Fire Validation ──
// Extracted from fire_weapon and fire_vehicle_weapon to eliminate duplication.

use crate::constants::FIRE_RATE_TOLERANCE_US;
use crate::helpers::timestamp_micros;

/// Check fire rate cooldown. Returns Err if firing too fast.
pub fn check_fire_rate(
    ctx: &ReducerContext,
    last_fire: Timestamp,
    fire_rate: f32,
) -> Result<(), String> {
    let now_us = timestamp_micros(ctx.timestamp);
    let last_us = timestamp_micros(last_fire);
    let cooldown_us = (1_000_000.0 / fire_rate) as u64;
    if now_us.saturating_sub(last_us) < cooldown_us.saturating_sub(FIRE_RATE_TOLERANCE_US) {
        return Err("Firing too fast".to_string());
    }
    Ok(())
}

/// Validate projectile travel time. Logs warning if suspicious but doesn't reject.
pub fn validate_travel_time(
    shot_origin: &crate::types::Vec3,
    impact_pos: &crate::types::Vec3,
    projectile_speed: f32,
    travel_time_ms: u32,
) {
    let dx = impact_pos.x - shot_origin.x;
    let dy = impact_pos.y - shot_origin.y;
    let dz = impact_pos.z - shot_origin.z;
    let distance = (dx * dx + dy * dy + dz * dz).sqrt();
    let expected_time_ms = (distance / projectile_speed * 1000.0) as u32;
    let min_time = expected_time_ms / 2;
    let max_time = expected_time_ms.saturating_mul(3).max(500);
    if travel_time_ms < min_time || travel_time_ms > max_time {
        log::warn!(
            "Projectile travel time mismatch: got {}ms, expected ~{}ms (dist={:.1})",
            travel_time_ms,
            expected_time_ms,
            distance
        );
    }
}
