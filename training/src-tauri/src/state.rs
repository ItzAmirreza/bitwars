//! Shared training state and config types.
//!
//! These are plain (non-Tauri) types shared by the headless trainer (`bin/train.rs`)
//! and the Tauri GUI bridge (`bridge.rs`). Keeping them here — separate from the
//! `#[tauri::command]` layer — lets the training engine build without pulling in
//! tauri/webkit, so it compiles and runs on a headless CPU training server.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::rl::ppo::PPOConfig;
use crate::rl::replay::EpisodeRecording;
use crate::sim::world::BaseTerrain;

// ── Shared state types ──

/// Training statistics exposed to the frontend.
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct TrainingStats {
    pub episode: u64,
    pub total_steps: u64,
    pub mean_reward: f32,
    pub mean_episode_length: f32,
    pub steps_per_sec: f32,
    pub elapsed_secs: f64,
    pub success_rate: f32,
    pub timeout_rate: f32,
    pub stall_rate: f32,
    pub rpg_usage_rate: f32,
    pub block_destroy_rate: f32,
    pub policy_loss: f32,
    pub value_loss: f32,
    pub entropy: f32,
    pub approx_kl: f32,
    pub explained_variance: f32,
    pub current_task: String,
    pub device: String,
}

/// Live bot state for the 3D viewport.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LiveBotState {
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
    pub target: [f32; 3],
    pub health: f32,
    pub weapon: u8,
    pub on_ground: bool,
    pub action: [f32; 8],
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct PreviewFrame {
    pub bots: Vec<LiveBotState>,
    pub terrain_revision: u64,
}

/// Hyperparameters that can be adjusted at runtime.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HyperParams {
    pub lr: Option<f64>,
    pub gamma: Option<f32>,
    pub entropy_coeff: Option<f32>,
    pub num_envs: Option<usize>,
    pub rollout_length: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrainingConfigView {
    pub lr: f64,
    pub gamma: f32,
    pub entropy_coeff: f32,
    pub num_envs: usize,
    pub rollout_length: usize,
    pub seed: u64,
}

#[derive(Clone, Debug)]
pub struct RuntimeTrainingConfig {
    pub ppo: PPOConfig,
    pub num_envs: usize,
    pub seed: u64,
}

impl RuntimeTrainingConfig {
    pub fn recommended() -> Self {
        let cpu_count = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        let num_envs = match cpu_count {
            0..=4 => 8,
            5..=8 => 16,
            9..=12 => 32,
            _ => 32,
        };
        let rollout_length = 256usize;
        let total_batch = num_envs * rollout_length;
        let minibatch_size = recommended_minibatch_size(total_batch);

        Self {
            ppo: PPOConfig {
                lr: 2.5e-4,
                gamma: 0.995,
                gae_lambda: 0.95,
                clip_epsilon: 0.2,
                entropy_coeff: 0.004,
                value_coeff: 0.5,
                max_grad_norm: 0.5,
                num_epochs: 4,
                minibatch_size,
                rollout_length,
            },
            num_envs,
            seed: 42,
        }
    }

    pub fn view(&self) -> TrainingConfigView {
        TrainingConfigView {
            lr: self.ppo.lr,
            gamma: self.ppo.gamma,
            entropy_coeff: self.ppo.entropy_coeff,
            num_envs: self.num_envs,
            rollout_length: self.ppo.rollout_length,
            seed: self.seed,
        }
    }

    pub fn apply_params(&mut self, params: &HyperParams) -> Vec<String> {
        let mut updates = Vec::new();

        if let Some(lr) = params.lr {
            self.ppo.lr = lr.max(1e-6);
            updates.push(format!("lr={:.6}", self.ppo.lr));
        }
        if let Some(gamma) = params.gamma {
            self.ppo.gamma = gamma.clamp(0.9, 0.9999);
            updates.push(format!("gamma={:.4}", self.ppo.gamma));
        }
        if let Some(entropy) = params.entropy_coeff {
            self.ppo.entropy_coeff = entropy.max(0.0);
            updates.push(format!("entropy_coeff={:.4}", self.ppo.entropy_coeff));
        }
        if let Some(num_envs) = params.num_envs {
            self.num_envs = num_envs.clamp(1, 128);
            updates.push(format!("num_envs={}", self.num_envs));
        }
        if let Some(rollout) = params.rollout_length {
            self.ppo.rollout_length = rollout.clamp(64, 2048);
            updates.push(format!("rollout_length={}", self.ppo.rollout_length));
        }

        let total_batch = self.num_envs * self.ppo.rollout_length;
        self.ppo.minibatch_size = recommended_minibatch_size(total_batch);

        updates
    }
}

impl TrainingState {
    pub fn note_preview_activity(&mut self) {
        self.preview_last_request_at = Some(Instant::now());
    }

    pub fn preview_active(&self, timeout: Duration) -> bool {
        self.preview_last_request_at
            .map(|at| at.elapsed() <= timeout)
            .unwrap_or(false)
    }

    #[cfg(target_os = "macos")]
    pub fn ensure_sleep_prevention(&mut self) {
        if self.sleep_inhibitor.is_some() {
            return;
        }
        match std::process::Command::new("caffeinate").arg("-i").spawn() {
            Ok(child) => {
                log::info!("Started caffeinate guard (pid={})", child.id());
                self.sleep_inhibitor = Some(child);
            }
            Err(err) => {
                log::warn!("Failed to start caffeinate guard: {}", err);
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn ensure_sleep_prevention(&mut self) {}

    #[cfg(target_os = "macos")]
    pub fn stop_sleep_prevention(&mut self) {
        if let Some(mut child) = self.sleep_inhibitor.take() {
            let _ = child.kill();
            let _ = child.wait();
            log::info!("Stopped caffeinate guard");
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn stop_sleep_prevention(&mut self) {}
}

fn recommended_minibatch_size(total_batch: usize) -> usize {
    if total_batch >= 8192 {
        512
    } else if total_batch >= 4096 {
        256
    } else {
        128
    }
}

/// Checkpoint metadata for listing saved checkpoints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub path: String,
    pub episode: u64,
    pub mean_reward: f32,
    pub mean_episode_length: f32,
    pub timestamp: String,
    pub file_size_bytes: u64,
    pub success_rate: f32,
    pub stall_rate: f32,
    pub timeout_rate: f32,
    pub task: String,
}

/// Training status for frontend to query on mount.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrainingStatus {
    pub is_running: bool,
    pub is_paused: bool,
}

/// Root shared state managed by Tauri.
pub struct TrainingState {
    pub is_running: bool,
    pub is_paused: bool,
    pub stats: TrainingStats,
    pub reward_history: Vec<(u64, f32)>,
    /// All bot states for visualization (one per environment).
    pub live_bot_states: Vec<LiveBotState>,
    /// When true, the preview shows a separate deterministic evaluation rollout.
    pub preview_deterministic: bool,
    /// Request the training loop to reset the preview rollout on the next tick.
    pub preview_reset_requested: bool,
    /// Shared base terrain for chunk visualization.
    pub base_terrain: Option<Arc<BaseTerrain>>,
    /// Which environment's terrain to show in the preview (set by frontend).
    pub preview_bot: usize,
    /// Snapshot of the preview bot's modified terrain chunks (overlaid on base).
    pub preview_modified_chunks: HashMap<u32, [u8; 4096]>,
    pub checkpoint_dir: PathBuf,
    /// Signal from frontend to save a checkpoint (training loop reads & clears).
    pub checkpoint_save_requested: bool,
    /// Signal from frontend to load a checkpoint (training loop reads & clears).
    pub checkpoint_load_path: Option<String>,
    pub preview_terrain_revision: u64,
    pub runtime_config: RuntimeTrainingConfig,
    pub pending_hyperparams: Option<HyperParams>,
    pub best_replays: Vec<EpisodeRecording>,
    pub pending_replay_deletions: Vec<String>,
    pub clear_replays_requested: bool,
    pub preview_last_request_at: Option<Instant>,
    pub sleep_inhibitor: Option<Child>,
}

impl Default for TrainingState {
    fn default() -> Self {
        let checkpoint_dir = std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("checkpoints");
        TrainingState {
            is_running: false,
            is_paused: false,
            stats: TrainingStats::default(),
            reward_history: Vec::new(),
            live_bot_states: Vec::new(),
            preview_deterministic: false,
            preview_reset_requested: true,
            base_terrain: None,
            preview_bot: 0,
            preview_modified_chunks: HashMap::new(),
            checkpoint_dir,
            checkpoint_save_requested: false,
            checkpoint_load_path: None,
            preview_terrain_revision: 0,
            runtime_config: RuntimeTrainingConfig::recommended(),
            pending_hyperparams: None,
            best_replays: Vec::new(),
            pending_replay_deletions: Vec::new(),
            clear_replays_requested: false,
            preview_last_request_at: None,
            sleep_inhibitor: None,
        }
    }
}

pub type SharedState = Arc<Mutex<TrainingState>>;

/// Lock the shared state, converting a poisoned mutex into a user-friendly error.
pub fn lock_state(state: &SharedState) -> Result<std::sync::MutexGuard<'_, TrainingState>, String> {
    state
        .lock()
        .map_err(|e| format!("State lock poisoned: {}", e))
}
