//! Training environment with a Gym-like API.
//!
//! Ties all sim modules together into a reset/step loop for RL training.
//! Each environment instance has its own CoW terrain, player state, weapons,
//! and projectiles. The base terrain is shared via Arc.

use std::sync::Arc;

use rand::Rng;
use rand::SeedableRng;

use super::destruction::explode_at;
use super::knockback;
use super::movement::{MoveAction, PlayerMovement};
use super::weapons::{Delivery, Projectile, WeaponState, NUM_WEAPONS, WEAPONS};
use super::world::{BaseTerrain, EnvTerrain};
use crate::worldgen;

// ── Constants ──

/// Simulation timestep: 30 Hz matching server tick rate.
const SIM_DT: f32 = 1.0 / 30.0;

/// Per-episode timeout is derived from target distance and active task.
const EPISODE_TIMEOUT_MIN: f32 = 12.0;
const EPISODE_TIMEOUT_MAX: f32 = 40.0;

/// Target is a 3x3 block area on the ground.
const TARGET_SIZE: f32 = 3.0;

/// Observation vector dimension.
/// 13 (state) + 48 (raycasts) + 27 (3x3x3 grid)
/// + 3 (ammo) + 3 (cooldown) + 4 (nearest pickup) + 5 (status)
/// + 3 (current look vector)
pub const OBSERVATION_DIM: usize = 106;

/// Number of vision raycasts.
const NUM_RAYS: usize = 48;
/// Max raycast distance in blocks.
const RAY_MAX_DIST: f32 = 40.0;
/// Max attempts for sampling a scenario-specific spawn/target pair.
const SCENARIO_SAMPLE_ATTEMPTS: usize = 420;

/// Action vector dimension.
/// [move_fwd, move_strafe, look_yaw, look_pitch, jump, sprint, fire, weapon_select]
pub const ACTION_DIM: usize = 8;
const MAX_YAW_DELTA_PER_STEP: f32 = 0.35;
const MAX_PITCH_DELTA_PER_STEP: f32 = 0.25;

const PROGRESS_CLAMP: f32 = 2.0;
const BREACH_OTHER_FIRE_COST: f32 = 0.05;
/// Positive reward per block destroyed — encourages RPG use for breaching.
const BREACH_DESTROY_REWARD_PER_BLOCK: f32 = 0.012;
const STAGNATION_DRIFT_COST: f32 = 0.02;
/// Per-step bonus for moving fast toward the target (at max sprint speed).
const VELOCITY_TOWARD_TARGET_BONUS: f32 = 0.04;

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
    pub blocks_destroyed_this_step: u32,
    pub reached_target: bool,
    pub timed_out: bool,
    pub stalled_out: bool,
    pub fired_weapon: Option<u8>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ScenarioKind {
    OpenRun,
    ElevatedTraversal,
    Breach,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TrainingTask {
    GroundShort,
    GroundLong,
    Elevated,
    Breach,
}

impl TrainingTask {
    pub(crate) fn initial() -> Self {
        Self::GroundShort
    }

    pub(crate) fn next(self) -> Option<Self> {
        match self {
            Self::GroundShort => Some(Self::GroundLong),
            Self::GroundLong => Some(Self::Elevated),
            Self::Elevated => Some(Self::Breach),
            Self::Breach => None,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::GroundShort => "Ground Short",
            Self::GroundLong => "Ground Long",
            Self::Elevated => "Elevated",
            Self::Breach => "Breach",
        }
    }

    fn layout_kind(self) -> ScenarioKind {
        match self {
            Self::GroundShort | Self::GroundLong => ScenarioKind::OpenRun,
            Self::Elevated => ScenarioKind::ElevatedTraversal,
            Self::Breach => ScenarioKind::Breach,
        }
    }

    fn distance_range(self) -> (f32, f32) {
        match self {
            Self::GroundShort => (8.0, 18.0),
            Self::GroundLong => (18.0, 36.0),
            Self::Elevated => (14.0, 30.0),
            Self::Breach => (12.0, 28.0),
        }
    }

    pub(crate) fn mastery_window(self) -> usize {
        match self {
            Self::GroundShort => 120,
            Self::GroundLong => 140,
            Self::Elevated => 160,
            Self::Breach => 0,
        }
    }

    pub(crate) fn mastery_min_episodes(self) -> usize {
        match self {
            Self::GroundShort => 96,
            Self::GroundLong => 112,
            Self::Elevated => 128,
            Self::Breach => usize::MAX,
        }
    }

    pub(crate) fn mastery_success_rate(self) -> f32 {
        match self {
            Self::GroundShort => 0.70,
            Self::GroundLong => 0.62,
            Self::Elevated => 0.52,
            Self::Breach => 1.0,
        }
    }

    pub(crate) fn mastery_stall_rate(self) -> f32 {
        match self {
            Self::GroundShort => 0.20,
            Self::GroundLong => 0.28,
            Self::Elevated => 0.38,
            Self::Breach => 0.0,
        }
    }

    pub(crate) fn mastery_timeout_rate(self) -> f32 {
        match self {
            Self::GroundShort => 0.08,
            Self::GroundLong => 0.10,
            Self::Elevated => 0.14,
            Self::Breach => 0.0,
        }
    }

    fn weapons_enabled(self) -> bool {
        matches!(self, Self::Breach)
    }

    fn progress_scale(self) -> f32 {
        match self {
            Self::GroundShort => 10.0,
            Self::GroundLong => 10.0,
            Self::Elevated => 9.0,
            Self::Breach => 8.0,
        }
    }

    fn living_cost(self) -> f32 {
        match self {
            Self::GroundShort => 0.028,
            Self::GroundLong => 0.033,
            Self::Elevated => 0.04,
            Self::Breach => 0.045,
        }
    }

    fn success_bonus(self) -> f32 {
        match self {
            Self::GroundShort => 30.0,
            Self::GroundLong => 35.0,
            Self::Elevated => 40.0,
            Self::Breach => 50.0,
        }
    }

    fn timeout_penalty(self) -> f32 {
        match self {
            Self::GroundShort => 10.0,
            Self::GroundLong => 12.0,
            Self::Elevated => 15.0,
            Self::Breach => 18.0,
        }
    }

    fn stall_penalty(self) -> f32 {
        match self {
            Self::GroundShort => 6.0,
            Self::GroundLong => 8.0,
            Self::Elevated => 10.0,
            Self::Breach => 12.0,
        }
    }

    fn stall_window(self) -> (f32, f32) {
        match self {
            Self::GroundShort => (5.0, 3.5),
            Self::GroundLong => (6.5, 4.0),
            Self::Elevated => (8.0, 5.5),
            Self::Breach => (10.0, 7.5),
        }
    }

    fn remaining_work(self, distance: f32, height_gap: f32, obstruction_count: u32) -> f32 {
        match self {
            Self::GroundShort | Self::GroundLong => distance,
            Self::Elevated => distance + height_gap * 4.0,
            Self::Breach => distance + obstruction_count as f32 * 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerminationReason {
    ReachedTarget,
    TimedOut,
    Stalled,
}

// ── Training Environment ──

/// The core training environment: Gym-like API with reset() and step().
pub struct TrainingEnv {
    terrain: EnvTerrain,
    player: PlayerMovement,
    weapons: WeaponState,
    target_pos: [f32; 3],
    spawn_pos: [f32; 3],
    episode_time: f32,
    episode_timeout: f32,
    episode_step: u32,
    total_reward: f32,
    prev_distance: f32,
    initial_remaining_work: f32,
    active_projectiles: Vec<Projectile>,
    blocks_destroyed: u32,
    rng: rand::rngs::StdRng,
    done: bool,
    /// Active training task assigned by the outer curriculum controller.
    task: TrainingTask,
    /// Smallest remaining-work score seen this episode.
    best_remaining_work: f32,
    /// Time since the bot last made meaningful progress toward the target.
    stagnation_timer: f32,
    /// Previous remaining-work score used for reward shaping.
    prev_remaining_work: f32,
    /// Per-step destruction count used for reward shaping.
    step_blocks_destroyed: u32,
    /// Weapon fired on this step, if any.
    fired_weapon_this_step: Option<u8>,
}

impl TrainingEnv {
    /// Create a new training environment with shared base terrain and a per-env seed.
    pub fn new(base_terrain: Arc<BaseTerrain>, seed: u64) -> Self {
        let terrain = EnvTerrain::new(base_terrain);
        let rng = rand::rngs::StdRng::seed_from_u64(seed);

        TrainingEnv {
            terrain,
            player: PlayerMovement::new(375.0, 30.0, 375.0),
            weapons: WeaponState::new(),
            target_pos: [0.0; 3],
            spawn_pos: [0.0; 3],
            episode_time: 0.0,
            episode_timeout: EPISODE_TIMEOUT_MAX,
            episode_step: 0,
            total_reward: 0.0,
            prev_distance: 0.0,
            initial_remaining_work: 0.0,
            active_projectiles: Vec::new(),
            blocks_destroyed: 0,
            rng,
            done: false,
            task: TrainingTask::initial(),
            best_remaining_work: f32::MAX,
            stagnation_timer: 0.0,
            prev_remaining_work: 0.0,
            step_blocks_destroyed: 0,
            fired_weapon_this_step: None,
        }
    }

    /// Reset the environment for a new episode. Returns the initial observation.
    pub fn reset(&mut self) -> Vec<f32> {
        // Reset terrain (drop CoW modifications)
        self.terrain.reset();

        let (min_dist, max_dist) = self.task.distance_range();
        let (spawn_pos, target_pos) =
            sample_episode_layout(&mut self.rng, &self.terrain, min_dist, max_dist, self.task);
        self.spawn_pos = spawn_pos;
        self.target_pos = target_pos;

        // Reset player at spawn
        self.player
            .reset(self.spawn_pos[0], self.spawn_pos[1], self.spawn_pos[2]);
        // Face toward target.
        // forward = (-sin(yaw), -cos(yaw)), so to face (dx, dz) we need
        // yaw = atan2(-dx, -dz).
        let dx = self.target_pos[0] - self.spawn_pos[0];
        let dz = self.target_pos[2] - self.spawn_pos[2];
        self.player.yaw = (-dx).atan2(-dz);

        // Reset weapons
        self.weapons.reset();
        self.weapons.select_weapon(0);

        // Clear projectiles
        self.active_projectiles.clear();

        // Reset episode tracking
        self.episode_time = 0.0;
        self.episode_step = 0;
        self.total_reward = 0.0;
        self.best_remaining_work = f32::MAX;
        self.stagnation_timer = 0.0;
        self.blocks_destroyed = 0;
        self.step_blocks_destroyed = 0;
        self.done = false;
        self.prev_remaining_work = 0.0;
        self.fired_weapon_this_step = None;

        // Compute initial task progress state.
        self.prev_distance = self.distance_to_target();
        let initial_height_gap = positive_height_gap(self.player.pos_y, self.target_pos[1]);
        let initial_line_block_count = line_block_count(
            &self.terrain,
            [self.player.pos_x, self.player.pos_y, self.player.pos_z],
            self.target_pos,
        );

        // Set timeout after computing obstruction count (Breach needs extra time per obstruction)
        self.episode_timeout = episode_timeout_for(
            horizontal_distance(self.spawn_pos, self.target_pos),
            initial_line_block_count,
            self.task,
        );
        let initial_remaining_work = self.task.remaining_work(
            self.prev_distance,
            initial_height_gap,
            initial_line_block_count,
        );
        self.initial_remaining_work = initial_remaining_work;
        self.prev_remaining_work = initial_remaining_work;
        self.best_remaining_work = initial_remaining_work;

        self.compute_observation()
    }

    pub fn set_task(&mut self, task: TrainingTask) {
        self.task = task;
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
    ///   [7] weapon_select (0-2, discretized)
    pub fn step(&mut self, action: &[f32]) -> StepResult {
        debug_assert!(
            action.len() >= ACTION_DIM,
            "Action must have {} elements",
            ACTION_DIM
        );
        self.step_blocks_destroyed = 0;
        self.fired_weapon_this_step = None;

        // Parse action
        let forward = action[0].clamp(-1.0, 1.0);
        let strafe = action[1].clamp(-1.0, 1.0);
        let yaw_delta = action[2].clamp(-1.0, 1.0) * MAX_YAW_DELTA_PER_STEP;
        let pitch_delta = action[3].clamp(-1.0, 1.0) * MAX_PITCH_DELTA_PER_STEP;
        let jump = action[4] > 0.5;
        let sprint = action[5] > 0.5;
        let fire = action[6] > 0.5;
        let weapon_select = (action[7].round() as usize).min(NUM_WEAPONS - 1);
        let next_yaw = self.player.yaw + yaw_delta;
        let next_pitch = (self.player.pitch + pitch_delta)
            .clamp(-std::f32::consts::FRAC_PI_2, std::f32::consts::FRAC_PI_2);
        let weapons_enabled = self.task.weapons_enabled();

        // Handle weapon switching
        self.weapons
            .select_weapon(if weapons_enabled { weapon_select } else { 0 });

        // Tick weapon sim time
        self.weapons.tick(SIM_DT);

        let mut fired_weapon = None;

        // Handle fire action
        if weapons_enabled && fire {
            let w = self.weapons.current_weapon;
            // Auto-reload if empty (matches real game's instant infantry reload)
            if self.weapons.ammo[w] == 0 {
                self.weapons.reload(w);
            }
            if self.weapons.can_fire(w) {
                let def = &WEAPONS[w];
                fired_weapon = Some(def.index);
                self.fired_weapon_this_step = fired_weapon;
                // Compute fire direction from yaw and pitch
                let cos_pitch = next_pitch.cos();
                let dir_x = -next_yaw.sin() * cos_pitch;
                let dir_y = -next_pitch.sin();
                let dir_z = -next_yaw.cos() * cos_pitch;

                // Deduct ammo and set cooldown
                self.weapons.fire(w);

                match def.delivery {
                    Delivery::Projectile => {
                        // Spawn an RPG projectile.
                        self.active_projectiles.push(Projectile::new(
                            self.player.pos_x,
                            self.player.pos_y,
                            self.player.pos_z,
                            dir_x,
                            dir_y,
                            dir_z,
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
        let blocks_before = self.blocks_destroyed;
        self.tick_projectiles();
        self.step_blocks_destroyed = self.blocks_destroyed - blocks_before;

        // Early curriculum removes pickups and buff interactions entirely.
        self.player.speed_multiplier = 1.0;

        // Build move action
        let move_action = MoveAction {
            forward,
            strafe,
            yaw: next_yaw,
            pitch: next_pitch,
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
        let termination = self.termination_reason();
        let reached = matches!(termination, Some(TerminationReason::ReachedTarget));
        let timed_out = matches!(termination, Some(TerminationReason::TimedOut));
        let stalled_out = matches!(termination, Some(TerminationReason::Stalled));
        self.done = termination.is_some();

        let observation = self.compute_observation();

        let info = StepInfo {
            episode_time: self.episode_time,
            episode_step: self.episode_step,
            total_reward: self.total_reward,
            distance_to_target: self.distance_to_target(),
            health: self.player.health,
            blocks_destroyed: self.blocks_destroyed,
            blocks_destroyed_this_step: self.blocks_destroyed - blocks_before,
            reached_target: reached,
            timed_out,
            stalled_out,
            fired_weapon,
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
    /// Layout (106 floats) — fully egocentric for navigation:
    ///   [0]       sin(relative_yaw_to_target)  — positive = target to the right
    ///   [1]       cos(relative_yaw_to_target)  — 1.0 = facing target directly
    ///   [2]       target elevation angle / (π/2) — positive = target above
    ///   [3]       horizontal distance / 50      — distance to target
    ///   [4]       height difference / 20        — signed: positive = target above
    ///   [5]       progress ratio                — 0=start, 1=at target
    ///   [6]       forward speed / 20            — egocentric forward velocity
    ///   [7]       lateral speed / 20            — egocentric lateral velocity
    ///   [8]       vertical speed / 20           — vertical velocity
    ///   [9]       time remaining fraction       — 1.0=full, 0.0=timeout
    ///   [10]      stagnation level              — 0=fresh, 1=stuck
    ///   [11]      on ground                     — 1.0 if grounded
    ///   [12]      distance to target / 50 (clamped to 1.0)
    ///   [13..61]  48 raycast distances (0=wall at face, 1=clear to max range)
    ///   [61..88]  3x3x3 immediate terrain grid (27 values, for close collision)
    ///   [88..91]  Ammo per weapon (normalized, 3 weapons)
    ///   [91..94]  Cooldown per weapon (normalized, 3 weapons)
    ///   [94]      current pitch / (π/2)
    ///   [95]      is climbing
    ///   [96]      is sprinting
    ///   [97]      health / max_health
    ///   [98]      current weapon (normalized)
    ///   [99]      speed multiplier / 3.0
    ///   [100..106] reserved (zeros)
    pub fn compute_observation(&self) -> Vec<f32> {
        let mut obs = Vec::with_capacity(OBSERVATION_DIM);

        // ── Egocentric target direction ──
        let dx = self.target_pos[0] - self.player.pos_x;
        let dy = self.target_pos[1] - self.player.pos_y;
        let dz = self.target_pos[2] - self.player.pos_z;
        let dist_hz = (dx * dx + dz * dz).sqrt().max(0.001);
        let dist_3d = (dx * dx + dy * dy + dz * dz).sqrt().max(0.001);

        // Forward and right vectors in XZ plane from player yaw
        let sin_yaw = self.player.yaw.sin();
        let cos_yaw = self.player.yaw.cos();
        let fwd_x = -sin_yaw;
        let fwd_z = -cos_yaw;
        let right_x = cos_yaw;
        let right_z = -sin_yaw;

        // Project target onto forward/right to get relative yaw
        let target_fwd = dx * fwd_x + dz * fwd_z;
        let target_right = dx * right_x + dz * right_z;
        let relative_yaw = target_right.atan2(target_fwd);

        // Target elevation angle (positive = above)
        let elevation_angle = (dy / dist_3d).clamp(-1.0, 1.0).asin();

        // [0]: sin(relative_yaw) — positive = target to the right
        obs.push(relative_yaw.sin());
        // [1]: cos(relative_yaw) — 1.0 = facing directly at target
        obs.push(relative_yaw.cos());
        // [2]: elevation angle normalized
        obs.push(elevation_angle / std::f32::consts::FRAC_PI_2);
        // [3]: horizontal distance (better normalization for 8-36 block range)
        obs.push(dist_hz / 50.0);
        // [4]: height difference (signed, in blocks)
        obs.push(dy / 20.0);
        // [5]: progress ratio
        let progress_ratio = if self.initial_remaining_work > 0.01 {
            (1.0 - self.prev_remaining_work / self.initial_remaining_work).clamp(-1.0, 1.0)
        } else {
            0.0
        };
        obs.push(progress_ratio);

        // ── Egocentric velocity ──
        let forward_speed = self.player.h_vel_x * fwd_x + self.player.h_vel_z * fwd_z;
        let lateral_speed = self.player.h_vel_x * right_x + self.player.h_vel_z * right_z;
        let ego_vel_norm = 20.0f32;
        // [6]: forward speed
        obs.push(forward_speed / ego_vel_norm);
        // [7]: lateral speed
        obs.push(lateral_speed / ego_vel_norm);
        // [8]: vertical speed
        obs.push(self.player.vel_y / ego_vel_norm);

        // ── Time and urgency ──
        // [9]: time remaining fraction
        obs.push((1.0 - self.episode_time / self.episode_timeout).clamp(0.0, 1.0));
        // [10]: stagnation level
        obs.push((self.stagnation_timer / 8.0).min(1.0));
        // [11]: on ground
        obs.push(if self.player.on_ground { 1.0 } else { 0.0 });

        // [12]: distance to target (clamped)
        obs.push((dist_hz / 50.0).min(1.0));

        // [13..61]: 48 raycast distances
        // Cast rays in a sphere pattern: 8 horizontal at eye level, 8 at +30deg,
        // 8 at -30deg, 8 at +60deg, 4 straight up variations, 4 straight down,
        // 8 in the forward hemisphere focused toward movement direction
        let eye_x = self.player.pos_x;
        let eye_y = self.player.pos_y;
        let eye_z = self.player.pos_z;

        let ray_dirs = compute_ray_directions(self.player.yaw, self.player.pitch);
        for dir in &ray_dirs {
            let hit_dist = cast_ray(&self.terrain, eye_x, eye_y, eye_z, dir.0, dir.1, dir.2);
            obs.push(hit_dist / RAY_MAX_DIST); // 0=wall at face, 1=clear to max
        }

        // [61..88]: 3x3x3 immediate grid (close-range collision awareness)
        let px = self.player.pos_x.floor() as i32;
        let py = (self.player.pos_y - 0.5).floor() as i32; // center on body, not eyes
        let pz = self.player.pos_z.floor() as i32;
        for dy_off in -1..=1 {
            for dz_off in -1..=1 {
                for dx_off in -1..=1 {
                    let block = self
                        .terrain
                        .get_block(px + dx_off, py + dy_off, pz + dz_off);
                    obs.push(if block != worldgen::AIR { 1.0 } else { 0.0 });
                }
            }
        }

        // [88..91], [91..94]: weapon state. Early tasks disable combat and keep
        // these slots at zero for checkpoint-shape compatibility.
        if self.task.weapons_enabled() {
            for i in 0..NUM_WEAPONS {
                let max = WEAPONS[i].max_ammo as f32;
                obs.push(if max > 0.0 {
                    self.weapons.ammo[i] as f32 / max
                } else {
                    0.0
                });
            }

            for i in 0..NUM_WEAPONS {
                let cooldown = 1.0 / WEAPONS[i].fire_rate;
                let elapsed = self.weapons.sim_time - self.weapons.last_fire_times[i];
                let remaining = (cooldown - elapsed).max(0.0);
                obs.push(if cooldown > 0.0 {
                    remaining / cooldown
                } else {
                    0.0
                });
            }
        } else {
            obs.extend_from_slice(&[0.0; 6]);
        }

        // [94]: current pitch
        obs.push(self.player.pitch / std::f32::consts::FRAC_PI_2);
        // [95]: is climbing
        obs.push(if self.player.is_climbing { 1.0 } else { 0.0 });
        // [96]: is sprinting
        obs.push(if self.player.is_sprinting { 1.0 } else { 0.0 });
        // [97]: health
        obs.push(self.player.health / self.player.max_health);
        // [98]: current weapon
        obs.push(if self.task.weapons_enabled() {
            self.weapons.current_weapon as f32 / (NUM_WEAPONS.saturating_sub(1).max(1) as f32)
        } else {
            0.0
        });
        // [99]: speed multiplier
        obs.push(self.player.speed_multiplier / 3.0);
        // [100..106]: reserved
        obs.extend_from_slice(&[0.0; 6]);

        debug_assert_eq!(obs.len(), OBSERVATION_DIM);
        obs
    }

    // ── Private helpers ──

    /// Compute dense reward for the current step.
    fn compute_reward(&mut self) -> f32 {
        let current_distance = self.distance_to_target();
        let current_height_gap = positive_height_gap(self.player.pos_y, self.target_pos[1]);
        let current_line_block_count = line_block_count(
            &self.terrain,
            [self.player.pos_x, self.player.pos_y, self.player.pos_z],
            self.target_pos,
        );
        let current_remaining_work = self.task.remaining_work(
            current_distance,
            current_height_gap,
            current_line_block_count,
        );

        // Reward only reduction in remaining task work. The remaining-work
        // definition changes by stage, but the shaping rule stays the same.
        let progress = (self.prev_remaining_work - current_remaining_work)
            .clamp(-PROGRESS_CLAMP, PROGRESS_CLAMP);
        let mut reward = progress * self.task.progress_scale();

        if self.task.weapons_enabled() {
            // Reward block destruction — each cleared block opens the path.
            if self.step_blocks_destroyed > 0 {
                reward += self.step_blocks_destroyed as f32 * BREACH_DESTROY_REWARD_PER_BLOCK;
            }
            // RPG fire (weapon 2) is free — it's the essential breaching tool.
            // Penalize non-RPG fire to discourage wasting time with rifle/shotgun.
            if let Some(weapon) = self.fired_weapon_this_step {
                if weapon != 2 {
                    reward -= BREACH_OTHER_FIRE_COST;
                }
            }
        }

        reward -= self.task.living_cost();

        // Dense velocity-toward-target bonus: rewards moving fast toward the goal.
        let to_target_x = self.target_pos[0] - self.player.pos_x;
        let to_target_z = self.target_pos[2] - self.player.pos_z;
        let h_dist = (to_target_x * to_target_x + to_target_z * to_target_z).sqrt();
        if h_dist > 1.0 {
            let dir_x = to_target_x / h_dist;
            let dir_z = to_target_z / h_dist;
            let vel_toward = self.player.h_vel_x * dir_x + self.player.h_vel_z * dir_z;
            reward += (vel_toward / 18.0).clamp(0.0, 1.0) * VELOCITY_TOWARD_TARGET_BONUS;
        }

        if current_remaining_work < self.best_remaining_work - 0.25 {
            self.best_remaining_work = current_remaining_work;
            self.stagnation_timer = 0.0;
        } else {
            self.stagnation_timer += SIM_DT;
            if self.stagnation_timer > 1.5 {
                // Escalating cost: the longer stuck, the worse it gets.
                // At 1.5s: 1x, at 3.0s: 2x, at 4.5s: 3x, etc.
                let escalation = self.stagnation_timer / 1.5;
                reward -= STAGNATION_DRIFT_COST * escalation;
            }
        }

        let reached_target = self.reached_target();
        let timed_out = self.episode_time >= self.episode_timeout;
        let stalled_out = self.should_abort_for_stall(current_remaining_work);

        if reached_target {
            // Speed-scaled success bonus: up to 2x for very fast completion.
            let time_left = (self.episode_timeout - self.episode_time).max(0.0);
            let speed_multiplier = 1.0 + time_left / self.episode_timeout;
            reward += self.task.success_bonus() * speed_multiplier;
        } else if timed_out {
            reward -= self.task.timeout_penalty();
        } else if stalled_out {
            reward -= self.task.stall_penalty();
        }

        // Update rolling state for next step.
        self.prev_distance = current_distance;
        self.prev_remaining_work = current_remaining_work;

        reward
    }

    fn termination_reason(&self) -> Option<TerminationReason> {
        let current_remaining_work = self.current_remaining_work();
        if self.reached_target() {
            Some(TerminationReason::ReachedTarget)
        } else if self.episode_time >= self.episode_timeout {
            Some(TerminationReason::TimedOut)
        } else if self.should_abort_for_stall(current_remaining_work) {
            Some(TerminationReason::Stalled)
        } else {
            None
        }
    }

    fn should_abort_for_stall(&self, current_remaining_work: f32) -> bool {
        let (min_time, max_stagnation) = self.task.stall_window();
        let near_finish = current_remaining_work <= (self.initial_remaining_work * 0.20).max(3.0);
        !near_finish && self.episode_time >= min_time && self.stagnation_timer >= max_stagnation
    }

    fn current_remaining_work(&self) -> f32 {
        let distance = self.distance_to_target();
        let height_gap = positive_height_gap(self.player.pos_y, self.target_pos[1]);
        let obstruction_count = line_block_count(
            &self.terrain,
            [self.player.pos_x, self.player.pos_y, self.player.pos_z],
            self.target_pos,
        );
        self.task
            .remaining_work(distance, height_gap, obstruction_count)
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
        let (kx, ky, kz) =
            knockback::apply_explosion_knockback(player_pos, explosion_pos, radius, damage);
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

    pub fn spawn_pos(&self) -> [f32; 3] {
        self.spawn_pos
    }

    /// Get the current player health.
    pub fn player_health(&self) -> f32 {
        self.player.health
    }

    /// Get the current weapon index.
    pub fn current_weapon(&self) -> u8 {
        if self.task.weapons_enabled() {
            WEAPONS[self.weapons.current_weapon].index
        } else {
            0
        }
    }

    /// Get whether the player is on the ground.
    pub fn on_ground(&self) -> bool {
        self.player.on_ground
    }

    pub fn player_yaw(&self) -> f32 {
        self.player.yaw
    }

    pub fn player_pitch(&self) -> f32 {
        self.player.pitch
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
fn find_ground_position(rng: &mut rand::rngs::StdRng, terrain: &EnvTerrain) -> [f32; 3] {
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

fn sample_episode_layout(
    rng: &mut rand::rngs::StdRng,
    terrain: &EnvTerrain,
    min_dist: f32,
    max_dist: f32,
    task: TrainingTask,
) -> ([f32; 3], [f32; 3]) {
    let desired = task.layout_kind();
    if let Some(pair) = sample_pair_for_scenario(rng, terrain, min_dist, max_dist, desired) {
        return pair;
    }

    for _ in 0..SCENARIO_SAMPLE_ATTEMPTS {
        let spawn = find_ground_position(rng, terrain);
        let target = find_ground_position(rng, terrain);
        let dist = horizontal_distance(spawn, target);
        if dist >= min_dist && dist <= max_dist {
            return (spawn, target);
        }
    }

    let spawn = find_ground_position(rng, terrain);
    let target = loop {
        let candidate = find_ground_position(rng, terrain);
        let dist = horizontal_distance(spawn, candidate);
        if dist >= min_dist && dist <= max_dist {
            break candidate;
        }
    };
    (spawn, target)
}

fn sample_pair_for_scenario(
    rng: &mut rand::rngs::StdRng,
    terrain: &EnvTerrain,
    min_dist: f32,
    max_dist: f32,
    scenario: ScenarioKind,
) -> Option<([f32; 3], [f32; 3])> {
    for _ in 0..SCENARIO_SAMPLE_ATTEMPTS {
        let spawn = find_ground_position(rng, terrain);
        let target = find_ground_position(rng, terrain);
        let dx = target[0] - spawn[0];
        let dz = target[2] - spawn[2];
        let dist = (dx * dx + dz * dz).sqrt();
        if dist < min_dist || dist > max_dist {
            continue;
        }

        let height_gap = target[1] - spawn[1];
        let blocked = line_block_count(terrain, spawn, target);
        let matches = match scenario {
            ScenarioKind::OpenRun => dist <= max_dist && height_gap.abs() <= 3.0 && blocked <= 2,
            ScenarioKind::ElevatedTraversal => {
                height_gap >= 3.5 && dist <= max_dist + 8.0 && (blocked >= 1 || height_gap >= 4.5)
            }
            ScenarioKind::Breach => dist >= min_dist * 0.85 && blocked >= 5,
        };

        if matches {
            return Some((spawn, target));
        }
    }

    None
}

fn line_block_count(terrain: &EnvTerrain, start: [f32; 3], end: [f32; 3]) -> u32 {
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let dz = end[2] - start[2];
    let horizontal_dist = (dx * dx + dz * dz).sqrt().max(1.0);
    let steps = (horizontal_dist / 0.75).ceil().max(2.0) as u32;
    let mut blocked = 0u32;

    for step in 1..steps {
        let t = step as f32 / steps as f32;
        let x = start[0] + dx * t;
        let z = start[2] + dz * t;
        let body_y = start[1] + dy * t - 0.8;
        let bx = x.floor() as i32;
        let bz = z.floor() as i32;
        let lower = body_y.floor() as i32;
        let upper = (body_y + 0.9).floor() as i32;

        if terrain.get_block(bx, lower, bz) != worldgen::AIR
            || terrain.get_block(bx, upper, bz) != worldgen::AIR
        {
            blocked += 1;
        }
    }

    blocked
}

fn positive_height_gap(player_y: f32, target_y: f32) -> f32 {
    (target_y - player_y).max(0.0)
}

fn horizontal_distance(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = b[0] - a[0];
    let dz = b[2] - a[2];
    (dx * dx + dz * dz).sqrt()
}

fn episode_timeout_for(distance: f32, obstruction_count: u32, task: TrainingTask) -> f32 {
    let task_extra = match task {
        TrainingTask::GroundShort => 0.0,
        TrainingTask::GroundLong => 2.0,
        TrainingTask::Elevated => 4.0,
        TrainingTask::Breach => 6.0,
    };
    // Give extra time per obstruction on Breach — each blocked section requires
    // the bot to aim, fire RPG, wait for explosion, then navigate through.
    let obstruction_extra = if task == TrainingTask::Breach {
        obstruction_count as f32 * 0.3
    } else {
        0.0
    };
    (10.0 + distance * 0.35 + task_extra + obstruction_extra)
        .clamp(EPISODE_TIMEOUT_MIN, EPISODE_TIMEOUT_MAX)
}

// ── Raycast Vision ──

/// Compute 48 ray directions in a sphere pattern relative to the bot's look.
///
/// Pattern:
///   Ring 0 (look level):               8 rays every 45 degrees
///   Ring 1 (look +30 degrees):         8 rays every 45 degrees
///   Ring 2 (look -30 degrees):         8 rays every 45 degrees
///   Ring 3 (look +60 degrees):         8 rays every 45 degrees
///   Ring 4 (look -60 degrees):         8 rays every 45 degrees
///   Vertical bias:                     2 rays (strong up/down offsets)
///   Forward focus:                     6 rays (denser coverage around the current look dir)
fn compute_ray_directions(yaw: f32, pitch: f32) -> [(f32, f32, f32); NUM_RAYS] {
    let mut dirs = [(0.0f32, 0.0f32, 0.0f32); NUM_RAYS];
    let mut idx = 0;

    // Helper: local look offsets -> world-space unit vector.
    let make_dir = |yaw_offset: f32, pitch_offset: f32| -> (f32, f32, f32) {
        let total_yaw = yaw + yaw_offset;
        let total_pitch = (pitch + pitch_offset).clamp(
            -std::f32::consts::FRAC_PI_2 + 0.01,
            std::f32::consts::FRAC_PI_2 - 0.01,
        );
        let cos_p = total_pitch.cos();
        let dx = -total_yaw.sin() * cos_p;
        let dy = -total_pitch.sin();
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
    dirs[idx] = make_dir(0.0, -1.45);
    idx += 1;
    dirs[idx] = make_dir(0.0, 1.45);
    idx += 1;

    // Forward-focused rays (denser coverage in the movement direction)
    let forward_offsets = [
        (0.0f32, 0.15f32), // slightly up-forward
        (0.0, -0.15),      // slightly down-forward
        (0.26, 0.0),       // 15 deg right
        (-0.26, 0.0),      // 15 deg left
        (0.26, 0.15),      // right-up
        (-0.26, 0.15),     // left-up
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
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
    dir_x: f32,
    dir_y: f32,
    dir_z: f32,
) -> f32 {
    let len = (dir_x * dir_x + dir_y * dir_y + dir_z * dir_z).sqrt();
    if len < 0.0001 {
        return RAY_MAX_DIST;
    }
    let dx = dir_x / len;
    let dy = dir_y / len;
    let dz = dir_z / len;

    let mut vx = origin_x.floor() as i32;
    let mut vy = origin_y.floor() as i32;
    let mut vz = origin_z.floor() as i32;

    let step_x: i32 = if dx >= 0.0 { 1 } else { -1 };
    let step_y: i32 = if dy >= 0.0 { 1 } else { -1 };
    let step_z: i32 = if dz >= 0.0 { 1 } else { -1 };

    let t_delta_x = if dx != 0.0 {
        (1.0 / dx).abs()
    } else {
        f32::INFINITY
    };
    let t_delta_y = if dy != 0.0 {
        (1.0 / dy).abs()
    } else {
        f32::INFINITY
    };
    let t_delta_z = if dz != 0.0 {
        (1.0 / dz).abs()
    } else {
        f32::INFINITY
    };

    let mut t_max_x = if dx != 0.0 {
        (if step_x > 0 {
            vx as f32 + 1.0 - origin_x
        } else {
            origin_x - vx as f32
        }) / dx.abs()
    } else {
        f32::INFINITY
    };
    let mut t_max_y = if dy != 0.0 {
        (if step_y > 0 {
            vy as f32 + 1.0 - origin_y
        } else {
            origin_y - vy as f32
        }) / dy.abs()
    } else {
        f32::INFINITY
    };
    let mut t_max_z = if dz != 0.0 {
        (if step_z > 0 {
            vz as f32 + 1.0 - origin_z
        } else {
            origin_z - vz as f32
        }) / dz.abs()
    } else {
        f32::INFINITY
    };

    let mut dist = 0.0f32;

    while dist < RAY_MAX_DIST {
        if vx < 0
            || vy < 0
            || vz < 0
            || vx >= worldgen::WORLD_SIZE_X as i32
            || vy >= worldgen::WORLD_SIZE_Y as i32
            || vz >= worldgen::WORLD_SIZE_Z as i32
        {
            return RAY_MAX_DIST;
        }

        if terrain.get_block(vx, vy, vz) != worldgen::AIR {
            return dist.min(RAY_MAX_DIST);
        }

        if t_max_x < t_max_y {
            if t_max_x < t_max_z {
                vx += step_x;
                dist = t_max_x;
                t_max_x += t_delta_x;
            } else {
                vz += step_z;
                dist = t_max_z;
                t_max_z += t_delta_z;
            }
        } else if t_max_y < t_max_z {
            vy += step_y;
            dist = t_max_y;
            t_max_y += t_delta_y;
        } else {
            vz += step_z;
            dist = t_max_z;
            t_max_z += t_delta_z;
        }
    }

    RAY_MAX_DIST
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::world::{pack_chunk_id, BaseTerrain, EnvTerrain};
    use std::collections::HashMap;

    fn single_chunk_terrain() -> EnvTerrain {
        let mut chunks = HashMap::new();
        chunks.insert(pack_chunk_id(0, 0, 0), [worldgen::AIR; 4096]);
        let base = BaseTerrain { chunks, seed: 0 };
        EnvTerrain::new(Arc::new(base))
    }

    fn client_like_cast_ray(
        terrain: &EnvTerrain,
        origin_x: f32,
        origin_y: f32,
        origin_z: f32,
        dir_x: f32,
        dir_y: f32,
        dir_z: f32,
    ) -> f32 {
        let len = (dir_x * dir_x + dir_y * dir_y + dir_z * dir_z).sqrt();
        let dx = dir_x / len;
        let dy = dir_y / len;
        let dz = dir_z / len;

        let mut x = origin_x.floor() as i32;
        let mut y = origin_y.floor() as i32;
        let mut z = origin_z.floor() as i32;

        let step_x = if dx >= 0.0 { 1 } else { -1 };
        let step_y = if dy >= 0.0 { 1 } else { -1 };
        let step_z = if dz >= 0.0 { 1 } else { -1 };

        let t_delta_x = if dx != 0.0 {
            (1.0 / dx).abs()
        } else {
            f32::INFINITY
        };
        let t_delta_y = if dy != 0.0 {
            (1.0 / dy).abs()
        } else {
            f32::INFINITY
        };
        let t_delta_z = if dz != 0.0 {
            (1.0 / dz).abs()
        } else {
            f32::INFINITY
        };

        let mut t_max_x = if dx != 0.0 {
            (if step_x > 0 {
                x as f32 + 1.0 - origin_x
            } else {
                origin_x - x as f32
            }) / dx.abs()
        } else {
            f32::INFINITY
        };
        let mut t_max_y = if dy != 0.0 {
            (if step_y > 0 {
                y as f32 + 1.0 - origin_y
            } else {
                origin_y - y as f32
            }) / dy.abs()
        } else {
            f32::INFINITY
        };
        let mut t_max_z = if dz != 0.0 {
            (if step_z > 0 {
                z as f32 + 1.0 - origin_z
            } else {
                origin_z - z as f32
            }) / dz.abs()
        } else {
            f32::INFINITY
        };

        let mut dist = 0.0f32;
        while dist < RAY_MAX_DIST {
            if x < 0
                || y < 0
                || z < 0
                || x >= worldgen::WORLD_SIZE_X as i32
                || y >= worldgen::WORLD_SIZE_Y as i32
                || z >= worldgen::WORLD_SIZE_Z as i32
            {
                return RAY_MAX_DIST;
            }

            if terrain.get_block(x, y, z) != worldgen::AIR {
                return dist.min(RAY_MAX_DIST);
            }

            if t_max_x < t_max_y {
                if t_max_x < t_max_z {
                    x += step_x;
                    dist = t_max_x;
                    t_max_x += t_delta_x;
                } else {
                    z += step_z;
                    dist = t_max_z;
                    t_max_z += t_delta_z;
                }
            } else if t_max_y < t_max_z {
                y += step_y;
                dist = t_max_y;
                t_max_y += t_delta_y;
            } else {
                z += step_z;
                dist = t_max_z;
                t_max_z += t_delta_z;
            }
        }

        RAY_MAX_DIST
    }

    #[test]
    fn cast_ray_matches_client_dda_distance() {
        let mut terrain = single_chunk_terrain();
        terrain.set_block(8, 5, 11, worldgen::CONCRETE);

        let origin = (8.5, 5.5, 8.5);
        let dir = (0.0, 0.0, 1.0);

        let expected =
            client_like_cast_ray(&terrain, origin.0, origin.1, origin.2, dir.0, dir.1, dir.2);
        let actual = cast_ray(&terrain, origin.0, origin.1, origin.2, dir.0, dir.1, dir.2);

        assert!(
            (expected - actual).abs() < 1e-5,
            "expected {expected}, got {actual}"
        );
        assert!((actual - 2.5).abs() < 1e-5, "expected 2.5, got {actual}");
    }

    #[test]
    fn ray_directions_follow_current_pitch() {
        let flat = compute_ray_directions(0.0, 0.0);
        let up = compute_ray_directions(0.0, -0.6);
        let down = compute_ray_directions(0.0, 0.6);

        assert!(
            up[0].1 > flat[0].1,
            "upward look should tilt center ray upward"
        );
        assert!(
            down[0].1 < flat[0].1,
            "downward look should tilt center ray downward"
        );
    }

    #[test]
    fn spawn_facing_points_toward_target() {
        // forward = (-sin(yaw), -cos(yaw)) must align with (dx, dz)
        let cases: &[([f32; 2], &str)] = &[
            ([10.0, 0.0], "+X"),
            ([-10.0, 0.0], "-X"),
            ([0.0, 10.0], "+Z"),
            ([0.0, -10.0], "-Z"),
            ([7.0, 7.0], "+X+Z"),
            ([-7.0, 7.0], "-X+Z"),
        ];

        for &([dx, dz], label) in cases {
            let yaw = (-dx).atan2(-dz);
            let fwd_x = -yaw.sin();
            let fwd_z = -yaw.cos();
            let dist = (dx * dx + dz * dz).sqrt();
            let dot = (fwd_x * dx + fwd_z * dz) / dist;
            assert!(
                dot > 0.99,
                "spawn facing failed for {label}: forward=({fwd_x:.3},{fwd_z:.3}), target=({:.3},{:.3}), dot={dot:.4}",
                dx / dist,
                dz / dist
            );
        }
    }

    #[test]
    fn egocentric_obs_target_ahead_gives_cos_one() {
        // When facing directly at target, cos(relative_yaw) ≈ 1.0
        let base = Arc::new(BaseTerrain { chunks: std::collections::HashMap::new(), seed: 0 });
        let mut env = TrainingEnv::new(base, 42);
        // Manually set up a scenario: player at (5, 5, 5), target at (5, 5, 15)
        env.player.reset(5.0, 5.0, 5.0);
        env.target_pos = [5.0, 5.0, 15.0];
        // Face toward +Z: yaw = atan2(-0, -10) = π
        env.player.yaw = (0.0f32).atan2(-10.0); // π
        env.initial_remaining_work = 10.0;
        env.prev_remaining_work = 10.0;
        env.episode_timeout = 20.0;

        let obs = env.compute_observation();
        // obs[0] = sin(relative_yaw), obs[1] = cos(relative_yaw)
        assert!(
            obs[1] > 0.95,
            "cos(relative_yaw) should be ~1.0 when facing target, got {}",
            obs[1]
        );
        assert!(
            obs[0].abs() < 0.1,
            "sin(relative_yaw) should be ~0.0 when facing target, got {}",
            obs[0]
        );
    }
}
