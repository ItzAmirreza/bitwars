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
    pub vehicle_tick_interval_ms: u64,
    pub player: PlayerConfig,
    pub weapons: Vec<WeaponConfig>,
    pub vehicle_weapons: Vec<VehicleWeaponConfig>,
    pub helicopter: HelicopterConfig,
    pub fighter_jet: FighterJetConfig,
    pub anti_air: AntiAirConfig,
    pub apc: ApcConfig,
    pub grenade: GrenadeConfig,
    pub vehicle_block_collision: VehicleBlockCollisionConfig,
    pub combat: CombatConfig,
    pub r#match: MatchConfig,
    pub weather: Vec<WeatherConfig>,
    pub abilities: AbilitiesConfig,
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
    pub fighter_jet: u8,
    pub anti_air: u8,
    #[serde(rename = "APC")]
    pub apc: u8,
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
    #[serde(default)]
    pub pellets: u8,
    #[serde(default)]
    pub spread: f32,
    #[serde(default)]
    pub close_range_threshold: f32,
    #[serde(default = "default_close_range_mult")]
    pub close_range_damage_mult: f32,
}

fn default_close_range_mult() -> f32 {
    1.0
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VehicleWeaponConfig {
    pub index: u8,
    pub name: String,
    pub damage: i32,
    #[serde(default = "default_damage_scale")]
    pub player_damage_scale: f32,
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

fn default_damage_scale() -> f32 {
    1.0
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
    pub drag_piloted: f32,
    pub drag_unpiloted: f32,
    pub horiz_blend: f32,
    pub vert_blend: f32,
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
pub struct FighterJetConfig {
    pub health_max: i32,
    pub scale: f32,
    pub mount_range: f32,
    pub min_altitude: f32,
    pub max_altitude: f32,
    pub min_speed: f32,
    pub max_speed: f32,
    pub acceleration: f32,
    pub brake_deceleration: f32,
    pub idle_deceleration: f32,
    pub max_yaw_rate: f32,
    pub max_pitch_rate: f32,
    pub max_roll_rate: f32,
    pub lift_factor: f32,
    pub gravity: f32,
    pub stall_speed: f32,
    pub pilot_seat_height: f32,
    pub drag_piloted: f32,
    pub drag_unpiloted: f32,
    pub velocity_blend: f32,
    pub hitbox: FighterJetHitbox,
    pub camera: FighterJetCamera,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FighterJetHitbox {
    pub center_y: f32,
    pub half_x: f32,
    pub half_y: f32,
    pub half_z: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FighterJetCamera {
    pub distance: f32,
    pub height: f32,
    pub pitch_min: f32,
    pub pitch_max: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AntiAirConfig {
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
    pub turret_yaw_rate: f32,
    pub turret_pitch_rate: f32,
    pub pilot_seat_height: f32,
    pub drag_piloted: f32,
    pub drag_unpiloted: f32,
    pub horiz_blend: f32,
    pub tracking_range: f32,
    pub hitbox: AntiAirHitbox,
    pub camera: AntiAirCamera,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AntiAirHitbox {
    pub center_y: f32,
    pub half_x: f32,
    pub half_y: f32,
    pub half_z: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AntiAirCamera {
    pub distance: f32,
    pub height: f32,
    pub pitch_min: f32,
    pub pitch_max: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApcConfig {
    pub health_max: i32,
    pub scale: f32,
    pub mount_range: f32,
    pub min_altitude: f32,
    pub max_altitude: f32,
    pub cruise_speed: f32,
    pub strafe_speed: f32,
    pub lift_speed: f32,
    pub max_yaw_rate: f32,
    pub pilot_seat_height: f32,
    pub drag_piloted: f32,
    pub drag_unpiloted: f32,
    pub horiz_blend: f32,
    pub gravity: f32,
    pub collision_speed_retain: f32,
    pub hitbox: ApcHitbox,
    pub camera: ApcCamera,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApcHitbox {
    pub center_y: f32,
    pub half_x: f32,
    pub half_y: f32,
    pub half_z: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApcCamera {
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
pub struct VehicleBlockCollisionConfig {
    pub damage_per_block: i32,
    pub speed_retain_per_block: f32,
    pub min_speed_to_collide: f32,
    pub speed_destroy_reference: f32,
    pub min_destroy_fraction: f32,
    pub max_blocks_per_tick: usize,
    pub collision_hitbox_scale: f32,
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
pub struct MatchConfig {
    pub round_duration_secs: u64,
    pub intermission_secs: u64,
    pub ending_warning_secs: u64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeatherConfig {
    pub name: String,
    pub cloud_density: f32,
    pub fog_density: f32,
    pub wind_speed: f32,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
pub struct AbilityTypes {
    pub health_regen: u8,
    pub double_damage: u8,
    pub speed_boost: u8,
    pub shield: u8,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AbilitiesConfig {
    pub types: AbilityTypes,
    pub double_damage_duration_secs: f32,
    pub double_damage_multiplier: f32,
    pub speed_boost_duration_secs: f32,
    pub speed_boost_multiplier: f32,
    pub shield_duration_secs: f32,
    pub shield_damage_reduction: f32,
    pub pickup_radius: f32,
    pub max_active_pickups: usize,
    pub pickup_respawn_secs: u64,
    pub tick_interval_ms: u64,
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
