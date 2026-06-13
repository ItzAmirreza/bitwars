//! Deterministic in-sim evaluation of a trained checkpoint.
//!
//! The deployed bot runs the *mean/argmax* (deterministic) policy, so evaluation
//! must too — training's rolling success rate uses *sampled* actions and doesn't
//! reflect deployed behaviour. `evaluate_checkpoint` loads a checkpoint and runs
//! deterministic rollouts across every curriculum task, returning success/stall/
//! timeout rates so deployments can be gated on beating the current model.

use std::sync::Arc;

use candle_core::{Device, Tensor};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::rl::network::{
    ActorCritic, LSTMState, ACTION_PARAM_DIM, BINARY_ACTION_DIM, CONTINUOUS_ACTION_DIM,
    HIDDEN_SIZE, OBS_DIM, POLICY_WEAPON_DIM, POLICY_WEAPON_INDICES,
};
use crate::sim::environment::{StepResult, TrainingEnv, TrainingTask};
use crate::sim::world::BaseTerrain;

/// Per-task evaluation summary.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TaskEval {
    pub task: String,
    pub episodes: usize,
    pub success_rate: f32,
    pub timeout_rate: f32,
    pub stall_rate: f32,
    pub mean_reward: f32,
    pub mean_len: f32,
}

/// Evaluate a checkpoint deterministically across all curriculum tasks.
///
/// `seed` controls the evaluation world (use one held out from training to
/// measure generalization). Returns one `TaskEval` per task.
pub fn evaluate_checkpoint(
    checkpoint_path: &str,
    seed: u64,
    episodes_per_task: usize,
    num_envs: usize,
) -> Result<Vec<TaskEval>, String> {
    let device = Device::Cpu;
    let mut network = ActorCritic::new(&device).map_err(|e| format!("net init: {e:?}"))?;
    network
        .load(checkpoint_path)
        .map_err(|e| format!("load weights: {e:?}"))?;

    let base = Arc::new(BaseTerrain::generate(seed));

    // Curriculum task list, in order.
    let mut tasks = vec![TrainingTask::initial()];
    while let Some(next) = tasks.last().unwrap().next() {
        tasks.push(next);
    }

    let num_envs = num_envs.max(1);
    let mut results = Vec::new();
    for (t_idx, task) in tasks.into_iter().enumerate() {
        let summary = eval_one_task(
            &network,
            &device,
            base.clone(),
            task,
            seed.wrapping_add(0x9E37_79B9_u64.wrapping_mul(t_idx as u64 + 1)),
            episodes_per_task,
            num_envs,
        )?;
        results.push(summary);
    }
    Ok(results)
}

fn eval_one_task(
    network: &ActorCritic,
    device: &Device,
    base: Arc<BaseTerrain>,
    task: TrainingTask,
    seed: u64,
    episodes_target: usize,
    num_envs: usize,
) -> Result<TaskEval, String> {
    let mut envs: Vec<TrainingEnv> = (0..num_envs)
        .map(|i| {
            let mut e = TrainingEnv::new(base.clone(), seed.wrapping_add(7919 * (i as u64 + 1)));
            e.set_task(task);
            e
        })
        .collect();
    let mut obs: Vec<Vec<f32>> = envs.iter_mut().map(|e| e.reset()).collect();
    let mut states: Vec<(Vec<f32>, Vec<f32>)> =
        vec![(vec![0.0; HIDDEN_SIZE], vec![0.0; HIDDEN_SIZE]); num_envs];

    let mut ep_reward = vec![0.0f32; num_envs];
    let mut ep_len = vec![0u32; num_envs];

    let mut completed = 0usize;
    let mut success = 0usize;
    let mut timeout = 0usize;
    let mut stall = 0usize;
    let mut reward_sum = 0.0f32;
    let mut len_sum = 0.0f32;

    while completed < episodes_target {
        let actions =
            deterministic_actions(network, device, &obs, &mut states).map_err(|e| e.to_string())?;
        let results: Vec<StepResult> = envs
            .par_iter_mut()
            .zip(actions.par_iter())
            .map(|(env, action)| env.step(action))
            .collect();

        for i in 0..num_envs {
            ep_reward[i] += results[i].reward;
            ep_len[i] += 1;
            if results[i].done {
                completed += 1;
                // Only tally the first `episodes_target` completions.
                if completed <= episodes_target {
                    let info = &results[i].info;
                    if info.reached_target {
                        success += 1;
                    }
                    if info.timed_out {
                        timeout += 1;
                    }
                    if info.stalled_out {
                        stall += 1;
                    }
                    reward_sum += ep_reward[i];
                    len_sum += ep_len[i] as f32;
                }
                ep_reward[i] = 0.0;
                ep_len[i] = 0;
                obs[i] = envs[i].reset();
                states[i] = (vec![0.0; HIDDEN_SIZE], vec![0.0; HIDDEN_SIZE]);
            } else {
                obs[i] = results[i].observation.clone();
            }
        }
    }

    let n = episodes_target as f32;
    Ok(TaskEval {
        task: task.label().to_string(),
        episodes: episodes_target,
        success_rate: success as f32 / n,
        timeout_rate: timeout as f32 / n,
        stall_rate: stall as f32 / n,
        mean_reward: reward_sum / n,
        mean_len: len_sum / n,
    })
}

/// Batched deterministic (mean continuous, >0.5 binary, argmax weapon) actions,
/// matching `bots/src/neural.ts::forward`. Updates the per-env LSTM states.
fn deterministic_actions(
    network: &ActorCritic,
    device: &Device,
    obs: &[Vec<f32>],
    states: &mut [(Vec<f32>, Vec<f32>)],
) -> candle_core::Result<Vec<Vec<f32>>> {
    let batch = obs.len();
    let flat: Vec<f32> = obs.iter().flatten().copied().collect();
    let obs_t = Tensor::from_slice(&flat, (batch, OBS_DIM), device)?;
    let state = LSTMState::stack(states, device)?;

    let (params, _log_std, weapon_logits, _value, new_state) = network.forward(&obs_t, &state)?;
    let cont = params.narrow(1, 0, CONTINUOUS_ACTION_DIM)?.tanh()?.to_vec2::<f32>()?;
    let binary =
        candle_nn::ops::sigmoid(&params.narrow(1, CONTINUOUS_ACTION_DIM, BINARY_ACTION_DIM)?)?
            .to_vec2::<f32>()?;
    let wlogits = weapon_logits.narrow(1, 0, POLICY_WEAPON_DIM)?.to_vec2::<f32>()?;
    let h_all = new_state.h.to_vec2::<f32>()?;
    let c_all = new_state.c.to_vec2::<f32>()?;

    let mut actions = Vec::with_capacity(batch);
    for i in 0..batch {
        let mut a = Vec::with_capacity(ACTION_PARAM_DIM + 1);
        a.extend(cont[i].iter().copied());
        a.extend(binary[i].iter().map(|&p| if p >= 0.5 { 1.0 } else { 0.0 }));
        let mut wi = 0usize;
        let mut best = wlogits[i][0];
        for k in 1..POLICY_WEAPON_DIM {
            if wlogits[i][k] > best {
                best = wlogits[i][k];
                wi = k;
            }
        }
        a.push(POLICY_WEAPON_INDICES[wi] as f32);
        actions.push(a);
        states[i] = (h_all[i].clone(), c_all[i].clone());
    }
    Ok(actions)
}
