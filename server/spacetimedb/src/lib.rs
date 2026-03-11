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

/// Tracks every destroyed block so new clients can rebuild the world state.
/// Key is the block coordinate packed into one row per destruction event.
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
    }

    Ok(())
}

/// Called frequently by clients to sync their position/rotation.
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

    if weapon > 2 {
        return Err("Invalid weapon".to_string());
    }

    // Clamp position to world bounds instead of rejecting
    let clamped_pos = Vec3 {
        x: pos.x.clamp(-1.0, (WORLD_SIZE_X + 1) as f32),
        y: pos.y.clamp(-10.0, 100.0),
        z: pos.z.clamp(-1.0, (WORLD_SIZE_Z + 1) as f32),
    };

    ctx.db.player().identity().update(Player {
        pos: clamped_pos,
        rot,
        current_weapon: weapon,
        ..player
    });

    Ok(())
}

// ── Combat Reducers ──

/// Client fires a weapon. Server records the shot event for other clients
/// and processes block destruction.
#[reducer]
pub fn fire_weapon(
    ctx: &ReducerContext,
    origin: Vec3,
    direction: Vec3,
    weapon: u8,
) -> Result<(), String> {
    let sender = ctx.sender();
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    if weapon > 2 {
        return Err("Invalid weapon".to_string());
    }

    // Record shot event for other clients to render
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

/// Called by client when a block is destroyed (after client-side raycast hit).
/// Server records it so all clients can stay in sync.
#[reducer]
pub fn destroy_block(ctx: &ReducerContext, x: i32, y: i32, z: i32) -> Result<(), String> {
    let sender = ctx.sender();
    let _player = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Not registered")?;

    // Bounds check
    if x < 0 || x >= WORLD_SIZE_X || y < 0 || y >= WORLD_SIZE_Y || z < 0 || z >= WORLD_SIZE_Z {
        return Err("Block out of bounds".to_string());
    }

    ctx.db.destroyed_block().insert(DestroyedBlock {
        id: 0,
        x,
        y,
        z,
        destroyed_by: sender,
        destroyed_at: ctx.timestamp,
    });

    Ok(())
}

/// Destroy multiple blocks at once (explosions).
#[reducer]
pub fn destroy_blocks(ctx: &ReducerContext, blocks: Vec<Vec3>) -> Result<(), String> {
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

        if x >= 0 && x < WORLD_SIZE_X && y >= 0 && y < WORLD_SIZE_Y && z >= 0 && z < WORLD_SIZE_Z {
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

// ── Damage / Kill ──

/// Player reports hitting another player. Server validates and applies damage.
#[reducer]
pub fn hit_player(
    ctx: &ReducerContext,
    target_identity: Identity,
    damage: i32,
) -> Result<(), String> {
    let sender = ctx.sender();
    if sender == target_identity {
        return Err("Cannot hit yourself".to_string());
    }

    let _attacker = ctx
        .db
        .player()
        .identity()
        .find(sender)
        .ok_or("Attacker not registered")?;

    let target = ctx
        .db
        .player()
        .identity()
        .find(target_identity)
        .ok_or("Target not found")?;

    if target.health <= 0 {
        return Err("Target already dead".to_string());
    }

    let clamped_damage = damage.min(50); // cap damage per hit
    let new_health = (target.health - clamped_damage).max(0);

    ctx.db.player().identity().update(Player {
        health: new_health,
        ..target
    });

    // If killed
    if new_health == 0 {
        // Update killer stats
        if let Some(attacker) = ctx.db.player().identity().find(sender) {
            ctx.db.player().identity().update(Player {
                kills: attacker.kills + 1,
                ..attacker
            });
        }

        // Update victim stats (will respawn via respawn reducer)
        if let Some(dead) = ctx.db.player().identity().find(target_identity) {
            ctx.db.player().identity().update(Player {
                deaths: dead.deaths + 1,
                ..dead
            });
        }

        log::info!("{:?} killed {:?}", sender, target_identity);
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
    let now_micros = ctx
        .timestamp
        .to_duration_since_unix_epoch()
        .unwrap_or_default()
        .as_micros() as u64;

    let stale: Vec<u64> = ctx
        .db
        .shot_event()
        .iter()
        .filter(|s| {
            let shot_micros = s
                .fired_at
                .to_duration_since_unix_epoch()
                .unwrap_or_default()
                .as_micros() as u64;
            now_micros.saturating_sub(shot_micros) > 2_000_000 // older than 2 seconds
        })
        .map(|s| s.id)
        .collect();

    for id in stale {
        ctx.db.shot_event().id().delete(&id);
    }

    Ok(())
}
