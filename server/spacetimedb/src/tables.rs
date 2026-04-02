// ── Table Definitions ──
// All SpacetimeDB tables. This is the data schema for the entire game.

use spacetimedb::{table, Identity, ScheduleAt, Timestamp};

use crate::types::{DestroyedBlock, Rotation, Vec3};

// Scheduled table macros need reducer functions in scope.
use crate::cleanup::{cleanup_detach_events, cleanup_shots_scheduled, tick_health_regen};
use crate::environment::tick_environment;
use crate::grenades::tick_grenades;
use crate::map::reset_map;
use crate::matchmaking::tick_match;
// tick_vehicles is in vehicles/mod.rs, re-exported
use crate::abilities::tick_abilities;
use crate::vehicles::tick_vehicles;

// ── Core Entities ──

/// Every connected player.
#[derive(Clone)]
#[table(accessor = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub entity_id: u64,
    pub username: String,
    pub character_preset: u8,
    pub movement_flags: u8,
    pub pos: Vec3,
    pub vel: Vec3,
    pub rot: Rotation,
    pub health: i32,
    pub max_health: i32,
    pub current_weapon: u8,
    pub kills: u32,
    pub deaths: u32,
    pub spawn_protected: bool,
    pub online: bool,
    pub mounted_vehicle_id: u64,
    pub joined_at: Timestamp,
    pub last_damage_time: Timestamp,
}

/// Abstract entity root shared by all world objects (player, vehicle, item, ...).
#[derive(Clone)]
#[table(
    accessor = entity,
    public,
    index(accessor = idx_entity_kind, btree(columns = [kind]))
)]
pub struct Entity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// 1 = Player, 2 = Vehicle
    pub kind: u8,
    pub subtype: u8,
    pub pos: Vec3,
    pub vel: Vec3,
    pub rot: Rotation,
    pub scale: f32,
    pub active: bool,
    /// Monotonic server simulation tick id for vehicle entities.
    /// Non-vehicle entities may keep this at 0.
    pub sim_tick: u64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Vehicle entity component attached to an Entity row.
#[derive(Clone)]
#[table(
    accessor = vehicle,
    public,
    index(accessor = idx_vehicle_type, btree(columns = [vehicle_type]))
)]
pub struct Vehicle {
    #[primary_key]
    pub entity_id: u64,
    pub vehicle_type: u8,
    pub pilot_identity: Option<Identity>,
    pub seat_count: u8,
    pub input_forward: f32,
    pub input_strafe: f32,
    pub input_lift: f32,
    pub input_yaw: f32,
    pub boosting: bool,
    /// Monotonic sequence number of the last input packet received from
    /// the pilot via `update_vehicle_input`.
    pub input_seq: u32,
    /// Monotonic sequence number of the last input packet that has actually
    /// been consumed by vehicle physics in `tick_vehicles`.
    ///
    /// This is the authoritative ack used by the client's rewind-and-replay
    /// prediction system.
    pub acked_input_seq: u32,
    /// Monotonic server simulation tick id when this row was last updated by
    /// vehicle physics.
    pub sim_tick: u64,
    /// Timestamp of the last vehicle physics tick that consumed input and
    /// updated this row.
    pub sim_updated_at: Timestamp,
    pub rotor_spin: f32,
    pub health: i32,
    pub weapon_type: u8,
    pub weapon_ammo_primary: i32,
    pub weapon_ammo_secondary: i32,
    pub weapon_ammo_tertiary: i32,
    pub weapon_last_fire: Timestamp,
    pub created_at: Timestamp,
    pub last_input_at: Timestamp,
}

/// Small FIFO queue of pilot inputs to guarantee deterministic one-command-
/// per-tick processing on the server.
#[derive(Clone)]
#[table(
    accessor = vehicle_input_cmd,
    index(accessor = idx_vehicle_input_by_vehicle, btree(columns = [vehicle_id]))
)]
pub struct VehicleInputCmd {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub vehicle_id: u64,
    pub seq: u32,
    pub forward: f32,
    pub strafe: f32,
    pub lift: f32,
    pub yaw: f32,
    pub boosting: bool,
    pub received_at: Timestamp,
}

// ── Player State ──

/// Persistent 3-weapon loadout keyed by username.
#[table(accessor = player_loadout, public)]
pub struct PlayerLoadout {
    #[primary_key]
    pub username: String,
    pub slot1: u8,
    pub slot2: u8,
    pub slot3: u8,
    pub updated_at: Timestamp,
}

/// Normalized ammo storage: one row per (player, weapon) pair.
/// Adding new weapons requires zero schema changes.
#[table(accessor = player_ammo, public, index(accessor = idx_ammo_identity, btree(columns = [identity])))]
pub struct PlayerAmmo {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    pub weapon_index: u8,
    pub ammo: i32,
}

/// Per-player fire timing (shared across all weapons).
/// Private: only needed server-side for fire rate validation.
#[table(accessor = player_fire_state)]
pub struct PlayerFireState {
    #[primary_key]
    pub identity: Identity,
    pub last_fire_time: Timestamp,
}

/// Tracks movement history for diagnostics / future anti-cheat.
/// Private: only needed server-side.
#[table(accessor = player_movement)]
pub struct PlayerMovementState {
    #[primary_key]
    pub identity: Identity,
    pub last_pos: Vec3,
    pub last_update: Timestamp,
    pub violation_count: u32,
}

// ── World ──

/// Server-authoritative world chunk. RLE-compressed 16x16x16 block data.
#[table(
    accessor = world_chunk,
    public,
    index(accessor = idx_world_chunk_cx, btree(columns = [cx])),
    index(accessor = idx_world_chunk_cz, btree(columns = [cz]))
)]
pub struct WorldChunk {
    #[primary_key]
    pub chunk_id: u32,
    pub cx: u8,
    pub cy: u8,
    pub cz: u8,
    pub data: Vec<u8>,
    pub version: u64,
}

/// World config: stores current map seed and round info.
#[table(accessor = world_config, public)]
pub struct WorldConfig {
    #[primary_key]
    pub id: u32,
    pub seed: u64,
    pub round_number: u32,
    pub round_start: Timestamp,
}

/// Current match round / intermission state.
#[table(accessor = match_state, public)]
pub struct MatchState {
    #[primary_key]
    pub id: u32,
    pub round_number: u32,
    pub state: u8,
    pub phase_started_at: Timestamp,
    pub phase_ends_at: Timestamp,
    pub time_remaining_secs: u32,
}

/// Server-authoritative world environment: time of day + weather.
#[table(accessor = world_environment, public)]
pub struct WorldEnvironment {
    #[primary_key]
    pub id: u32,
    pub time_of_day: f32,
    pub weather: u8,
    pub wind_speed: f32,
    pub cloud_density: f32,
    pub fog_density: f32,
    pub last_weather_change: Timestamp,
}

// ── Events (short-lived, cleaned up by scheduled reducers) ──

/// Shot fired — other clients render tracers.
#[table(accessor = shot_event, public)]
pub struct ShotEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub shooter: Identity,
    pub origin: Vec3,
    pub direction: Vec3,
    pub hit_pos: Vec3,
    pub has_hit: bool,
    pub weapon: u8,
    pub source_vehicle: u64,
    pub fired_at: Timestamp,
}

/// Physics detach event: blocks that lost structural support.
#[table(accessor = detach_event, public)]
pub struct DetachEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub blocks_x: Vec<i32>,
    pub blocks_y: Vec<i32>,
    pub blocks_z: Vec<i32>,
    pub block_types: Vec<u8>,
    pub motion_mode: u8,
    pub pivot: Vec3,
    pub axis: Vec3,
    pub drift: Vec3,
    pub fracture_origin: Vec3,
    pub fracture_dir: Vec3,
    pub ang_accel: f32,
    pub initial_ang_vel: f32,
    pub gravity_scale: f32,
    pub fracture_speed: f32,
    pub lifetime_ms: u32,
    pub created_at: Timestamp,
}

/// Explosion event for all clients to render VFX.
#[table(accessor = explosion_event, public)]
pub struct ExplosionEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub origin: Identity,
    pub pos: Vec3,
    pub radius: f32,
    pub weapon: u8,
    pub destroyed_blocks: Vec<DestroyedBlock>,
    pub created_at: Timestamp,
}

/// Kill event for the kill feed.
#[table(accessor = kill_event, public)]
pub struct KillEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub killer_name: String,
    pub victim_name: String,
    pub weapon: u8,
    pub created_at: Timestamp,
}

/// Vehicle destroyed event.
#[table(accessor = vehicle_destroy_event, public)]
pub struct VehicleDestroyEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub entity_id: u64,
    pub vehicle_type: u8,
    pub pos: Vec3,
    pub rot: Rotation,
    pub created_at: Timestamp,
}

/// Chat messages.
#[table(accessor = chat_message, public)]
pub struct ChatMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub sender: Identity,
    pub sender_name: String,
    pub text: String,
    pub sent_at: Timestamp,
}

/// Server-side chat anti-spam state per player.
#[table(accessor = chat_throttle)]
pub struct ChatThrottle {
    #[primary_key]
    pub identity: Identity,
    pub last_message_at: Timestamp,
    pub last_message_text: String,
    pub window_started_at: Timestamp,
    pub messages_in_window: u8,
    pub muted_until: Timestamp,
}

/// Final standings captured when a round ends.
#[table(
    accessor = match_result,
    public,
    index(accessor = idx_match_result_round, btree(columns = [round_number]))
)]
pub struct MatchResult {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub round_number: u32,
    pub winner_name: String,
    pub winner_kills: u32,
    pub player_identities: Vec<Identity>,
    pub player_names: Vec<String>,
    pub player_kills: Vec<u32>,
    pub player_deaths: Vec<u32>,
    pub created_at: Timestamp,
}

// ── Projectiles ──

/// Server-authoritative grenade projectile that bounces and explodes.
#[derive(Clone)]
#[table(accessor = grenade_projectile, public)]
pub struct GrenadeProjectile {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub owner: Identity,
    pub pos: Vec3,
    pub vel: Vec3,
    pub fuse_remaining_ms: u32,
    pub created_at: Timestamp,
}

// ── Scheduled Task Tables ──

#[table(accessor = detach_cleanup, scheduled(cleanup_detach_events))]
pub struct DetachCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = shot_cleanup, scheduled(cleanup_shots_scheduled))]
pub struct ShotCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = environment_tick, scheduled(tick_environment))]
pub struct EnvironmentTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = map_reset_timer, scheduled(reset_map))]
pub struct MapResetTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = match_tick, scheduled(tick_match))]
pub struct MatchTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = health_regen_tick, scheduled(tick_health_regen))]
pub struct HealthRegenTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = vehicle_tick, scheduled(tick_vehicles))]
pub struct VehicleTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

#[table(accessor = grenade_tick, scheduled(tick_grenades))]
pub struct GrenadeTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// ── Abilities ──

/// Ability pickup spawned in the world.
#[derive(Clone)]
#[table(accessor = ability_pickup, public)]
pub struct AbilityPickup {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub ability_type: u8,
    pub pos: Vec3,
    pub active: bool,
    pub respawn_at: Timestamp,
    pub created_at: Timestamp,
}

/// Active buff on a player (public so clients can render indicators).
#[table(
    accessor = player_buff,
    public,
    index(accessor = idx_buff_identity, btree(columns = [identity]))
)]
pub struct PlayerBuff {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub identity: Identity,
    pub ability_type: u8,
    pub expires_at: Timestamp,
    pub created_at: Timestamp,
}

/// Short-lived event so all clients see the pickup VFX.
#[table(accessor = ability_pickup_event, public)]
pub struct AbilityPickupEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub player: Identity,
    pub ability_type: u8,
    pub pos: Vec3,
    pub created_at: Timestamp,
}

#[table(accessor = ability_tick, scheduled(tick_abilities))]
pub struct AbilityTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}
