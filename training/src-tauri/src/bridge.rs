//! Tauri IPC bridge — the `#[tauri::command]` layer the GUI frontend calls.
//!
//! All shared-state types live in `crate::state` (tauri-free) so the training
//! engine builds headless. This module is only compiled with the `gui` feature.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::*;

// ── Tauri commands ──

#[tauri::command]
pub async fn start_training(state: State<'_, SharedState>) -> Result<String, String> {
    let shared = state.inner().clone();
    let runtime_config = {
        let s = lock_state(&shared)?;
        if s.is_running {
            return Err("Training is already running".to_string());
        }
        s.runtime_config.clone()
    };
    {
        let mut s = lock_state(&shared)?;
        s.is_running = true;
        s.is_paused = false;
        s.reward_history.clear();
        s.best_replays.clear();
        s.pending_replay_deletions.clear();
        s.clear_replays_requested = false;
        s.pending_hyperparams = None;
        s.stats = TrainingStats::default();
        s.preview_reset_requested = true;
        s.ensure_sleep_prevention();
    }

    // Spawn training thread
    let state_clone = shared.clone();
    std::thread::Builder::new()
        .name("training-loop".into())
        .spawn(move || {
            crate::training_loop::run_training(
                state_clone,
                runtime_config.ppo,
                runtime_config.num_envs,
                runtime_config.seed,
            );
        })
        .map_err(|e| {
            if let Ok(mut s) = shared.lock() {
                s.is_running = false;
                s.is_paused = false;
                s.stop_sleep_prevention();
            }
            format!("Failed to spawn training thread: {}", e)
        })?;

    Ok("Training started".to_string())
}

#[tauri::command]
pub async fn pause_training(state: State<'_, SharedState>) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    if s.is_paused {
        return Err("Training is already paused".to_string());
    }
    s.is_paused = true;
    s.stop_sleep_prevention();
    Ok("Training paused".to_string())
}

#[tauri::command]
pub async fn resume_training(state: State<'_, SharedState>) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    if !s.is_paused {
        return Err("Training is not paused".to_string());
    }
    s.is_paused = false;
    s.ensure_sleep_prevention();
    Ok("Training resumed".to_string())
}

#[tauri::command]
pub async fn stop_training(state: State<'_, SharedState>) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    if !s.is_running {
        return Err("Training is not running".to_string());
    }
    s.is_running = false;
    s.is_paused = false;
    s.stop_sleep_prevention();
    Ok("Training stopped".to_string())
}

#[tauri::command]
pub async fn get_training_stats(state: State<'_, SharedState>) -> Result<TrainingStats, String> {
    let s = lock_state(&state)?;
    Ok(s.stats.clone())
}

#[tauri::command]
pub async fn get_training_config(
    state: State<'_, SharedState>,
) -> Result<TrainingConfigView, String> {
    let s = lock_state(&state)?;
    Ok(s.runtime_config.view())
}

/// Max reward history points to send over IPC. The frontend was already
/// downsampling to 2000, but doing it Rust-side avoids serialising and
/// transferring up to 10K tuples every second.
const MAX_REWARD_HISTORY_IPC: usize = 2000;

#[tauri::command]
pub async fn get_reward_history(state: State<'_, SharedState>) -> Result<Vec<(u64, f32)>, String> {
    let s = lock_state(&state)?;
    let history = &s.reward_history;
    if history.len() <= MAX_REWARD_HISTORY_IPC {
        return Ok(history.clone());
    }
    // Downsample: evenly spaced + always include the last point
    let step = history.len() as f64 / MAX_REWARD_HISTORY_IPC as f64;
    let mut sampled = Vec::with_capacity(MAX_REWARD_HISTORY_IPC);
    for i in 0..MAX_REWARD_HISTORY_IPC - 1 {
        let idx = (i as f64 * step) as usize;
        sampled.push(history[idx]);
    }
    sampled.push(*history.last().unwrap());
    Ok(sampled)
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
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read checkpoint dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // Only list .safetensors weights files (each has a .meta sidecar)
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "safetensors" {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let file_size_bytes = metadata.len();

        // Try to read the .meta sidecar for accurate data
        let meta_path = path.with_extension("meta");
        let (episode, mean_reward, mean_episode_length, timestamp, success_rate, stall_rate, timeout_rate, task) =
            if let Ok(meta_bytes) = std::fs::read(&meta_path) {
                if let Ok(meta) =
                    bincode::deserialize::<crate::rl::checkpoint::CheckpointMeta>(&meta_bytes)
                {
                    (
                        meta.episode,
                        meta.mean_reward,
                        meta.mean_episode_length,
                        meta.timestamp,
                        meta.success_rate,
                        meta.stall_rate,
                        meta.timeout_rate,
                        meta.task,
                    )
                } else {
                    // Corrupt meta — fall back to filename parsing
                    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                    let (ep, r) = parse_checkpoint_stem(stem);
                    (ep, r, 0.0, "unknown".to_string(), 0.0, 0.0, 0.0, String::new())
                }
            } else {
                // No meta file — fall back to filename parsing
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                let (ep, r) = parse_checkpoint_stem(stem);
                (ep, r, 0.0, "unknown".to_string(), 0.0, 0.0, 0.0, String::new())
            };

        checkpoints.push(CheckpointInfo {
            path: path.to_string_lossy().to_string(),
            episode,
            mean_reward,
            mean_episode_length,
            timestamp,
            file_size_bytes,
            success_rate,
            stall_rate,
            timeout_rate,
            task,
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
pub async fn save_checkpoint_now(state: State<'_, SharedState>) -> Result<String, String> {
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
    if !s.is_running {
        return Err("Start training first, then load a checkpoint".to_string());
    }
    let checkpoint_path = PathBuf::from(&path);
    if !checkpoint_path.exists() {
        return Err(format!("Checkpoint not found: {}", path));
    }
    s.checkpoint_load_path = Some(path.clone());
    Ok("Loading checkpoint...".to_string())
}

#[tauri::command]
pub async fn delete_checkpoint(
    state: State<'_, SharedState>,
    path: String,
) -> Result<String, String> {
    let s = lock_state(&state)?;
    let checkpoint_dir = s
        .checkpoint_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve checkpoint dir: {}", e))?;
    drop(s);

    let checkpoint_path = PathBuf::from(&path);
    if checkpoint_path.extension().and_then(|ext| ext.to_str()) != Some("safetensors") {
        return Err("Only .safetensors checkpoint files can be deleted".to_string());
    }
    if !checkpoint_path.exists() {
        return Err(format!("Checkpoint not found: {}", path));
    }

    let resolved = checkpoint_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve checkpoint path: {}", e))?;
    if !resolved.starts_with(&checkpoint_dir) {
        return Err("Checkpoint path is outside the checkpoint directory".to_string());
    }

    fs::remove_file(&resolved)
        .map_err(|e| format!("Failed to delete checkpoint weights: {}", e))?;
    let meta_path = resolved.with_extension("meta");
    if meta_path.exists() {
        fs::remove_file(&meta_path)
            .map_err(|e| format!("Failed to delete checkpoint metadata: {}", e))?;
    }

    Ok(format!(
        "Deleted checkpoint {}",
        resolved
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown")
    ))
}

#[tauri::command]
pub async fn clear_checkpoints(state: State<'_, SharedState>) -> Result<String, String> {
    let s = lock_state(&state)?;
    let dir = s.checkpoint_dir.clone();
    drop(s);

    if !dir.exists() {
        return Ok("No checkpoints to delete".to_string());
    }

    let mut deleted = 0usize;
    for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read checkpoint dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read checkpoint entry: {}", e))?;
        let path = entry.path();
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if ext == "safetensors" || ext == "meta" {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
            deleted += 1;
        }
    }

    Ok(format!("Deleted {} checkpoint files", deleted))
}

#[tauri::command]
pub async fn get_live_bot_state(
    state: State<'_, SharedState>,
) -> Result<Vec<LiveBotState>, String> {
    let mut s = lock_state(&state)?;
    s.note_preview_activity();
    Ok(s.live_bot_states.clone())
}

#[tauri::command]
pub async fn get_preview_frame(state: State<'_, SharedState>) -> Result<PreviewFrame, String> {
    let mut s = lock_state(&state)?;
    s.note_preview_activity();
    Ok(PreviewFrame {
        bots: s.live_bot_states.clone(),
        terrain_revision: s.preview_terrain_revision,
    })
}

#[tauri::command]
pub async fn get_training_status(state: State<'_, SharedState>) -> Result<TrainingStatus, String> {
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
    s.note_preview_activity();
    s.preview_bot = bot_index;
    Ok(())
}

#[tauri::command]
pub async fn set_preview_mode(
    state: State<'_, SharedState>,
    deterministic: bool,
) -> Result<(), String> {
    let mut s = lock_state(&state)?;
    s.note_preview_activity();
    if s.preview_deterministic != deterministic {
        s.preview_deterministic = deterministic;
        s.preview_reset_requested = true;
    }
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
    let mut s = lock_state(&state)?;
    s.note_preview_activity();
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
        for cy in 0..crate::worldgen::NUM_CHUNKS_Y {
            for cz in cz_min..=cz_max {
                let id = crate::sim::world::pack_chunk_id(cx as u8, cy as u8, cz as u8);
                // Use modified chunk if available, otherwise fall back to base
                let data = s
                    .preview_modified_chunks
                    .get(&id)
                    .or_else(|| terrain.chunks.get(&id));
                if let Some(data) = data {
                    if data.iter().all(|&block| block == crate::worldgen::AIR) {
                        continue;
                    }
                    chunks.push((cx as u8, cy as u8, cz as u8, data.to_vec()));
                }
            }
        }
    }
    Ok(chunks)
}

/// Lightweight episode metadata for the list view (no frame data).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EpisodeListItem {
    pub timestamp: String,
    pub total_reward: f32,
    pub episode_length: usize,
    pub strategies_detected: Vec<String>,
}

/// Return only episode metadata — used for polling the replay list without
/// transferring megabytes of frame data through IPC every few seconds.
#[tauri::command]
pub async fn get_episode_list(
    state: State<'_, SharedState>,
) -> Result<Vec<EpisodeListItem>, String> {
    let s = lock_state(&state)?;
    let list = s
        .best_replays
        .iter()
        .map(|r| EpisodeListItem {
            timestamp: r.timestamp.clone(),
            total_reward: r.total_reward,
            episode_length: r.episode_length,
            strategies_detected: r.strategies_detected.clone(),
        })
        .collect();
    Ok(list)
}

/// Return full frame data for a single recording identified by timestamp.
/// Only called when the user actually selects a replay to view.
#[tauri::command]
pub async fn get_episode_replay(
    state: State<'_, SharedState>,
    timestamp: String,
) -> Result<String, String> {
    let s = lock_state(&state)?;
    let recording = s
        .best_replays
        .iter()
        .find(|r| r.timestamp == timestamp)
        .ok_or_else(|| "Recording not found".to_string())?;
    serde_json::to_string(recording).map_err(|e| format!("Failed to serialize replay: {}", e))
}

#[tauri::command]
pub async fn delete_replay(
    state: State<'_, SharedState>,
    timestamp: String,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    let before = s.best_replays.len();
    s.best_replays
        .retain(|recording| recording.timestamp != timestamp);
    if s.best_replays.len() == before {
        return Err("Replay not found".to_string());
    }
    if s.is_running {
        s.pending_replay_deletions.push(timestamp);
    }
    Ok("Replay deleted".to_string())
}

#[tauri::command]
pub async fn clear_replays(state: State<'_, SharedState>) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    let deleted = s.best_replays.len();
    s.best_replays.clear();
    if s.is_running {
        s.pending_replay_deletions.clear();
        s.clear_replays_requested = true;
    }
    Ok(format!("Deleted {} replays", deleted))
}

#[tauri::command]
pub async fn update_hyperparams(
    state: State<'_, SharedState>,
    params: HyperParams,
) -> Result<String, String> {
    let mut s = lock_state(&state)?;
    let updates = s.runtime_config.apply_params(&params);
    if s.is_running {
        let live_params = HyperParams {
            lr: params.lr,
            gamma: params.gamma,
            entropy_coeff: params.entropy_coeff,
            num_envs: None,
            rollout_length: None,
        };
        if live_params.lr.is_some()
            || live_params.gamma.is_some()
            || live_params.entropy_coeff.is_some()
        {
            s.pending_hyperparams = Some(live_params);
        }
    }

    if updates.is_empty() {
        return Ok("No hyperparameters updated".to_string());
    }

    let mut message = format!("Hyperparameters updated: {}", updates.join(", "));
    if s.is_running && (params.num_envs.is_some() || params.rollout_length.is_some()) {
        message.push_str(" (env count and rollout length apply on next start)");
    }
    Ok(message)
}
