// ── Shared Config ──
// Reads game constants from the shared JSON file (embedded at compile time).
// This ensures the Rust server and TypeScript client share identical values.

use serde::Deserialize;
use std::sync::OnceLock;

/// Raw JSON embedded at compile time — no filesystem access at runtime.
const RAW_JSON: &str = include_str!("../../../shared/game-constants.json");

// ── Top-Level Config ──

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GameConfig {
    pub world: WorldConfig,
    pub block_types: BlockTypes,
    pub entity_kinds: EntityKinds,
    pub vehicle_types: VehicleTypes,
    pub player: PlayerConfig,
    pub weapons: Vec<WeaponConfig>,
    pub vehicle_weapons: Vec<VehicleWeaponConfig>,
    pub helicopter: HelicopterConfig,
    pub grenade: GrenadeConfig,
    pub combat: CombatConfig,
    pub weather: Vec<WeatherConfig>,
}

// ── Sub-Configs ──

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorldConfig {
    pub size_x: usize,
    pub size_y: usize,
    pub size_z: usize,
    pub chunk_size: usize,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct BlockTypes {
    pub air: u8,
    pub concrete: u8,
    pub dark_concrete: u8,
    pub asphalt: u8,
    pub rebar: u8,
    pub brick: u8,
    pub metal: u8,
    pub rubble: u8,
    pub dirt: u8,
    pub sand: u8,
    pub grass: u8,
    pub wood: u8,
    pub stone: u8,
    pub snow: u8,
    pub lantern: u8,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct EntityKinds {
    pub player: u8,
    pub vehicle: u8,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct VehicleTypes {
    pub helicopter: u8,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerConfig {
    pub max_health: i32,
    pub eye_height: f32,
    pub foot_radius: f32,
    pub hitbox_half_width: f32,
    pub hitbox_height: f32,
    pub god_mode_health: i32,
    pub max_movement_speed: f32,
    pub speed_violation_threshold: u32,
    pub health_regen_rate: i32,
    pub health_regen_delay_secs: u64,
    pub num_character_presets: u8,
    pub default_loadout: Vec<u8>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeaponConfig {
    pub index: u8,
    pub name: String,
    pub damage: i32,
    pub radius: f32,
    pub fire_rate: f32,
    pub max_ammo: i32,
    pub max_range: f32,
    pub projectile_speed: f32,
    pub delivery: String,
    pub color: String,
    pub recoil: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VehicleWeaponConfig {
    pub index: u8,
    pub name: String,
    pub damage: i32,
    pub radius: f32,
    pub fire_rate: f32,
    pub max_ammo: i32,
    pub max_range: f32,
    pub projectile_speed: f32,
    pub gravity: f32,
    pub delivery: String,
    pub color: String,
    pub reload_time: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HelicopterConfig {
    pub health_max: i32,
    pub scale: f32,
    pub mount_range: f32,
    pub min_altitude: f32,
    pub max_altitude: f32,
    pub cruise_speed: f32,
    pub strafe_speed: f32,
    pub lift_speed: f32,
    pub max_yaw_rate: f32,
    pub max_pitch_rate: f32,
    pub pilot_seat_height: f32,
    pub hitbox: HelicopterHitbox,
    pub camera: HelicopterCamera,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HelicopterHitbox {
    pub center_y: f32,
    pub half_x: f32,
    pub half_y: f32,
    pub half_z: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HelicopterCamera {
    pub distance: f32,
    pub height: f32,
    pub pitch_min: f32,
    pub pitch_max: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GrenadeConfig {
    pub tick_interval_ms: u64,
    pub gravity: f32,
    pub fuse_ms: u32,
    pub bounce_restitution: f32,
    pub bounce_friction: f32,
    pub ground_friction: f32,
    pub min_bounce_vel: f32,
    pub radius: f32,
    pub weapon_index: u8,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CombatConfig {
    pub fire_rate_tolerance_us: u64,
    pub max_shot_origin_dist_sq: f32,
    pub max_vehicle_shot_origin_dist_sq: f32,
    pub max_block_destroy_per_call: usize,
    pub max_block_destroy_range: f32,
    pub hitscan_dot_threshold_player: f32,
    pub hitscan_dot_threshold_vehicle: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub name: String,
    pub cloud_density: f32,
    pub fog_density: f32,
    pub wind_speed: f32,
}

// ── Accessor ──

static CONFIG: OnceLock<GameConfig> = OnceLock::new();

/// Returns a reference to the parsed shared game config.
/// Panics on first call if the JSON is malformed (compile-time embedded, so this
/// would be caught during development).
pub fn config() -> &'static GameConfig {
    CONFIG.get_or_init(|| {
        serde_json::from_str(RAW_JSON).expect("Failed to parse shared game-constants.json")
    })
}
