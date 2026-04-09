use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A single frame of a recorded episode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayFrame {
    /// World position [x, y, z].
    pub pos: [f32; 3],
    /// Velocity [x, y, z].
    pub vel: [f32; 3],
    /// Yaw angle in radians.
    pub yaw: f32,
    /// Pitch angle in radians.
    pub pitch: f32,
    /// Action values [forward, strafe, yaw_delta, pitch_delta, jump, sprint, fire, weapon].
    pub action: [f32; 8],
    /// Selected weapon index.
    pub weapon: u8,
    /// Current health.
    pub health: f32,
    /// Reward received this frame.
    pub reward: f32,
    /// Whether the bot is on the ground.
    pub on_ground: bool,
    /// Number of blocks destroyed this frame.
    pub blocks_destroyed: u16,
}

/// A complete recorded episode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodeRecording {
    /// All frames in the episode.
    pub frames: Vec<ReplayFrame>,
    /// Cumulative reward for the episode.
    pub total_reward: f32,
    /// Number of frames.
    pub episode_length: usize,
    /// Starting position.
    pub spawn_pos: [f32; 3],
    /// Target/goal position.
    pub target_pos: [f32; 3],
    /// Strategies detected via heuristics.
    pub strategies_detected: Vec<String>,
    /// ISO 8601 timestamp when the episode was recorded.
    pub timestamp: String,
}

/// Manages a collection of the best episode recordings.
///
/// Keeps at most `max_recordings` episodes, sorted by total_reward descending.
/// New recordings are only kept if they beat the current worst in the collection
/// (or the collection is not yet full).
pub struct ReplayManager {
    /// Stored recordings, sorted by total_reward descending.
    recordings: Vec<EpisodeRecording>,
    /// Maximum number of recordings to keep.
    max_recordings: usize,
    /// In-progress recording frames.
    current_frames: Option<Vec<ReplayFrame>>,
    /// Spawn position for in-progress recording.
    current_spawn_pos: [f32; 3],
    /// Target position for in-progress recording.
    current_target_pos: [f32; 3],
}

impl ReplayManager {
    /// Create a new replay manager.
    pub fn new(max_recordings: usize) -> Self {
        Self {
            recordings: Vec::with_capacity(max_recordings),
            max_recordings,
            current_frames: None,
            current_spawn_pos: [0.0; 3],
            current_target_pos: [0.0; 3],
        }
    }

    /// Start recording a new episode.
    pub fn start_recording(&mut self, spawn_pos: [f32; 3], target_pos: [f32; 3]) {
        self.current_frames = Some(Vec::with_capacity(2048));
        self.current_spawn_pos = spawn_pos;
        self.current_target_pos = target_pos;
    }

    /// Record a single frame in the current episode.
    ///
    /// Does nothing if no recording is in progress.
    pub fn record_frame(&mut self, frame: ReplayFrame) {
        if let Some(ref mut frames) = self.current_frames {
            frames.push(frame);
        }
    }

    /// Finish the current recording and try to add it to the best-of collection.
    ///
    /// Returns `true` if the recording was kept (i.e., it was good enough).
    /// Returns `false` if it was discarded (worse than all existing recordings
    /// and the collection is full).
    pub fn finish_recording(&mut self, total_reward: f32) -> bool {
        let frames = match self.current_frames.take() {
            Some(f) => f,
            None => return false,
        };

        if frames.is_empty() {
            return false;
        }

        let strategies = detect_strategies(&frames);
        let episode_length = frames.len();

        self.insert_recording(EpisodeRecording {
            frames,
            total_reward,
            episode_length,
            spawn_pos: self.current_spawn_pos,
            target_pos: self.current_target_pos,
            strategies_detected: strategies,
            timestamp: chrono::Utc::now().to_rfc3339(),
        })
    }

    pub fn insert_recording(&mut self, recording: EpisodeRecording) -> bool {
        if self.recordings.len() >= self.max_recordings {
            let worst_reward = self
                .recordings
                .last()
                .map(|r| r.total_reward)
                .unwrap_or(f32::NEG_INFINITY);
            if recording.total_reward <= worst_reward {
                return false;
            }
        }

        let insert_pos = self
            .recordings
            .iter()
            .position(|r| r.total_reward < recording.total_reward)
            .unwrap_or(self.recordings.len());
        self.recordings.insert(insert_pos, recording);

        if self.recordings.len() > self.max_recordings {
            self.recordings.truncate(self.max_recordings);
        }

        true
    }

    /// Get the N best recordings.
    pub fn get_best(&self, n: usize) -> Vec<&EpisodeRecording> {
        self.recordings.iter().take(n).collect()
    }

    /// Number of stored recordings.
    pub fn len(&self) -> usize {
        self.recordings.len()
    }

    /// Whether the collection is empty.
    pub fn is_empty(&self) -> bool {
        self.recordings.is_empty()
    }

    pub fn recordings(&self) -> &[EpisodeRecording] {
        &self.recordings
    }

    pub fn delete_recording_by_timestamp(&mut self, timestamp: &str) -> bool {
        let before = self.recordings.len();
        self.recordings
            .retain(|recording| recording.timestamp != timestamp);
        self.recordings.len() != before
    }

    pub fn clear_recordings(&mut self) {
        self.recordings.clear();
    }

    /// Save all recordings to disk using bincode.
    pub fn save_to_disk(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create replay dir: {}", e))?;
        }

        let bytes = bincode::serialize(&self.recordings)
            .map_err(|e| format!("Failed to serialize replays: {}", e))?;
        fs::write(path, bytes).map_err(|e| format!("Failed to write replays: {}", e))?;

        log::info!(
            "Saved {} replay recordings to {}",
            self.recordings.len(),
            path.display()
        );
        Ok(())
    }

    /// Load recordings from disk.
    pub fn load_from_disk(&mut self, path: &Path) -> Result<(), String> {
        let bytes = fs::read(path).map_err(|e| format!("Failed to read replay file: {}", e))?;
        let loaded: Vec<EpisodeRecording> = bincode::deserialize(&bytes)
            .map_err(|e| format!("Failed to deserialize replays: {}", e))?;

        log::info!(
            "Loaded {} replay recordings from {}",
            loaded.len(),
            path.display()
        );

        self.recordings = loaded;
        // Ensure sorted by reward descending
        self.recordings
            .sort_by(|a, b| b.total_reward.partial_cmp(&a.total_reward).unwrap());
        // Trim to max
        if self.recordings.len() > self.max_recordings {
            self.recordings.truncate(self.max_recordings);
        }

        Ok(())
    }
}

/// Detect gameplay strategies from a sequence of frames using simple heuristics.
pub fn detect_strategies(frames: &[ReplayFrame]) -> Vec<String> {
    let mut strategies = Vec::new();

    let mut saw_rocket_jump = false;
    let mut saw_tunnel = false;
    let mut saw_speed_boost = false;

    for i in 1..frames.len() {
        let prev = &frames[i - 1];
        let curr = &frames[i];

        if !saw_rocket_jump
            && prev.weapon == 2
            && prev.action[6] > 0.5
            && frames[i.saturating_sub(1)..=(i + 2).min(frames.len() - 1)]
                .iter()
                .any(|frame| frame.blocks_destroyed > 0)
            && !curr.on_ground
            && (curr.vel[1] > prev.vel[1] + 2.5 || curr.pos[1] > prev.pos[1] + 1.5)
        {
            strategies.push("rocket_jump".to_string());
            saw_rocket_jump = true;
        }

        // "tunnel": blocks destroyed while moving forward
        if !saw_tunnel && curr.blocks_destroyed > 0 {
            let horiz_speed = (curr.vel[0] * curr.vel[0] + curr.vel[2] * curr.vel[2]).sqrt();
            if horiz_speed > 1.0 {
                strategies.push("tunnel".to_string());
                saw_tunnel = true;
            }
        }

        // "speed_boost": horizontal speed exceeds normal sprint speed.
        if !saw_speed_boost {
            let horiz_speed = (curr.vel[0] * curr.vel[0] + curr.vel[2] * curr.vel[2]).sqrt();
            if horiz_speed > 20.0 {
                strategies.push("speed_boost".to_string());
                saw_speed_boost = true;
            }
        }
    }

    // "wall_climb": multiple consecutive frames where bot is not on ground
    // but moving upward (climbing a vertical surface)
    let mut consecutive_climbing = 0;
    for frame in frames {
        if !frame.on_ground && frame.vel[1] > 0.5 {
            consecutive_climbing += 1;
            if consecutive_climbing >= 10 {
                strategies.push("wall_climb".to_string());
                break;
            }
        } else {
            consecutive_climbing = 0;
        }
    }

    strategies
}
