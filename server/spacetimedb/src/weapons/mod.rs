// ── Weapon Registry ──
// Weapon stats are sourced from shared/game-constants.json at compile time.
// Per-weapon .rs files are kept for any weapon-specific logic (special behaviors).

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

// ── Vehicle Weapon Definition ──

pub struct VehicleWeaponDef {
    pub name: &'static str,
    pub index: u8,
    pub damage: i32,
    pub player_damage_scale: f32,
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
    /// Damage scaled for hitting infantry players (lower than vehicle-vs-vehicle).
    pub fn player_damage(&self) -> i32 {
        ((self.damage as f32) * self.player_damage_scale).round() as i32
    }
}

// ── Registry (runtime-initialized from shared JSON) ──

use std::sync::OnceLock;

fn parse_delivery(s: &str) -> DeliveryMethod {
    match s {
        "hitscan" => DeliveryMethod::Hitscan,
        "projectile" => DeliveryMethod::Projectile,
        "server_projectile" => DeliveryMethod::ServerProjectile,
        other => panic!("Unknown delivery method in game-constants.json: {}", other),
    }
}

static WEAPONS: OnceLock<Vec<WeaponDef>> = OnceLock::new();
static VEHICLE_WEAPONS: OnceLock<Vec<VehicleWeaponDef>> = OnceLock::new();

fn weapons_registry() -> &'static [WeaponDef] {
    WEAPONS.get_or_init(|| {
        let cfg = crate::shared_config::config();
        cfg.weapons
            .iter()
            .map(|w| WeaponDef {
                name: Box::leak(w.name.clone().into_boxed_str()),
                index: w.index,
                damage: w.damage,
                radius: w.radius,
                fire_rate: w.fire_rate,
                max_ammo: w.max_ammo,
                max_range: w.max_range,
                projectile_speed: w.projectile_speed,
                delivery: parse_delivery(&w.delivery),
            })
            .collect()
    })
}

fn vehicle_weapons_registry() -> &'static [VehicleWeaponDef] {
    VEHICLE_WEAPONS.get_or_init(|| {
        let cfg = crate::shared_config::config();
        cfg.vehicle_weapons
            .iter()
            .map(|w| VehicleWeaponDef {
                name: Box::leak(w.name.clone().into_boxed_str()),
                index: w.index,
                damage: w.damage,
                player_damage_scale: w.player_damage_scale,
                radius: w.radius,
                fire_rate: w.fire_rate,
                max_ammo: w.max_ammo,
                max_range: w.max_range,
                projectile_speed: w.projectile_speed,
                gravity: w.gravity,
                delivery: parse_delivery(&w.delivery),
            })
            .collect()
    })
}

/// Number of infantry weapons. Sourced from shared/game-constants.json.
pub fn num_weapons() -> u8 {
    weapons_registry().len() as u8
}

/// Number of vehicle weapons. Sourced from shared/game-constants.json.
pub fn num_vehicle_weapons() -> u8 {
    vehicle_weapons_registry().len() as u8
}

pub fn get_weapon(index: u8) -> &'static WeaponDef {
    &weapons_registry()[index as usize]
}

pub fn get_vehicle_weapon(index: u8) -> &'static VehicleWeaponDef {
    &vehicle_weapons_registry()[index as usize]
}

pub fn shot_event_retention_us(weapon_code: u8) -> u64 {
    const HITSCAN_RETENTION_US: u64 = 2_000_000;
    const PROJECTILE_GRACE_US: u64 = 2_000_000;
    const MIN_PROJECTILE_RETENTION_US: u64 = 4_000_000;
    const MAX_PROJECTILE_RETENTION_US: u64 = 12_000_000;

    let (delivery, max_range, projectile_speed) = if weapon_code >= 100 {
        let vehicle_index = weapon_code - 100;
        if vehicle_index >= num_vehicle_weapons() {
            return HITSCAN_RETENTION_US;
        }
        let def = get_vehicle_weapon(vehicle_index);
        (def.delivery, def.max_range, def.projectile_speed)
    } else {
        if weapon_code >= num_weapons() {
            return HITSCAN_RETENTION_US;
        }
        let def = get_weapon(weapon_code);
        (def.delivery, def.max_range, def.projectile_speed)
    };

    if delivery == DeliveryMethod::Hitscan || projectile_speed <= 0.01 {
        return HITSCAN_RETENTION_US;
    }

    let expected_flight_us = ((max_range / projectile_speed) * 1_000_000.0).ceil() as u64;
    (expected_flight_us + PROJECTILE_GRACE_US)
        .clamp(MIN_PROJECTILE_RETENTION_US, MAX_PROJECTILE_RETENTION_US)
}

// ── Normalized Ammo Accessors ──
// These work with the PlayerAmmo table (1 row per player+weapon).
// Adding a new weapon does NOT require changes here.

pub fn get_ammo(ctx: &ReducerContext, identity: Identity, weapon: u8) -> i32 {
    for row in ctx.db.player_ammo().idx_ammo_identity().filter(&identity) {
        if row.weapon_index == weapon {
            return row.ammo;
        }
    }
    0
}

pub fn set_ammo(ctx: &ReducerContext, identity: Identity, weapon: u8, ammo: i32) {
    for row in ctx.db.player_ammo().idx_ammo_identity().filter(&identity) {
        if row.weapon_index == weapon {
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
    for def in weapons_registry() {
        let has_row = ctx
            .db
            .player_ammo()
            .idx_ammo_identity()
            .filter(&identity)
            .any(|r| r.weapon_index == def.index);
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
    for def in weapons_registry() {
        set_ammo(ctx, identity, def.index, def.max_ammo);
    }
}

/// Set all ammo to a specific value (admin /ammo).
pub fn set_all_ammo_value(ctx: &ReducerContext, identity: Identity, value: i32) {
    for def in weapons_registry() {
        set_ammo(ctx, identity, def.index, value);
    }
}

// ── Shared Fire Validation ──
// Extracted from fire_weapon and fire_vehicle_weapon to eliminate duplication.

use crate::helpers::timestamp_micros;

/// Check fire rate cooldown. Returns Err if firing too fast.
pub fn check_fire_rate(
    ctx: &ReducerContext,
    last_fire: Timestamp,
    fire_rate: f32,
) -> Result<(), String> {
    let fire_rate_tolerance_us = crate::constants::fire_rate_tolerance_us();
    let now_us = timestamp_micros(ctx.timestamp);
    let last_us = timestamp_micros(last_fire);
    let cooldown_us = (1_000_000.0 / fire_rate) as u64;
    if now_us.saturating_sub(last_us) < cooldown_us.saturating_sub(fire_rate_tolerance_us) {
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
