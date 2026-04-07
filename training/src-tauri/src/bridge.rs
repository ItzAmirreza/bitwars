//! Tauri IPC bridge -- connects the Rust training backend with the frontend UI.
//!
//! All commands read/write from shared TrainingState behind Arc<Mutex<>>.
//! The actual training thread integration will be wired in a later task;
//! for now the commands operate on the shared state struct.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::sim::world::BaseTerrain;

use serde::{Deserialize, Serialize};
use tauri::State;

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
}

/// Live bot state for the 3D viewport.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LiveBotState {
    pub pos: [f32; 3],
    pub vel: [f32; 3],
    pub target: [f32; 3],
    pub health: f32,
    pub weapon: u8,
    pub on_ground: bool,
    pub action: [f32; 8],
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

/// Checkpoint metadata for listing saved checkpoints.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CheckpointInfo {
    pub path: String,
    pub episode: u64,
    pub mean_reward: f32,
    pub mean_episode_length: f32,
    pub timestamp: String,
    pub file_size_bytes: u64,
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
            base_terrain: None,
            preview_bot: 0,
            preview_modified_chunks: HashMap::new(),
            checkpoint_dir,
            checkpoint_save_requested: false,
            checkpoint_load_path: None,
        }
    }
}

pub type SharedState = Arc<Mutex<TrainingState>>;

/// Lock the shared state, converting a poisoned mutex into a user-friendly error.
fn lock_state(state: &SharedState) -> Result<std::sync::MutexGuard<'_, TrainingState>, String> {
    state
        .lock()
        .map_err(|e| format!("State lock poisoned: {}", e))
}

// ── Tauri commands ──

#[tauri::command]
pub async fn start_training(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let shared = state.inner().clone();
    {
        let mut s = lock_state(&shared)?;
        if s.is_running {
            return Err("Training is already running".to_string());
        }
        s.is_running = true;
        s.is_paused = false;
    }

    // Spawn training thread
    let state_clone = shared.clone();
    std::thread::Builder::new()
        .name("training-loop".into())
        .spawn(move || {
            let config = crate::rl::ppo::PPOConfig::default();
            crate::training_loop::run_training(state_clone, config, 64, 42);
        })
        .map_err(|e| format!("Failed to spawn training thread: {}", e))?;

    Ok("Training started".to_string())
}

#[tauri::command]
pub async fn pause_training(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    if s.is_paused {
        return Err("Training is already paused".to_string());
    }
    s.is_paused = true;
    Ok("Training paused".to_string())
}

#[tauri::command]
pub async fn resume_training(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    if !s.is_paused {
        return Err("Training is not paused".to_string());
    }
    s.is_paused = false;
    Ok("Training resumed".to_string())
}

#[tauri::command]
pub async fn stop_training(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    s.is_running = false;
    s.is_paused = false;
    Ok("Training stopped".to_string())
}

#[tauri::command]
pub async fn get_training_stats(
    state: State<'_, SharedState>,
) -> Result<TrainingStats, String> {
    let s = lock_state(&state)?;
    Ok(s.stats.clone())
}

#[tauri::command]
pub async fn get_reward_history(
    state: State<'_, SharedState>,
) -> Result<Vec<(u64, f32)>, String> {
    let s = lock_state(&state)?;
    Ok(s.reward_history.clone())
}

#[tauri::command]
pub async fn list_checkpoints(
    state: State<'_, SharedState>,
) -> Result<Vec<CheckpointInfo>, String> {
    let s = lock_state(&state)?;
    let dir = &s.checkpoint_dir;

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut checkpoints = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read checkpoint dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // List .safetensors and .bin checkpoint files
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        if ext != "safetensors" && ext != "bin" {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let file_size_bytes = metadata.len();

        // Parse episode and reward from filename convention:
        // checkpoint_ep{episode}_r{reward}.safetensors
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let (episode, mean_reward) = parse_checkpoint_stem(stem);

        let timestamp = metadata
            .modified()
            .ok()
            .and_then(|t| {
                let duration = t.duration_since(std::time::UNIX_EPOCH).ok()?;
                let secs = duration.as_secs() as i64;
                let dt = chrono::DateTime::from_timestamp(secs, 0)?;
                Some(dt.format("%Y-%m-%d %H:%M:%S").to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());

        checkpoints.push(CheckpointInfo {
            path: path.to_string_lossy().to_string(),
            episode,
            mean_reward,
            mean_episode_length: 0.0,
            timestamp,
            file_size_bytes,
        });
    }

    // Sort by episode descending (most recent first)
    checkpoints.sort_by(|a, b| b.episode.cmp(&a.episode));
    Ok(checkpoints)
}

/// Parse checkpoint filename stem for episode and reward.
/// Expected format: "checkpoint_ep{N}_r{R}" or similar.
fn parse_checkpoint_stem(stem: &str) -> (u64, f32) {
    let mut episode = 0u64;
    let mut reward = 0.0f32;

    if let Some(ep_start) = stem.find("ep") {
        let after_ep = &stem[ep_start + 2..];
        let num_end = after_ep
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(after_ep.len());
        if let Ok(ep) = after_ep[..num_end].parse::<u64>() {
            episode = ep;
        }
    }

    if let Some(r_start) = stem.find("_r") {
        let after_r = &stem[r_start + 2..];
        let num_end = after_r
            .find(|c: char| !c.is_ascii_digit() && c != '.' && c != '-')
            .unwrap_or(after_r.len());
        if let Ok(r) = after_r[..num_end].parse::<f32>() {
            reward = r;
        }
    }

    (episode, reward)
}

#[tauri::command]
pub async fn save_checkpoint_now(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running -- nothing to checkpoint".to_string());
    }
    s.checkpoint_save_requested = true;
    Ok("Checkpoint save requested".to_string())
}

#[tauri::command]
pub async fn load_checkpoint(
    state: State<'_, SharedState>,
    path: String,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    let checkpoint_path = PathBuf::from(&path);
    if !checkpoint_path.exists() {
        return Err(format!("Checkpoint not found: {}", path));
    }
    s.checkpoint_load_path = Some(path.clone());
    Ok(format!("Checkpoint load requested: {}", path))
}

#[tauri::command]
pub async fn get_live_bot_state(
    state: State<'_, SharedState>,
) -> Result<Vec<LiveBotState>, String> {
    let s = lock_state(&state)?;
    Ok(s.live_bot_states.clone())
}

#[tauri::command]
pub async fn get_training_status(
    state: State<'_, SharedState>,
) -> Result<TrainingStatus, String> {
    let s = lock_state(&state)?;
    Ok(TrainingStatus {
        is_running: s.is_running,
        is_paused: s.is_paused,
    })
}

/// Set which bot's environment terrain to show in the 3D preview.
#[tauri::command]
pub async fn set_preview_bot(
    state: State<'_, SharedState>,
    bot_index: usize,
) -> Result<(), String> {
    let mut s = lock_state(&state)?;
    s.preview_bot = bot_index;
    Ok(())
}

/// Get terrain chunk data around a world position for 3D preview rendering.
/// Returns a list of (chunk_x, chunk_y, chunk_z, block_data[4096]) tuples.
/// Uses modified terrain from the preview bot's environment when available.
#[tauri::command]
pub async fn get_terrain_chunks(
    state: State<'_, SharedState>,
    center_x: f32,
    center_z: f32,
    radius: usize,
) -> Result<Vec<(u8, u8, u8, Vec<u8>)>, String> {
    let s = lock_state(&state)?;
    let terrain = match &s.base_terrain {
        Some(t) => t,
        None => return Ok(Vec::new()),
    };

    let cx_center = ((center_x as usize) / 16).min(46);
    let cz_center = ((center_z as usize) / 16).min(46);
    let cx_min = cx_center.saturating_sub(radius);
    let cz_min = cz_center.saturating_sub(radius);
    let cx_max = (cx_center + radius).min(46);
    let cz_max = (cz_center + radius).min(46);

    let mut chunks = Vec::new();
    for cx in cx_min..=cx_max {
        for cy in 0..3usize {
            for cz in cz_min..=cz_max {
                let id = crate::sim::world::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                // Use modified chunk if available, otherwise fall back to base
                let data = s.preview_modified_chunks.get(&id)
                    .or_else(|| terrain.chunks.get(&id));
                if let Some(data) = data {
                    chunks.push((cx as u8, cy as u8, cz as u8, data.to_vec()));
                }
            }
        }
    }
    Ok(chunks)
}

#[tauri::command]
pub async fn get_episode_replay(
    state: State<'_, SharedState>,
) -> Result<String, String> {
    let _s = lock_state(&state)?;
    // Episode replay will return serialized EpisodeRecording when wired
    Ok("[]".to_string())
}

#[tauri::command]
pub async fn update_hyperparams(
    state: State<'_, SharedState>,
    params: HyperParams,
) -> Result<String, String> {
    let _s = lock_state(&state)?;
    // Hyperparameter updates will be forwarded to the training thread
    // when it is integrated. For now, acknowledge receipt.
    let mut updates = Vec::new();
    if let Some(lr) = params.lr {
        updates.push(format!("lr={:.6}", lr));
    }
    if let Some(gamma) = params.gamma {
        updates.push(format!("gamma={:.4}", gamma));
    }
    if let Some(entropy) = params.entropy_coeff {
        updates.push(format!("entropy_coeff={:.4}", entropy));
    }
    if let Some(num_envs) = params.num_envs {
        updates.push(format!("num_envs={}", num_envs));
    }
    if let Some(rollout) = params.rollout_length {
        updates.push(format!("rollout_length={}", rollout));
    }

    if updates.is_empty() {
        Ok("No hyperparameters updated".to_string())
    } else {
        Ok(format!("Hyperparameters updated: {}", updates.join(", ")))
    }
}
