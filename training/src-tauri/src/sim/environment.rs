//! Training environment with a Gym-like API.
//!
//! Ties all sim modules together into a reset/step loop for RL training.
//! Each environment instance has its own CoW terrain, player state, weapons,
//! abilities, and projectiles. The base terrain is shared via Arc.

use std::sync::Arc;

use rand::Rng;
use rand::SeedableRng;

use super::abilities::AbilitySystem;
use super::destruction::explode_at;
use super::knockback;
use super::movement::{MoveAction, PlayerMovement};
use super::weapons::{
    Delivery, Projectile, WeaponState,
    WEAPONS, NUM_WEAPONS,
};
use super::world::{BaseTerrain, EnvTerrain};
use crate::worldgen;

// ── Constants ──

/// Simulation timestep: 30 Hz matching server tick rate.
const SIM_DT: f32 = 1.0 / 30.0;

/// Maximum episode duration in seconds.
const EPISODE_TIMEOUT: f32 = 30.0;

/// Target is a 3x3 block area on the ground.
const TARGET_SIZE: f32 = 3.0;

/// Observation vector dimension.
/// 13 (state) + 48 (raycasts) + 27 (3x3x3 grid) + 5 (ammo) + 5 (cooldown) + 5 (flags)
pub const OBSERVATION_DIM: usize = 103;

/// Number of vision raycasts.
const NUM_RAYS: usize = 48;
/// Max raycast distance in blocks.
const RAY_MAX_DIST: f32 = 40.0;
/// DDA step limit per ray.
const RAY_MAX_STEPS: u32 = 60;

/// Action vector dimension.
/// [move_fwd, move_strafe, look_yaw, look_pitch, jump, sprint, fire, weapon_select]
pub const ACTION_DIM: usize = 8;

// ── Step result types ──

/// Information about the step for logging/debugging.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct StepInfo {
    pub episode_time: f32,
    pub episode_step: u32,
    pub total_reward: f32,
    pub distance_to_target: f32,
    pub health: f32,
    pub blocks_destroyed: u32,
    pub reached_target: bool,
}

/// Result of a single environment step.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct StepResult {
    pub observation: Vec<f32>,
    pub reward: f32,
    pub done: bool,
    pub info: StepInfo,
}

// ── Training Environment ──

/// The core training environment: Gym-like API with reset() and step().
pub struct TrainingEnv {
    terrain: EnvTerrain,
    player: PlayerMovement,
    weapons: WeaponState,
    abilities: AbilitySystem,
    target_pos: [f32; 3],
    spawn_pos: [f32; 3],
    episode_time: f32,
    episode_step: u32,
    total_reward: f32,
    prev_distance: f32,
    active_projectiles: Vec<Projectile>,
    blocks_destroyed: u32,
    rng: rand::rngs::StdRng,
    done: bool,
}

impl TrainingEnv {
    /// Create a new training environment with shared base terrain and a per-env seed.
    pub fn new(base_terrain: Arc<BaseTerrain>, seed: u64) -> Self {
        let terrain = EnvTerrain::new(base_terrain);
        let rng = rand::rngs::StdRng::seed_from_u64(seed);

        // Spawn ability pickups in the world (they persist across episodes)
        let mut abilities = AbilitySystem::new();
        abilities.spawn_pickups(&terrain, seed, 12);

        TrainingEnv {
            terrain,
            player: PlayerMovement::new(375.0, 30.0, 375.0),
            weapons: WeaponState::new(),
            abilities,
            target_pos: [0.0; 3],
            spawn_pos: [0.0; 3],
            episode_time: 0.0,
            episode_step: 0,
            total_reward: 0.0,
            prev_distance: 0.0,
            active_projectiles: Vec::new(),
            blocks_destroyed: 0,
            rng,
            done: false,
        }
    }

    /// Reset the environment for a new episode. Returns the initial observation.
    pub fn reset(&mut self) -> Vec<f32> {
        // Reset terrain (drop CoW modifications)
        self.terrain.reset();

        // Pick random spawn position on solid ground
        self.spawn_pos = find_ground_position(&mut self.rng, &self.terrain);

        // Pick random target on ground, at least 30 blocks from spawn
        self.target_pos = loop {
            let candidate = find_ground_position(&mut self.rng, &self.terrain);
            let dx = candidate[0] - self.spawn_pos[0];
            let dz = candidate[2] - self.spawn_pos[2];
            let dist = (dx * dx + dz * dz).sqrt();
            if dist >= 30.0 {
                break candidate;
            }
        };

        // Reset player at spawn
        self.player.reset(
            self.spawn_pos[0],
            self.spawn_pos[1],
            self.spawn_pos[2],
        );
        // Face toward target
        let dx = self.target_pos[0] - self.spawn_pos[0];
        let dz = self.target_pos[2] - self.spawn_pos[2];
        self.player.yaw = dx.atan2(-dz);

        // Reset weapons and abilities
        self.weapons.reset();
        self.abilities.reset();

        // Clear projectiles
        self.active_projectiles.clear();

        // Reset episode tracking
        self.episode_time = 0.0;
        self.episode_step = 0;
        self.total_reward = 0.0;
        self.blocks_destroyed = 0;
        self.done = false;

        // Compute initial distance
        self.prev_distance = self.distance_to_target();

        self.compute_observation()
    }

    /// Take one step in the environment given an action vector.
    ///
    /// Action layout (8 floats):
    ///   [0] forward    (-1 to 1)
    ///   [1] strafe     (-1 to 1)
    ///   [2] yaw delta  (continuous, added to current yaw)
    ///   [3] pitch delta (continuous, added to current pitch)
    ///   [4] jump       (>0.5 = true)
    ///   [5] sprint     (>0.5 = true)
    ///   [6] fire       (>0.5 = true)
    ///   [7] weapon_select (0-5, discretized)
    pub fn step(&mut self, action: &[f32]) -> StepResult {
        debug_assert!(action.len() >= ACTION_DIM, "Action must have {} elements", ACTION_DIM);

        // Parse action
        let forward = action[0].clamp(-1.0, 1.0);
        let strafe = action[1].clamp(-1.0, 1.0);
        let yaw_delta = action[2];
        let pitch_delta = action[3];
        let jump = action[4] > 0.5;
        let sprint = action[5] > 0.5;
        let fire = action[6] > 0.5;
        let weapon_select = (action[7].round() as usize).min(NUM_WEAPONS - 1);

        // Handle weapon switching
        self.weapons.select_weapon(weapon_select);

        // Tick weapon sim time
        self.weapons.tick(SIM_DT);

        // Handle fire action
        if fire {
            let w = self.weapons.current_weapon;
            // Auto-reload if empty (matches real game's instant infantry reload)
            if self.weapons.ammo[w] == 0 {
                self.weapons.reload(w);
            }
            if self.weapons.can_fire(w) {
                let def = &WEAPONS[w];
                // Compute fire direction from yaw and pitch
                let cos_pitch = self.player.pitch.cos();
                let dir_x = -self.player.yaw.sin() * cos_pitch;
                let dir_y = -self.player.pitch.sin();
                let dir_z = -self.player.yaw.cos() * cos_pitch;

                // Deduct ammo and set cooldown
                self.weapons.fire(w);

                match def.delivery {
                    Delivery::Projectile => {
                        // Spawn a projectile (RPG, Sniper)
                        self.active_projectiles.push(Projectile::new(
                            self.player.pos_x, self.player.pos_y, self.player.pos_z,
                            dir_x, dir_y, dir_z,
                            w,
                        ));
                    }
                    Delivery::Hitscan => {
                        // Hitscan weapons: no projectile simulation needed for nav training.
                    }
                }
            }
        }

        // Tick projectiles
        self.tick_projectiles();

        // Tick ability system and check for pickups
        self.abilities.tick(SIM_DT);
        let player_pos_tuple = (self.player.pos_x, self.player.pos_y, self.player.pos_z);
        self.abilities.try_collect(player_pos_tuple);

        // Apply speed multiplier from abilities
        self.player.speed_multiplier = self.abilities.get_speed_multiplier();

        // Build move action
        let move_action = MoveAction {
            forward,
            strafe,
            yaw: self.player.yaw + yaw_delta,
            pitch: (self.player.pitch + pitch_delta).clamp(
                -std::f32::consts::FRAC_PI_2,
                std::f32::consts::FRAC_PI_2,
            ),
            jump,
            sprint,
        };

        // Update player movement
        self.player.update(SIM_DT, &move_action, &self.terrain);

        // Update episode tracking
        self.episode_time += SIM_DT;
        self.episode_step += 1;

        // Compute reward
        let reward = self.compute_reward();
        self.total_reward += reward;

        // Check done
        let reached = self.reached_target();
        self.done = self.check_done();

        let observation = self.compute_observation();

        let info = StepInfo {
            episode_time: self.episode_time,
            episode_step: self.episode_step,
            total_reward: self.total_reward,
            distance_to_target: self.distance_to_target(),
            health: self.player.health,
            blocks_destroyed: self.blocks_destroyed,
            reached_target: reached,
        };

        StepResult {
            observation,
            reward,
            done: self.done,
            info,
        }
    }

    /// Compute the observation vector with raycast vision.
    ///
    /// Layout (106 floats):
    ///   [0..3]    Position (normalized)
    ///   [3..6]    Velocity (normalized)
    ///   [6..9]    Target position (normalized)
    ///   [9..12]   Direction to target (unit vector)
    ///   [12]      Distance to target (normalized)
    ///   [13..61]  48 raycast distances (0=wall at face, 1=clear to max range)
    ///   [61..88]  3x3x3 immediate terrain grid (27 values, for close collision)
    ///   [88..93]  Ammo per weapon (normalized, 5 weapons)
    ///   [93..98]  Cooldown per weapon (normalized, 5 weapons)
    ///   [98]      Health (normalized)
    ///   [99]      Speed multiplier (normalized)
    ///   [100]     On ground
    ///   [101]     Is climbing
    ///   [102]     Current weapon (normalized)
    pub fn compute_observation(&self) -> Vec<f32> {
        let mut obs = Vec::with_capacity(OBSERVATION_DIM);

        let world_sx = worldgen::WORLD_SIZE_X as f32;
        let world_sy = worldgen::WORLD_SIZE_Y as f32;
        let world_sz = worldgen::WORLD_SIZE_Z as f32;

        // [0..3]: Position normalized
        obs.push(self.player.pos_x / world_sx);
        obs.push(self.player.pos_y / world_sy);
        obs.push(self.player.pos_z / world_sz);

        // [3..6]: Velocity normalized
        let max_speed = 35.0f32;
        obs.push(self.player.h_vel_x / max_speed);
        obs.push(self.player.vel_y / max_speed);
        obs.push(self.player.h_vel_z / max_speed);

        // [6..9]: Target position normalized
        obs.push(self.target_pos[0] / world_sx);
        obs.push(self.target_pos[1] / world_sy);
        obs.push(self.target_pos[2] / world_sz);

        // [9..12]: Direction to target (unit vector)
        let dx = self.target_pos[0] - self.player.pos_x;
        let dy = self.target_pos[1] - self.player.pos_y;
        let dz = self.target_pos[2] - self.player.pos_z;
        let dist = (dx * dx + dy * dy + dz * dz).sqrt().max(0.001);
        obs.push(dx / dist);
        obs.push(dy / dist);
        obs.push(dz / dist);

        // [12]: Distance to target normalized
        obs.push((dist / 100.0).min(1.0));

        // [13..61]: 48 raycast distances
        // Cast rays in a sphere pattern: 8 horizontal at eye level, 8 at +30deg,
        // 8 at -30deg, 8 at +60deg, 4 straight up variations, 4 straight down,
        // 8 in the forward hemisphere focused toward movement direction
        let eye_x = self.player.pos_x;
        let eye_y = self.player.pos_y;
        let eye_z = self.player.pos_z;

        let ray_dirs = compute_ray_directions(self.player.yaw);
        for dir in &ray_dirs {
            let hit_dist = cast_ray(
                &self.terrain, eye_x, eye_y, eye_z,
                dir.0, dir.1, dir.2,
            );
            obs.push(hit_dist / RAY_MAX_DIST); // 0=wall at face, 1=clear to max
        }

        // [61..88]: 3x3x3 immediate grid (close-range collision awareness)
        let px = self.player.pos_x.floor() as i32;
        let py = (self.player.pos_y - 0.5).floor() as i32; // center on body, not eyes
        let pz = self.player.pos_z.floor() as i32;
        for dy_off in -1..=1 {
            for dz_off in -1..=1 {
                for dx_off in -1..=1 {
                    let block = self.terrain.get_block(
                        px + dx_off, py + dy_off, pz + dz_off,
                    );
                    obs.push(if block != worldgen::AIR { 1.0 } else { 0.0 });
                }
            }
        }

        // [88..94]: Ammo per weapon normalized
        for i in 0..NUM_WEAPONS {
            let max = WEAPONS[i].max_ammo as f32;
            obs.push(if max > 0.0 { self.weapons.ammo[i] as f32 / max } else { 0.0 });
        }

        // [94..100]: Cooldown remaining normalized
        for i in 0..NUM_WEAPONS {
            let cooldown = 1.0 / WEAPONS[i].fire_rate;
            let elapsed = self.weapons.sim_time - self.weapons.last_fire_times[i];
            let remaining = (cooldown - elapsed).max(0.0);
            obs.push(if cooldown > 0.0 { remaining / cooldown } else { 0.0 });
        }

        // [100]: Health
        obs.push(self.player.health / self.player.max_health);
        // [101]: Speed multiplier
        obs.push(self.player.speed_multiplier / 2.4);
        // [102]: On ground
        obs.push(if self.player.on_ground { 1.0 } else { 0.0 });
        // [103]: Is climbing
        obs.push(if self.player.is_climbing { 1.0 } else { 0.0 });
        // [104]: Current weapon
        obs.push(self.weapons.current_weapon as f32 / 4.0);

        debug_assert_eq!(obs.len(), OBSERVATION_DIM);
        obs
    }

    // ── Private helpers ──

    /// Compute dense reward for the current step.
    fn compute_reward(&mut self) -> f32 {
        let mut reward = 0.0f32;
        let current_distance = self.distance_to_target();

        // Distance decrease reward — got closer = positive, moved away = negative
        // Scaled so sprinting straight at target (~0.6 blocks/step) gives ~+1.5/step
        reward += (self.prev_distance - current_distance) * 2.5;

        // Velocity toward target bonus — encourages speed, not just inching forward
        let speed = self.player.horizontal_speed;
        if speed > 0.1 {
            let dx = self.target_pos[0] - self.player.pos_x;
            let dz = self.target_pos[2] - self.player.pos_z;
            let target_dist = (dx * dx + dz * dz).sqrt();
            if target_dist > 0.1 {
                let target_dir_x = dx / target_dist;
                let target_dir_z = dz / target_dist;
                let vel_dir_x = self.player.h_vel_x / speed;
                let vel_dir_z = self.player.h_vel_z / speed;
                let dot = vel_dir_x * target_dir_x + vel_dir_z * target_dir_z;
                reward += dot * speed / 10.0;
            }
        }

        // Arrival bonus
        if self.reached_target() {
            reward += 100.0;
        }

        // Time penalty — small, just enough to prefer faster routes
        reward -= 0.05;

        // Update prev_distance for next step
        self.prev_distance = current_distance;

        reward
    }

    /// Check if the episode is done.
    fn check_done(&self) -> bool {
        // Reached target
        if self.reached_target() {
            return true;
        }
        // Episode timeout
        if self.episode_time >= EPISODE_TIMEOUT {
            return true;
        }
        false
    }

    /// Check if the player has reached the target.
    fn reached_target(&self) -> bool {
        let dx = (self.player.pos_x - self.target_pos[0]).abs();
        let dz = (self.player.pos_z - self.target_pos[2]).abs();
        let dy = (self.player.foot_y() - (self.target_pos[1] - 1.7)).abs();
        // Within 1.5 blocks horizontally, near target Y
        dx <= TARGET_SIZE / 2.0 && dz <= TARGET_SIZE / 2.0 && dy < 3.0
    }

    /// Horizontal distance to target.
    fn distance_to_target(&self) -> f32 {
        let dx = self.target_pos[0] - self.player.pos_x;
        let dz = self.target_pos[2] - self.player.pos_z;
        (dx * dx + dz * dz).sqrt()
    }

    /// Tick all active projectiles using the weapons module's Projectile::tick().
    /// When a projectile hits terrain or expires, triggers an explosion if it has
    /// a blast radius (RPG).
    fn tick_projectiles(&mut self) {
        let mut explosions: Vec<([f32; 3], usize)> = Vec::new();

        self.active_projectiles.retain_mut(|proj| {
            let weapon_idx = proj.weapon_idx;
            let hit = proj.tick(SIM_DT, &self.terrain);
            if hit {
                let def = &WEAPONS[weapon_idx];
                if def.radius > 0.0 {
                    let (px, py, pz) = proj.impact_pos();
                    explosions.push(([px, py, pz], weapon_idx));
                }
                return false; // remove projectile
            }
            true
        });

        // Process explosions
        for (pos, weapon_idx) in explosions {
            let def = &WEAPONS[weapon_idx];
            self.apply_explosion(pos, def.damage as f32, def.radius);
        }
    }

    /// Apply an explosion: destroy blocks, apply knockback.
    /// Knockback matches client InfantryFireController.applyExplosionKnockback().
    fn apply_explosion(&mut self, pos: [f32; 3], damage: f32, radius: f32) {
        // Destroy blocks using the full ellipsoid + structural cascade pipeline
        let destroyed = explode_at(&mut self.terrain, (pos[0], pos[1], pos[2]), radius);
        self.blocks_destroyed += destroyed.len() as u32;

        // Apply knockback to player (matches client-side knockback formula)
        let player_pos = (self.player.pos_x, self.player.pos_y, self.player.pos_z);
        let explosion_pos = (pos[0], pos[1], pos[2]);
        let (kx, ky, kz) = knockback::apply_explosion_knockback(
            player_pos,
            explosion_pos,
            radius,
            damage,
        );
        if kx.abs() > 0.01 || ky.abs() > 0.01 || kz.abs() > 0.01 {
            self.player.apply_impulse(kx, ky, kz);
        }
    }

    // ── Accessors for bridge/live state ──

    /// Get the current player position.
    pub fn player_pos(&self) -> [f32; 3] {
        [self.player.pos_x, self.player.pos_y, self.player.pos_z]
    }

    /// Get the current player velocity.
    pub fn player_vel(&self) -> [f32; 3] {
        let (vx, vy, vz) = self.player.get_velocity();
        [vx, vy, vz]
    }

    /// Get the current target position.
    pub fn target_pos(&self) -> [f32; 3] {
        self.target_pos
    }

    /// Get the current player health.
    pub fn player_health(&self) -> f32 {
        self.player.health
    }

    /// Get the current weapon index.
    pub fn current_weapon(&self) -> u8 {
        self.weapons.current_weapon as u8
    }

    /// Get whether the player is on the ground.
    pub fn on_ground(&self) -> bool {
        self.player.on_ground
    }

    /// Get the modified terrain chunks (for preview overlay on base terrain).
    pub fn modified_terrain_chunks(&self) -> &std::collections::HashMap<u32, [u8; 4096]> {
        self.terrain.modified_chunks()
    }

    /// Get whether the episode is done.
    #[allow(dead_code)]
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Get the simulation timestep.
    #[allow(dead_code)]
    pub fn dt(&self) -> f32 {
        SIM_DT
    }
}

/// Find a random position on solid ground within world bounds.
///
/// Picks random x, z in [50, 700] (avoiding world edges), scans down from
/// y=47 to find the topmost solid block, and returns the position with
/// standing eye height.
fn find_ground_position(
    rng: &mut rand::rngs::StdRng,
    terrain: &EnvTerrain,
) -> [f32; 3] {
    const MAX_ATTEMPTS: u32 = 200;
    for _ in 0..MAX_ATTEMPTS {
        let x = rng.gen_range(50.0..700.0f32);
        let z = rng.gen_range(50.0..700.0f32);
        let bx = x.floor() as i32;
        let bz = z.floor() as i32;

        // Scan down from near world top to find topmost solid block
        for y in (0..worldgen::WORLD_SIZE_Y as i32).rev() {
            let block = terrain.get_block(bx, y, bz);
            if block != worldgen::AIR && block != worldgen::BEDROCK {
                let ground_y = y as f32 + 1.0;
                // Verify the space above is clear (2 blocks for player height)
                let above1 = terrain.get_block(bx, y + 1, bz);
                let above2 = terrain.get_block(bx, y + 2, bz);
                if above1 == worldgen::AIR && above2 == worldgen::AIR {
                    return [x, ground_y + 1.7, z];
                }
            }
        }
    }

    // Fallback: center of world at a safe height
    [375.5, 30.0, 375.5]
}

// ── Raycast Vision ──

/// Compute 48 ray directions in a sphere pattern relative to the bot's yaw.
///
/// Pattern:
///   Ring 0 (eye level, pitch=0):       8 rays every 45 degrees
///   Ring 1 (up 30 degrees):            8 rays every 45 degrees
///   Ring 2 (down 30 degrees):          8 rays every 45 degrees
///   Ring 3 (up 60 degrees):            8 rays every 45 degrees
///   Ring 4 (down 60 degrees):          8 rays every 45 degrees
///   Vertical:                          2 rays (straight up, straight down)
///   Forward focus (pitch=0, ±15deg):   6 rays (dense coverage ahead)
fn compute_ray_directions(yaw: f32) -> [(f32, f32, f32); NUM_RAYS] {
    let mut dirs = [(0.0f32, 0.0f32, 0.0f32); NUM_RAYS];
    let mut idx = 0;

    // Helper: yaw_offset + pitch -> (dx, dy, dz) unit vector
    let make_dir = |yaw_offset: f32, pitch: f32| -> (f32, f32, f32) {
        let total_yaw = yaw + yaw_offset;
        let cos_p = pitch.cos();
        let dx = -total_yaw.sin() * cos_p;
        let dy = pitch.sin();
        let dz = -total_yaw.cos() * cos_p;
        (dx, dy, dz)
    };

    // Rings at different pitch angles
    let pitches = [0.0f32, 0.52, -0.52, 1.05, -1.05]; // 0, ±30deg, ±60deg
    for &pitch in &pitches {
        for i in 0..8 {
            let yaw_offset = i as f32 * std::f32::consts::FRAC_PI_4; // 45 degree steps
            dirs[idx] = make_dir(yaw_offset, pitch);
            idx += 1;
        }
    }

    // Straight up and straight down
    dirs[idx] = (0.0, 1.0, 0.0);
    idx += 1;
    dirs[idx] = (0.0, -1.0, 0.0);
    idx += 1;

    // Forward-focused rays (denser coverage in the movement direction)
    let forward_offsets = [
        (0.0f32, 0.15f32),   // slightly up-forward
        (0.0, -0.15),        // slightly down-forward
        (0.26, 0.0),         // 15 deg right
        (-0.26, 0.0),        // 15 deg left
        (0.26, 0.15),        // right-up
        (-0.26, 0.15),       // left-up
    ];
    for &(yaw_off, pitch) in &forward_offsets {
        dirs[idx] = make_dir(yaw_off, pitch);
        idx += 1;
    }

    debug_assert_eq!(idx, NUM_RAYS);
    dirs
}

/// Cast a single ray using DDA (Digital Differential Analyzer) voxel traversal.
/// Returns the distance to the first solid block hit, or RAY_MAX_DIST if nothing hit.
fn cast_ray(
    terrain: &EnvTerrain,
    origin_x: f32, origin_y: f32, origin_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
) -> f32 {
    // Normalize direction
    let len = (dir_x * dir_x + dir_y * dir_y + dir_z * dir_z).sqrt();
    if len < 0.0001 {
        return RAY_MAX_DIST;
    }
    let dx = dir_x / len;
    let dy = dir_y / len;
    let dz = dir_z / len;

    // Current voxel position
    let mut vx = origin_x.floor() as i32;
    let mut vy = origin_y.floor() as i32;
    let mut vz = origin_z.floor() as i32;

    // Step direction (+1 or -1)
    let step_x: i32 = if dx >= 0.0 { 1 } else { -1 };
    let step_y: i32 = if dy >= 0.0 { 1 } else { -1 };
    let step_z: i32 = if dz >= 0.0 { 1 } else { -1 };

    // Distance along ray to next voxel boundary (tMax)
    let t_max_x = if dx.abs() < 1e-10 {
        f32::MAX
    } else if dx > 0.0 {
        ((vx as f32 + 1.0) - origin_x) / dx
    } else {
        (vx as f32 - origin_x) / dx
    };
    let t_max_y = if dy.abs() < 1e-10 {
        f32::MAX
    } else if dy > 0.0 {
        ((vy as f32 + 1.0) - origin_y) / dy
    } else {
        (vy as f32 - origin_y) / dy
    };
    let t_max_z = if dz.abs() < 1e-10 {
        f32::MAX
    } else if dz > 0.0 {
        ((vz as f32 + 1.0) - origin_z) / dz
    } else {
        (vz as f32 - origin_z) / dz
    };

    let mut t_max_x = t_max_x;
    let mut t_max_y = t_max_y;
    let mut t_max_z = t_max_z;

    // How far along ray to cross one full voxel (tDelta)
    let t_delta_x = if dx.abs() < 1e-10 { f32::MAX } else { (1.0 / dx).abs() };
    let t_delta_y = if dy.abs() < 1e-10 { f32::MAX } else { (1.0 / dy).abs() };
    let t_delta_z = if dz.abs() < 1e-10 { f32::MAX } else { (1.0 / dz).abs() };

    for _ in 0..RAY_MAX_STEPS {
        // Check current voxel
        let block = terrain.get_block(vx, vy, vz);
        if block != worldgen::AIR {
            // Hit! Return distance to this voxel
            let t = t_max_x.min(t_max_y).min(t_max_z);
            return t.min(RAY_MAX_DIST);
        }

        // Step to next voxel (DDA)
        if t_max_x < t_max_y {
            if t_max_x < t_max_z {
                if t_max_x > RAY_MAX_DIST { return RAY_MAX_DIST; }
                vx += step_x;
                t_max_x += t_delta_x;
            } else {
                if t_max_z > RAY_MAX_DIST { return RAY_MAX_DIST; }
                vz += step_z;
                t_max_z += t_delta_z;
            }
        } else {
            if t_max_y < t_max_z {
                if t_max_y > RAY_MAX_DIST { return RAY_MAX_DIST; }
                vy += step_y;
                t_max_y += t_delta_y;
            } else {
                if t_max_z > RAY_MAX_DIST { return RAY_MAX_DIST; }
                vz += step_z;
                t_max_z += t_delta_z;
            }
        }
    }

    RAY_MAX_DIST
}
