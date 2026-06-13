//! Main training loop: spawns environments, runs PPO with LSTM, updates shared state.
//!
//! Runs on a background thread. Environment steps are parallelized with rayon.
//! LSTM hidden states are maintained per environment and reset on episode done.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use rayon::prelude::*;

use crate::state::{LiveBotState, SharedState, TrainingStats};
use crate::rl::checkpoint::{CheckpointManager, CheckpointMeta};
use crate::rl::network::HIDDEN_SIZE;
use crate::rl::ppo::{PPOConfig, PPOTrainer};
use crate::rl::replay::{detect_strategies, EpisodeRecording, ReplayFrame, ReplayManager};
use crate::sim::environment::{StepResult, TrainingEnv, TrainingTask};
use crate::sim::world::BaseTerrain;

const STATS_UPDATE_INTERVAL: u64 = 50;
const PREVIEW_ACTIVE_STATE_UPDATE_INTERVAL: u64 = 4;
const PREVIEW_ACTIVE_TERRAIN_UPDATE_INTERVAL: u64 = 12;
const PREVIEW_IDLE_STATE_UPDATE_INTERVAL: u64 = 12;
const PREVIEW_IDLE_TERRAIN_UPDATE_INTERVAL: u64 = 60;
const PREVIEW_ACTIVITY_CHECK_INTERVAL: u64 = 6;
const PREVIEW_ACTIVITY_TIMEOUT: Duration = Duration::from_millis(1500);
const ROLLING_WINDOW: usize = 100;
const AUTO_SAVE_INTERVAL: u64 = 1000;

#[derive(Clone, Copy, Debug)]
struct CurriculumOutcome {
    success: bool,
    timeout: bool,
    stall: bool,
}

#[derive(Clone, Copy, Debug)]
struct MasterySnapshot {
    success_rate: f32,
    timeout_rate: f32,
    stall_rate: f32,
    samples: usize,
}

fn push_curriculum_outcome(
    outcomes: &mut VecDeque<CurriculumOutcome>,
    task: TrainingTask,
    outcome: CurriculumOutcome,
) {
    let keep = task.mastery_window();
    if keep == 0 {
        return;
    }
    outcomes.push_back(outcome);
    while outcomes.len() > keep {
        outcomes.pop_front();
    }
}

fn mastery_snapshot(
    task: TrainingTask,
    outcomes: &VecDeque<CurriculumOutcome>,
) -> Option<MasterySnapshot> {
    if outcomes.len() < task.mastery_min_episodes() {
        return None;
    }
    let samples = outcomes.len();
    let success_rate = outcomes.iter().filter(|o| o.success).count() as f32 / samples as f32;
    let timeout_rate = outcomes.iter().filter(|o| o.timeout).count() as f32 / samples as f32;
    let stall_rate = outcomes.iter().filter(|o| o.stall).count() as f32 / samples as f32;
    Some(MasterySnapshot {
        success_rate,
        timeout_rate,
        stall_rate,
        samples,
    })
}

fn should_advance_task(
    task: TrainingTask,
    outcomes: &VecDeque<CurriculumOutcome>,
) -> Option<MasterySnapshot> {
    task.next()?;
    let snapshot = mastery_snapshot(task, outcomes)?;
    if snapshot.success_rate >= task.mastery_success_rate()
        && snapshot.timeout_rate <= task.mastery_timeout_rate()
        && snapshot.stall_rate <= task.mastery_stall_rate()
    {
        Some(snapshot)
    } else {
        None
    }
}

/// Build checkpoint metadata from current training state.
fn build_checkpoint_meta(
    trainer: &PPOTrainer,
    mean_reward: f32,
    mean_episode_length: f32,
    step_count: u64,
    success_rate: f32,
    stall_rate: f32,
    timeout_rate: f32,
    task: &str,
) -> CheckpointMeta {
    CheckpointMeta {
        episode: trainer.total_episodes,
        total_steps: step_count,
        mean_reward,
        mean_episode_length,
        timestamp: chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string(),
        config: trainer.config.clone(),
        success_rate,
        stall_rate,
        timeout_rate,
        task: task.to_string(),
    }
}

/// Save a checkpoint (shared helper for manual + auto save).
fn do_save_checkpoint(
    checkpoint_mgr: &CheckpointManager,
    trainer: &PPOTrainer,
    mean_reward: f32,
    mean_episode_length: f32,
    step_count: u64,
    success_rate: f32,
    stall_rate: f32,
    timeout_rate: f32,
    task: &str,
) {
    let meta = build_checkpoint_meta(
        trainer,
        mean_reward,
        mean_episode_length,
        step_count,
        success_rate,
        stall_rate,
        timeout_rate,
        task,
    );
    match checkpoint_mgr.save(&trainer.network, &meta) {
        Ok(path) => log::info!("Checkpoint saved: {}", path.display()),
        Err(e) => log::error!("Failed to save checkpoint: {}", e),
    }
}

/// Score for ranking checkpoints: success rate dominates, reward breaks ties.
fn checkpoint_score(success_rate: f32, mean_reward: f32) -> f32 {
    success_rate * 10000.0 + mean_reward
}

pub fn run_training(state: SharedState, ppo_config: PPOConfig, num_envs: usize, seed: u64) {
    log::info!("Generating world terrain (seed={})...", seed);
    let base_terrain = Arc::new(BaseTerrain::generate(seed));
    log::info!(
        "World generated. Starting training with {} environments.",
        num_envs
    );

    let checkpoint_dir = {
        let mut s = state.lock().unwrap();
        s.base_terrain = Some(base_terrain.clone());
        s.checkpoint_dir.clone()
    };

    let checkpoint_mgr = CheckpointManager::with_limits(checkpoint_dir, 20, AUTO_SAVE_INTERVAL);

    let mut envs: Vec<TrainingEnv> = (0..num_envs)
        .map(|i| TrainingEnv::new(base_terrain.clone(), seed + i as u64 + 1000))
        .collect();
    let mut active_task = TrainingTask::initial();
    for env in &mut envs {
        env.set_task(active_task);
    }

    let mut trainer = match PPOTrainer::new(ppo_config) {
        Ok(t) => t,
        Err(e) => {
            log::error!("Failed to create PPO trainer: {:?}", e);
            if let Ok(mut s) = state.lock() {
                s.is_running = false;
                s.stop_sleep_prevention();
            }
            return;
        }
    };

    // Initialize LSTM hidden states for all environments
    trainer.init_states(num_envs);

    let mut observations: Vec<Vec<f32>> = envs.iter_mut().map(|env| env.reset()).collect();
    let mut preview_env = TrainingEnv::new(base_terrain.clone(), seed ^ 0x0E71_5EED);
    preview_env.set_task(active_task);
    let mut preview_observation = preview_env.reset();
    let mut preview_state = (vec![0.0f32; HIDDEN_SIZE], vec![0.0f32; HIDDEN_SIZE]);
    let mut preview_action_frame = [0.0f32; 8];
    let mut replay_manager = ReplayManager::new(8);
    let mut episode_frames: Vec<Vec<ReplayFrame>> =
        (0..num_envs).map(|_| Vec::with_capacity(1024)).collect();
    let mut curriculum_outcomes = VecDeque::with_capacity(active_task.mastery_window().max(1));

    let start_time = Instant::now();
    let mut episode_rewards: Vec<f32> = Vec::new();
    let mut episode_lengths: Vec<f32> = Vec::new();
    let mut episode_successes: Vec<bool> = Vec::new();
    let mut episode_timeouts: Vec<bool> = Vec::new();
    let mut episode_stalls: Vec<bool> = Vec::new();
    let mut episode_rpg_usage: Vec<f32> = Vec::new();
    let mut episode_blocks_destroyed: Vec<f32> = Vec::new();
    let mut current_ep_rewards = vec![0.0f32; num_envs];
    let mut current_ep_steps = vec![0u32; num_envs];
    let mut current_ep_rpg_fires = vec![0u32; num_envs];
    let mut current_ep_blocks = vec![0u32; num_envs];
    let mut step_count: u64 = 0;
    let mut sim_step: u64 = 0;
    let mut last_auto_save_ep: u64 = 0;
    let mut best_checkpoint_score: f32 = f32::NEG_INFINITY;
    let mut success_rate: f32 = 0.0;
    let mut stall_rate: f32 = 0.0;
    let mut timeout_rate: f32 = 0.0;
    let mut mean_reward: f32 = 0.0;
    let mut mean_length: f32 = 0.0;
    let mut last_update_stats = crate::rl::ppo::PPOUpdateStats {
        policy_loss: 0.0,
        value_loss: 0.0,
        entropy: 0.0,
        approx_kl: 0.0,
        explained_variance: 0.0,
    };
    let mut preview_active = false;

    struct CompletedEpisode {
        reward: f32,
        length: f32,
        success: bool,
        timeout: bool,
        stall: bool,
        rpg_usage: f32,
        blocks_destroyed: f32,
        recording_kept: bool,
    }

    log::info!(
        "Training loop started (LSTM, {} envs, {} rayon threads).",
        num_envs,
        rayon::current_num_threads()
    );

    loop {
        // Check stop/pause + checkpoint load requests
        let mut pending_replay_deletions = Vec::new();
        let mut clear_replays_requested = false;
        let mut paused = false;
        let (preview_deterministic, preview_reset_requested) = {
            let mut preview_reset_requested = false;
            let mut s = match state.lock() {
                Ok(s) => s,
                Err(_) => break,
            };
            if s.clear_replays_requested {
                clear_replays_requested = true;
                s.clear_replays_requested = false;
                s.pending_replay_deletions.clear();
            } else if !s.pending_replay_deletions.is_empty() {
                pending_replay_deletions = std::mem::take(&mut s.pending_replay_deletions);
            }
            if !s.is_running {
                break;
            }
            if s.is_paused {
                paused = true;
            }
            if s.preview_reset_requested {
                preview_reset_requested = true;
                s.preview_reset_requested = false;
            }

            if !paused {
                if let Some(params) = s.pending_hyperparams.take() {
                    if let Some(lr) = params.lr {
                        trainer.set_learning_rate(lr);
                    }
                    if let Some(gamma) = params.gamma {
                        trainer.config.gamma = gamma.clamp(0.9, 0.9999);
                    }
                    if let Some(entropy) = params.entropy_coeff {
                        trainer.config.entropy_coeff = entropy.max(0.0);
                    }
                }

                // Handle checkpoint load request
                if let Some(path) = s.checkpoint_load_path.take() {
                    let load_path = PathBuf::from(&path);
                    drop(s); // Release lock during file I/O
                    match checkpoint_mgr.load(&load_path, &mut trainer.network) {
                        Ok(meta) => {
                            trainer.total_episodes = meta.episode;
                            trainer.total_steps = meta.total_steps;
                            last_auto_save_ep = meta.episode;
                            trainer.init_states(num_envs);
                            active_task = TrainingTask::initial();
                            curriculum_outcomes.clear();
                            for env in &mut envs {
                                env.set_task(active_task);
                            }
                            preview_env.set_task(active_task);
                            observations = envs.iter_mut().map(|env| env.reset()).collect();
                            preview_observation = preview_env.reset();
                            preview_state.0.fill(0.0);
                            preview_state.1.fill(0.0);
                            preview_action_frame = [0.0; 8];
                            current_ep_rewards.fill(0.0);
                            current_ep_steps.fill(0);
                            current_ep_rpg_fires.fill(0);
                            current_ep_blocks.fill(0);
                            for frames in &mut episode_frames {
                                frames.clear();
                            }
                            log::info!(
                                "Loaded checkpoint from ep={}, reward={:.1}; curriculum reset to {}",
                                meta.episode,
                                meta.mean_reward,
                                active_task.label(),
                            );
                        }
                        Err(e) => log::error!("Failed to load checkpoint: {}", e),
                    }
                    continue;
                }
            }
            (s.preview_deterministic, preview_reset_requested)
        };

        if preview_reset_requested {
            preview_observation = preview_env.reset();
            preview_state.0.fill(0.0);
            preview_state.1.fill(0.0);
            preview_action_frame = [0.0; 8];
        }

        if clear_replays_requested {
            replay_manager.clear_recordings();
            if let Ok(mut s) = state.lock() {
                s.best_replays.clear();
            }
        } else if !pending_replay_deletions.is_empty() {
            for timestamp in &pending_replay_deletions {
                replay_manager.delete_recording_by_timestamp(timestamp);
            }
            if let Ok(mut s) = state.lock() {
                s.best_replays = replay_manager.recordings().to_vec();
            }
        }

        if paused {
            // Check for manual save request while paused
            if let Ok(mut s) = state.lock() {
                if s.checkpoint_save_requested {
                    s.checkpoint_save_requested = false;
                    drop(s);
                    do_save_checkpoint(
                        &checkpoint_mgr,
                        &trainer,
                        mean_reward,
                        mean_length,
                        step_count,
                        success_rate,
                        stall_rate,
                        timeout_rate,
                        active_task.label(),
                    );
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            continue;
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
        let mut completed_episodes = Vec::new();

        for i in 0..num_envs {
            let result = &results[i];
            rewards[i] = result.reward;
            dones[i] = result.done;

            current_ep_rewards[i] += result.reward;
            current_ep_steps[i] += 1;
            current_ep_blocks[i] += result.info.blocks_destroyed_this_step;
            if matches!(result.info.fired_weapon, Some(2)) {
                current_ep_rpg_fires[i] += 1;
            }

            let mut action_frame = [0.0f32; 8];
            if let Some(action) = actions.get(i) {
                for (slot, value) in action.iter().enumerate().take(8) {
                    action_frame[slot] = *value;
                }
            }
            episode_frames[i].push(ReplayFrame {
                pos: envs[i].player_pos(),
                vel: envs[i].player_vel(),
                yaw: envs[i].player_yaw(),
                pitch: envs[i].player_pitch(),
                action: action_frame,
                weapon: envs[i].current_weapon(),
                health: envs[i].player_health(),
                reward: result.reward,
                on_ground: envs[i].on_ground(),
                blocks_destroyed: result.info.blocks_destroyed_this_step.min(u16::MAX as u32)
                    as u16,
            });

            if result.done {
                let frames = std::mem::take(&mut episode_frames[i]);
                let strategies = detect_strategies(&frames);
                let recording = EpisodeRecording {
                    frames,
                    total_reward: current_ep_rewards[i],
                    episode_length: current_ep_steps[i] as usize,
                    spawn_pos: envs[i].spawn_pos(),
                    target_pos: envs[i].target_pos(),
                    strategies_detected: strategies,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                };
                let recording_kept = replay_manager.insert_recording(recording);
                let success = result.info.reached_target;
                let timeout = result.info.timed_out;
                let stall = result.info.stalled_out;
                let rpg_usage = current_ep_rpg_fires[i] as f32 / current_ep_steps[i].max(1) as f32;
                let blocks_destroyed = current_ep_blocks[i] as f32;
                completed_episodes.push(CompletedEpisode {
                    reward: current_ep_rewards[i],
                    length: current_ep_steps[i] as f32,
                    success,
                    timeout,
                    stall,
                    rpg_usage,
                    blocks_destroyed,
                    recording_kept,
                });
                observations[i] = envs[i].reset();
                current_ep_rewards[i] = 0.0;
                current_ep_steps[i] = 0;
                current_ep_rpg_fires[i] = 0;
                current_ep_blocks[i] = 0;
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
        sim_step += 1;

        // 5. PPO update
        if trainer.should_update() {
            match trainer
                .get_values(&observations)
                .and_then(|bootstrap_values| trainer.update(&bootstrap_values))
            {
                Ok(stats) => last_update_stats = stats,
                Err(e) => {
                    log::error!("PPO update failed: {:?}", e);
                    break;
                }
            }
        }

        if !completed_episodes.is_empty() {
            let first_episode = trainer.total_episodes - completed_episodes.len() as u64 + 1;
            for (offset, completed) in completed_episodes.iter().enumerate() {
                let episode_num = first_episode + offset as u64;
                episode_rewards.push(completed.reward);
                episode_lengths.push(completed.length);
                episode_successes.push(completed.success);
                episode_timeouts.push(completed.timeout);
                episode_stalls.push(completed.stall);
                episode_rpg_usage.push(completed.rpg_usage);
                episode_blocks_destroyed.push(completed.blocks_destroyed);
                if episode_rewards.len() > 10_000 {
                    episode_rewards.drain(0..episode_rewards.len() - 10_000);
                }
                if episode_lengths.len() > 10_000 {
                    episode_lengths.drain(0..episode_lengths.len() - 10_000);
                }
                trim_recent(&mut episode_successes, ROLLING_WINDOW);
                trim_recent(&mut episode_timeouts, ROLLING_WINDOW);
                trim_recent(&mut episode_stalls, ROLLING_WINDOW);
                trim_recent(&mut episode_rpg_usage, ROLLING_WINDOW);
                trim_recent(&mut episode_blocks_destroyed, ROLLING_WINDOW);

                if let Ok(mut s) = state.lock() {
                    s.reward_history.push((episode_num, completed.reward));
                    if s.reward_history.len() > 10_000 {
                        let excess = s.reward_history.len() - 10_000;
                        s.reward_history.drain(0..excess);
                    }
                    if completed.recording_kept {
                        s.best_replays = replay_manager.recordings().to_vec();
                    }
                }

                push_curriculum_outcome(
                    &mut curriculum_outcomes,
                    active_task,
                    CurriculumOutcome {
                        success: completed.success,
                        timeout: completed.timeout,
                        stall: completed.stall,
                    },
                );
            }

            if let Some(snapshot) = should_advance_task(active_task, &curriculum_outcomes) {
                if let Some(next_task) = active_task.next() {
                    log::info!(
                        "Advancing training task from {} to {} after {} episodes: success={:.0}% stall={:.0}% timeout={:.0}%",
                        active_task.label(),
                        next_task.label(),
                        snapshot.samples,
                        snapshot.success_rate * 100.0,
                        snapshot.stall_rate * 100.0,
                        snapshot.timeout_rate * 100.0,
                    );
                    active_task = next_task;
                    curriculum_outcomes.clear();
                    trainer.buffer.clear();

                    for i in 0..num_envs {
                        envs[i].set_task(active_task);
                        observations[i] = envs[i].reset();
                        current_ep_rewards[i] = 0.0;
                        current_ep_steps[i] = 0;
                        current_ep_rpg_fires[i] = 0;
                        current_ep_blocks[i] = 0;
                        episode_frames[i].clear();
                        trainer.reset_env_state(i);
                    }

                    preview_env.set_task(active_task);
                    preview_observation = preview_env.reset();
                    preview_state.0.fill(0.0);
                    preview_state.1.fill(0.0);
                    preview_action_frame = [0.0; 8];
                }
            }
        }

        if preview_active && preview_deterministic {
            match trainer.deterministic_action_for_state(&preview_observation, &preview_state) {
                Ok((preview_action, next_preview_state)) => {
                    preview_action_frame = action_frame_from(&preview_action);
                    preview_state = next_preview_state;
                    let result = preview_env.step(&preview_action);
                    if result.done {
                        preview_observation = preview_env.reset();
                        preview_state.0.fill(0.0);
                        preview_state.1.fill(0.0);
                    } else {
                        preview_observation = result.observation;
                    }
                }
                Err(e) => {
                    log::error!("Preview deterministic action failed: {:?}", e);
                }
            }
        }

        if sim_step % PREVIEW_ACTIVITY_CHECK_INTERVAL == 0 {
            if let Ok(s) = state.lock() {
                preview_active = s.preview_active(PREVIEW_ACTIVITY_TIMEOUT);
            }
        }

        let preview_state_interval = if preview_active {
            PREVIEW_ACTIVE_STATE_UPDATE_INTERVAL
        } else {
            PREVIEW_IDLE_STATE_UPDATE_INTERVAL
        };
        let preview_terrain_interval = if preview_active {
            PREVIEW_ACTIVE_TERRAIN_UPDATE_INTERVAL
        } else {
            PREVIEW_IDLE_TERRAIN_UPDATE_INTERVAL
        };

        if sim_step % preview_state_interval == 0 {
            if let Ok(mut s) = state.lock() {
                s.live_bot_states = if preview_deterministic {
                    vec![LiveBotState {
                        pos: preview_env.player_pos(),
                        vel: preview_env.player_vel(),
                        yaw: preview_env.player_yaw(),
                        pitch: preview_env.player_pitch(),
                        target: preview_env.target_pos(),
                        health: preview_env.player_health(),
                        weapon: preview_env.current_weapon(),
                        on_ground: preview_env.on_ground(),
                        action: preview_action_frame,
                    }]
                } else {
                    envs.iter()
                        .enumerate()
                        .map(|(i, env)| {
                            let action = actions.get(i).map(|v| v.as_slice()).unwrap_or(&[]);
                            LiveBotState {
                                pos: env.player_pos(),
                                vel: env.player_vel(),
                                yaw: env.player_yaw(),
                                pitch: env.player_pitch(),
                                target: env.target_pos(),
                                health: env.player_health(),
                                weapon: env.current_weapon(),
                                on_ground: env.on_ground(),
                                action: action_frame_from(action),
                            }
                        })
                        .collect()
                };

                if sim_step % preview_terrain_interval == 0 {
                    s.preview_modified_chunks = if preview_deterministic {
                        preview_env.modified_terrain_chunks().clone()
                    } else {
                        let preview_idx = s.preview_bot.min(envs.len().saturating_sub(1));
                        envs[preview_idx].modified_terrain_chunks().clone()
                    };
                    s.preview_terrain_revision = s.preview_terrain_revision.wrapping_add(1);
                }
            }
        }

        // 6. Compute stats for shared state + checkpoint decisions
        let recent_r = if episode_rewards.len() > ROLLING_WINDOW {
            &episode_rewards[episode_rewards.len() - ROLLING_WINDOW..]
        } else {
            &episode_rewards
        };
        mean_reward = if recent_r.is_empty() {
            0.0
        } else {
            recent_r.iter().sum::<f32>() / recent_r.len() as f32
        };

        let recent_l = if episode_lengths.len() > ROLLING_WINDOW {
            &episode_lengths[episode_lengths.len() - ROLLING_WINDOW..]
        } else {
            &episode_lengths
        };
        mean_length = if recent_l.is_empty() {
            0.0
        } else {
            recent_l.iter().sum::<f32>() / recent_l.len() as f32
        };
        success_rate = bool_rate(&episode_successes);
        timeout_rate = bool_rate(&episode_timeouts);
        stall_rate = bool_rate(&episode_stalls);
        let rpg_usage_rate = mean_or_zero(&episode_rpg_usage);
        let block_destroy_rate = mean_or_zero(&episode_blocks_destroyed);

        // 7. Check for manual save request
        let mut should_save = false;
        if step_count % (STATS_UPDATE_INTERVAL * num_envs as u64) < num_envs as u64 {
            let elapsed = start_time.elapsed().as_secs_f64();
            let steps_per_sec = step_count as f32 / elapsed as f32;

            if let Ok(mut s) = state.lock() {
                s.stats = TrainingStats {
                    episode: trainer.total_episodes,
                    total_steps: step_count,
                    mean_reward,
                    mean_episode_length: mean_length,
                    steps_per_sec,
                    elapsed_secs: elapsed,
                    success_rate,
                    timeout_rate,
                    stall_rate,
                    rpg_usage_rate,
                    block_destroy_rate,
                    policy_loss: last_update_stats.policy_loss,
                    value_loss: last_update_stats.value_loss,
                    entropy: last_update_stats.entropy,
                    approx_kl: last_update_stats.approx_kl,
                    explained_variance: last_update_stats.explained_variance,
                    current_task: active_task.label().to_string(),
                    device: trainer.device_label(),
                };

                // Check manual save request
                if s.checkpoint_save_requested {
                    s.checkpoint_save_requested = false;
                    should_save = true;
                }
            }
        }

        // 8. Auto-save every 1000 episodes
        if trainer.total_episodes > 0
            && trainer.total_episodes >= last_auto_save_ep + AUTO_SAVE_INTERVAL
        {
            last_auto_save_ep = trainer.total_episodes;
            should_save = true;
        }

        // 9. Execute checkpoint save (outside mutex lock)
        if should_save {
            do_save_checkpoint(
                &checkpoint_mgr,
                &trainer,
                mean_reward,
                mean_length,
                step_count,
                success_rate,
                stall_rate,
                timeout_rate,
                active_task.label(),
            );
        }

        // 10. Auto-save best checkpoint when score improves
        let current_score = checkpoint_score(success_rate, mean_reward);
        if current_score > best_checkpoint_score && trainer.total_episodes >= 100 {
            best_checkpoint_score = current_score;
            let meta = build_checkpoint_meta(
                &trainer,
                mean_reward,
                mean_length,
                step_count,
                success_rate,
                stall_rate,
                timeout_rate,
                active_task.label(),
            );
            match checkpoint_mgr.save_best(&trainer.network, &meta) {
                Ok(_) => {}
                Err(e) => log::error!("Failed to save best checkpoint: {}", e),
            }
        }
    }

    // Final checkpoint on training stop
    {
        let recent_r = if episode_rewards.len() > ROLLING_WINDOW {
            &episode_rewards[episode_rewards.len() - ROLLING_WINDOW..]
        } else {
            &episode_rewards
        };
        let mean_reward = if recent_r.is_empty() {
            0.0
        } else {
            recent_r.iter().sum::<f32>() / recent_r.len() as f32
        };
        let recent_l = if episode_lengths.len() > ROLLING_WINDOW {
            &episode_lengths[episode_lengths.len() - ROLLING_WINDOW..]
        } else {
            &episode_lengths
        };
        let mean_length = if recent_l.is_empty() {
            0.0
        } else {
            recent_l.iter().sum::<f32>() / recent_l.len() as f32
        };
        let final_success = bool_rate(&episode_successes);
        let final_stall = bool_rate(&episode_stalls);
        let final_timeout = bool_rate(&episode_timeouts);
        do_save_checkpoint(
            &checkpoint_mgr,
            &trainer,
            mean_reward,
            mean_length,
            step_count,
            final_success,
            final_stall,
            final_timeout,
            active_task.label(),
        );
    }

    log::info!(
        "Training complete. {} episodes, {} steps in {:.1}s",
        trainer.total_episodes,
        step_count,
        start_time.elapsed().as_secs_f64()
    );

    if let Ok(mut s) = state.lock() {
        s.is_running = false;
        s.is_paused = false;
        s.stop_sleep_prevention();
    }
}

fn trim_recent<T>(values: &mut Vec<T>, keep: usize) {
    if values.len() > keep {
        let excess = values.len() - keep;
        values.drain(0..excess);
    }
}

fn mean_or_zero(values: &[f32]) -> f32 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f32>() / values.len() as f32
    }
}

fn bool_rate(values: &[bool]) -> f32 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().filter(|&&v| v).count() as f32 / values.len() as f32
    }
}

fn action_frame_from(action: &[f32]) -> [f32; 8] {
    let mut frame = [0.0f32; 8];
    for (idx, value) in action.iter().enumerate().take(8) {
        frame[idx] = *value;
    }
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ground_short_advances_only_after_mastery_window_is_good() {
        let task = TrainingTask::GroundShort;
        let mut outcomes = VecDeque::new();

        for _ in 0..task.mastery_min_episodes() {
            push_curriculum_outcome(
                &mut outcomes,
                task,
                CurriculumOutcome {
                    success: true,
                    timeout: false,
                    stall: false,
                },
            );
        }

        let snapshot = should_advance_task(task, &outcomes).expect("mastery");
        assert!(snapshot.success_rate >= task.mastery_success_rate());
        assert!(snapshot.stall_rate <= task.mastery_stall_rate());
        assert!(snapshot.timeout_rate <= task.mastery_timeout_rate());
    }

    #[test]
    fn ground_short_does_not_advance_when_stall_rate_is_too_high() {
        let task = TrainingTask::GroundShort;
        let mut outcomes = VecDeque::new();

        for _ in 0..76 {
            push_curriculum_outcome(
                &mut outcomes,
                task,
                CurriculumOutcome {
                    success: true,
                    timeout: false,
                    stall: false,
                },
            );
        }

        for _ in 0..20 {
            push_curriculum_outcome(
                &mut outcomes,
                task,
                CurriculumOutcome {
                    success: false,
                    timeout: false,
                    stall: true,
                },
            );
        }

        assert!(outcomes.len() >= task.mastery_min_episodes());
        assert!(should_advance_task(task, &outcomes).is_none());
    }

    #[test]
    #[ignore]
    fn benchmark_env_counts() {
        let base_terrain = Arc::new(BaseTerrain::generate(42));
        let candidates = [12usize, 16, 24, 32];
        let rollout_steps = 48usize;
        let mut best = (0usize, 0.0f32);

        for &num_envs in &candidates {
            let mut trainer = PPOTrainer::new(PPOConfig {
                rollout_length: rollout_steps,
                ..PPOConfig::default()
            })
            .expect("trainer");
            trainer.init_states(num_envs);

            let mut envs: Vec<TrainingEnv> = (0..num_envs)
                .map(|i| TrainingEnv::new(base_terrain.clone(), 10_000 + i as u64))
                .collect();
            let mut observations: Vec<Vec<f32>> = envs.iter_mut().map(TrainingEnv::reset).collect();

            let start = Instant::now();
            for _ in 0..rollout_steps {
                let (actions, _, _) = trainer.get_actions(&observations).expect("actions");
                let results: Vec<StepResult> = envs
                    .par_iter_mut()
                    .zip(actions.par_iter())
                    .map(|(env, action)| env.step(action))
                    .collect();
                for (idx, result) in results.into_iter().enumerate() {
                    observations[idx] = if result.done {
                        envs[idx].reset()
                    } else {
                        result.observation
                    };
                }
            }

            let elapsed = start.elapsed().as_secs_f32().max(0.001);
            let steps_per_sec = (num_envs * rollout_steps) as f32 / elapsed;
            println!("candidate num_envs={num_envs} steps_per_sec={steps_per_sec:.1}");

            if steps_per_sec > best.1 {
                best = (num_envs, steps_per_sec);
            }
        }

        println!(
            "recommended num_envs={} steps_per_sec={:.1}",
            best.0, best.1
        );
        assert!(best.0 > 0);
    }
}
