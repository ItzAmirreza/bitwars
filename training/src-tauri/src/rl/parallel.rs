use std::sync::Arc;

use crate::sim::world::BaseTerrain;

use super::network::OBS_DIM;

/// Vectorized environment manager for parallel training.
///
/// Wraps multiple independent training environments that share base terrain
/// via Arc. Each environment can be stepped independently with its own
/// actions and returns its own observations/rewards/dones.
///
/// Currently a placeholder that defines the interface. The actual TrainingEnv
/// will be integrated when the sim::environment module is ready.
pub struct VecEnv {
    pub num_envs: usize,
    base_terrain: Arc<BaseTerrain>,
    // Individual environments will be added when TrainingEnv is implemented:
    // envs: Vec<TrainingEnv>,
}

impl VecEnv {
    /// Create a new vectorized environment.
    ///
    /// - `num_envs`: number of parallel environments
    /// - `base_terrain`: shared base terrain (read-only, CoW per env)
    /// - `seed`: base random seed (each env gets seed + env_index)
    pub fn new(num_envs: usize, base_terrain: Arc<BaseTerrain>, _seed: u64) -> Self {
        VecEnv {
            num_envs,
            base_terrain,
        }
    }

    /// Reset all environments and return initial observations.
    ///
    /// Returns a Vec of observation vectors, one per environment.
    /// Each observation is a Vec<f32> of length OBS_DIM.
    pub fn reset_all(&mut self) -> Vec<Vec<f32>> {
        vec![vec![0.0; OBS_DIM]; self.num_envs]
    }

    /// Step all environments with the given actions.
    ///
    /// - `actions`: slice of action vectors, one per environment.
    ///   Each action is [8 continuous floats + 1 weapon index float].
    ///
    /// Returns (observations, rewards, dones):
    /// - observations: Vec of obs vectors, one per env
    /// - rewards: Vec of scalar rewards, one per env
    /// - dones: Vec of episode-done flags, one per env
    pub fn step_all(
        &mut self,
        actions: &[Vec<f32>],
    ) -> (Vec<Vec<f32>>, Vec<f32>, Vec<bool>) {
        debug_assert_eq!(
            actions.len(),
            self.num_envs,
            "Must provide one action per environment"
        );

        let obs = vec![vec![0.0; OBS_DIM]; self.num_envs];
        let rewards = vec![0.0; self.num_envs];
        let dones = vec![false; self.num_envs];
        (obs, rewards, dones)
    }

    /// Get a reference to the shared base terrain.
    pub fn base_terrain(&self) -> &Arc<BaseTerrain> {
        &self.base_terrain
    }
}
