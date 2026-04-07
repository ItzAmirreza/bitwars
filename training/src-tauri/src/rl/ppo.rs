use candle_core::{Device, Result as CandleResult, Tensor};
use candle_nn::{AdamW, Optimizer, ParamsAdamW};
use serde::{Deserialize, Serialize};

use super::network::{ActorCritic, LSTMState, CONTINUOUS_ACTION_DIM, HIDDEN_SIZE, OBS_DIM};

/// PPO hyperparameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PPOConfig {
    pub lr: f64,
    pub gamma: f32,
    pub gae_lambda: f32,
    pub clip_epsilon: f32,
    pub entropy_coeff: f32,
    pub value_coeff: f32,
    pub max_grad_norm: f32,
    pub num_epochs: usize,
    pub minibatch_size: usize,
    pub rollout_length: usize,
}

impl Default for PPOConfig {
    fn default() -> Self {
        Self {
            lr: 3e-4,
            gamma: 0.99,
            gae_lambda: 0.95,
            clip_epsilon: 0.2,
            entropy_coeff: 0.01,
            value_coeff: 0.5,
            max_grad_norm: 0.5,
            num_epochs: 4,
            minibatch_size: 64,
            rollout_length: 2048,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PPOUpdateStats {
    pub policy_loss: f32,
    pub value_loss: f32,
    pub entropy: f32,
    pub approx_kl: f32,
    pub explained_variance: f32,
}

/// Rollout buffer that also stores LSTM hidden states.
pub struct RolloutBuffer {
    pub observations: Vec<Vec<f32>>,
    pub actions: Vec<Vec<f32>>,
    pub weapon_indices: Vec<usize>,
    pub log_probs: Vec<f32>,
    pub values: Vec<f32>,
    pub rewards: Vec<f32>,
    pub dones: Vec<bool>,
    /// LSTM h state at the time of each transition.
    pub hidden_h: Vec<Vec<f32>>,
    /// LSTM c state at the time of each transition.
    pub hidden_c: Vec<Vec<f32>>,
    capacity: usize,
}

impl RolloutBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            observations: Vec::with_capacity(capacity),
            actions: Vec::with_capacity(capacity),
            weapon_indices: Vec::with_capacity(capacity),
            log_probs: Vec::with_capacity(capacity),
            values: Vec::with_capacity(capacity),
            rewards: Vec::with_capacity(capacity),
            dones: Vec::with_capacity(capacity),
            hidden_h: Vec::with_capacity(capacity),
            hidden_c: Vec::with_capacity(capacity),
            capacity,
        }
    }

    pub fn clear(&mut self) {
        self.observations.clear();
        self.actions.clear();
        self.weapon_indices.clear();
        self.log_probs.clear();
        self.values.clear();
        self.rewards.clear();
        self.dones.clear();
        self.hidden_h.clear();
        self.hidden_c.clear();
    }

    pub fn is_full(&self) -> bool {
        self.observations.len() >= self.capacity
    }

    pub fn len(&self) -> usize {
        self.observations.len()
    }

    pub fn push(
        &mut self,
        obs: Vec<f32>,
        action: Vec<f32>,
        weapon_idx: usize,
        log_prob: f32,
        value: f32,
        reward: f32,
        done: bool,
        h: Vec<f32>,
        c: Vec<f32>,
    ) {
        self.observations.push(obs);
        self.actions.push(action);
        self.weapon_indices.push(weapon_idx);
        self.log_probs.push(log_prob);
        self.values.push(value);
        self.rewards.push(reward);
        self.dones.push(done);
        self.hidden_h.push(h);
        self.hidden_c.push(c);
    }
}

/// Compute Generalized Advantage Estimation.
pub fn compute_gae(
    rewards: &[f32],
    values: &[f32],
    dones: &[bool],
    gamma: f32,
    lambda: f32,
    last_value: f32,
) -> (Vec<f32>, Vec<f32>) {
    let t = rewards.len();
    let mut advantages = vec![0.0_f32; t];
    let mut last_gae = 0.0_f32;

    for i in (0..t).rev() {
        let next_value = if i == t - 1 { last_value } else { values[i + 1] };
        let next_non_terminal = if dones[i] { 0.0 } else { 1.0 };
        let delta = rewards[i] + gamma * next_value * next_non_terminal - values[i];
        last_gae = delta + gamma * lambda * next_non_terminal * last_gae;
        advantages[i] = last_gae;
    }

    let returns: Vec<f32> = advantages.iter()
        .zip(values.iter())
        .map(|(adv, val)| adv + val)
        .collect();

    (advantages, returns)
}

/// PPO trainer with LSTM-based actor-critic.
pub struct PPOTrainer {
    pub network: ActorCritic,
    optimizer: AdamW,
    pub config: PPOConfig,
    pub buffer: RolloutBuffer,
    pub total_steps: u64,
    pub total_episodes: u64,
    /// Current LSTM states for all environments (one per env).
    /// Stored as (h_vec, c_vec) pairs for easy cloning.
    env_states: Vec<(Vec<f32>, Vec<f32>)>,
    device: Device,
}

impl PPOTrainer {
    pub fn new(config: PPOConfig) -> CandleResult<Self> {
        let device = Device::Cpu;
        let network = ActorCritic::new(&device)?;
        let optimizer = AdamW::new(
            network.var_map().all_vars(),
            ParamsAdamW {
                lr: config.lr,
                weight_decay: 0.0,
                ..Default::default()
            },
        )?;
        let buffer = RolloutBuffer::new(config.rollout_length);

        Ok(Self {
            network,
            optimizer,
            config,
            buffer,
            total_steps: 0,
            total_episodes: 0,
            env_states: Vec::new(),
            device,
        })
    }

    /// Initialize LSTM states for N environments (call once before training).
    pub fn init_states(&mut self, num_envs: usize) {
        let zeros = vec![0.0f32; HIDDEN_SIZE];
        self.env_states = (0..num_envs)
            .map(|_| (zeros.clone(), zeros.clone()))
            .collect();
    }

    /// Reset the LSTM state for a specific environment (call on episode done).
    pub fn reset_env_state(&mut self, env_idx: usize) {
        if env_idx < self.env_states.len() {
            self.env_states[env_idx].0.fill(0.0);
            self.env_states[env_idx].1.fill(0.0);
        }
    }

    /// Get actions for all observations using the LSTM network.
    ///
    /// Uses and updates the per-env hidden states.
    /// Returns (actions, log_probs, values).
    pub fn get_actions(
        &mut self,
        observations: &[Vec<f32>],
    ) -> CandleResult<(Vec<Vec<f32>>, Vec<f32>, Vec<f32>)> {
        let num_envs = observations.len();

        // Build batched observation tensor [num_envs, OBS_DIM]
        let obs_flat: Vec<f32> = observations.iter().flatten().copied().collect();
        let obs_tensor = Tensor::from_slice(&obs_flat, (num_envs, OBS_DIM), &self.device)?;

        // Build batched LSTM state from per-env states
        let state = LSTMState::stack(&self.env_states, &self.device)?;

        // Batched forward + sample
        let (actions, log_probs, values, new_state) =
            self.network.sample_actions_batch(&obs_tensor, &state)?;

        // Update per-env states from the new batched state
        for i in 0..num_envs {
            let (h, c) = new_state.to_vecs(i)?;
            self.env_states[i] = (h, c);
        }

        Ok((actions, log_probs, values))
    }

    /// Record transitions with LSTM hidden states.
    pub fn record_step(
        &mut self,
        observations: &[Vec<f32>],
        actions: &[Vec<f32>],
        log_probs: &[f32],
        values: &[f32],
        rewards: &[f32],
        dones: &[bool],
        hidden_states: &[(Vec<f32>, Vec<f32>)],
    ) {
        for i in 0..observations.len() {
            let weapon_idx = actions[i].get(CONTINUOUS_ACTION_DIM)
                .map(|&v| v as usize)
                .unwrap_or(0);

            self.buffer.push(
                observations[i].clone(),
                actions[i][..CONTINUOUS_ACTION_DIM].to_vec(),
                weapon_idx,
                log_probs[i],
                values[i],
                rewards[i],
                dones[i],
                hidden_states[i].0.clone(),
                hidden_states[i].1.clone(),
            );

            if dones[i] {
                self.total_episodes += 1;
            }
            self.total_steps += 1;
        }
    }

    /// Get a snapshot of current per-env hidden states (for storing in buffer).
    pub fn get_env_states(&self) -> &[(Vec<f32>, Vec<f32>)] {
        &self.env_states
    }

    pub fn should_update(&self) -> bool {
        self.buffer.is_full()
    }

    /// PPO update using stored hidden states for LSTM evaluation.
    pub fn update(&mut self) -> CandleResult<PPOUpdateStats> {
        let buffer_len = self.buffer.len();
        if buffer_len == 0 {
            return Ok(PPOUpdateStats {
                policy_loss: 0.0, value_loss: 0.0, entropy: 0.0,
                approx_kl: 0.0, explained_variance: 0.0,
            });
        }

        // Bootstrap last value using last observation + its hidden state
        let last_obs = &self.buffer.observations[buffer_len - 1];
        let last_obs_tensor = Tensor::from_slice(last_obs, (1, OBS_DIM), &self.device)?;
        let last_h = &self.buffer.hidden_h[buffer_len - 1];
        let last_c = &self.buffer.hidden_c[buffer_len - 1];
        let last_state = LSTMState::from_vecs(last_h, last_c, &self.device)?;
        let (_, _, _, last_val, _) = self.network.forward(&last_obs_tensor, &last_state)?;
        let last_value: f32 = last_val.squeeze(0)?.squeeze(0)?.to_scalar()?;

        // GAE
        let (advantages, returns) = compute_gae(
            &self.buffer.rewards,
            &self.buffer.values,
            &self.buffer.dones,
            self.config.gamma,
            self.config.gae_lambda,
            last_value,
        );

        // Normalize advantages
        let adv_mean = advantages.iter().sum::<f32>() / advantages.len() as f32;
        let adv_var = advantages.iter().map(|a| (a - adv_mean).powi(2)).sum::<f32>()
            / advantages.len() as f32;
        let adv_std = (adv_var + 1e-8).sqrt();
        let norm_advantages: Vec<f32> = advantages.iter().map(|a| (a - adv_mean) / adv_std).collect();

        // Flatten buffer into tensors
        let obs_flat: Vec<f32> = self.buffer.observations.iter().flatten().copied().collect();
        let obs_tensor = Tensor::from_slice(&obs_flat, (buffer_len, OBS_DIM), &self.device)?;

        let act_flat: Vec<f32> = self.buffer.actions.iter().flatten().copied().collect();
        let actions_tensor = Tensor::from_slice(&act_flat, (buffer_len, CONTINUOUS_ACTION_DIM), &self.device)?;

        let weapon_indices: Vec<u32> = self.buffer.weapon_indices.iter().map(|&w| w as u32).collect();
        let weapon_tensor = Tensor::from_slice(&weapon_indices, buffer_len, &self.device)?;

        // Flatten hidden states into tensors [buffer_len, HIDDEN_SIZE]
        let h_flat: Vec<f32> = self.buffer.hidden_h.iter().flatten().copied().collect();
        let c_flat: Vec<f32> = self.buffer.hidden_c.iter().flatten().copied().collect();
        let h_tensor = Tensor::from_slice(&h_flat, (buffer_len, HIDDEN_SIZE), &self.device)?;
        let c_tensor = Tensor::from_slice(&c_flat, (buffer_len, HIDDEN_SIZE), &self.device)?;

        let old_log_probs = Tensor::from_slice(&self.buffer.log_probs, buffer_len, &self.device)?;
        let advantages_tensor = Tensor::from_slice(&norm_advantages, buffer_len, &self.device)?;
        let returns_tensor = Tensor::from_slice(&returns, buffer_len, &self.device)?;

        // Training loop
        let mut total_policy_loss = 0.0f32;
        let mut total_value_loss = 0.0f32;
        let mut total_entropy = 0.0f32;
        let mut total_approx_kl = 0.0f32;
        let mut num_updates = 0u32;

        let mut indices: Vec<usize> = (0..buffer_len).collect();

        for _epoch in 0..self.config.num_epochs {
            shuffle_indices(&mut indices);

            let mut start = 0;
            while start + self.config.minibatch_size <= buffer_len {
                let end = start + self.config.minibatch_size;
                let mb_idx: Vec<u32> = indices[start..end].iter().map(|&i| i as u32).collect();
                let idx_tensor = Tensor::from_slice(&mb_idx, self.config.minibatch_size, &self.device)?;

                let mb_obs = obs_tensor.index_select(&idx_tensor, 0)?;
                let mb_actions = actions_tensor.index_select(&idx_tensor, 0)?;
                let mb_weapons = weapon_tensor.index_select(&idx_tensor, 0)?;
                let mb_old_lp = old_log_probs.index_select(&idx_tensor, 0)?;
                let mb_advantages = advantages_tensor.index_select(&idx_tensor, 0)?;
                let mb_returns = returns_tensor.index_select(&idx_tensor, 0)?;

                // Gather stored hidden states for this minibatch
                let mb_h = h_tensor.index_select(&idx_tensor, 0)?;
                let mb_c = c_tensor.index_select(&idx_tensor, 0)?;
                let mb_state = LSTMState { h: mb_h, c: mb_c };

                // Evaluate with stored hidden states
                let (new_log_probs, values, entropy) =
                    self.network.evaluate_actions(&mb_obs, &mb_actions, &mb_weapons, &mb_state)?;

                let log_ratio = (&new_log_probs - &mb_old_lp)?;
                let ratio = log_ratio.exp()?;

                let approx_kl: f32 = log_ratio.sqr()?.mean_all()?.to_scalar::<f32>()? * 0.5;

                let surr1 = (&ratio * &mb_advantages)?;
                let ratio_clamped = ratio.clamp(
                    1.0 - self.config.clip_epsilon as f64,
                    1.0 + self.config.clip_epsilon as f64,
                )?;
                let surr2 = (&ratio_clamped * &mb_advantages)?;
                let policy_loss = surr1.minimum(&surr2)?.mean_all()?.neg()?;

                let value_loss = (&values - &mb_returns)?.sqr()?.mean_all()?;

                let entropy_scalar: f32 = entropy.to_scalar()?;
                let loss = (&policy_loss
                    + value_loss.affine(self.config.value_coeff as f64, 0.0)?)?
                    .broadcast_sub(&entropy.affine(self.config.entropy_coeff as f64, 0.0)?)?;

                self.optimizer.backward_step(&loss)?;

                total_policy_loss += policy_loss.to_scalar::<f32>()?;
                total_value_loss += value_loss.to_scalar::<f32>()?;
                total_entropy += entropy_scalar;
                total_approx_kl += approx_kl;
                num_updates += 1;

                start = end;
            }
        }

        // Explained variance
        let values_vec = &self.buffer.values;
        let val_mean = values_vec.iter().sum::<f32>() / values_vec.len() as f32;
        let val_var = values_vec.iter().map(|v| (v - val_mean).powi(2)).sum::<f32>()
            / values_vec.len() as f32;
        let residual_var = returns.iter().zip(values_vec.iter())
            .map(|(r, v)| (r - v).powi(2)).sum::<f32>() / returns.len() as f32;
        let explained_variance = if val_var < 1e-8 { 0.0 } else { 1.0 - residual_var / val_var };

        self.buffer.clear();

        let n = num_updates.max(1) as f32;
        Ok(PPOUpdateStats {
            policy_loss: total_policy_loss / n,
            value_loss: total_value_loss / n,
            entropy: total_entropy / n,
            approx_kl: total_approx_kl / n,
            explained_variance,
        })
    }
}

fn shuffle_indices(indices: &mut [usize]) {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let n = indices.len();
    for i in (1..n).rev() {
        let j = rng.gen_range(0..=i);
        indices.swap(i, j);
    }
}
