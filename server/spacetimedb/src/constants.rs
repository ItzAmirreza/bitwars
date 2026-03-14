// ── Game Constants ──
// All tuning parameters and magic numbers live here.

use crate::types::Vec3;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

// ── Spawn & Player ──

pub const SPAWN_POS: Vec3 = Vec3 {
    x: WORLD_SIZE_X as f32 / 2.0,
    y: 20.0,
    z: WORLD_SIZE_Z as f32 / 2.0,
};
pub const MAX_HEALTH: i32 = 100;
pub const HEALTH_REGEN_RATE: i32 = 5;
pub const HEALTH_REGEN_DELAY_SECS: u64 = 10;
pub const MAX_MOVEMENT_SPEED: f32 = 35.0;
pub const SPEED_VIOLATION_THRESHOLD: u32 = 10;
pub const PLAYER_EYE_HEIGHT: f32 = 1.7;
pub const PLAYER_FOOT_RADIUS: f32 = 0.29;
pub const DEFAULT_LOADOUT: [u8; 3] = [0, 1, 2];
pub const NUM_CHARACTER_PRESETS: u8 = 5;

// ── Entity Kinds ──

pub const ENTITY_KIND_PLAYER: u8 = 1;
pub const ENTITY_KIND_VEHICLE: u8 = 2;

// ── Grenade Physics ──

pub const GRENADE_TICK_INTERVAL_MS: u64 = 33;
pub const GRENADE_GRAVITY: f32 = 18.0;
pub const GRENADE_FUSE_MS: u32 = 5000;
pub const GRENADE_BOUNCE_RESTITUTION: f32 = 0.45;
pub const GRENADE_BOUNCE_FRICTION: f32 = 0.7;
pub const GRENADE_GROUND_FRICTION: f32 = 0.96;
pub const GRENADE_MIN_BOUNCE_VEL: f32 = 1.5;
pub const GRENADE_RADIUS: f32 = 0.19;
pub const GRENADE_WEAPON_INDEX: u8 = 4;

// ── Helicopter ──

pub const VEHICLE_TYPE_HELICOPTER: u8 = 0;
pub const SANDBOX_HELICOPTER_COUNT: usize = 1;
pub const HELI_SPAWN_CLEARANCE_RADIUS: i32 = 4;
pub const HELI_SPAWN_CLEARANCE_HEIGHT: i32 = 7;
pub const HELI_SPAWN_MIN_SEPARATION: f32 = 28.0;
pub const HELI_SCALE: f32 = 1.85;
pub const HELI_MOUNT_RANGE: f32 = 8.5;
pub const HELI_MIN_ALTITUDE_FROM_GROUND: f32 = 0.0;
pub const HELI_MAX_ALTITUDE: f32 = 96.0;
pub const HELI_TICK_INTERVAL_MS: u64 = 33;
pub const HELI_CRUISE_SPEED: f32 = 34.0;
pub const HELI_STRAFE_SPEED: f32 = 22.0;
pub const HELI_LIFT_SPEED: f32 = 16.0;
pub const HELI_MAX_YAW_RATE: f32 = 5.2;
pub const HELI_MAX_PITCH_RATE: f32 = 4.2;
pub const HELI_PILOT_SEAT_HEIGHT: f32 = 1.8;
pub const HELI_HEALTH_MAX: i32 = 1000;
pub const HELI_HITBOX_CENTER_Y: f32 = 2.5;
pub const HELI_HITBOX_HALF_X: f32 = 6.4;
pub const HELI_HITBOX_HALF_Y: f32 = 1.25;
pub const HELI_HITBOX_HALF_Z: f32 = 4.9;

// ── Combat Validation ──

/// God mode sentinel: max_health >= this means invulnerable.
pub const GOD_MODE_HEALTH: i32 = 9999;
/// Fire rate tolerance in microseconds (client-server clock drift allowance).
pub const FIRE_RATE_TOLERANCE_US: u64 = 150_000;
/// Max origin distance squared for infantry shots.
pub const MAX_SHOT_ORIGIN_DIST_SQ: f32 = 25.0;
/// Max origin distance squared for vehicle shots.
pub const MAX_VEHICLE_SHOT_ORIGIN_DIST_SQ: f32 = 225.0;
/// Max blocks per destroy_blocks_physics call.
pub const MAX_BLOCK_DESTROY_PER_CALL: usize = 500;
/// Max range for block destruction from player position.
pub const MAX_BLOCK_DESTROY_RANGE: f32 = 40.0;
/// Hitscan direction dot product threshold (infantry vs player).
pub const HITSCAN_DOT_THRESHOLD_PLAYER: f32 = 0.5;
/// Hitscan direction dot product threshold (infantry vs vehicle).
pub const HITSCAN_DOT_THRESHOLD_VEHICLE: f32 = 0.35;

// ── Weather Presets ──

pub struct WeatherPreset {
    pub name: &'static str,
    pub cloud_density: f32,
    pub fog_density: f32,
    pub wind_speed: f32,
}

pub const WEATHER_PRESETS: [WeatherPreset; 5] = [
    WeatherPreset {
        name: "Clear",
        cloud_density: 0.1,
        fog_density: 0.6,
        wind_speed: 0.1,
    },
    WeatherPreset {
        name: "Cloudy",
        cloud_density: 0.5,
        fog_density: 0.8,
        wind_speed: 0.3,
    },
    WeatherPreset {
        name: "Overcast",
        cloud_density: 0.8,
        fog_density: 1.2,
        wind_speed: 0.4,
    },
    WeatherPreset {
        name: "Rainy",
        cloud_density: 0.7,
        fog_density: 1.5,
        wind_speed: 0.5,
    },
    WeatherPreset {
        name: "Stormy",
        cloud_density: 0.9,
        fog_density: 1.8,
        wind_speed: 0.8,
    },
];

pub const NUM_WEATHER_TYPES: u8 = 5;
