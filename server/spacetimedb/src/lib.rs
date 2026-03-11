use spacetimedb::{reducer, table, Identity, ReducerContext, SpacetimeType, Table, Timestamp};

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
    fire_rate: f32, // shots per second
    max_ammo: i32,
    max_range: f32,
}

const WEAPON_DEFS: [WeaponDef; 3] = [
    // Rifle: fast, precise, moderate damage
    WeaponDef {
        damage: 25,
        radius: 0.0,
        fire_rate: 5.0,
        max_ammo: 30,
        max_range: 80.0,
    },
    // Shotgun: slow, spread, close range
    WeaponDef {
        damage: 12,
        radius: 1.5,
        fire_rate: 1.0,
        max_ammo: 8,
        max_range: 30.0,
    },
    // RPG: very slow, explosive, high damage
    WeaponDef {
        damage: 80,
        radius: 3.5,
        fire_rate: 0.5,
        max_ammo: 4,
        max_range: 80.0,
    },
];

const NUM_WEAPONS: u8 = 3;

// ── Tables ──

/// Every connected player in the sandbox
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

/// Tracks every destroyed block so new clients can rebuild the world state.
#[table(accessor = destroyed_block, public)]
pub struct DestroyedBlock {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub destroyed_by: Identity,
    pub destroyed_at: Timestamp,
}

/// Short-lived row: represents a shot fired so other clients can render
/// tracers / muzzle flashes. Clients delete these after rendering.
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

// ── Constants ──

const SPAWN_POS: Vec3 = Vec3 {
    x: 64.0,
    y: 20.0,
    z: 64.0,
};
const MAX_HEALTH: i32 = 100;
const WORLD_SIZE_X: i32 = 128;
const WORLD_SIZE_Y: i32 = 48;
const WORLD_SIZE_Z: i32 = 128;
// Max movement speed: sprint(18) + slide(22) + generous tolerance for jitter
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
    if ctx
        .db
        .player_movement()
        .identity()
        .find(identity)
        .is_none()
    {
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
    x >= 0 && x < WORLD_SIZE_X && y >= 0 && y < WORLD_SIZE_Y && z >= 0 && z < WORLD_SIZE_Z
}

// ── Lifecycle Reducers ──

#[reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("BitWars module initialized");
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
        // Keep existing ammo on reconnect, but init if missing
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
        ctx.db.player().identity().update(Player {
            username,
            ..player
        });
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
        // Initialize weapon state for new player
        init_weapon_state(ctx, sender);
    }

    init_movement_state(ctx, sender, &SPAWN_POS);

    Ok(())
}

/// Called frequently by clients to sync their position/rotation.
/// Includes server-side speed validation.
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

    // Speed validation
    if let Some(mv_state) = ctx.db.player_movement().identity().find(sender) {
        let now_us = timestamp_micros(ctx.timestamp);
        let last_us = timestamp_micros(mv_state.last_update);
        let dt = (now_us.saturating_sub(last_us)) as f64 / 1_000_000.0; // seconds

        if dt > 0.01 {
            let d_sq = dist_sq(&clamped_pos, &mv_state.last_pos);
            let dist = d_sq.sqrt();
            let speed = dist / dt as f32;

            if speed > MAX_MOVEMENT_SPEED {
                let new_violations = mv_state.violation_count + 1;

                if new_violations > SPEED_VIOLATION_THRESHOLD {
                    // Snap back to last valid position
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

                // Accumulate violations but still accept the position
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
                // Valid speed — reset violations
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

    ctx.db.player().identity().update(Player {
        pos: clamped_pos,
        rot,
        current_weapon: weapon,
        ..player
    });

    Ok(())
}

// ── Combat Reducers ──

/// Unified fire weapon reducer. Server validates fire rate, ammo, origin,
/// player hits (distance + direction), and block destruction (distance).
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

    // Player must be alive to fire
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
    // 50ms tolerance for network jitter
    if now_us.saturating_sub(last_us) < cooldown_us.saturating_sub(50_000) {
        return Err("Firing too fast".to_string());
    }

    // 2. Ammo check
    let current_ammo = get_ammo(&wstate, weapon);
    if current_ammo <= 0 {
        return Err("No ammo".to_string());
    }

    // 3. Origin validation: shot origin must be near player's server-known position
    if dist_sq(&origin, &player.pos) > 9.0 {
        // 3 units tolerance (squared)
        return Err("Shot origin too far from player".to_string());
    }

    // 4. Deduct ammo and update fire time
    set_ammo(&mut wstate, weapon, current_ammo - 1);
    wstate.last_fire_time = ctx.timestamp;
    ctx.db.player_weapon_state().identity().update(wstate);

    // 5. Validate + apply player hits
    let dir_len = (direction.x * direction.x
        + direction.y * direction.y
        + direction.z * direction.z)
        .sqrt();

    for target_id in &hit_players {
        if *target_id == sender {
            continue;
        }

        if let Some(target) = ctx.db.player().identity().find(*target_id) {
            if target.health <= 0 || !target.online {
                continue;
            }

            // Distance check
            let target_dist_sq = dist_sq(&origin, &target.pos);
            let max_range = def.max_range + 3.0; // tolerance
            if target_dist_sq > max_range * max_range {
                continue;
            }

            // Direction check: target should be roughly in fire direction
            if dir_len > 0.01 {
                let to_x = target.pos.x - origin.x;
                let to_y = target.pos.y - origin.y;
                let to_z = target.pos.z - origin.z;
                let to_len = (to_x * to_x + to_y * to_y + to_z * to_z).sqrt();

                if to_len > 0.1 {
                    let dot = (to_x * direction.x + to_y * direction.y + to_z * direction.z)
                        / (to_len * dir_len);
                    // Must be within ~60 degree cone
                    if dot < 0.5 {
                        continue;
                    }
                }
            }

            // Apply server-defined damage
            let new_health = (target.health - def.damage).max(0);
            ctx.db.player().identity().update(Player {
                health: new_health,
                ..target
            });

            // Handle kill
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

    // 6. Validate + apply block destruction
    if hit_blocks.len() > 500 {
        return Err("Too many blocks".to_string());
    }
    for block in &hit_blocks {
        let bx = block.x as i32;
        let by = block.y as i32;
        let bz = block.z as i32;

        if !block_in_bounds(bx, by, bz) {
            continue;
        }

        // Distance check: blocks must be within weapon range
        let block_dist_sq = dist_sq(&origin, block);
        let max_block_range = def.max_range + 5.0; // tolerance
        if block_dist_sq > max_block_range * max_block_range {
            continue;
        }

        ctx.db.destroyed_block().insert(DestroyedBlock {
            id: 0,
            x: bx,
            y: by,
            z: bz,
            destroyed_by: sender,
            destroyed_at: ctx.timestamp,
        });
    }

    // 7. Record shot event for other clients to render tracers
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

/// Reload the current weapon's ammo.
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

    for block in blocks {
        let x = block.x as i32;
        let y = block.y as i32;
        let z = block.z as i32;

        if block_in_bounds(x, y, z) {
            ctx.db.destroyed_block().insert(DestroyedBlock {
                id: 0,
                x,
                y,
                z,
                destroyed_by: sender,
                destroyed_at: ctx.timestamp,
            });
        }
    }

    Ok(())
}

/// Player respawns after death.
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

    // Reset ammo on respawn
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

    ctx.db.chat_message().insert(ChatMessage {
        id: 0,
        sender,
        sender_name: player.username,
        text,
        sent_at: ctx.timestamp,
    });

    Ok(())
}

/// Cleanup old shot events (called periodically or by clients).
#[reducer]
pub fn cleanup_shots(ctx: &ReducerContext) -> Result<(), String> {
    let now_micros = timestamp_micros(ctx.timestamp);

    let stale: Vec<u64> = ctx
        .db
        .shot_event()
        .iter()
        .filter(|s| {
            let shot_micros = timestamp_micros(s.fired_at);
            now_micros.saturating_sub(shot_micros) > 2_000_000 // older than 2 seconds
        })
        .map(|s| s.id)
        .collect();

    for id in stale {
        ctx.db.shot_event().id().delete(&id);
    }

    Ok(())
}
