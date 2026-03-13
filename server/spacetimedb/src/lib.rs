use spacetimedb::{
    reducer, table, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp,
};
use std::collections::HashMap;
use std::f32::consts::TAU;
use std::time::Duration;

mod worldgen;
use std::collections::HashMap as StdHashMap;
use worldgen::{
    AIR, CHUNK_SIZE, NUM_CHUNKS_X, NUM_CHUNKS_Y, NUM_CHUNKS_Z, WORLD_SIZE_X, WORLD_SIZE_Y,
    WORLD_SIZE_Z,
};

// ── Weather Types ──
// 0 = Clear, 1 = Cloudy, 2 = Overcast, 3 = Rainy, 4 = Stormy

// ── Custom Types ──

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct DestroyedBlock {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub block_type: u8,
}

#[derive(SpacetimeType, Clone, Debug, PartialEq)]
pub struct Rotation {
    pub yaw: f32,
    pub pitch: f32,
}

// ── Weapon Definitions (Server Authority) ──

struct WeaponDef {
    damage: i32,
    radius: f32,
    fire_rate: f32,
    max_ammo: i32,
    max_range: f32,
    projectile_speed: f32,
}

const WEAPON_DEFS: [WeaponDef; 5] = [
    // Rifle: fast, precise, moderate damage (hitscan)
    WeaponDef {
        damage: 25,
        radius: 0.0,
        fire_rate: 5.0,
        max_ammo: 90,
        max_range: 80.0,
        projectile_speed: 0.0,
    },
    // Shotgun: slow, spread, close range (hitscan)
    WeaponDef {
        damage: 12,
        radius: 1.5,
        fire_rate: 1.0,
        max_ammo: 24,
        max_range: 30.0,
        projectile_speed: 0.0,
    },
    // RPG: very slow, explosive, high damage (projectile)
    WeaponDef {
        damage: 80,
        radius: 3.5,
        fire_rate: 0.5,
        max_ammo: 12,
        max_range: 80.0,
        projectile_speed: 120.0,
    },
    // Machine Gun: very high fire-rate bullet hose (hitscan)
    WeaponDef {
        damage: 14,
        radius: 0.0,
        fire_rate: 13.0,
        max_ammo: 180,
        max_range: 90.0,
        projectile_speed: 0.0,
    },
    // Grenade Launcher: arcing explosive sandbox chaos (projectile)
    WeaponDef {
        damage: 95,
        radius: 4.8,
        fire_rate: 1.4,
        max_ammo: 14,
        max_range: 85.0,
        projectile_speed: 48.0,
    },
];

const NUM_WEAPONS: u8 = 5;

// ── Tables ──

/// Every connected player
#[derive(Clone)]
#[table(accessor = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub entity_id: u64,
    pub username: String,
    pub character_preset: u8,
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
    /// 0 means not mounted in a vehicle.
    pub mounted_vehicle_id: u64,
    pub joined_at: Timestamp,
    pub last_damage_time: Timestamp,
}

/// Abstract entity root shared by all world objects (player, vehicle, item, ...).
#[derive(Clone)]
#[table(accessor = entity, public)]
pub struct Entity {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    /// 1 = Player, 2 = Vehicle
    pub kind: u8,
    /// Type inside the kind (e.g. helicopter type for vehicles)
    pub subtype: u8,
    pub pos: Vec3,
    pub vel: Vec3,
    pub rot: Rotation,
    pub scale: f32,
    pub active: bool,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// Vehicle entity component attached to an Entity row.
#[derive(Clone)]
#[table(accessor = vehicle, public)]
pub struct Vehicle {
    #[primary_key]
    pub entity_id: u64,
    /// 0 = Helicopter
    pub vehicle_type: u8,
    pub pilot_identity: Option<Identity>,
    pub seat_count: u8,
    pub input_forward: f32,
    pub input_strafe: f32,
    pub input_lift: f32,
    pub input_yaw: f32,
    pub boosting: bool,
    /// Visual rotor spin amount, synced for all clients.
    pub rotor_spin: f32,
    pub health: i32,
    pub created_at: Timestamp,
    pub last_input_at: Timestamp,
}

/// Persistent 3-weapon loadout keyed by username.
/// Used to restore player weapon choices across sessions.
#[table(accessor = player_loadout, public)]
pub struct PlayerLoadout {
    #[primary_key]
    pub username: String,
    pub slot1: u8,
    pub slot2: u8,
    pub slot3: u8,
    pub updated_at: Timestamp,
}

/// Server-authoritative weapon state per player
#[table(accessor = player_weapon_state, public)]
pub struct PlayerWeaponState {
    #[primary_key]
    pub identity: Identity,
    pub ammo_rifle: i32,
    pub ammo_shotgun: i32,
    pub ammo_rpg: i32,
    pub ammo_machine_gun: i32,
    pub ammo_grenade: i32,
    pub last_fire_time: Timestamp,
}

/// Tracks movement for speed validation
#[table(accessor = player_movement, public)]
pub struct PlayerMovementState {
    #[primary_key]
    pub identity: Identity,
    pub last_pos: Vec3,
    pub last_update: Timestamp,
    pub violation_count: u32,
}

/// Server-authoritative world chunk. RLE-compressed 16x16x16 block data.
#[table(accessor = world_chunk, public)]
pub struct WorldChunk {
    #[primary_key]
    pub chunk_id: u32,
    pub cx: u8,
    pub cy: u8,
    pub cz: u8,
    pub data: Vec<u8>,
    pub version: u64,
}

/// Short-lived row: represents a shot fired so other clients can render tracers.
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
    pub fired_at: Timestamp,
}

/// Physics detach event: blocks that lost structural support and should fall.
/// All clients spawn falling blocks from these events.
#[table(accessor = detach_event, public)]
pub struct DetachEvent {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub blocks_x: Vec<i32>,
    pub blocks_y: Vec<i32>,
    pub blocks_z: Vec<i32>,
    pub block_types: Vec<u8>,
    /// 0 = free-fall shear, 1 = rotational topple
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

/// Scheduled cleanup for old DetachEvents
#[table(accessor = detach_cleanup, scheduled(cleanup_detach_events))]
pub struct DetachCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Scheduled cleanup for old ShotEvents and ExplosionEvents
#[table(accessor = shot_cleanup, scheduled(cleanup_shots_scheduled))]
pub struct ShotCleanup {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Short-lived row: explosion event for all clients to render VFX.
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

/// Chat messages
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

/// Server-authoritative world environment: time of day + weather.
/// Single row (id=1), all clients sync from this.
#[table(accessor = world_environment, public)]
pub struct WorldEnvironment {
    #[primary_key]
    pub id: u32,
    /// Time of day in hours (0.0 - 24.0)
    pub time_of_day: f32,
    /// Weather type: 0=Clear, 1=Cloudy, 2=Overcast, 3=Rainy, 4=Stormy
    pub weather: u8,
    /// Wind speed (0.0 - 1.0)
    pub wind_speed: f32,
    /// Cloud density (0.0 - 1.0)
    pub cloud_density: f32,
    /// Fog density multiplier (0.5 - 2.0)
    pub fog_density: f32,
    /// When the weather last changed
    pub last_weather_change: Timestamp,
}

/// Scheduled environment tick — advances time, occasionally changes weather
#[table(accessor = environment_tick, scheduled(tick_environment))]
pub struct EnvironmentTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
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

/// Scheduled map reset every 5 minutes.
#[table(accessor = map_reset_timer, scheduled(reset_map))]
pub struct MapResetTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Scheduled health regeneration tick — runs every 1 second.
/// Regenerates 5 HP/s for players who haven't taken damage in 10 seconds.
#[table(accessor = health_regen_tick, scheduled(tick_health_regen))]
pub struct HealthRegenTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

/// Scheduled vehicle simulation tick (20Hz).
#[table(accessor = vehicle_tick, scheduled(tick_vehicles))]
pub struct VehicleTick {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// ── Constants ──

const SPAWN_POS: Vec3 = Vec3 {
    x: WORLD_SIZE_X as f32 / 2.0,
    y: 20.0,
    z: WORLD_SIZE_Z as f32 / 2.0,
};
const MAX_HEALTH: i32 = 100;
const HEALTH_REGEN_RATE: i32 = 5; // HP per second
const HEALTH_REGEN_DELAY_SECS: u64 = 10; // seconds after last damage before regen starts
const MAX_MOVEMENT_SPEED: f32 = 35.0;
const ZERO_VEL: Vec3 = Vec3 {
    x: 0.0,
    y: 0.0,
    z: 0.0,
};
const SPEED_VIOLATION_THRESHOLD: u32 = 10;
const PLAYER_EYE_HEIGHT: f32 = 1.7;
const PLAYER_FOOT_RADIUS: f32 = 0.29;
const DEFAULT_LOADOUT: [u8; 3] = [0, 1, 2];
const NUM_CHARACTER_PRESETS: u8 = 5;
const ENTITY_KIND_PLAYER: u8 = 1;
const ENTITY_KIND_VEHICLE: u8 = 2;
const VEHICLE_TYPE_HELICOPTER: u8 = 0;
const SANDBOX_HELICOPTER_COUNT: usize = 1;
const HELI_SPAWN_CLEARANCE_RADIUS: i32 = 4;
const HELI_SPAWN_CLEARANCE_HEIGHT: i32 = 7;
const HELI_SPAWN_MIN_SEPARATION: f32 = 28.0;
const HELI_SCALE: f32 = 1.85;
const HELI_MOUNT_RANGE: f32 = 8.5;
const HELI_MIN_ALTITUDE_FROM_GROUND: f32 = 0.0;
const HELI_MAX_ALTITUDE: f32 = 96.0;
const HELI_CRUISE_SPEED: f32 = 34.0;
const HELI_STRAFE_SPEED: f32 = 22.0;
const HELI_LIFT_SPEED: f32 = 16.0;
const HELI_YAW_SPEED: f32 = 1.5;
const HELI_PILOT_SEAT_HEIGHT: f32 = 1.8;
const HELI_HEALTH_MAX: i32 = 1000;
const HELI_SKID_BOTTOM_LOCAL_Y: f32 = 1.325;
const HELI_HITBOX_CENTER_Y: f32 = 2.5;
const HELI_HITBOX_HALF_X: f32 = 6.4;
const HELI_HITBOX_HALF_Y: f32 = 1.25;
const HELI_HITBOX_HALF_Z: f32 = 4.9;

// ── Helpers ──

fn timestamp_micros(ts: Timestamp) -> u64 {
    ts.to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64
}

fn dist_sq(a: &Vec3, b: &Vec3) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    dx * dx + dy * dy + dz * dz
}

fn vec3_from_tuple(v: (f32, f32, f32)) -> Vec3 {
    Vec3 {
        x: v.0,
        y: v.1,
        z: v.2,
    }
}

fn init_weapon_state(ctx: &ReducerContext, identity: Identity) {
    if ctx
        .db
        .player_weapon_state()
        .identity()
        .find(identity)
        .is_none()
    {
        ctx.db.player_weapon_state().insert(PlayerWeaponState {
            identity,
            ammo_rifle: WEAPON_DEFS[0].max_ammo,
            ammo_shotgun: WEAPON_DEFS[1].max_ammo,
            ammo_rpg: WEAPON_DEFS[2].max_ammo,
            ammo_machine_gun: WEAPON_DEFS[3].max_ammo,
            ammo_grenade: WEAPON_DEFS[4].max_ammo,
            last_fire_time: ctx.timestamp,
        });
    }
}

fn init_movement_state(ctx: &ReducerContext, identity: Identity, pos: &Vec3) {
    if ctx.db.player_movement().identity().find(identity).is_none() {
        ctx.db.player_movement().insert(PlayerMovementState {
            identity,
            last_pos: pos.clone(),
            last_update: ctx.timestamp,
            violation_count: 0,
        });
    } else {
        ctx.db
            .player_movement()
            .identity()
            .update(PlayerMovementState {
                identity,
                last_pos: pos.clone(),
                last_update: ctx.timestamp,
                violation_count: 0,
            });
    }
}

fn get_ammo(state: &PlayerWeaponState, weapon: u8) -> i32 {
    match weapon {
        0 => state.ammo_rifle,
        1 => state.ammo_shotgun,
        2 => state.ammo_rpg,
        3 => state.ammo_machine_gun,
        4 => state.ammo_grenade,
        _ => 0,
    }
}

fn set_ammo(state: &mut PlayerWeaponState, weapon: u8, ammo: i32) {
    match weapon {
        0 => state.ammo_rifle = ammo,
        1 => state.ammo_shotgun = ammo,
        2 => state.ammo_rpg = ammo,
        3 => state.ammo_machine_gun = ammo,
        4 => state.ammo_grenade = ammo,
        _ => {}
    }
}

fn loadout_slots_valid(slot1: u8, slot2: u8, slot3: u8) -> bool {
    slot1 < NUM_WEAPONS
        && slot2 < NUM_WEAPONS
        && slot3 < NUM_WEAPONS
        && slot1 != slot2
        && slot1 != slot3
        && slot2 != slot3
}

fn weapon_in_loadout(loadout: &PlayerLoadout, weapon: u8) -> bool {
    weapon == loadout.slot1 || weapon == loadout.slot2 || weapon == loadout.slot3
}

fn normalize_character_preset(preset: u8) -> u8 {
    if preset < NUM_CHARACTER_PRESETS {
        preset
    } else {
        0
    }
}

fn normalize_or_create_player_loadout(ctx: &ReducerContext, username: &str) -> PlayerLoadout {
    let key = username.to_string();
    if let Some(existing) = ctx.db.player_loadout().username().find(&key) {
        if loadout_slots_valid(existing.slot1, existing.slot2, existing.slot3) {
            return existing;
        }

        ctx.db.player_loadout().username().update(PlayerLoadout {
            username: key.clone(),
            slot1: DEFAULT_LOADOUT[0],
            slot2: DEFAULT_LOADOUT[1],
            slot3: DEFAULT_LOADOUT[2],
            updated_at: ctx.timestamp,
        });
        return PlayerLoadout {
            username: key,
            slot1: DEFAULT_LOADOUT[0],
            slot2: DEFAULT_LOADOUT[1],
            slot3: DEFAULT_LOADOUT[2],
            updated_at: ctx.timestamp,
        };
    }

    ctx.db.player_loadout().insert(PlayerLoadout {
        username: key,
        slot1: DEFAULT_LOADOUT[0],
        slot2: DEFAULT_LOADOUT[1],
        slot3: DEFAULT_LOADOUT[2],
        updated_at: ctx.timestamp,
    })
}

fn clamp_pos(pos: &Vec3) -> Vec3 {
    Vec3 {
        x: pos.x.clamp(-1.0, (WORLD_SIZE_X + 1) as f32),
        y: pos.y.clamp(-10.0, 100.0),
        z: pos.z.clamp(-1.0, (WORLD_SIZE_Z + 1) as f32),
    }
}

fn block_in_bounds(x: i32, y: i32, z: i32) -> bool {
    x >= 0
        && x < WORLD_SIZE_X as i32
        && y >= 0
        && y < WORLD_SIZE_Y as i32
        && z >= 0
        && z < WORLD_SIZE_Z as i32
}

fn get_block_type(ctx: &ReducerContext, x: i32, y: i32, z: i32) -> Option<u8> {
    if !block_in_bounds(x, y, z) {
        return Some(AIR);
    }

    let ux = x as usize;
    let uy = y as usize;
    let uz = z as usize;
    let cx = (ux / CHUNK_SIZE) as u8;
    let cy = (uy / CHUNK_SIZE) as u8;
    let cz = (uz / CHUNK_SIZE) as u8;
    let lx = ux % CHUNK_SIZE;
    let ly = uy % CHUNK_SIZE;
    let lz = uz % CHUNK_SIZE;
    let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);

    let chunk = ctx.db.world_chunk().chunk_id().find(chunk_id)?;
    let mut decoded = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
    worldgen::rle_decode(&chunk.data, &mut decoded);
    let idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
    Some(decoded[idx])
}

fn is_grounded(ctx: &ReducerContext, pos: &Vec3) -> bool {
    let foot_y = pos.y - PLAYER_EYE_HEIGHT;
    let probe_y = (foot_y - 0.05).floor() as i32;
    let probes = [
        (pos.x, pos.z),
        (pos.x - PLAYER_FOOT_RADIUS, pos.z - PLAYER_FOOT_RADIUS),
        (pos.x + PLAYER_FOOT_RADIUS, pos.z - PLAYER_FOOT_RADIUS),
        (pos.x - PLAYER_FOOT_RADIUS, pos.z + PLAYER_FOOT_RADIUS),
        (pos.x + PLAYER_FOOT_RADIUS, pos.z + PLAYER_FOOT_RADIUS),
    ];

    probes.iter().any(|(px, pz)| {
        let bx = px.floor() as i32;
        let bz = pz.floor() as i32;
        matches!(get_block_type(ctx, bx, probe_y, bz), Some(bt) if bt != AIR)
    })
}

fn hash_u64(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^ (x >> 31)
}

fn unit_from_seed(seed: u64) -> f32 {
    ((hash_u64(seed) & 0xffff_ffff) as f64 / 4_294_967_295.0) as f32
}

fn create_player_entity(ctx: &ReducerContext, pos: &Vec3, vel: &Vec3, rot: &Rotation) -> u64 {
    let row = ctx.db.entity().insert(Entity {
        id: 0,
        kind: ENTITY_KIND_PLAYER,
        subtype: 0,
        pos: pos.clone(),
        vel: vel.clone(),
        rot: rot.clone(),
        scale: 1.0,
        active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    row.id
}

fn sync_player_entity(ctx: &ReducerContext, player: &Player) {
    if player.entity_id == 0 {
        return;
    }

    if let Some(entity) = ctx.db.entity().id().find(&player.entity_id) {
        ctx.db.entity().id().update(Entity {
            pos: player.pos.clone(),
            vel: player.vel.clone(),
            rot: player.rot.clone(),
            active: player.online,
            updated_at: ctx.timestamp,
            ..entity
        });
    }
}

fn ensure_player_entity(ctx: &ReducerContext, player: &Player) -> u64 {
    if player.entity_id != 0 {
        if ctx.db.entity().id().find(&player.entity_id).is_some() {
            return player.entity_id;
        }
    }

    create_player_entity(ctx, &player.pos, &player.vel, &player.rot)
}

fn get_or_generate_chunk(ctx: &ReducerContext, cx: u8, cy: u8, cz: u8) -> Option<WorldChunk> {
    let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
    if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
        return Some(chunk);
    }

    let seed = ctx.db.world_config().id().find(1)?.seed;
    let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, seed);
    Some(ctx.db.world_chunk().insert(WorldChunk {
        chunk_id,
        cx,
        cy,
        cz,
        data,
        version: 1,
    }))
}

fn get_block_type_generated_cached(
    ctx: &ReducerContext,
    x: i32,
    y: i32,
    z: i32,
    chunk_cache: &mut StdHashMap<u32, [u8; 4096]>,
) -> Option<u8> {
    if !block_in_bounds(x, y, z) {
        return Some(AIR);
    }

    let ux = x as usize;
    let uy = y as usize;
    let uz = z as usize;
    let cx = (ux / CHUNK_SIZE) as u8;
    let cy = (uy / CHUNK_SIZE) as u8;
    let cz = (uz / CHUNK_SIZE) as u8;
    let lx = ux % CHUNK_SIZE;
    let ly = uy % CHUNK_SIZE;
    let lz = uz % CHUNK_SIZE;

    let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
    if !chunk_cache.contains_key(&chunk_id) {
        let chunk = get_or_generate_chunk(ctx, cx, cy, cz)?;
        let mut decoded = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
        worldgen::rle_decode(&chunk.data, &mut decoded);
        chunk_cache.insert(chunk_id, decoded);
    }

    let decoded = chunk_cache.get(&chunk_id)?;
    let idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
    Some(decoded[idx])
}

fn get_surface_height_generated(
    ctx: &ReducerContext,
    x: i32,
    z: i32,
    chunk_cache: &mut StdHashMap<u32, [u8; 4096]>,
) -> Option<i32> {
    if x < 0 || x >= WORLD_SIZE_X as i32 || z < 0 || z >= WORLD_SIZE_Z as i32 {
        return None;
    }

    for y in (0..WORLD_SIZE_Y as i32).rev() {
        if matches!(get_block_type_generated_cached(ctx, x, y, z, chunk_cache), Some(bt) if bt != AIR)
        {
            return Some(y);
        }
    }
    None
}

fn helicopter_spawn_y_if_fit(
    ctx: &ReducerContext,
    center_x: i32,
    center_z: i32,
    chunk_cache: &mut StdHashMap<u32, [u8; 4096]>,
) -> Option<f32> {
    let mut min_surface = i32::MAX;
    let mut max_surface = i32::MIN;

    for dx in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
        for dz in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
            if dx * dx + dz * dz > HELI_SPAWN_CLEARANCE_RADIUS * HELI_SPAWN_CLEARANCE_RADIUS {
                continue;
            }
            if (dx & 1) != 0 || (dz & 1) != 0 {
                continue;
            }

            let sx = center_x + dx;
            let sz = center_z + dz;
            let surf = get_surface_height_generated(ctx, sx, sz, chunk_cache)?;
            min_surface = min_surface.min(surf);
            max_surface = max_surface.max(surf);
        }
    }

    if min_surface == i32::MAX || max_surface - min_surface > 2 {
        return None;
    }

    let base_y = max_surface + 1;
    if base_y + HELI_SPAWN_CLEARANCE_HEIGHT >= WORLD_SIZE_Y as i32 - 1 {
        return None;
    }

    for dx in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
        for dz in -HELI_SPAWN_CLEARANCE_RADIUS..=HELI_SPAWN_CLEARANCE_RADIUS {
            if dx * dx + dz * dz > HELI_SPAWN_CLEARANCE_RADIUS * HELI_SPAWN_CLEARANCE_RADIUS {
                continue;
            }
            let sx = center_x + dx;
            let sz = center_z + dz;
            for y in base_y..=base_y + HELI_SPAWN_CLEARANCE_HEIGHT {
                if !matches!(
                    get_block_type_generated_cached(ctx, sx, y, sz, chunk_cache),
                    Some(AIR)
                ) {
                    return None;
                }
            }
        }
    }

    let center = Vec3 {
        x: center_x as f32 + 0.5,
        y: (base_y as f32) + 1.0,
        z: center_z as f32 + 0.5,
    };

    for p in ctx.db.player().iter() {
        if dist_sq(&p.pos, &center) < HELI_SPAWN_MIN_SEPARATION * HELI_SPAWN_MIN_SEPARATION {
            return None;
        }
    }

    for v in ctx.db.vehicle().iter() {
        if let Some(entity) = ctx.db.entity().id().find(&v.entity_id) {
            if dist_sq(&entity.pos, &center) < HELI_SPAWN_MIN_SEPARATION * HELI_SPAWN_MIN_SEPARATION
            {
                return None;
            }
        }
    }

    Some(center.y)
}

fn helicopter_ground_rest_height(ctx: &ReducerContext, x: f32, z: f32) -> f32 {
    let sx = x.floor() as i32;
    let sz = z.floor() as i32;
    if sx < 0 || sx >= WORLD_SIZE_X as i32 || sz < 0 || sz >= WORLD_SIZE_Z as i32 {
        return 3.0;
    }
    let mut found = None;
    for y in (0..WORLD_SIZE_Y as i32).rev() {
        if matches!(get_block_type(ctx, sx, y, sz), Some(bt) if bt != AIR) {
            found = Some(y);
            break;
        }
    }
    if let Some(surface) = found {
        surface as f32 + 2.0
    } else {
        3.0
    }
}

fn spawn_helicopter(ctx: &ReducerContext, pos: Vec3, yaw: f32) -> u64 {
    let entity = ctx.db.entity().insert(Entity {
        id: 0,
        kind: ENTITY_KIND_VEHICLE,
        subtype: VEHICLE_TYPE_HELICOPTER,
        pos,
        vel: ZERO_VEL,
        rot: Rotation { yaw, pitch: 0.0 },
        scale: HELI_SCALE,
        active: true,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });

    ctx.db.vehicle().insert(Vehicle {
        entity_id: entity.id,
        vehicle_type: VEHICLE_TYPE_HELICOPTER,
        pilot_identity: None,
        seat_count: 4,
        input_forward: 0.0,
        input_strafe: 0.0,
        input_lift: 0.0,
        input_yaw: 0.0,
        boosting: false,
        rotor_spin: 0.0,
        health: 500,
        created_at: ctx.timestamp,
        last_input_at: ctx.timestamp,
    });

    entity.id
}

fn spawn_sandbox_helicopters(ctx: &ReducerContext) {
    let seed = timestamp_micros(ctx.timestamp) ^ 0x6a09e667f3bcc909;
    let margin = (HELI_SPAWN_CLEARANCE_RADIUS + 12).max(10);
    let span_x = (WORLD_SIZE_X as i32 - margin * 2).max(8);
    let span_z = (WORLD_SIZE_Z as i32 - margin * 2).max(8);
    let mut chunk_cache: StdHashMap<u32, [u8; 4096]> = StdHashMap::new();

    let mut spawned = 0usize;
    for attempt in 0..320u64 {
        if spawned >= SANDBOX_HELICOPTER_COUNT {
            break;
        }

        let rx = hash_u64(seed ^ attempt.wrapping_mul(0x9e3779b97f4a7c15));
        let rz = hash_u64(seed ^ attempt.wrapping_mul(0xd1b54a32d192ed03));
        let x = margin + (rx % span_x as u64) as i32;
        let z = margin + (rz % span_z as u64) as i32;

        let Some(y) = helicopter_spawn_y_if_fit(ctx, x, z, &mut chunk_cache) else {
            continue;
        };

        let yaw = unit_from_seed(seed ^ attempt.wrapping_mul(0x94d049bb133111eb)) * TAU;
        spawn_helicopter(
            ctx,
            Vec3 {
                x: x as f32 + 0.5,
                y,
                z: z as f32 + 0.5,
            },
            yaw,
        );
        spawned += 1;
    }

    log::info!("Spawned {} sandbox helicopters", spawned);
}

fn clamp_vehicle_axis(v: f32) -> f32 {
    v.clamp(-1.0, 1.0)
}

fn dismount_player_internal(ctx: &ReducerContext, player: Player, force_to_ground: bool) -> Player {
    let mut next = player;
    if next.mounted_vehicle_id == 0 {
        return next;
    }

    let mut dismount_pos = next.pos.clone();
    if let Some(entity) = ctx.db.entity().id().find(&next.mounted_vehicle_id) {
        if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&next.mounted_vehicle_id) {
            ctx.db.vehicle().entity_id().update(Vehicle {
                pilot_identity: None,
                input_forward: 0.0,
                input_strafe: 0.0,
                input_lift: 0.0,
                input_yaw: 0.0,
                boosting: false,
                ..vehicle
            });
        }

        let right_x = entity.rot.yaw.cos();
        let right_z = -entity.rot.yaw.sin();
        dismount_pos = Vec3 {
            x: entity.pos.x + right_x * 3.4,
            y: entity.pos.y,
            z: entity.pos.z + right_z * 3.4,
        };
    }

    if force_to_ground {
        let gy =
            helicopter_ground_rest_height(ctx, dismount_pos.x, dismount_pos.z) + PLAYER_EYE_HEIGHT;
        dismount_pos.y = gy.max(0.0);
    }

    next.pos = clamp_pos(&dismount_pos);
    next.vel = ZERO_VEL;
    next.mounted_vehicle_id = 0;
    next
}

// ── Chunk Modification Helpers ──

/// Destroy blocks in the world by modifying WorldChunk data.
/// Returns the positions and block types of blocks that were actually solid (and are now air).
fn destroy_blocks_in_world(
    ctx: &ReducerContext,
    blocks: &[(i32, i32, i32)],
) -> Vec<(i32, i32, i32, u8)> {
    let mut actually_destroyed = Vec::new();

    // Group by chunk
    let mut chunks_affected: HashMap<u32, Vec<(i32, i32, i32, usize, usize, usize)>> =
        HashMap::new();

    for &(x, y, z) in blocks {
        if !block_in_bounds(x, y, z) {
            continue;
        }
        let cx = (x / CHUNK_SIZE as i32) as u8;
        let cy = (y / CHUNK_SIZE as i32) as u8;
        let cz = (z / CHUNK_SIZE as i32) as u8;
        let chunk_id = worldgen::pack_chunk_id(cx, cy, cz);
        let lx = (x % CHUNK_SIZE as i32) as usize;
        let ly = (y % CHUNK_SIZE as i32) as usize;
        let lz = (z % CHUNK_SIZE as i32) as usize;
        chunks_affected
            .entry(chunk_id)
            .or_default()
            .push((x, y, z, lx, ly, lz));
    }

    for (chunk_id, local_blocks) in chunks_affected {
        if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
            let mut block_data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
            worldgen::rle_decode(&chunk.data, &mut block_data);

            let mut modified = false;
            for (x, y, z, lx, ly, lz) in local_blocks {
                let local_idx = lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE;
                let block_type = block_data[local_idx];
                if block_type != AIR {
                    block_data[local_idx] = AIR;
                    actually_destroyed.push((x, y, z, block_type));
                    modified = true;
                }
            }

            if modified {
                let new_data = worldgen::rle_encode(&block_data);
                ctx.db.world_chunk().chunk_id().update(WorldChunk {
                    data: new_data,
                    version: chunk.version + 1,
                    ..chunk
                });
            }
        }
    }

    actually_destroyed
}

/// Decompress chunks near the given positions into a sparse map.
/// Loads chunks within a local radius around each probe position.
fn decompress_nearby_chunks(
    ctx: &ReducerContext,
    positions: &[(i32, i32, i32)],
) -> StdHashMap<u32, [u8; 4096]> {
    let mut needed_chunks = std::collections::HashSet::new();
    let radius = 4i32; // chunk radius to load around each position

    for &(px, py, pz) in positions {
        let pcx = px / CHUNK_SIZE as i32;
        let pcy = py / CHUNK_SIZE as i32;
        let pcz = pz / CHUNK_SIZE as i32;
        for dcx in -radius..=radius {
            for dcy in -radius..=radius {
                for dcz in -radius..=radius {
                    let cx = pcx + dcx;
                    let cy = pcy + dcy;
                    let cz = pcz + dcz;
                    if cx >= 0
                        && cx < NUM_CHUNKS_X as i32
                        && cy >= 0
                        && cy < NUM_CHUNKS_Y as i32
                        && cz >= 0
                        && cz < NUM_CHUNKS_Z as i32
                    {
                        needed_chunks.insert(worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8));
                    }
                }
            }
        }
    }

    let mut result = StdHashMap::new();
    for chunk_id in needed_chunks {
        if let Some(chunk) = ctx.db.world_chunk().chunk_id().find(chunk_id) {
            let mut data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
            worldgen::rle_decode(&chunk.data, &mut data);
            result.insert(chunk_id, data);
        }
    }
    result
}

/// Run structural integrity check after block destruction.
/// Uses sparse chunk loading (only nearby chunks) to avoid huge memory allocation.
fn run_structural_check(ctx: &ReducerContext, destroyed_positions: &[(i32, i32, i32)]) {
    if destroyed_positions.is_empty() {
        return;
    }

    let max_structural_cascade_steps: usize = 6;

    let mut frontier: Vec<(i32, i32, i32)> = destroyed_positions.to_vec();
    let mut total_components = 0usize;
    let mut total_detached = 0usize;

    for _ in 0..max_structural_cascade_steps {
        if frontier.is_empty() {
            break;
        }

        let chunks = decompress_nearby_chunks(ctx, &frontier);
        let collapse_plans = worldgen::check_structural_integrity_sparse(&chunks, &frontier);
        if collapse_plans.is_empty() {
            break;
        }

        let mut candidate_coords: Vec<(i32, i32, i32)> = Vec::new();
        for plan in &collapse_plans {
            candidate_coords.extend(plan.blocks.iter().map(|&(x, y, z, _)| (x, y, z)));
        }

        // Remove detached blocks from authoritative world first.
        let actually_detached = destroy_blocks_in_world(ctx, &candidate_coords);
        if actually_detached.is_empty() {
            break;
        }

        let detached_set: std::collections::HashSet<(i32, i32, i32)> = actually_detached
            .iter()
            .map(|&(x, y, z, _)| (x, y, z))
            .collect();

        // Emit one event per collapse component with deterministic motion parameters.
        for plan in collapse_plans {
            let filtered_blocks: Vec<(i32, i32, i32, u8)> = plan
                .blocks
                .into_iter()
                .filter(|(x, y, z, _)| detached_set.contains(&(*x, *y, *z)))
                .collect();
            if filtered_blocks.is_empty() {
                continue;
            }

            let blocks_x: Vec<i32> = filtered_blocks.iter().map(|&(x, _, _, _)| x).collect();
            let blocks_y: Vec<i32> = filtered_blocks.iter().map(|&(_, y, _, _)| y).collect();
            let blocks_z: Vec<i32> = filtered_blocks.iter().map(|&(_, _, z, _)| z).collect();
            let block_types: Vec<u8> = filtered_blocks.iter().map(|&(_, _, _, bt)| bt).collect();

            ctx.db.detach_event().insert(DetachEvent {
                id: 0,
                blocks_x,
                blocks_y,
                blocks_z,
                block_types,
                motion_mode: plan.motion_mode,
                pivot: vec3_from_tuple(plan.pivot),
                axis: vec3_from_tuple(plan.axis),
                drift: vec3_from_tuple(plan.drift),
                fracture_origin: vec3_from_tuple(plan.fracture_origin),
                fracture_dir: vec3_from_tuple(plan.fracture_dir),
                ang_accel: plan.ang_accel,
                initial_ang_vel: plan.initial_ang_vel,
                gravity_scale: plan.gravity_scale,
                fracture_speed: plan.fracture_speed,
                lifetime_ms: plan.lifetime_ms,
                created_at: ctx.timestamp,
            });
            total_components += 1;
        }

        total_detached += actually_detached.len();
        frontier = actually_detached
            .iter()
            .map(|&(x, y, z, _)| (x, y, z))
            .collect();
    }

    if total_detached > 0 {
        log::info!(
            "Structural check: {} components, {} detached blocks",
            total_components,
            total_detached
        );
    }
}

// ── Lifecycle Reducers ──

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    log::info!("BitWars module initialized — generating world...");

    let seed = timestamp_micros(ctx.timestamp);

    // Create world config
    ctx.db.world_config().insert(WorldConfig {
        id: 1,
        seed,
        round_number: 1,
        round_start: ctx.timestamp,
    });

    // Generate only spawn-area chunks (5x3x5 around center)
    let center_cx = (WORLD_SIZE_X / 2 / CHUNK_SIZE) as i32;
    let center_cz = (WORLD_SIZE_Z / 2 / CHUNK_SIZE) as i32;
    let mut chunk_count = 0;
    for dcx in -2..=2 {
        for dcz in -2..=2 {
            let cx = center_cx + dcx;
            let cz = center_cz + dcz;
            if cx < 0 || cx >= NUM_CHUNKS_X as i32 || cz < 0 || cz >= NUM_CHUNKS_Z as i32 {
                continue;
            }
            for cy in 0..NUM_CHUNKS_Y as i32 {
                let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, seed);
                let chunk_id = worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                ctx.db.world_chunk().insert(WorldChunk {
                    chunk_id,
                    cx: cx as u8,
                    cy: cy as u8,
                    cz: cz as u8,
                    data,
                    version: 1,
                });
                chunk_count += 1;
            }
        }
    }

    log::info!(
        "World generation complete: {} spawn-area chunks stored (seed={})",
        chunk_count,
        seed
    );

    // Schedule periodic DetachEvent cleanup
    ctx.db.detach_cleanup().insert(DetachCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(5)),
    });

    // Schedule periodic ShotEvent + ExplosionEvent cleanup
    ctx.db.shot_cleanup().insert(ShotCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(3)),
    });

    // Schedule first map reset in 5 minutes
    ctx.db.map_reset_timer().insert(MapResetTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(300)),
    });

    // Initialize world environment with random time and weather
    let initial_time = ((seed % 2400) as f32) / 100.0; // 0.0 - 24.0
    let initial_weather = ((seed / 2400) % 5) as u8;
    let wind = ((seed % 100) as f32) / 100.0;
    let cloud = match initial_weather {
        0 => 0.1 + ((seed % 20) as f32) / 100.0,
        1 => 0.4 + ((seed % 30) as f32) / 100.0,
        2 => 0.7 + ((seed % 20) as f32) / 100.0,
        3 => 0.6 + ((seed % 30) as f32) / 100.0,
        4 => 0.8 + ((seed % 20) as f32) / 100.0,
        _ => 0.3,
    };
    let fog = match initial_weather {
        0 => 0.6,
        1 => 0.8,
        2 => 1.2,
        3 => 1.5,
        4 => 1.8,
        _ => 1.0,
    };

    ctx.db.world_environment().insert(WorldEnvironment {
        id: 1,
        time_of_day: initial_time,
        weather: initial_weather,
        wind_speed: wind,
        cloud_density: cloud,
        fog_density: fog,
        last_weather_change: ctx.timestamp,
    });

    // Schedule first environment tick (every 10 seconds)
    ctx.db.environment_tick().insert(EnvironmentTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(10)),
    });

    // Schedule first health regen tick (every 1 second)
    ctx.db.health_regen_tick().insert(HealthRegenTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1)),
    });

    // Schedule vehicle simulation tick (20Hz)
    ctx.db.vehicle_tick().insert(VehicleTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(50)),
    });

    // Spawn sandbox vehicles (helicopters)
    spawn_sandbox_helicopters(ctx);

    log::info!(
        "Environment initialized: time={:.1}h, weather={}",
        initial_time,
        initial_weather
    );
}

#[reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(sender) {
        let entity_id = ensure_player_entity(ctx, &player);
        let loadout = normalize_or_create_player_loadout(ctx, &player.username);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };
        let character_preset = normalize_character_preset(player.character_preset);

        ctx.db.player().identity().update(Player {
            online: true,
            pos: SPAWN_POS,
            vel: ZERO_VEL,
            health: MAX_HEALTH,
            spawn_protected: true,
            current_weapon,
            character_preset,
            entity_id,
            mounted_vehicle_id: 0,
            ..player
        });
        if let Some(updated) = ctx.db.player().identity().find(sender) {
            sync_player_entity(ctx, &updated);
        }
        init_weapon_state(ctx, sender);
        init_movement_state(ctx, sender, &SPAWN_POS);
        if player.mounted_vehicle_id != 0 {
            if let Some(vehicle) = ctx
                .db
                .vehicle()
                .entity_id()
                .find(&player.mounted_vehicle_id)
            {
                ctx.db.vehicle().entity_id().update(Vehicle {
                    pilot_identity: Some(sender),
                    ..vehicle
                });
            }
        }
        log::info!("Player reconnected: {:?}", sender);
    }
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(sender) {
        let disconnected = dismount_player_internal(ctx, player, true);
        let disconnected = Player {
            online: false,
            ..disconnected
        };
        ctx.db.player().identity().update(disconnected.clone());
        sync_player_entity(ctx, &disconnected);
        log::info!("Player disconnected: {:?}", sender);
    }
}

// ── Player Reducers ──

#[reducer]
pub fn set_username(
    ctx: &ReducerContext,
    username: String,
    character_preset: u8,
) -> Result<(), String> {
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 20 {
        return Err("Username must be 1-20 characters".to_string());
    }
    let character_preset = normalize_character_preset(character_preset);

    let sender = ctx.sender();
    for p in ctx.db.player().iter() {
        if p.username == username && p.identity != sender {
            return Err("Username already taken".to_string());
        }
    }

    let loadout = normalize_or_create_player_loadout(ctx, &username);

    if let Some(player) = ctx.db.player().identity().find(sender) {
        let entity_id = ensure_player_entity(ctx, &player);
        let current_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
            player.current_weapon
        } else {
            loadout.slot1
        };

        ctx.db.player().identity().update(Player {
            username,
            current_weapon,
            character_preset,
            entity_id,
            ..player
        });
    } else {
        let base_rot = Rotation {
            yaw: 0.0,
            pitch: 0.0,
        };
        let entity_id = create_player_entity(ctx, &SPAWN_POS, &ZERO_VEL, &base_rot);
        ctx.db.player().insert(Player {
            identity: sender,
            entity_id,
            username,
            character_preset,
            pos: SPAWN_POS,
            vel: ZERO_VEL,
            rot: base_rot,
            health: MAX_HEALTH,
            max_health: MAX_HEALTH,
            current_weapon: loadout.slot1,
            kills: 0,
            deaths: 0,
            spawn_protected: true,
            online: true,
            mounted_vehicle_id: 0,
            joined_at: ctx.timestamp,
            last_damage_time: ctx.timestamp,
        });
        init_weapon_state(ctx, sender);
    }

    init_movement_state(ctx, sender, &SPAWN_POS);
    if let Some(updated) = ctx.db.player().identity().find(sender) {
        sync_player_entity(ctx, &updated);
    }
    Ok(())
}

#[reducer]
pub fn update_position(
    ctx: &ReducerContext,
    pos: Vec3,
    vel: Vec3,
    rot: Rotation,
    weapon: u8,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    let selected_weapon = if weapon_in_loadout(&loadout, weapon) {
        weapon
    } else {
        loadout.slot1
    };

    if player.mounted_vehicle_id != 0 {
        if let Some(vehicle) = ctx
            .db
            .vehicle()
            .entity_id()
            .find(&player.mounted_vehicle_id)
        {
            if vehicle.pilot_identity != Some(sender) {
                return Err("Vehicle occupied".to_string());
            }
        } else {
            let dismounted = Player {
                mounted_vehicle_id: 0,
                ..player
            };
            ctx.db.player().identity().update(dismounted.clone());
            sync_player_entity(ctx, &dismounted);
            return Ok(());
        }

        if let Some(vehicle_entity) = ctx.db.entity().id().find(&player.mounted_vehicle_id) {
            let mounted = Player {
                pos: Vec3 {
                    x: vehicle_entity.pos.x,
                    y: vehicle_entity.pos.y + HELI_PILOT_SEAT_HEIGHT,
                    z: vehicle_entity.pos.z,
                },
                vel: vehicle_entity.vel.clone(),
                rot,
                current_weapon: selected_weapon,
                spawn_protected: false,
                ..player
            };
            ctx.db.player().identity().update(mounted.clone());
            sync_player_entity(ctx, &mounted);
        }
        return Ok(());
    }

    let clamped_pos = clamp_pos(&pos);
    let admin_bypass = is_admin(&player.username);

    // Speed validation (bypassed for admins — fly mode)
    if !admin_bypass {
        if let Some(mv_state) = ctx.db.player_movement().identity().find(sender) {
            let now_us = timestamp_micros(ctx.timestamp);
            let last_us = timestamp_micros(mv_state.last_update);
            let dt = (now_us.saturating_sub(last_us)) as f64 / 1_000_000.0;

            if dt > 0.01 {
                if dt > 0.4 {
                    ctx.db
                        .player_movement()
                        .identity()
                        .update(PlayerMovementState {
                            identity: sender,
                            last_pos: clamped_pos.clone(),
                            last_update: ctx.timestamp,
                            violation_count: 0,
                        });
                    let spawn_protected = if player.spawn_protected {
                        !is_grounded(ctx, &clamped_pos)
                    } else {
                        false
                    };

                    let updated = Player {
                        pos: clamped_pos,
                        vel,
                        rot,
                        current_weapon: selected_weapon,
                        spawn_protected,
                        ..player
                    };
                    ctx.db.player().identity().update(updated.clone());
                    sync_player_entity(ctx, &updated);
                    return Ok(());
                }

                let d_sq = dist_sq(&clamped_pos, &mv_state.last_pos);
                let dist = d_sq.sqrt();
                let speed = dist / dt as f32;

                if speed > MAX_MOVEMENT_SPEED {
                    let new_violations = mv_state.violation_count + 1;

                    if new_violations > SPEED_VIOLATION_THRESHOLD {
                        let corrected = Player {
                            pos: mv_state.last_pos.clone(),
                            rot,
                            current_weapon: selected_weapon,
                            ..player
                        };
                        ctx.db.player().identity().update(corrected.clone());
                        sync_player_entity(ctx, &corrected);
                        ctx.db
                            .player_movement()
                            .identity()
                            .update(PlayerMovementState {
                                identity: sender,
                                last_pos: mv_state.last_pos,
                                last_update: ctx.timestamp,
                                violation_count: 0,
                            });
                        return Ok(());
                    }

                    ctx.db
                        .player_movement()
                        .identity()
                        .update(PlayerMovementState {
                            identity: sender,
                            last_pos: clamped_pos.clone(),
                            last_update: ctx.timestamp,
                            violation_count: new_violations,
                        });
                } else {
                    ctx.db
                        .player_movement()
                        .identity()
                        .update(PlayerMovementState {
                            identity: sender,
                            last_pos: clamped_pos.clone(),
                            last_update: ctx.timestamp,
                            violation_count: 0,
                        });
                }
            }
        } else {
            init_movement_state(ctx, sender, &clamped_pos);
        }
    } // end admin_bypass

    let spawn_protected = if player.spawn_protected {
        !is_grounded(ctx, &clamped_pos)
    } else {
        false
    };

    let updated = Player {
        pos: clamped_pos,
        vel,
        rot,
        current_weapon: selected_weapon,
        spawn_protected,
        ..player
    };
    ctx.db.player().identity().update(updated.clone());
    sync_player_entity(ctx, &updated);

    Ok(())
}

#[reducer]
pub fn interact_vehicle(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if player.mounted_vehicle_id != 0 {
        let dismounted = dismount_player_internal(ctx, player, true);
        ctx.db.player().identity().update(dismounted.clone());
        init_movement_state(ctx, sender, &dismounted.pos);
        sync_player_entity(ctx, &dismounted);
        return Ok(());
    }

    let mut best_vehicle: Option<(u64, Vec3, f32)> = None;
    for v in ctx.db.vehicle().iter() {
        if v.vehicle_type != VEHICLE_TYPE_HELICOPTER {
            continue;
        }
        if v.pilot_identity.is_some() {
            continue;
        }
        let Some(entity) = ctx.db.entity().id().find(&v.entity_id) else {
            continue;
        };
        if !entity.active {
            continue;
        }

        let d2 = dist_sq(&player.pos, &entity.pos);
        if d2 > HELI_MOUNT_RANGE * HELI_MOUNT_RANGE {
            continue;
        }

        match &best_vehicle {
            Some((_, _, best_d2)) if *best_d2 <= d2 => {}
            _ => best_vehicle = Some((v.entity_id, entity.pos.clone(), d2)),
        }
    }

    let (vehicle_id, vehicle_pos, _) = best_vehicle.ok_or("No vehicle in range")?;

    if let Some(vehicle) = ctx.db.vehicle().entity_id().find(&vehicle_id) {
        ctx.db.vehicle().entity_id().update(Vehicle {
            pilot_identity: Some(sender),
            input_forward: 0.0,
            input_strafe: 0.0,
            input_lift: 0.0,
            input_yaw: 0.0,
            boosting: false,
            last_input_at: ctx.timestamp,
            ..vehicle
        });
    }

    let mounted = Player {
        mounted_vehicle_id: vehicle_id,
        spawn_protected: false,
        pos: Vec3 {
            x: vehicle_pos.x,
            y: vehicle_pos.y + HELI_PILOT_SEAT_HEIGHT,
            z: vehicle_pos.z,
        },
        vel: ZERO_VEL,
        ..player
    };
    ctx.db.player().identity().update(mounted.clone());
    init_movement_state(ctx, sender, &mounted.pos);
    sync_player_entity(ctx, &mounted);

    Ok(())
}

#[reducer]
pub fn update_vehicle_input(
    ctx: &ReducerContext,
    forward: f32,
    strafe: f32,
    lift: f32,
    yaw: f32,
    boosting: bool,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if player.mounted_vehicle_id == 0 {
        return Err("Not mounted".to_string());
    }

    let mut vehicle = ctx
        .db
        .vehicle()
        .entity_id()
        .find(&player.mounted_vehicle_id)
        .ok_or("Vehicle not found")?;

    if vehicle.pilot_identity != Some(sender) {
        return Err("Not pilot".to_string());
    }

    vehicle.input_forward = clamp_vehicle_axis(forward);
    vehicle.input_strafe = clamp_vehicle_axis(strafe);
    vehicle.input_lift = clamp_vehicle_axis(lift);
    vehicle.input_yaw = clamp_vehicle_axis(yaw);
    vehicle.boosting = boosting;
    vehicle.last_input_at = ctx.timestamp;
    ctx.db.vehicle().entity_id().update(vehicle);

    Ok(())
}

// ── Combat Reducers ──

#[reducer]
pub fn fire_weapon(
    ctx: &ReducerContext,
    origin: Vec3,
    direction: Vec3,
    weapon: u8,
    hit_players: Vec<Identity>,
    hit_blocks: Vec<Vec3>,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if weapon >= NUM_WEAPONS {
        return Err("Invalid weapon".to_string());
    }

    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    if !weapon_in_loadout(&loadout, weapon) {
        return Err("Weapon not in loadout".to_string());
    }

    if player.health <= 0 {
        return Err("Cannot fire while dead".to_string());
    }

    if player.spawn_protected {
        return Err("Cannot fire while spawn protected".to_string());
    }

    if player.mounted_vehicle_id != 0 {
        return Err("Cannot fire while piloting".to_string());
    }

    let def = &WEAPON_DEFS[weapon as usize];
    let mut wstate = ctx
        .db
        .player_weapon_state()
        .identity()
        .find(sender)
        .ok_or("No weapon state")?;

    // 1. Fire rate check (150ms tolerance for network jitter)
    let now_us = timestamp_micros(ctx.timestamp);
    let last_us = timestamp_micros(wstate.last_fire_time);
    let cooldown_us = (1_000_000.0 / def.fire_rate) as u64;
    if now_us.saturating_sub(last_us) < cooldown_us.saturating_sub(150_000) {
        return Err("Firing too fast".to_string());
    }

    // 2. Ammo check
    let current_ammo = get_ammo(&wstate, weapon);
    if current_ammo <= 0 {
        return Err("No ammo".to_string());
    }

    // 3. Origin validation (generous to account for network latency —
    //    at 35 u/s max speed, 143ms delay = 5 unit drift)
    if dist_sq(&origin, &player.pos) > 25.0 {
        return Err("Shot origin too far from player".to_string());
    }

    // 4. Deduct ammo and update fire time
    set_ammo(&mut wstate, weapon, current_ammo - 1);
    wstate.last_fire_time = ctx.timestamp;
    ctx.db.player_weapon_state().identity().update(wstate);

    // 4b. Projectile weapons: skip hit validation, just record shot event
    if def.projectile_speed > 0.0 {
        ctx.db.shot_event().insert(ShotEvent {
            id: 0,
            shooter: sender,
            origin,
            direction,
            hit_pos: ZERO_VEL,
            has_hit: false,
            weapon,
            fired_at: ctx.timestamp,
        });
        return Ok(());
    }

    // 5. Validate + apply player hits
    let dir_len =
        (direction.x * direction.x + direction.y * direction.y + direction.z * direction.z).sqrt();

    for target_id in &hit_players {
        if *target_id == sender {
            continue;
        }

        if let Some(target) = ctx.db.player().identity().find(*target_id) {
            if target.health <= 0 || !target.online || target.spawn_protected {
                continue;
            }

            // God mode protection
            if target.max_health >= 9999 {
                continue;
            }

            let target_dist_sq = dist_sq(&origin, &target.pos);
            let max_range = def.max_range + 3.0;
            if target_dist_sq > max_range * max_range {
                continue;
            }

            if dir_len > 0.01 {
                let to_x = target.pos.x - origin.x;
                let to_y = target.pos.y - origin.y;
                let to_z = target.pos.z - origin.z;
                let to_len = (to_x * to_x + to_y * to_y + to_z * to_z).sqrt();

                if to_len > 0.1 {
                    let dot = (to_x * direction.x + to_y * direction.y + to_z * direction.z)
                        / (to_len * dir_len);
                    if dot < 0.5 {
                        continue;
                    }
                }
            }

            let new_health = (target.health - def.damage).max(0);
            ctx.db.player().identity().update(Player {
                health: new_health,
                last_damage_time: ctx.timestamp,
                ..target
            });

            if new_health == 0 {
                if let Some(attacker) = ctx.db.player().identity().find(sender) {
                    ctx.db.player().identity().update(Player {
                        kills: attacker.kills + 1,
                        ..attacker
                    });
                }
                if let Some(dead) = ctx.db.player().identity().find(*target_id) {
                    ctx.db.player().identity().update(Player {
                        deaths: dead.deaths + 1,
                        ..dead
                    });
                }
                log::info!("{:?} killed {:?}", sender, target_id);
            }
        }
    }

    // 6. Validate + apply block destruction via WorldChunks
    if hit_blocks.len() > 500 {
        return Err("Too many blocks".to_string());
    }

    let block_coords: Vec<(i32, i32, i32)> = hit_blocks
        .iter()
        .filter(|block| {
            let bx = block.x as i32;
            let by = block.y as i32;
            let bz = block.z as i32;
            if !block_in_bounds(bx, by, bz) {
                return false;
            }
            let block_dist_sq = dist_sq(&origin, block);
            let max_block_range = def.max_range + 5.0;
            block_dist_sq <= max_block_range * max_block_range
        })
        .map(|b| (b.x as i32, b.y as i32, b.z as i32))
        .collect();

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    // 7. Determine hit position for remote VFX
    let (shot_hit_pos, shot_has_hit) = if !actually_destroyed.is_empty() {
        let first = &actually_destroyed[0];
        (
            Vec3 {
                x: first.0 as f32,
                y: first.1 as f32,
                z: first.2 as f32,
            },
            true,
        )
    } else if !hit_players.is_empty() {
        // Use the first hit player's position as impact
        if let Some(target) = ctx.db.player().identity().find(hit_players[0]) {
            (target.pos.clone(), true)
        } else {
            (ZERO_VEL, false)
        }
    } else {
        (ZERO_VEL, false)
    };

    // 8. Record shot event
    ctx.db.shot_event().insert(ShotEvent {
        id: 0,
        shooter: sender,
        origin: origin.clone(),
        direction,
        hit_pos: shot_hit_pos,
        has_hit: shot_has_hit,
        weapon,
        fired_at: ctx.timestamp,
    });

    // 9. Emit explosion event if weapon has radius (e.g., shotgun)
    if def.radius > 0.0 && !actually_destroyed.is_empty() {
        let center = &actually_destroyed[0];
        ctx.db.explosion_event().insert(ExplosionEvent {
            id: 0,
            origin: sender,
            pos: Vec3 {
                x: center.0 as f32,
                y: center.1 as f32,
                z: center.2 as f32,
            },
            radius: def.radius,
            weapon,
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
    }

    Ok(())
}

#[reducer]
pub fn reload_weapon(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let weapon = player.current_weapon;
    if weapon >= NUM_WEAPONS {
        return Err("Invalid weapon".to_string());
    }

    let mut wstate = ctx
        .db
        .player_weapon_state()
        .identity()
        .find(sender)
        .ok_or("No weapon state")?;

    let def = &WEAPON_DEFS[weapon as usize];
    set_ammo(&mut wstate, weapon, def.max_ammo);
    ctx.db.player_weapon_state().identity().update(wstate);

    Ok(())
}

#[reducer]
pub fn set_loadout(ctx: &ReducerContext, slot1: u8, slot2: u8, slot3: u8) -> Result<(), String> {
    if !loadout_slots_valid(slot1, slot2, slot3) {
        return Err("Loadout must contain 3 unique valid weapons".to_string());
    }

    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if player.username.trim().is_empty() {
        return Err("Set username first".to_string());
    }

    let username = player.username.clone();
    let updated = PlayerLoadout {
        username: username.clone(),
        slot1,
        slot2,
        slot3,
        updated_at: ctx.timestamp,
    };

    if ctx.db.player_loadout().username().find(&username).is_some() {
        ctx.db.player_loadout().username().update(updated);
    } else {
        ctx.db.player_loadout().insert(updated);
    }

    if !weapon_in_loadout(
        &PlayerLoadout {
            username,
            slot1,
            slot2,
            slot3,
            updated_at: ctx.timestamp,
        },
        player.current_weapon,
    ) {
        let switched = Player {
            current_weapon: slot1,
            ..player
        };
        ctx.db.player().identity().update(switched.clone());
        sync_player_entity(ctx, &switched);
    }

    Ok(())
}

/// Destroy blocks from physics simulation (falling blocks, cascades).
/// Separate from fire_weapon because physics blocks can be far from player.
#[reducer]
pub fn destroy_blocks_physics(ctx: &ReducerContext, blocks: Vec<Vec3>) -> Result<(), String> {
    let sender = ctx.sender();
    // We still verify the player exists, but don't check health —
    // projectiles launched while alive should still impact after death.
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if blocks.len() > 500 {
        return Err("Too many blocks in one call".to_string());
    }

    let block_coords: Vec<(i32, i32, i32)> = blocks
        .iter()
        .filter(|b| block_in_bounds(b.x as i32, b.y as i32, b.z as i32))
        .map(|b| (b.x as i32, b.y as i32, b.z as i32))
        .collect();

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    Ok(())
}

#[reducer]
pub fn sync_entity_transform(
    ctx: &ReducerContext,
    entity_id: u64,
    pos: Vec3,
    vel: Vec3,
    rot: Rotation,
) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if player.entity_id != entity_id {
        return Err("Entity mismatch".to_string());
    }

    if let Some(entity) = ctx.db.entity().id().find(&entity_id) {
        if entity.kind != ENTITY_KIND_PLAYER {
            return Err("Not a player entity".to_string());
        }
        ctx.db.entity().id().update(Entity {
            pos,
            vel,
            rot,
            active: player.online,
            updated_at: ctx.timestamp,
            ..entity
        });
    }

    Ok(())
}

#[reducer]
pub fn respawn(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    let loadout = normalize_or_create_player_loadout(ctx, &player.username);
    let respawn_weapon = if weapon_in_loadout(&loadout, player.current_weapon) {
        player.current_weapon
    } else {
        loadout.slot1
    };

    let player = dismount_player_internal(ctx, player, true);

    let respawned = Player {
        health: MAX_HEALTH,
        pos: SPAWN_POS,
        vel: ZERO_VEL,
        spawn_protected: true,
        current_weapon: respawn_weapon,
        rot: Rotation {
            yaw: 0.0,
            pitch: 0.0,
        },
        ..player
    };
    ctx.db.player().identity().update(respawned.clone());
    sync_player_entity(ctx, &respawned);

    if let Some(wstate) = ctx.db.player_weapon_state().identity().find(sender) {
        ctx.db
            .player_weapon_state()
            .identity()
            .update(PlayerWeaponState {
                ammo_rifle: WEAPON_DEFS[0].max_ammo,
                ammo_shotgun: WEAPON_DEFS[1].max_ammo,
                ammo_rpg: WEAPON_DEFS[2].max_ammo,
                ammo_machine_gun: WEAPON_DEFS[3].max_ammo,
                ammo_grenade: WEAPON_DEFS[4].max_ammo,
                ..wstate
            });
    }

    init_movement_state(ctx, sender, &SPAWN_POS);
    Ok(())
}

// ── Admin Commands ──

const ADMIN_USERNAME: &str = "amir";
const ADMIN_HELP_TEXT: &str = "Admin commands:\n/tp <player> or /tp <x> <y> <z>\n/tphere <player>\n/kill <player>\n/heal [player]\n/god\n/fly\n/ammo\n/weather <0-4>\n/time <0-24>\n/announce <message>\n/killall\n/respawnall";

fn is_admin(username: &str) -> bool {
    username.to_lowercase() == ADMIN_USERNAME
}

fn find_player_by_name(ctx: &ReducerContext, name: &str) -> Option<Player> {
    let name_lower = name.to_lowercase();
    ctx.db
        .player()
        .iter()
        .find(|p| p.username.to_lowercase() == name_lower)
}

fn insert_system_message(ctx: &ReducerContext, text: &str) {
    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender: ctx.sender(),
        sender_name: "[SERVER]".to_string(),
        text: text.to_string(),
        sent_at: ctx.timestamp,
    });
}

fn insert_admin_help(ctx: &ReducerContext) {
    insert_system_message(ctx, ADMIN_HELP_TEXT);
}

fn insert_command_help(ctx: &ReducerContext, reason: &str) {
    insert_system_message(ctx, &format!("{}\n\n{}", reason, ADMIN_HELP_TEXT));
}

fn process_admin_command(ctx: &ReducerContext, sender: Identity, text: &str) -> Result<(), String> {
    let parts: Vec<&str> = text.split_whitespace().collect();
    if parts.is_empty() {
        insert_admin_help(ctx);
        return Ok(());
    }

    let cmd = parts[0].to_lowercase();

    match cmd.as_str() {
        "/tp" => {
            if parts.len() == 4 {
                // /tp x y z
                let x: f32 = parts[1]
                    .parse()
                    .map_err(|_| "Invalid x coordinate".to_string())?;
                let y: f32 = parts[2]
                    .parse()
                    .map_err(|_| "Invalid y coordinate".to_string())?;
                let z: f32 = parts[3]
                    .parse()
                    .map_err(|_| "Invalid z coordinate".to_string())?;
                let new_pos = Vec3 { x, y, z };

                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let player = dismount_player_internal(ctx, player, true);
                let next = Player {
                    pos: new_pos.clone(),
                    ..player
                };
                ctx.db.player().identity().update(next.clone());
                sync_player_entity(ctx, &next);
                init_movement_state(ctx, sender, &new_pos);
                insert_system_message(
                    ctx,
                    &format!("Teleported to ({:.1}, {:.1}, {:.1})", x, y, z),
                );
            } else if parts.len() == 2 {
                // /tp <player>
                let target =
                    find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
                let target_pos = target.pos.clone();
                let target_name = target.username.clone();

                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let player = dismount_player_internal(ctx, player, true);
                let next = Player {
                    pos: target_pos.clone(),
                    ..player
                };
                ctx.db.player().identity().update(next.clone());
                sync_player_entity(ctx, &next);
                init_movement_state(ctx, sender, &target_pos);
                insert_system_message(ctx, &format!("Teleported to {}", target_name));
            } else {
                insert_command_help(ctx, "Usage: /tp <player> or /tp <x> <y> <z>");
                return Ok(());
            }
            Ok(())
        }

        "/tphere" | "/summon" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /tphere <player>");
                return Ok(());
            }
            let admin = ctx
                .db
                .player()
                .identity()
                .find(sender)
                .ok_or("Not registered")?;
            let admin_pos = admin.pos.clone();

            let target =
                find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
            let target = dismount_player_internal(ctx, target, true);
            let target_identity = target.identity;
            let target_name = target.username.clone();
            let moved = Player {
                pos: admin_pos.clone(),
                ..target
            };
            ctx.db.player().identity().update(moved.clone());
            sync_player_entity(ctx, &moved);
            init_movement_state(ctx, target_identity, &admin_pos);
            insert_system_message(ctx, &format!("Summoned {} to your location", target_name));
            Ok(())
        }

        "/kill" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /kill <player>");
                return Ok(());
            }
            let target =
                find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
            let target_name = target.username.clone();
            let target = dismount_player_internal(ctx, target, true);
            let killed = Player {
                health: 0,
                deaths: target.deaths + 1,
                last_damage_time: ctx.timestamp,
                ..target
            };
            ctx.db.player().identity().update(killed.clone());
            sync_player_entity(ctx, &killed);
            insert_system_message(ctx, &format!("Killed {}", target_name));
            Ok(())
        }

        "/heal" => {
            if parts.len() == 1 {
                // Heal self
                let player = ctx
                    .db
                    .player()
                    .identity()
                    .find(sender)
                    .ok_or("Not registered")?;
                let healed = Player {
                    health: MAX_HEALTH,
                    ..player
                };
                ctx.db.player().identity().update(healed.clone());
                sync_player_entity(ctx, &healed);
                insert_system_message(ctx, "Healed yourself");
            } else if parts.len() == 2 {
                let target =
                    find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
                let target_name = target.username.clone();
                let healed = Player {
                    health: target.max_health,
                    ..target
                };
                ctx.db.player().identity().update(healed.clone());
                sync_player_entity(ctx, &healed);
                insert_system_message(ctx, &format!("Healed {}", target_name));
            } else {
                insert_command_help(ctx, "Usage: /heal [player]");
                return Ok(());
            }
            Ok(())
        }

        "/god" => {
            let player = ctx
                .db
                .player()
                .identity()
                .find(sender)
                .ok_or("Not registered")?;
            let is_god = player.max_health >= 9999;
            if is_god {
                let toggled = Player {
                    health: MAX_HEALTH,
                    max_health: MAX_HEALTH,
                    ..player
                };
                ctx.db.player().identity().update(toggled.clone());
                sync_player_entity(ctx, &toggled);
                insert_system_message(ctx, "God mode OFF");
            } else {
                let toggled = Player {
                    health: 9999,
                    max_health: 9999,
                    ..player
                };
                ctx.db.player().identity().update(toggled.clone());
                sync_player_entity(ctx, &toggled);
                insert_system_message(ctx, "God mode ON");
            }
            Ok(())
        }

        "/ammo" => {
            if let Some(wstate) = ctx.db.player_weapon_state().identity().find(sender) {
                ctx.db
                    .player_weapon_state()
                    .identity()
                    .update(PlayerWeaponState {
                        ammo_rifle: 999,
                        ammo_shotgun: 999,
                        ammo_rpg: 999,
                        ammo_machine_gun: 999,
                        ammo_grenade: 999,
                        ..wstate
                    });
            }
            insert_system_message(ctx, "Infinite ammo granted");
            Ok(())
        }

        "/weather" => {
            if parts.len() != 2 {
                insert_command_help(
                    ctx,
                    "Usage: /weather <0-4> (0=Clear 1=Cloudy 2=Overcast 3=Rainy 4=Stormy)",
                );
                return Ok(());
            }
            let w: u8 = parts[1]
                .parse()
                .map_err(|_| "Invalid weather type".to_string())?;
            if w > 4 {
                return Err("Weather must be 0-4".to_string());
            }

            if let Some(env) = ctx.db.world_environment().id().find(1) {
                let cloud = match w {
                    0 => 0.1,
                    1 => 0.5,
                    2 => 0.8,
                    3 => 0.7,
                    4 => 0.9,
                    _ => 0.3,
                };
                let fog = match w {
                    0 => 0.6,
                    1 => 0.8,
                    2 => 1.2,
                    3 => 1.5,
                    4 => 1.8,
                    _ => 1.0,
                };
                let wind = match w {
                    0 => 0.1,
                    1 => 0.3,
                    2 => 0.4,
                    3 => 0.5,
                    4 => 0.8,
                    _ => 0.3,
                };
                let name = match w {
                    0 => "Clear",
                    1 => "Cloudy",
                    2 => "Overcast",
                    3 => "Rainy",
                    4 => "Stormy",
                    _ => "Unknown",
                };
                ctx.db.world_environment().id().update(WorldEnvironment {
                    weather: w,
                    cloud_density: cloud,
                    fog_density: fog,
                    wind_speed: wind,
                    last_weather_change: ctx.timestamp,
                    ..env
                });
                insert_system_message(ctx, &format!("Weather set to {}", name));
            }
            Ok(())
        }

        "/time" => {
            if parts.len() != 2 {
                insert_command_help(ctx, "Usage: /time <0-24>");
                return Ok(());
            }
            let t: f32 = parts[1].parse().map_err(|_| "Invalid time".to_string())?;
            if !(0.0..=24.0).contains(&t) {
                return Err("Time must be 0.0 - 24.0".to_string());
            }

            if let Some(env) = ctx.db.world_environment().id().find(1) {
                ctx.db.world_environment().id().update(WorldEnvironment {
                    time_of_day: t,
                    ..env
                });
                let hours = t as u32;
                let mins = ((t - hours as f32) * 60.0) as u32;
                insert_system_message(ctx, &format!("Time set to {:02}:{:02}", hours, mins));
            }
            Ok(())
        }

        "/announce" => {
            if parts.len() < 2 {
                insert_command_help(ctx, "Usage: /announce <message>");
                return Ok(());
            }
            let msg = parts[1..].join(" ");
            insert_system_message(ctx, &format!("[ANNOUNCEMENT] {}", msg));
            Ok(())
        }

        "/killall" => {
            let target_ids: Vec<Identity> = ctx
                .db
                .player()
                .iter()
                .filter(|p| p.online && p.identity != sender)
                .map(|p| p.identity)
                .collect();

            let count = target_ids.len();
            for id in target_ids {
                if let Some(target) = ctx.db.player().identity().find(id) {
                    let target = dismount_player_internal(ctx, target, true);
                    let killed = Player {
                        health: 0,
                        deaths: target.deaths + 1,
                        last_damage_time: ctx.timestamp,
                        ..target
                    };
                    ctx.db.player().identity().update(killed.clone());
                    sync_player_entity(ctx, &killed);
                }
            }
            insert_system_message(ctx, &format!("Killed {} players", count));
            Ok(())
        }

        "/respawnall" => {
            let target_ids: Vec<Identity> = ctx
                .db
                .player()
                .iter()
                .filter(|p| p.online && p.identity != sender)
                .map(|p| p.identity)
                .collect();

            let count = target_ids.len();
            for id in target_ids {
                if let Some(target) = ctx.db.player().identity().find(id) {
                    let target = dismount_player_internal(ctx, target, true);
                    let respawned = Player {
                        health: MAX_HEALTH,
                        pos: SPAWN_POS,
                        vel: ZERO_VEL,
                        spawn_protected: true,
                        ..target
                    };
                    ctx.db.player().identity().update(respawned.clone());
                    sync_player_entity(ctx, &respawned);
                    init_movement_state(ctx, id, &SPAWN_POS);
                }
            }
            insert_system_message(ctx, &format!("Respawned {} players", count));
            Ok(())
        }

        "/fly" => {
            insert_system_message(ctx, "Fly mode toggled");
            Ok(())
        }

        "/" | "/help" => {
            insert_admin_help(ctx);
            Ok(())
        }

        _ => {
            insert_command_help(ctx, &format!("Unknown command: {}", parts[0]));
            Ok(())
        }
    }
}

// ── Chat ──

#[reducer]
pub fn send_chat(ctx: &ReducerContext, text: String) -> Result<(), String> {
    let text = text.trim().to_string();
    if text.is_empty() || text.len() > 200 {
        return Err("Message must be 1-200 characters".to_string());
    }

    let sender = ctx.sender();
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    // Admin command processing
    if text == "/" || text.eq_ignore_ascii_case("/help") {
        insert_admin_help(ctx);
        return Ok(());
    }

    if text.starts_with('/') {
        if !is_admin(&player.username) {
            return Err("Unknown command".to_string());
        }
        return process_admin_command(ctx, sender, &text);
    }

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender,
        sender_name: player.username,
        text,
        sent_at: ctx.timestamp,
    });

    Ok(())
}

/// Scheduled cleanup: remove old ShotEvents and ExplosionEvents, then reschedule.
#[reducer]
pub fn cleanup_shots_scheduled(ctx: &ReducerContext, _job: ShotCleanup) {
    let now_micros = timestamp_micros(ctx.timestamp);

    // Clean stale shot events (older than 2 seconds)
    let stale_shots: Vec<u64> = ctx
        .db
        .shot_event()
        .iter()
        .filter(|s| {
            let shot_micros = timestamp_micros(s.fired_at);
            now_micros.saturating_sub(shot_micros) > 2_000_000
        })
        .map(|s| s.id)
        .collect();

    for id in stale_shots {
        ctx.db.shot_event().id().delete(&id);
    }

    // Clean stale explosion events (older than 3 seconds)
    let stale_explosions: Vec<u64> = ctx
        .db
        .explosion_event()
        .iter()
        .filter(|e| {
            let ev_micros = timestamp_micros(e.created_at);
            now_micros.saturating_sub(ev_micros) > 3_000_000
        })
        .map(|e| e.id)
        .collect();

    for id in stale_explosions {
        ctx.db.explosion_event().id().delete(&id);
    }

    // Reschedule next cleanup in 3 seconds
    ctx.db.shot_cleanup().insert(ShotCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(3)),
    });
}

/// Scheduled cleanup: remove old DetachEvents and reschedule.
#[reducer]
pub fn cleanup_detach_events(ctx: &ReducerContext, _job: DetachCleanup) {
    let now_micros = timestamp_micros(ctx.timestamp);

    let stale: Vec<u64> = ctx
        .db
        .detach_event()
        .iter()
        .filter(|e| {
            let ev_micros = timestamp_micros(e.created_at);
            now_micros.saturating_sub(ev_micros) > 5_000_000 // 5 seconds
        })
        .map(|e| e.id)
        .collect();

    for id in stale {
        ctx.db.detach_event().id().delete(&id);
    }

    // Reschedule next cleanup in 5 seconds
    ctx.db.detach_cleanup().insert(DetachCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(5)),
    });
}

/// Scheduled vehicle simulation tick (20Hz).
#[reducer]
pub fn tick_vehicles(ctx: &ReducerContext, _job: VehicleTick) {
    let dt = 0.05_f32;
    let mut mounted_updates: Vec<Player> = Vec::new();
    let vehicle_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();

    for entity_id in vehicle_ids {
        let Some(mut vehicle) = ctx.db.vehicle().entity_id().find(&entity_id) else {
            continue;
        };
        if vehicle.vehicle_type != VEHICLE_TYPE_HELICOPTER {
            continue;
        }

        let Some(mut entity) = ctx.db.entity().id().find(&entity_id) else {
            continue;
        };
        if !entity.active {
            continue;
        }

        if let Some(pilot_id) = vehicle.pilot_identity {
            match ctx.db.player().identity().find(pilot_id) {
                Some(pilot) if pilot.online && pilot.health > 0 => {}
                Some(pilot) => {
                    let dismounted = dismount_player_internal(ctx, pilot, true);
                    ctx.db.player().identity().update(dismounted.clone());
                    init_movement_state(ctx, dismounted.identity, &dismounted.pos);
                    sync_player_entity(ctx, &dismounted);
                    if let Some(v) = ctx.db.vehicle().entity_id().find(&entity_id) {
                        vehicle = v;
                    }
                }
                None => {
                    vehicle.pilot_identity = None;
                    vehicle.input_forward = 0.0;
                    vehicle.input_strafe = 0.0;
                    vehicle.input_lift = 0.0;
                    vehicle.input_yaw = 0.0;
                    vehicle.boosting = false;
                }
            }
        }

        let has_pilot = vehicle.pilot_identity.is_some();

        let mut yaw_input = if has_pilot {
            clamp_vehicle_axis(vehicle.input_yaw)
        } else {
            0.0
        };

        if let Some(pilot_id) = vehicle.pilot_identity {
            if let Some(pilot) = ctx.db.player().identity().find(pilot_id) {
                let mut yaw_delta = pilot.rot.yaw - entity.rot.yaw;
                if yaw_delta > std::f32::consts::PI {
                    yaw_delta -= TAU;
                }
                if yaw_delta < -std::f32::consts::PI {
                    yaw_delta += TAU;
                }
                yaw_input = clamp_vehicle_axis(yaw_input + yaw_delta * 0.5);
            }
        }

        let forward_input = if has_pilot {
            clamp_vehicle_axis(vehicle.input_forward)
        } else {
            0.0
        };
        let strafe_input = if has_pilot {
            clamp_vehicle_axis(vehicle.input_strafe)
        } else {
            0.0
        };
        let lift_input = if has_pilot {
            clamp_vehicle_axis(vehicle.input_lift)
        } else {
            0.0
        };

        let boost_mul = if has_pilot && vehicle.boosting {
            1.32
        } else {
            1.0
        };

        let forward_speed = forward_input * HELI_CRUISE_SPEED * boost_mul;
        let strafe_speed = strafe_input * HELI_STRAFE_SPEED * boost_mul;
        let lift_speed = lift_input * HELI_LIFT_SPEED;

        let fx = -entity.rot.yaw.sin();
        let fz = -entity.rot.yaw.cos();
        let rx = entity.rot.yaw.cos();
        let rz = -entity.rot.yaw.sin();

        let target_vx = fx * forward_speed + rx * strafe_speed;
        let target_vz = fz * forward_speed + rz * strafe_speed;
        let target_vy = if has_pilot { lift_speed } else { -2.2 };

        let horiz_blend = if has_pilot { 0.18 } else { 0.09 };
        let vert_blend = if has_pilot { 0.14 } else { 0.06 };
        entity.vel.x += (target_vx - entity.vel.x) * horiz_blend;
        entity.vel.z += (target_vz - entity.vel.z) * horiz_blend;
        entity.vel.y += (target_vy - entity.vel.y) * vert_blend;

        let drag = if has_pilot { 0.992 } else { 0.962 };
        entity.vel.x *= drag;
        entity.vel.z *= drag;
        if !has_pilot {
            entity.vel.y *= 0.995;
        }

        entity.rot.yaw += yaw_input * HELI_YAW_SPEED * dt;
        if entity.rot.yaw > std::f32::consts::PI {
            entity.rot.yaw -= TAU;
        }
        if entity.rot.yaw < -std::f32::consts::PI {
            entity.rot.yaw += TAU;
        }
        entity.rot.pitch = (-entity.vel.y / HELI_LIFT_SPEED).clamp(-0.18, 0.18);

        let mut next_pos = Vec3 {
            x: entity.pos.x + entity.vel.x * dt,
            y: entity.pos.y + entity.vel.y * dt,
            z: entity.pos.z + entity.vel.z * dt,
        };

        let min_x = 2.0;
        let max_x = WORLD_SIZE_X as f32 - 2.0;
        let min_z = 2.0;
        let max_z = WORLD_SIZE_Z as f32 - 2.0;

        if next_pos.x < min_x {
            next_pos.x = min_x;
            entity.vel.x = entity.vel.x.abs() * 0.2;
        }
        if next_pos.x > max_x {
            next_pos.x = max_x;
            entity.vel.x = -entity.vel.x.abs() * 0.2;
        }
        if next_pos.z < min_z {
            next_pos.z = min_z;
            entity.vel.z = entity.vel.z.abs() * 0.2;
        }
        if next_pos.z > max_z {
            next_pos.z = max_z;
            entity.vel.z = -entity.vel.z.abs() * 0.2;
        }

        let ground = helicopter_ground_rest_height(ctx, next_pos.x, next_pos.z);
        let min_alt = ground + HELI_MIN_ALTITUDE_FROM_GROUND;
        if next_pos.y < min_alt {
            next_pos.y = min_alt;
            if entity.vel.y < 0.0 {
                entity.vel.y *= -0.08;
            }
            if !has_pilot {
                entity.vel.y = 0.0;
                entity.vel.x *= 0.93;
                entity.vel.z *= 0.93;
            }
        }
        if next_pos.y > HELI_MAX_ALTITUDE {
            next_pos.y = HELI_MAX_ALTITUDE;
            if entity.vel.y > 0.0 {
                entity.vel.y *= 0.15;
            }
        }

        entity.pos = next_pos;
        entity.updated_at = ctx.timestamp;

        let spin_target = if has_pilot {
            10.0 + (forward_input.abs() + strafe_input.abs()) * 4.0 + lift_input.abs() * 2.0
        } else {
            2.4
        };
        vehicle.rotor_spin = (vehicle.rotor_spin + spin_target * dt) % TAU;

        ctx.db.entity().id().update(entity.clone());
        ctx.db.vehicle().entity_id().update(vehicle.clone());

        if let Some(pilot_id) = vehicle.pilot_identity {
            if let Some(pilot) = ctx.db.player().identity().find(pilot_id) {
                mounted_updates.push(Player {
                    pos: Vec3 {
                        x: entity.pos.x,
                        y: entity.pos.y + HELI_PILOT_SEAT_HEIGHT,
                        z: entity.pos.z,
                    },
                    vel: entity.vel.clone(),
                    spawn_protected: false,
                    ..pilot
                });
            }
        }
    }

    for mounted in mounted_updates {
        ctx.db.player().identity().update(mounted.clone());
        init_movement_state(ctx, mounted.identity, &mounted.pos);
        sync_player_entity(ctx, &mounted);
    }

    ctx.db.vehicle_tick().insert(VehicleTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_millis(50)),
    });
}

/// Scheduled health regen tick: regenerates 5 HP/s for players
/// who haven't taken damage in 10 seconds. Runs every 1 second.
#[reducer]
pub fn tick_health_regen(ctx: &ReducerContext, _job: HealthRegenTick) {
    let now_us = timestamp_micros(ctx.timestamp);
    let regen_delay_us = HEALTH_REGEN_DELAY_SECS * 1_000_000;

    // Collect eligible players first to avoid borrow issues
    let eligible: Vec<Identity> = ctx
        .db
        .player()
        .iter()
        .filter(|p| {
            p.online
                && p.health > 0
                && p.health < p.max_health
                && p.max_health < 9999 // skip god mode
                && now_us.saturating_sub(timestamp_micros(p.last_damage_time)) > regen_delay_us
        })
        .map(|p| p.identity)
        .collect();

    for id in eligible {
        if let Some(p) = ctx.db.player().identity().find(id) {
            let new_health = (p.health + HEALTH_REGEN_RATE).min(p.max_health);
            let healed = Player {
                health: new_health,
                ..p
            };
            ctx.db.player().identity().update(healed.clone());
            sync_player_entity(ctx, &healed);
        }
    }

    // Reschedule next tick in 1 second
    ctx.db.health_regen_tick().insert(HealthRegenTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(1)),
    });
}

/// Scheduled environment tick: advances time of day and occasionally changes weather.
/// Runs every 10 seconds. Each tick advances ~2 game-minutes (full day = ~2 hours real-time).
#[reducer]
pub fn tick_environment(ctx: &ReducerContext, _job: EnvironmentTick) {
    if let Some(env) = ctx.db.world_environment().id().find(1) {
        // Advance time: 10s real = ~2 min game time → 0.0333h per tick
        // Full 24h cycle takes ~120 minutes (2 hours) real time
        let time_advance = 0.0333;
        let mut new_time = env.time_of_day + time_advance;
        if new_time >= 24.0 {
            new_time -= 24.0;
        }

        // Determine if weather should change (use timestamp as pseudo-random)
        let seed = timestamp_micros(ctx.timestamp);
        let since_change = timestamp_micros(ctx.timestamp)
            .saturating_sub(timestamp_micros(env.last_weather_change));
        // Minimum 5 minutes (300s) between weather changes
        let min_weather_interval = 300_000_000u64; // 5 min in microseconds

        let mut new_weather = env.weather;
        let mut new_wind = env.wind_speed;
        let mut new_cloud = env.cloud_density;
        let mut new_fog = env.fog_density;
        let mut weather_changed = false;

        if since_change > min_weather_interval {
            // ~5% chance per tick to change weather (roughly every ~3 min average)
            let roll = (seed % 100) as u8;
            if roll < 5 {
                // Weather transitions: prefer adjacent weather states
                let transition_roll = ((seed / 100) % 100) as u8;
                new_weather = match env.weather {
                    0 => {
                        // Clear → Cloudy (70%) or stays Clear (30%)
                        if transition_roll < 70 {
                            1
                        } else {
                            0
                        }
                    }
                    1 => {
                        // Cloudy → Clear (30%), Overcast (40%), Rainy (30%)
                        if transition_roll < 30 {
                            0
                        } else if transition_roll < 70 {
                            2
                        } else {
                            3
                        }
                    }
                    2 => {
                        // Overcast → Cloudy (40%), Rainy (40%), Stormy (20%)
                        if transition_roll < 40 {
                            1
                        } else if transition_roll < 80 {
                            3
                        } else {
                            4
                        }
                    }
                    3 => {
                        // Rainy → Overcast (30%), Cloudy (30%), Stormy (20%), Clear (20%)
                        if transition_roll < 30 {
                            2
                        } else if transition_roll < 60 {
                            1
                        } else if transition_roll < 80 {
                            4
                        } else {
                            0
                        }
                    }
                    4 => {
                        // Stormy → Rainy (50%), Overcast (30%), Cloudy (20%)
                        if transition_roll < 50 {
                            3
                        } else if transition_roll < 80 {
                            2
                        } else {
                            1
                        }
                    }
                    _ => 0,
                };

                if new_weather != env.weather {
                    weather_changed = true;
                    new_wind = ((seed % 80) as f32 + 10.0) / 100.0;
                    new_cloud = match new_weather {
                        0 => 0.1 + ((seed % 20) as f32) / 100.0,
                        1 => 0.4 + ((seed % 30) as f32) / 100.0,
                        2 => 0.7 + ((seed % 20) as f32) / 100.0,
                        3 => 0.6 + ((seed % 30) as f32) / 100.0,
                        4 => 0.8 + ((seed % 20) as f32) / 100.0,
                        _ => 0.3,
                    };
                    new_fog = match new_weather {
                        0 => 0.6,
                        1 => 0.8,
                        2 => 1.2,
                        3 => 1.5,
                        4 => 1.8,
                        _ => 1.0,
                    };
                    log::info!(
                        "Weather changed: {} → {} at time {:.1}h",
                        env.weather,
                        new_weather,
                        new_time
                    );
                }
            }
        }

        ctx.db.world_environment().id().update(WorldEnvironment {
            id: 1,
            time_of_day: new_time,
            weather: new_weather,
            wind_speed: new_wind,
            cloud_density: new_cloud,
            fog_density: new_fog,
            last_weather_change: if weather_changed {
                ctx.timestamp
            } else {
                env.last_weather_change
            },
        });
    }

    // Reschedule next tick in 10 seconds
    ctx.db.environment_tick().insert(EnvironmentTick {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(10)),
    });
}

// ── Chunk Request Reducer ──

#[reducer]
pub fn request_chunks(ctx: &ReducerContext, chunk_ids: Vec<u32>) -> Result<(), String> {
    let _sender = ctx.sender();
    // Must be registered
    ctx.db
        .player()
        .identity()
        .find(_sender)
        .ok_or("Not registered")?;

    if chunk_ids.len() > 20 {
        return Err("Too many chunks requested (max 20)".to_string());
    }

    let config = ctx
        .db
        .world_config()
        .id()
        .find(1)
        .ok_or("World not initialized")?;

    for chunk_id in chunk_ids {
        // Skip if already exists
        if ctx.db.world_chunk().chunk_id().find(chunk_id).is_some() {
            continue;
        }

        let (cx, cy, cz) = worldgen::unpack_chunk_id(chunk_id);
        // Bounds validation
        if (cx as usize) >= NUM_CHUNKS_X
            || (cy as usize) >= NUM_CHUNKS_Y
            || (cz as usize) >= NUM_CHUNKS_Z
        {
            continue;
        }

        let data = worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, config.seed);
        ctx.db.world_chunk().insert(WorldChunk {
            chunk_id,
            cx,
            cy,
            cz,
            data,
            version: 1,
        });
    }

    Ok(())
}

// ── Map Reset Reducer ──

#[reducer]
pub fn reset_map(ctx: &ReducerContext, _timer: MapResetTimer) {
    log::info!("MAP RESET triggered!");

    // 1. Delete all WorldChunk rows
    let chunk_ids: Vec<u32> = ctx.db.world_chunk().iter().map(|c| c.chunk_id).collect();
    for id in chunk_ids {
        ctx.db.world_chunk().chunk_id().delete(&id);
    }

    // 2. Generate new seed
    let new_seed = timestamp_micros(ctx.timestamp);

    // 3. Update world config
    if let Some(config) = ctx.db.world_config().id().find(1) {
        ctx.db.world_config().id().update(WorldConfig {
            seed: new_seed,
            round_number: config.round_number + 1,
            round_start: ctx.timestamp,
            ..config
        });
    }

    // 4. Respawn all online players
    let player_ids: Vec<Identity> = ctx
        .db
        .player()
        .iter()
        .filter(|p| p.online)
        .map(|p| p.identity)
        .collect();
    for id in player_ids {
        if let Some(p) = ctx.db.player().identity().find(id) {
            let entity_id = ensure_player_entity(ctx, &p);
            let loadout = normalize_or_create_player_loadout(ctx, &p.username);
            let current_weapon = if weapon_in_loadout(&loadout, p.current_weapon) {
                p.current_weapon
            } else {
                loadout.slot1
            };

            let p = dismount_player_internal(ctx, p, true);
            let reset = Player {
                entity_id,
                health: MAX_HEALTH,
                max_health: MAX_HEALTH,
                pos: SPAWN_POS,
                vel: ZERO_VEL,
                kills: 0,
                deaths: 0,
                spawn_protected: true,
                current_weapon,
                ..p
            };
            ctx.db.player().identity().update(reset.clone());
            sync_player_entity(ctx, &reset);
            init_weapon_state(ctx, id);
            init_movement_state(ctx, id, &SPAWN_POS);
        }
    }

    // Remove old vehicle entities for the new map
    let vehicle_entity_ids: Vec<u64> = ctx.db.vehicle().iter().map(|v| v.entity_id).collect();
    for id in vehicle_entity_ids {
        ctx.db.vehicle().entity_id().delete(&id);
    }
    let entity_ids: Vec<u64> = ctx
        .db
        .entity()
        .iter()
        .filter(|e| e.kind == ENTITY_KIND_VEHICLE)
        .map(|e| e.id)
        .collect();
    for id in entity_ids {
        ctx.db.entity().id().delete(&id);
    }

    // 5. Generate spawn-area chunks (5x3x5 around center)
    let center_cx = (WORLD_SIZE_X / 2 / CHUNK_SIZE) as i32;
    let center_cz = (WORLD_SIZE_Z / 2 / CHUNK_SIZE) as i32;
    for dcx in -2..=2 {
        for dcz in -2..=2 {
            let cx = center_cx + dcx;
            let cz = center_cz + dcz;
            if cx < 0 || cx >= NUM_CHUNKS_X as i32 || cz < 0 || cz >= NUM_CHUNKS_Z as i32 {
                continue;
            }
            for cy in 0..NUM_CHUNKS_Y as i32 {
                let data =
                    worldgen::generate_chunk(cx as usize, cy as usize, cz as usize, new_seed);
                let chunk_id = worldgen::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                ctx.db.world_chunk().insert(WorldChunk {
                    chunk_id,
                    cx: cx as u8,
                    cy: cy as u8,
                    cz: cz as u8,
                    data,
                    version: 1,
                });
            }
        }
    }

    // Spawn sandbox vehicles (helicopters) for the new world
    spawn_sandbox_helicopters(ctx);

    // 6. Clean up stale events
    let event_ids: Vec<u64> = ctx.db.detach_event().iter().map(|e| e.id).collect();
    for id in event_ids {
        ctx.db.detach_event().id().delete(&id);
    }
    let shot_ids: Vec<u64> = ctx.db.shot_event().iter().map(|s| s.id).collect();
    for id in shot_ids {
        ctx.db.shot_event().id().delete(&id);
    }
    let explosion_ids: Vec<u64> = ctx.db.explosion_event().iter().map(|e| e.id).collect();
    for id in explosion_ids {
        ctx.db.explosion_event().id().delete(&id);
    }

    // 7. Schedule next reset in 5 minutes
    ctx.db.map_reset_timer().insert(MapResetTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(300)),
    });

    // 8. Broadcast system message
    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender: ctx.sender(),
        sender_name: "[SERVER]".to_string(),
        text: "MAP RESET! New world generated. New round starting!".to_string(),
        sent_at: ctx.timestamp,
    });

    log::info!(
        "Map reset complete. New seed: {}, round: {}",
        new_seed,
        ctx.db
            .world_config()
            .id()
            .find(1)
            .map(|c| c.round_number)
            .unwrap_or(0)
    );
}

/// Handle projectile impact: validates travel time, applies damage and block destruction.
#[reducer]
pub fn projectile_impact(
    ctx: &ReducerContext,
    shot_origin: Vec3,
    impact_pos: Vec3,
    _direction: Vec3,
    weapon: u8,
    travel_time_ms: u32,
    hit_players: Vec<Identity>,
    hit_blocks: Vec<Vec3>,
) -> Result<(), String> {
    let sender = ctx.sender();
    // We still verify the player exists, but don't check health —
    // projectiles launched while alive should still impact after death.
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if weapon >= NUM_WEAPONS {
        return Err("Invalid weapon".to_string());
    }

    // NOTE: We intentionally do NOT check player.health here.
    // The projectile was already launched when the player was alive
    // (validated by fire_weapon). If the player dies mid-flight,
    // the projectile should still explode on impact.

    let def = &WEAPON_DEFS[weapon as usize];

    if def.projectile_speed <= 0.0 {
        return Err("Not a projectile weapon".to_string());
    }

    // Travel time validation
    let dx = impact_pos.x - shot_origin.x;
    let dy = impact_pos.y - shot_origin.y;
    let dz = impact_pos.z - shot_origin.z;
    let distance = (dx * dx + dy * dy + dz * dz).sqrt();
    let expected_time_ms = (distance / def.projectile_speed * 1000.0) as u32;

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

    // Impact range check
    let impact_dist_sq = dist_sq(&shot_origin, &impact_pos);
    let max_range = def.max_range + 10.0;
    if impact_dist_sq > max_range * max_range {
        return Err("Impact too far from origin".to_string());
    }

    // Validate + apply player hits
    for target_id in &hit_players {
        if *target_id == sender {
            continue;
        }

        if let Some(target) = ctx.db.player().identity().find(*target_id) {
            if target.health <= 0 || !target.online || target.spawn_protected {
                continue;
            }

            // God mode protection
            if target.max_health >= 9999 {
                continue;
            }

            let target_dist_sq = dist_sq(&impact_pos, &target.pos);
            let hit_range = def.radius + 5.0;
            if target_dist_sq > hit_range * hit_range {
                continue;
            }

            let new_health = (target.health - def.damage).max(0);
            ctx.db.player().identity().update(Player {
                health: new_health,
                last_damage_time: ctx.timestamp,
                ..target
            });

            if new_health == 0 {
                if let Some(attacker) = ctx.db.player().identity().find(sender) {
                    ctx.db.player().identity().update(Player {
                        kills: attacker.kills + 1,
                        ..attacker
                    });
                }
                if let Some(dead) = ctx.db.player().identity().find(*target_id) {
                    ctx.db.player().identity().update(Player {
                        deaths: dead.deaths + 1,
                        ..dead
                    });
                }
                log::info!("{:?} killed {:?} with projectile", sender, target_id);
            }
        }
    }

    // Validate + apply block destruction via WorldChunks
    if hit_blocks.len() > 500 {
        return Err("Too many blocks".to_string());
    }

    let block_coords: Vec<(i32, i32, i32)> = hit_blocks
        .iter()
        .filter(|block| {
            let bx = block.x as i32;
            let by = block.y as i32;
            let bz = block.z as i32;
            if !block_in_bounds(bx, by, bz) {
                return false;
            }
            let block_dist_sq = dist_sq(&impact_pos, block);
            let max_block_range = def.radius + 5.0;
            block_dist_sq <= max_block_range * max_block_range
        })
        .map(|b| (b.x as i32, b.y as i32, b.z as i32))
        .collect();

    let actually_destroyed = destroy_blocks_in_world(ctx, &block_coords);
    let destroyed_positions: Vec<(i32, i32, i32)> = actually_destroyed
        .iter()
        .map(|&(x, y, z, _)| (x, y, z))
        .collect();
    run_structural_check(ctx, &destroyed_positions);

    // Emit explosion event for all clients to render VFX
    if def.radius > 0.0 {
        ctx.db.explosion_event().insert(ExplosionEvent {
            id: 0,
            origin: sender,
            pos: impact_pos,
            radius: def.radius,
            weapon,
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
    }

    Ok(())
}
