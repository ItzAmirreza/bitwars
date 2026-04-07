//! Main training loop: spawns environments, runs PPO with LSTM, updates shared state.
//!
//! Runs on a background thread. Environment steps are parallelized with rayon.
//! LSTM hidden states are maintained per environment and reset on episode done.

use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;

use crate::bridge::{LiveBotState, SharedState, TrainingStats};
use crate::rl::ppo::{PPOConfig, PPOTrainer};
use crate::sim::environment::{StepResult, TrainingEnv};
use crate::sim::world::BaseTerrain;

const STATS_UPDATE_INTERVAL: u64 = 50;
const ROLLING_WINDOW: usize = 100;

pub fn run_training(state: SharedState, ppo_config: PPOConfig, num_envs: usize, seed: u64) {
    log::info!("Generating world terrain (seed={})...", seed);
    let base_terrain = Arc::new(BaseTerrain::generate(seed));
    log::info!("World generated. Starting training with {} environments.", num_envs);

    if let Ok(mut s) = state.lock() {
        s.base_terrain = Some(base_terrain.clone());
    }

    let mut envs: Vec<TrainingEnv> = (0..num_envs)
        .map(|i| TrainingEnv::new(base_terrain.clone(), seed + i as u64 + 1000))
        .collect();

    let mut trainer = match PPOTrainer::new(ppo_config) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to create PPO trainer: {:?}", e);
            if let Ok(mut s) = state.lock() { s.is_running = false; }
            return;
        }
    };

    // Initialize LSTM hidden states for all environments
    trainer.init_states(num_envs);

    let mut observations: Vec<Vec<f32>> = envs.iter_mut().map(|env| env.reset()).collect();

    let start_time = Instant::now();
    let mut episode_rewards: Vec<f32> = Vec::new();
    let mut episode_lengths: Vec<f32> = Vec::new();
    let mut current_ep_rewards = vec![0.0f32; num_envs];
    let mut current_ep_steps = vec![0u32; num_envs];
    let mut step_count: u64 = 0;

    log::info!("Training loop started (LSTM, {} envs, {} rayon threads).",
        num_envs, rayon::current_num_threads());

    loop {
        // Check stop/pause
        {
            let s = match state.lock() {
                Ok(s) => s,
                Err(_) => break,
            };
            if !s.is_running { break; }
            if s.is_paused {
                drop(s);
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            }
        }

        // Snapshot hidden states BEFORE getting actions (for buffer storage)
        let hidden_snapshot: Vec<(Vec<f32>, Vec<f32>)> = trainer.get_env_states().to_vec();

        // 1. Get actions (LSTM forward pass updates hidden states internally)
        let (actions, log_probs, values) = match trainer.get_actions(&observations) {
            Ok(r) => r,
            Err(e) => {
                log::error!("PPO get_actions failed: {:?}", e);
                break;
            }
        };

        // 2. Step environments in parallel
        let prev_observations = observations.clone();
        let results: Vec<StepResult> = envs
            .par_iter_mut()
            .zip(actions.par_iter())
            .map(|(env, action)| env.step(action))
            .collect();

        // 3. Process results + reset LSTM states on episode done
        let mut rewards = vec![0.0f32; num_envs];
        let mut dones = vec![false; num_envs];

        for i in 0..num_envs {
            let result = &results[i];
            rewards[i] = result.reward;
            dones[i] = result.done;

            current_ep_rewards[i] += result.reward;
            current_ep_steps[i] += 1;

            if result.done {
                episode_rewards.push(current_ep_rewards[i]);
                episode_lengths.push(current_ep_steps[i] as f32);
                observations[i] = envs[i].reset();
                current_ep_rewards[i] = 0.0;
                current_ep_steps[i] = 0;
                // Reset LSTM state for this env — new episode starts with blank memory
                trainer.reset_env_state(i);
            } else {
                observations[i] = result.observation.clone();
            }
        }

        // 4. Record transition with the hidden state snapshot from BEFORE the action
        trainer.record_step(
            &prev_observations,
            &actions,
            &log_probs,
            &values,
            &rewards,
            &dones,
            &hidden_snapshot,
        );

        step_count += num_envs as u64;

        // 5. PPO update
        if trainer.should_update() {
            if let Err(e) = trainer.update() {
                log::error!("PPO update failed: {:?}", e);
            }
        }

        // 6. Update shared state
        if step_count % (STATS_UPDATE_INTERVAL * num_envs as u64) < num_envs as u64 {
            let elapsed = start_time.elapsed().as_secs_f64();
            let steps_per_sec = step_count as f32 / elapsed as f32;

            let recent_r = if episode_rewards.len() > ROLLING_WINDOW {
                &episode_rewards[episode_rewards.len() - ROLLING_WINDOW..]
            } else { &episode_rewards };
            let mean_reward = if recent_r.is_empty() { 0.0 }
                else { recent_r.iter().sum::<f32>() / recent_r.len() as f32 };

            let recent_l = if episode_lengths.len() > ROLLING_WINDOW {
                &episode_lengths[episode_lengths.len() - ROLLING_WINDOW..]
            } else { &episode_lengths };
            let mean_length = if recent_l.is_empty() { 0.0 }
                else { recent_l.iter().sum::<f32>() / recent_l.len() as f32 };

            if let Ok(mut s) = state.lock() {
                s.stats = TrainingStats {
                    episode: trainer.total_episodes,
                    total_steps: step_count,
                    mean_reward,
                    mean_episode_length: mean_length,
                    steps_per_sec,
                    elapsed_secs: elapsed,
                };

                if trainer.total_episodes > 0
                    && s.reward_history.last().map_or(true, |&(ep, _)| trainer.total_episodes > ep + 10)
                {
                    s.reward_history.push((trainer.total_episodes, mean_reward));
                }

                s.live_bot_states = envs.iter().enumerate().map(|(i, env)| {
                    let mut a = [0.0f32; 9];
                    if let Some(act) = actions.get(i) {
                        for (j, val) in act.iter().enumerate().take(9) { a[j] = *val; }
                    }
                    LiveBotState {
                        pos: env.player_pos(),
                        vel: env.player_vel(),
                        target: env.target_pos(),
                        health: env.player_health(),
                        weapon: env.current_weapon(),
                        on_ground: env.on_ground(),
                        action: a,
                    }
                }).collect();
            }
        }
    }

    log::info!("Training complete. {} episodes, {} steps in {:.1}s",
        trainer.total_episodes, step_count, start_time.elapsed().as_secs_f64());
}
