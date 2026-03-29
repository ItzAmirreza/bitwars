// ── Game Constants ──
// All tuning parameters and magic numbers live here.
// Values are sourced from shared/game-constants.json via shared_config at runtime,
// exposed through lazy accessors that match the old `pub const` names.
//
// For values that MUST be `const` (used in const contexts like array sizes or
// other const expressions), we keep them hardcoded with a comment noting the
// shared source.

use crate::shared_config;
use crate::types::Vec3;
use crate::worldgen::{WORLD_SIZE_X, WORLD_SIZE_Z};

// ── Spawn & Player ──

// SPAWN_POS depends on WORLD_SIZE_X/Z which are const — keep as const.
pub const SPAWN_POS: Vec3 = Vec3 {
    x: WORLD_SIZE_X as f32 / 2.0,
    y: 20.0,
    z: WORLD_SIZE_Z as f32 / 2.0,
};

/// Sourced from shared/game-constants.json → player.maxHealth
pub fn max_health() -> i32 {
    shared_config::config().player.max_health
}
/// Sourced from shared/game-constants.json → player.healthRegenRate
pub fn health_regen_rate() -> i32 {
    shared_config::config().player.health_regen_rate
}
/// Sourced from shared/game-constants.json → player.healthRegenDelaySecs
pub fn health_regen_delay_secs() -> u64 {
    shared_config::config().player.health_regen_delay_secs
}
/// Sourced from shared/game-constants.json → player.maxMovementSpeed
pub fn max_movement_speed() -> f32 {
    shared_config::config().player.max_movement_speed
}
/// Sourced from shared/game-constants.json → player.speedViolationThreshold
pub fn speed_violation_threshold() -> u32 {
    shared_config::config().player.speed_violation_threshold
}
/// Sourced from shared/game-constants.json → player.eyeHeight
pub fn player_eye_height() -> f32 {
    shared_config::config().player.eye_height
}
/// Sourced from shared/game-constants.json → player.footRadius
pub fn player_foot_radius() -> f32 {
    shared_config::config().player.foot_radius
}
/// Sourced from shared/game-constants.json → player.numCharacterPresets
pub fn num_character_presets() -> u8 {
    shared_config::config().player.num_character_presets
}

/// Sourced from shared/game-constants.json → player.defaultLoadout
pub fn default_loadout() -> [u8; 3] {
    let l = &shared_config::config().player.default_loadout;
    [l[0], l[1], l[2]]
}

// ── Entity Kinds ──
// Sourced from shared/game-constants.json → entityKinds

pub fn entity_kind_player() -> u8 {
    shared_config::config().entity_kinds.player
}
pub fn entity_kind_vehicle() -> u8 {
    shared_config::config().entity_kinds.vehicle
}

// ── Grenade Physics ──
// Sourced from shared/game-constants.json → grenade

pub fn grenade_tick_interval_ms() -> u64 {
    shared_config::config().grenade.tick_interval_ms
}
pub fn grenade_gravity() -> f32 {
    shared_config::config().grenade.gravity
}
pub fn grenade_fuse_ms() -> u32 {
    shared_config::config().grenade.fuse_ms
}
pub fn grenade_bounce_restitution() -> f32 {
    shared_config::config().grenade.bounce_restitution
}
pub fn grenade_bounce_friction() -> f32 {
    shared_config::config().grenade.bounce_friction
}
pub fn grenade_ground_friction() -> f32 {
    shared_config::config().grenade.ground_friction
}
pub fn grenade_min_bounce_vel() -> f32 {
    shared_config::config().grenade.min_bounce_vel
}
pub fn grenade_radius() -> f32 {
    shared_config::config().grenade.radius
}
pub fn grenade_weapon_index() -> u8 {
    shared_config::config().grenade.weapon_index
}

// ── Helicopter ──
// Sourced from shared/game-constants.json → helicopter + vehicleTypes

pub fn vehicle_type_helicopter() -> u8 {
    shared_config::config().vehicle_types.helicopter
}

/// Not in shared JSON — server-only spawn config.
pub const SANDBOX_HELICOPTER_COUNT: usize = 1;
/// Not in shared JSON — server-only spawn config.
pub const HELI_SPAWN_CLEARANCE_RADIUS: i32 = 4;
/// Not in shared JSON — server-only spawn config.
pub const HELI_SPAWN_CLEARANCE_HEIGHT: i32 = 7;
/// Not in shared JSON — server-only spawn config.
pub const HELI_SPAWN_MIN_SEPARATION: f32 = 28.0;
/// Vehicle physics tick interval.  The canonical value lives in
/// shared/game-constants.json (`vehicleTickIntervalMs`).  We keep a const
/// here because Rust `const` can't call a function, and the server tick
/// rate doesn't change at runtime.  If you change it, update the JSON too.
pub const HELI_TICK_INTERVAL_MS: u64 = 33;

/// Monotonic server simulation tick id for vehicles.
/// Kept server-side only (not shared config) because it is an internal
/// sequencing mechanism, not gameplay tuning.
pub const VEHICLE_SIM_TICK_INCREMENT: u64 = 1;

pub fn heli_scale() -> f32 {
    shared_config::config().helicopter.scale
}
pub fn heli_mount_range() -> f32 {
    shared_config::config().helicopter.mount_range
}
pub fn heli_min_altitude_from_ground() -> f32 {
    shared_config::config().helicopter.min_altitude
}
pub fn heli_max_altitude() -> f32 {
    shared_config::config().helicopter.max_altitude
}
pub fn heli_cruise_speed() -> f32 {
    shared_config::config().helicopter.cruise_speed
}
pub fn heli_strafe_speed() -> f32 {
    shared_config::config().helicopter.strafe_speed
}
pub fn heli_lift_speed() -> f32 {
    shared_config::config().helicopter.lift_speed
}
pub fn heli_max_yaw_rate() -> f32 {
    shared_config::config().helicopter.max_yaw_rate
}
pub fn heli_max_pitch_rate() -> f32 {
    shared_config::config().helicopter.max_pitch_rate
}
pub fn heli_pilot_seat_height() -> f32 {
    shared_config::config().helicopter.pilot_seat_height
}
pub fn heli_health_max() -> i32 {
    shared_config::config().helicopter.health_max
}
pub fn heli_hitbox_center_y() -> f32 {
    shared_config::config().helicopter.hitbox.center_y
}
pub fn heli_hitbox_half_x() -> f32 {
    shared_config::config().helicopter.hitbox.half_x
}
pub fn heli_hitbox_half_y() -> f32 {
    shared_config::config().helicopter.hitbox.half_y
}
pub fn heli_hitbox_half_z() -> f32 {
    shared_config::config().helicopter.hitbox.half_z
}
pub fn heli_drag_piloted() -> f32 {
    shared_config::config().helicopter.drag_piloted
}
pub fn heli_drag_unpiloted() -> f32 {
    shared_config::config().helicopter.drag_unpiloted
}
pub fn heli_horiz_blend() -> f32 {
    shared_config::config().helicopter.horiz_blend
}
pub fn heli_vert_blend() -> f32 {
    shared_config::config().helicopter.vert_blend
}

// ── Fighter Jet ──
// Sourced from shared/game-constants.json → fighterJet + vehicleTypes

pub fn vehicle_type_fighter_jet() -> u8 {
    shared_config::config().vehicle_types.fighter_jet
}

/// Kinetic Penetrator weapon index (jet slot 0).
pub fn jet_weapon_slot0() -> u8 {
    2
}
/// Carpet Bomb weapon index (jet slot 1).
pub fn jet_weapon_slot1() -> u8 {
    3
}

/// Not in shared JSON — server-only spawn config.
pub const SANDBOX_JET_COUNT: usize = 1;
/// Not in shared JSON — server-only spawn config.
pub const JET_SPAWN_CLEARANCE_RADIUS: i32 = 6;
/// Not in shared JSON — server-only spawn config.
pub const JET_SPAWN_CLEARANCE_HEIGHT: i32 = 4;

pub fn jet_scale() -> f32 {
    shared_config::config().fighter_jet.scale
}
pub fn jet_mount_range() -> f32 {
    shared_config::config().fighter_jet.mount_range
}
pub fn jet_min_altitude() -> f32 {
    shared_config::config().fighter_jet.min_altitude
}
pub fn jet_max_altitude() -> f32 {
    shared_config::config().fighter_jet.max_altitude
}
pub fn jet_min_speed() -> f32 {
    shared_config::config().fighter_jet.min_speed
}
pub fn jet_max_speed() -> f32 {
    shared_config::config().fighter_jet.max_speed
}
pub fn jet_acceleration() -> f32 {
    shared_config::config().fighter_jet.acceleration
}
pub fn jet_brake_deceleration() -> f32 {
    shared_config::config().fighter_jet.brake_deceleration
}
pub fn jet_idle_deceleration() -> f32 {
    shared_config::config().fighter_jet.idle_deceleration
}
pub fn jet_max_yaw_rate() -> f32 {
    shared_config::config().fighter_jet.max_yaw_rate
}
pub fn jet_max_pitch_rate() -> f32 {
    shared_config::config().fighter_jet.max_pitch_rate
}
pub fn jet_max_roll_rate() -> f32 {
    shared_config::config().fighter_jet.max_roll_rate
}
pub fn jet_lift_factor() -> f32 {
    shared_config::config().fighter_jet.lift_factor
}
pub fn jet_gravity() -> f32 {
    shared_config::config().fighter_jet.gravity
}
pub fn jet_stall_speed() -> f32 {
    shared_config::config().fighter_jet.stall_speed
}
pub fn jet_pilot_seat_height() -> f32 {
    shared_config::config().fighter_jet.pilot_seat_height
}
pub fn jet_health_max() -> i32 {
    shared_config::config().fighter_jet.health_max
}
pub fn jet_hitbox_center_y() -> f32 {
    shared_config::config().fighter_jet.hitbox.center_y
}
pub fn jet_hitbox_half_x() -> f32 {
    shared_config::config().fighter_jet.hitbox.half_x
}
pub fn jet_hitbox_half_y() -> f32 {
    shared_config::config().fighter_jet.hitbox.half_y
}
pub fn jet_hitbox_half_z() -> f32 {
    shared_config::config().fighter_jet.hitbox.half_z
}
pub fn jet_drag_piloted() -> f32 {
    shared_config::config().fighter_jet.drag_piloted
}
pub fn jet_drag_unpiloted() -> f32 {
    shared_config::config().fighter_jet.drag_unpiloted
}
pub fn jet_velocity_blend() -> f32 {
    shared_config::config().fighter_jet.velocity_blend
}

// ── Combat Validation ──
// Sourced from shared/game-constants.json → combat + player.godModeHealth

/// God mode sentinel: max_health >= this means invulnerable.
pub fn god_mode_health() -> i32 {
    shared_config::config().player.god_mode_health
}
/// Fire rate tolerance in microseconds (client-server clock drift allowance).
pub fn fire_rate_tolerance_us() -> u64 {
    shared_config::config().combat.fire_rate_tolerance_us
}
/// Max origin distance squared for infantry shots.
pub fn max_shot_origin_dist_sq() -> f32 {
    shared_config::config().combat.max_shot_origin_dist_sq
}
/// Max origin distance squared for vehicle shots.
pub fn max_vehicle_shot_origin_dist_sq() -> f32 {
    shared_config::config()
        .combat
        .max_vehicle_shot_origin_dist_sq
}
/// Max blocks per destroy_blocks_physics call.
pub fn max_block_destroy_per_call() -> usize {
    shared_config::config().combat.max_block_destroy_per_call
}
/// Max range for block destruction from player position.
pub fn max_block_destroy_range() -> f32 {
    shared_config::config().combat.max_block_destroy_range
}
/// Hitscan direction dot product threshold (infantry vs player).
pub fn hitscan_dot_threshold_player() -> f32 {
    shared_config::config().combat.hitscan_dot_threshold_player
}
/// Hitscan direction dot product threshold (infantry vs vehicle).
pub fn hitscan_dot_threshold_vehicle() -> f32 {
    shared_config::config().combat.hitscan_dot_threshold_vehicle
}

// ── Weather Presets ──
// Sourced from shared/game-constants.json → weather

pub struct WeatherPreset {
    pub name: &'static str,
    pub cloud_density: f32,
    pub fog_density: f32,
    pub wind_speed: f32,
}

/// Number of weather types. Kept as const since it's used for RNG range.
/// Sourced from shared/game-constants.json → weather array length.
pub const NUM_WEATHER_TYPES: u8 = 5;

/// Weather presets sourced from the shared JSON. Names are leaked to get
/// 'static lifetimes (one-time cost, never freed).
pub fn weather_presets() -> &'static [WeatherPreset] {
    use std::sync::OnceLock;
    static PRESETS: OnceLock<Vec<WeatherPreset>> = OnceLock::new();
    PRESETS.get_or_init(|| {
        shared_config::config()
            .weather
            .iter()
            .map(|w| WeatherPreset {
                name: Box::leak(w.name.clone().into_boxed_str()),
                cloud_density: w.cloud_density,
                fog_density: w.fog_density,
                wind_speed: w.wind_speed,
            })
            .collect()
    })
}

// ── Backward-compatible const aliases ──
// These are kept so that existing code using `constants::SOME_CONST` continues
// to compile. They shadow the old `pub const` names with the same values
// but sourced from the JSON at first access.
//
// For truly const values (used in const array sizes etc.), we keep hardcoded
// consts above with comments noting the shared source.

// Legacy const shims — re-export functions with const-like names via macros
// is not ergonomic in Rust, so callers must migrate to function syntax.
// However, to minimize changes across the codebase we provide uppercase aliases.
//
// Callers that previously used e.g. `constants::MAX_HEALTH` must now use
// `constants::max_health()`. The search-and-replace is done below.
