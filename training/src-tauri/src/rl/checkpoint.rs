use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::network::ActorCritic;
use super::ppo::PPOConfig;

/// Metadata stored alongside each checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointMeta {
    pub episode: u64,
    pub total_steps: u64,
    pub mean_reward: f32,
    pub mean_episode_length: f32,
    pub timestamp: String,
    pub config: PPOConfig,
}

/// Manages saving, loading, listing, and cleaning up model checkpoints.
pub struct CheckpointManager {
    pub checkpoint_dir: PathBuf,
    pub max_checkpoints: usize,
    pub auto_save_interval: u64,
}

impl CheckpointManager {
    /// Create a new checkpoint manager.
    ///
    /// - `checkpoint_dir`: directory where checkpoints are stored
    /// - `max_checkpoints`: maximum number of checkpoints to retain (default 20)
    /// - `auto_save_interval`: save every N episodes (default 100_000)
    pub fn new(checkpoint_dir: PathBuf) -> Self {
        Self {
            checkpoint_dir,
            max_checkpoints: 20,
            auto_save_interval: 100_000,
        }
    }

    /// Create with custom limits.
    pub fn with_limits(
        checkpoint_dir: PathBuf,
        max_checkpoints: usize,
        auto_save_interval: u64,
    ) -> Self {
        Self {
            checkpoint_dir,
            max_checkpoints,
            auto_save_interval,
        }
    }

    /// Ensure the checkpoint directory exists.
    fn ensure_dir(&self) -> Result<(), String> {
        fs::create_dir_all(&self.checkpoint_dir)
            .map_err(|e| format!("Failed to create checkpoint dir: {}", e))
    }

    /// Save a checkpoint (network weights + metadata).
    ///
    /// Saves weights as safetensors and metadata as bincode, both in
    /// a file named `checkpoint_ep{N}_reward{R:.1}.bin`.
    ///
    /// Returns the path to the saved weights file.
    pub fn save(&self, network: &ActorCritic, meta: &CheckpointMeta) -> Result<PathBuf, String> {
        self.ensure_dir()?;

        let basename = format!("checkpoint_ep{}_r{:.1}", meta.episode, meta.mean_reward);

        // Save network weights (safetensors)
        let weights_path = self
            .checkpoint_dir
            .join(format!("{}.safetensors", basename));
        network
            .save(&weights_path)
            .map_err(|e| format!("Failed to save weights: {}", e))?;

        // Save metadata (bincode)
        let meta_path = self.checkpoint_dir.join(format!("{}.meta", basename));
        let meta_bytes =
            bincode::serialize(meta).map_err(|e| format!("Failed to serialize meta: {}", e))?;
        fs::write(&meta_path, meta_bytes)
            .map_err(|e| format!("Failed to write meta file: {}", e))?;

        log::info!(
            "Saved checkpoint: ep={}, reward={:.1}, path={}",
            meta.episode,
            meta.mean_reward,
            weights_path.display()
        );

        // Clean up old checkpoints
        self.cleanup()?;

        Ok(weights_path)
    }

    /// Load network weights and metadata from a checkpoint path.
    ///
    /// `path` should be the `.safetensors` weights file. The `.meta` file
    /// is expected alongside it with the same basename.
    pub fn load(&self, path: &Path, network: &mut ActorCritic) -> Result<CheckpointMeta, String> {
        // Load weights
        network
            .load(path)
            .map_err(|e| format!("Failed to load weights: {}", e))?;

        // Load metadata
        let meta_path = path.with_extension("meta");
        let meta_bytes =
            fs::read(&meta_path).map_err(|e| format!("Failed to read meta file: {}", e))?;
        let meta: CheckpointMeta = bincode::deserialize(&meta_bytes)
            .map_err(|e| format!("Failed to deserialize meta: {}", e))?;

        log::info!(
            "Loaded checkpoint: ep={}, reward={:.1}, path={}",
            meta.episode,
            meta.mean_reward,
            path.display()
        );

        Ok(meta)
    }

    /// List all checkpoints in the directory, sorted by episode number (ascending).
    pub fn list(&self) -> Result<Vec<(PathBuf, CheckpointMeta)>, String> {
        self.ensure_dir()?;

        let mut checkpoints = Vec::new();

        let entries = fs::read_dir(&self.checkpoint_dir)
            .map_err(|e| format!("Failed to read checkpoint dir: {}", e))?;

        for entry in entries {
            let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
            let path = entry.path();

            if path.extension().and_then(|e| e.to_str()) == Some("safetensors") {
                let meta_path = path.with_extension("meta");
                if meta_path.exists() {
                    match fs::read(&meta_path) {
                        Ok(bytes) => match bincode::deserialize::<CheckpointMeta>(&bytes) {
                            Ok(meta) => checkpoints.push((path, meta)),
                            Err(e) => {
                                log::warn!("Skipping corrupt meta {}: {}", meta_path.display(), e);
                            }
                        },
                        Err(e) => {
                            log::warn!("Skipping unreadable meta {}: {}", meta_path.display(), e);
                        }
                    }
                }
            }
        }

        // Sort by episode number ascending
        checkpoints.sort_by_key(|(_, meta)| meta.episode);

        Ok(checkpoints)
    }

    /// Remove old checkpoints, keeping only the `max_checkpoints` most recent.
    pub fn cleanup(&self) -> Result<(), String> {
        let checkpoints = self.list()?;

        if checkpoints.len() <= self.max_checkpoints {
            return Ok(());
        }

        let to_remove = checkpoints.len() - self.max_checkpoints;
        for (path, meta) in checkpoints.iter().take(to_remove) {
            // Remove weights file
            if let Err(e) = fs::remove_file(path) {
                log::warn!("Failed to remove checkpoint {}: {}", path.display(), e);
            }
            // Remove meta file
            let meta_path = path.with_extension("meta");
            if let Err(e) = fs::remove_file(&meta_path) {
                log::warn!("Failed to remove meta {}: {}", meta_path.display(), e);
            }
            log::info!(
                "Cleaned up old checkpoint: ep={}, reward={:.1}",
                meta.episode,
                meta.mean_reward
            );
        }

        Ok(())
    }

    /// Check whether an auto-save should be triggered at the given episode count.
    pub fn should_auto_save(&self, current_episode: u64) -> bool {
        current_episode > 0 && current_episode % self.auto_save_interval == 0
    }
}
