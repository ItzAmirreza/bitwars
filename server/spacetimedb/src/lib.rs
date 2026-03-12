use spacetimedb::{
    reducer, table, Identity, ReducerContext, ScheduleAt, SpacetimeType, Table, Timestamp,
};
use std::collections::HashMap;
use std::time::Duration;

mod worldgen;
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

const WEAPON_DEFS: [WeaponDef; 3] = [
    // Rifle: fast, precise, moderate damage (hitscan)
    WeaponDef {
        damage: 25,
        radius: 0.0,
        fire_rate: 5.0,
        max_ammo: 30,
        max_range: 80.0,
        projectile_speed: 0.0,
    },
    // Shotgun: slow, spread, close range (hitscan)
    WeaponDef {
        damage: 12,
        radius: 1.5,
        fire_rate: 1.0,
        max_ammo: 8,
        max_range: 30.0,
        projectile_speed: 0.0,
    },
    // RPG: very slow, explosive, high damage (projectile)
    WeaponDef {
        damage: 80,
        radius: 3.5,
        fire_rate: 0.5,
        max_ammo: 4,
        max_range: 80.0,
        projectile_speed: 40.0,
    },
];

const NUM_WEAPONS: u8 = 3;

// ── Tables ──

/// Every connected player
#[table(accessor = player, public)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub username: String,
    pub pos: Vec3,
    pub rot: Rotation,
    pub health: i32,
    pub max_health: i32,
    pub current_weapon: u8,
    pub kills: u32,
    pub deaths: u32,
    pub online: bool,
    pub joined_at: Timestamp,
}

/// Server-authoritative weapon state per player
#[table(accessor = player_weapon_state, public)]
pub struct PlayerWeaponState {
    #[primary_key]
    pub identity: Identity,
    pub ammo_rifle: i32,
    pub ammo_shotgun: i32,
    pub ammo_rpg: i32,
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

// ── Constants ──

const SPAWN_POS: Vec3 = Vec3 {
    x: 64.0,
    y: 20.0,
    z: 64.0,
};
const MAX_HEALTH: i32 = 100;
const MAX_MOVEMENT_SPEED: f32 = 35.0;
const SPEED_VIOLATION_THRESHOLD: u32 = 10;

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
        _ => 0,
    }
}

fn set_ammo(state: &mut PlayerWeaponState, weapon: u8, ammo: i32) {
    match weapon {
        0 => state.ammo_rifle = ammo,
        1 => state.ammo_shotgun = ammo,
        2 => state.ammo_rpg = ammo,
        _ => {}
    }
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

// ── Chunk Modification Helpers ──

/// Destroy blocks in the world by modifying WorldChunk data.
/// Returns the positions of blocks that were actually solid (and are now air).
fn destroy_blocks_in_world(
    ctx: &ReducerContext,
    blocks: &[(i32, i32, i32)],
) -> Vec<(i32, i32, i32)> {
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
                if block_data[local_idx] != AIR {
                    block_data[local_idx] = AIR;
                    actually_destroyed.push((x, y, z));
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

/// Decompress all WorldChunk rows into a flat world array.
fn decompress_world(ctx: &ReducerContext) -> Vec<u8> {
    let total = WORLD_SIZE_X * WORLD_SIZE_Y * WORLD_SIZE_Z;
    let mut blocks = vec![0u8; total];

    for chunk in ctx.db.world_chunk().iter() {
        let mut chunk_data = [0u8; CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE];
        worldgen::rle_decode(&chunk.data, &mut chunk_data);
        worldgen::inject_chunk(
            &mut blocks,
            chunk.cx as usize,
            chunk.cy as usize,
            chunk.cz as usize,
            &chunk_data,
        );
    }

    blocks
}

/// Run structural integrity check after block destruction.
/// Decompresses the world, finds unsupported blocks via BFS, removes them,
/// and emits a DetachEvent so all clients can animate the collapse.
fn run_structural_check(ctx: &ReducerContext, destroyed_positions: &[(i32, i32, i32)]) {
    if destroyed_positions.is_empty() {
        return;
    }

    let blocks = decompress_world(ctx);
    let fallen = worldgen::check_structural_integrity(&blocks, destroyed_positions);

    if fallen.is_empty() {
        return;
    }

    // Remove fallen blocks from the world chunks
    let fallen_coords: Vec<(i32, i32, i32)> =
        fallen.iter().map(|&(x, y, z, _)| (x, y, z)).collect();
    destroy_blocks_in_world(ctx, &fallen_coords);

    // Emit DetachEvent for clients to animate
    let blocks_x: Vec<i32> = fallen.iter().map(|&(x, _, _, _)| x).collect();
    let blocks_y: Vec<i32> = fallen.iter().map(|&(_, y, _, _)| y).collect();
    let blocks_z: Vec<i32> = fallen.iter().map(|&(_, _, z, _)| z).collect();
    let block_types: Vec<u8> = fallen.iter().map(|&(_, _, _, bt)| bt).collect();

    ctx.db.detach_event().insert(DetachEvent {
        id: 0,
        blocks_x,
        blocks_y,
        blocks_z,
        block_types,
        created_at: ctx.timestamp,
    });

    log::info!("Structural check: {} blocks detached", fallen_coords.len());
}

// ── Lifecycle Reducers ──

#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    log::info!("BitWars module initialized — generating world...");

    let blocks = worldgen::generate_world();

    // Chunk the world and store each chunk as RLE-compressed blob
    for cz in 0..NUM_CHUNKS_Z {
        for cy in 0..NUM_CHUNKS_Y {
            for cx in 0..NUM_CHUNKS_X {
                let data = worldgen::extract_chunk(&blocks, cx, cy, cz);
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

    log::info!(
        "World generation complete: {} chunks stored",
        NUM_CHUNKS_X * NUM_CHUNKS_Y * NUM_CHUNKS_Z
    );

    // Schedule periodic DetachEvent cleanup
    ctx.db.detach_cleanup().insert(DetachCleanup {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Time(ctx.timestamp + Duration::from_secs(5)),
    });

    // Initialize world environment with random time and weather
    let seed = timestamp_micros(ctx.timestamp);
    let initial_time = ((seed % 2400) as f32) / 100.0; // 0.0 - 24.0
    let initial_weather = ((seed / 2400) % 5) as u8;
    let wind = ((seed % 100) as f32) / 100.0;
    let cloud = match initial_weather {
        0 => 0.1 + ((seed % 20) as f32) / 100.0, // Clear: low clouds
        1 => 0.4 + ((seed % 30) as f32) / 100.0, // Cloudy
        2 => 0.7 + ((seed % 20) as f32) / 100.0, // Overcast
        3 => 0.6 + ((seed % 30) as f32) / 100.0, // Rainy
        4 => 0.8 + ((seed % 20) as f32) / 100.0, // Stormy
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
        ctx.db.player().identity().update(Player {
            online: true,
            pos: SPAWN_POS,
            health: MAX_HEALTH,
            ..player
        });
        init_weapon_state(ctx, sender);
        init_movement_state(ctx, sender, &SPAWN_POS);
        log::info!("Player reconnected: {:?}", sender);
    }
}

#[reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    if let Some(player) = ctx.db.player().identity().find(sender) {
        ctx.db.player().identity().update(Player {
            online: false,
            ..player
        });
        log::info!("Player disconnected: {:?}", sender);
    }
}

// ── Player Reducers ──

#[reducer]
pub fn set_username(ctx: &ReducerContext, username: String) -> Result<(), String> {
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 20 {
        return Err("Username must be 1-20 characters".to_string());
    }

    let sender = ctx.sender();
    for p in ctx.db.player().iter() {
        if p.username == username && p.identity != sender {
            return Err("Username already taken".to_string());
        }
    }

    if let Some(player) = ctx.db.player().identity().find(sender) {
        ctx.db
            .player()
            .identity()
            .update(Player { username, ..player });
    } else {
        ctx.db.player().insert(Player {
            identity: sender,
            username,
            pos: SPAWN_POS,
            rot: Rotation {
                yaw: 0.0,
                pitch: 0.0,
            },
            health: MAX_HEALTH,
            max_health: MAX_HEALTH,
            current_weapon: 0,
            kills: 0,
            deaths: 0,
            online: true,
            joined_at: ctx.timestamp,
        });
        init_weapon_state(ctx, sender);
    }

    init_movement_state(ctx, sender, &SPAWN_POS);
    Ok(())
}

#[reducer]
pub fn update_position(
    ctx: &ReducerContext,
    pos: Vec3,
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

    if weapon >= NUM_WEAPONS {
        return Err("Invalid weapon".to_string());
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
                let d_sq = dist_sq(&clamped_pos, &mv_state.last_pos);
                let dist = d_sq.sqrt();
                let speed = dist / dt as f32;

                if speed > MAX_MOVEMENT_SPEED {
                    let new_violations = mv_state.violation_count + 1;

                    if new_violations > SPEED_VIOLATION_THRESHOLD {
                        ctx.db.player().identity().update(Player {
                            pos: mv_state.last_pos.clone(),
                            rot,
                            current_weapon: weapon,
                            ..player
                        });
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

    ctx.db.player().identity().update(Player {
        pos: clamped_pos,
        rot,
        current_weapon: weapon,
        ..player
    });

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

    if player.health <= 0 {
        return Err("Cannot fire while dead".to_string());
    }

    let def = &WEAPON_DEFS[weapon as usize];
    let mut wstate = ctx
        .db
        .player_weapon_state()
        .identity()
        .find(sender)
        .ok_or("No weapon state")?;

    // 1. Fire rate check
    let now_us = timestamp_micros(ctx.timestamp);
    let last_us = timestamp_micros(wstate.last_fire_time);
    let cooldown_us = (1_000_000.0 / def.fire_rate) as u64;
    if now_us.saturating_sub(last_us) < cooldown_us.saturating_sub(50_000) {
        return Err("Firing too fast".to_string());
    }

    // 2. Ammo check
    let current_ammo = get_ammo(&wstate, weapon);
    if current_ammo <= 0 {
        return Err("No ammo".to_string());
    }

    // 3. Origin validation
    if dist_sq(&origin, &player.pos) > 9.0 {
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
            if target.health <= 0 || !target.online {
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
    run_structural_check(ctx, &actually_destroyed);

    // 7. Record shot event
    ctx.db.shot_event().insert(ShotEvent {
        id: 0,
        shooter: sender,
        origin,
        direction,
        weapon,
        fired_at: ctx.timestamp,
    });

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

/// Destroy blocks from physics simulation (falling blocks, cascades).
/// Separate from fire_weapon because physics blocks can be far from player.
#[reducer]
pub fn destroy_blocks_physics(ctx: &ReducerContext, blocks: Vec<Vec3>) -> Result<(), String> {
    let sender = ctx.sender();
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
    run_structural_check(ctx, &actually_destroyed);

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

    ctx.db.player().identity().update(Player {
        health: MAX_HEALTH,
        pos: SPAWN_POS,
        rot: Rotation {
            yaw: 0.0,
            pitch: 0.0,
        },
        ..player
    });

    if let Some(wstate) = ctx.db.player_weapon_state().identity().find(sender) {
        ctx.db
            .player_weapon_state()
            .identity()
            .update(PlayerWeaponState {
                ammo_rifle: WEAPON_DEFS[0].max_ammo,
                ammo_shotgun: WEAPON_DEFS[1].max_ammo,
                ammo_rpg: WEAPON_DEFS[2].max_ammo,
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
                ctx.db.player().identity().update(Player {
                    pos: new_pos.clone(),
                    ..player
                });
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
                ctx.db.player().identity().update(Player {
                    pos: target_pos.clone(),
                    ..player
                });
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
            let target_identity = target.identity;
            let target_name = target.username.clone();
            ctx.db.player().identity().update(Player {
                pos: admin_pos.clone(),
                ..target
            });
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
            ctx.db.player().identity().update(Player {
                health: 0,
                deaths: target.deaths + 1,
                ..target
            });
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
                ctx.db.player().identity().update(Player {
                    health: MAX_HEALTH,
                    ..player
                });
                insert_system_message(ctx, "Healed yourself");
            } else if parts.len() == 2 {
                let target =
                    find_player_by_name(ctx, parts[1]).ok_or("Player not found".to_string())?;
                let target_name = target.username.clone();
                ctx.db.player().identity().update(Player {
                    health: target.max_health,
                    ..target
                });
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
                ctx.db.player().identity().update(Player {
                    health: MAX_HEALTH,
                    max_health: MAX_HEALTH,
                    ..player
                });
                insert_system_message(ctx, "God mode OFF");
            } else {
                ctx.db.player().identity().update(Player {
                    health: 9999,
                    max_health: 9999,
                    ..player
                });
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
                    ctx.db.player().identity().update(Player {
                        health: 0,
                        deaths: target.deaths + 1,
                        ..target
                    });
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
                    ctx.db.player().identity().update(Player {
                        health: MAX_HEALTH,
                        pos: SPAWN_POS,
                        ..target
                    });
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

#[reducer]
pub fn cleanup_shots(ctx: &ReducerContext) -> Result<(), String> {
    let now_micros = timestamp_micros(ctx.timestamp);

    let stale: Vec<u64> = ctx
        .db
        .shot_event()
        .iter()
        .filter(|s| {
            let shot_micros = timestamp_micros(s.fired_at);
            now_micros.saturating_sub(shot_micros) > 2_000_000
        })
        .map(|s| s.id)
        .collect();

    for id in stale {
        ctx.db.shot_event().id().delete(&id);
    }

    Ok(())
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
    let player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if weapon >= NUM_WEAPONS {
        return Err("Invalid weapon".to_string());
    }

    if player.health <= 0 {
        return Err("Cannot impact while dead".to_string());
    }

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
            if target.health <= 0 || !target.online {
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
    run_structural_check(ctx, &actually_destroyed);

    Ok(())
}
