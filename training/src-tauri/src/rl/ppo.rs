use candle_core::{Device, Result as CandleResult, Tensor};
use candle_nn::{AdamW, Optimizer, ParamsAdamW};
use serde::{Deserialize, Serialize};

use super::network::{
    ActorCritic, LSTMState, ACTION_PARAM_DIM, BINARY_ACTION_DIM, CONTINUOUS_ACTION_DIM,
    HIDDEN_SIZE, OBS_DIM, POLICY_WEAPON_DIM, POLICY_WEAPON_INDICES,
};

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
            entropy_coeff: 0.004,
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
    rollout_steps: usize,
    num_envs: usize,
}

impl RolloutBuffer {
    pub fn new(rollout_steps: usize) -> Self {
        Self {
            observations: Vec::new(),
            actions: Vec::new(),
            weapon_indices: Vec::new(),
            log_probs: Vec::new(),
            values: Vec::new(),
            rewards: Vec::new(),
            dones: Vec::new(),
            hidden_h: Vec::new(),
            hidden_c: Vec::new(),
            rollout_steps,
            num_envs: 0,
        }
    }

    pub fn configure(&mut self, num_envs: usize) {
        self.num_envs = num_envs;
        let capacity = self.rollout_steps * num_envs;
        self.observations = Vec::with_capacity(capacity);
        self.actions = Vec::with_capacity(capacity);
        self.weapon_indices = Vec::with_capacity(capacity);
        self.log_probs = Vec::with_capacity(capacity);
        self.values = Vec::with_capacity(capacity);
        self.rewards = Vec::with_capacity(capacity);
        self.dones = Vec::with_capacity(capacity);
        self.hidden_h = Vec::with_capacity(capacity);
        self.hidden_c = Vec::with_capacity(capacity);
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
        self.num_envs > 0 && self.num_steps() >= self.rollout_steps
    }

    pub fn len(&self) -> usize {
        self.observations.len()
    }

    pub fn num_steps(&self) -> usize {
        if self.num_envs == 0 {
            0
        } else {
            self.observations.len() / self.num_envs
        }
    }

    pub fn num_envs(&self) -> usize {
        self.num_envs
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

/// Compute Generalized Advantage Estimation for a time-major `[t][env]` rollout.
pub fn compute_gae_per_env(
    rewards: &[f32],
    values: &[f32],
    dones: &[bool],
    bootstrap_values: &[f32],
    num_envs: usize,
    rollout_steps: usize,
    gamma: f32,
    lambda: f32,
) -> (Vec<f32>, Vec<f32>) {
    let total = rewards.len();
    let mut advantages = vec![0.0_f32; total];
    let mut returns = vec![0.0_f32; total];

    for env_idx in 0..num_envs {
        let mut last_gae = 0.0f32;
        for step in (0..rollout_steps).rev() {
            let idx = step * num_envs + env_idx;
            let next_value = if step + 1 == rollout_steps {
                bootstrap_values[env_idx]
            } else {
                values[(step + 1) * num_envs + env_idx]
            };
            let next_non_terminal = if dones[idx] { 0.0 } else { 1.0 };
            let delta = rewards[idx] + gamma * next_value * next_non_terminal - values[idx];
            last_gae = delta + gamma * lambda * next_non_terminal * last_gae;
            advantages[idx] = last_gae;
            returns[idx] = last_gae + values[idx];
        }
    }

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
    /// Initial learning rate (for annealing).
    initial_lr: f64,
}

/// Sequence length for truncated BPTT during PPO updates.
/// Each sequence is processed step-by-step through the LSTM, allowing gradients
/// to flow through time instead of treating each timestep independently.
const SEQ_LEN: usize = 8;

const ENTROPY_DECAY_EPISODES: f32 = 50_000.0;
const MIN_ENTROPY_COEFF: f32 = 0.003;

/// LR anneals linearly from the initial value down to 10% over this many episodes.
const LR_DECAY_EPISODES: f32 = 30_000.0;
const LR_MIN_FRACTION: f64 = 0.1;

impl PPOTrainer {
    pub fn new(config: PPOConfig) -> CandleResult<Self> {
        let device = select_best_device();
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

        let initial_lr = config.lr;
        Ok(Self {
            network,
            optimizer,
            config,
            buffer,
            total_steps: 0,
            total_episodes: 0,
            env_states: Vec::new(),
            device,
            initial_lr,
        })
    }

    /// Initialize LSTM states for N environments (call once before training).
    pub fn init_states(&mut self, num_envs: usize) {
        let zeros = vec![0.0f32; HIDDEN_SIZE];
        self.env_states = (0..num_envs)
            .map(|_| (zeros.clone(), zeros.clone()))
            .collect();
        self.buffer.configure(num_envs);
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

        // Pull hidden state back in one batched transfer instead of per-row reads.
        let h_all: Vec<Vec<f32>> = new_state.h.to_vec2()?;
        let c_all: Vec<Vec<f32>> = new_state.c.to_vec2()?;
        for (slot, (h, c)) in self
            .env_states
            .iter_mut()
            .zip(h_all.into_iter().zip(c_all.into_iter()))
            .take(num_envs)
        {
            *slot = (h, c);
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
            let weapon_idx = actions[i]
                .get(ACTION_PARAM_DIM)
                .map(|&v| v as usize)
                .unwrap_or(0);

            self.buffer.push(
                observations[i].clone(),
                actions[i][..ACTION_PARAM_DIM].to_vec(),
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

    pub fn set_learning_rate(&mut self, lr: f64) {
        self.optimizer.set_learning_rate(lr);
        self.config.lr = lr;
    }

    /// Linearly anneal the learning rate from initial down to 10% over LR_DECAY_EPISODES.
    fn effective_lr(&self) -> f64 {
        let progress = (self.total_episodes as f64 / LR_DECAY_EPISODES as f64).clamp(0.0, 1.0);
        self.initial_lr * (1.0 - progress * (1.0 - LR_MIN_FRACTION))
    }

    pub fn effective_entropy_coeff(&self) -> f32 {
        let start = self.config.entropy_coeff.max(0.0);
        if start <= MIN_ENTROPY_COEFF {
            return start;
        }

        let end = (start * 0.2).max(MIN_ENTROPY_COEFF).min(start);
        let progress = (self.total_episodes as f32 / ENTROPY_DECAY_EPISODES).clamp(0.0, 1.0);
        start + (end - start) * progress
    }

    pub fn get_values(&self, observations: &[Vec<f32>]) -> CandleResult<Vec<f32>> {
        let num_envs = observations.len();
        let obs_flat: Vec<f32> = observations.iter().flatten().copied().collect();
        let obs_tensor = Tensor::from_slice(&obs_flat, (num_envs, OBS_DIM), &self.device)?;
        let state = LSTMState::stack(&self.env_states, &self.device)?;
        let (_, _, _, values, _) = self.network.forward(&obs_tensor, &state)?;
        values.squeeze(1)?.to_vec1()
    }

    pub fn deterministic_action_for_state(
        &self,
        observation: &[f32],
        state: &(Vec<f32>, Vec<f32>),
    ) -> CandleResult<(Vec<f32>, (Vec<f32>, Vec<f32>))> {
        let obs_tensor = Tensor::from_slice(observation, (1, OBS_DIM), &self.device)?;
        let lstm_state = LSTMState::stack(std::slice::from_ref(state), &self.device)?;
        let (action_params, _log_std, weapon_logits, _value, new_state) =
            self.network.forward(&obs_tensor, &lstm_state)?;

        let cont_means = action_params
            .narrow(1, 0, CONTINUOUS_ACTION_DIM)?
            .tanh()?
            .to_vec2::<f32>()?;
        let binary_probs = candle_nn::ops::sigmoid(&action_params.narrow(
            1,
            CONTINUOUS_ACTION_DIM,
            BINARY_ACTION_DIM,
        )?)?
        .to_vec2::<f32>()?;
        let weapon_logits = weapon_logits
            .narrow(1, 0, POLICY_WEAPON_DIM)?
            .to_vec2::<f32>()?;

        let mut action = Vec::with_capacity(ACTION_PARAM_DIM + 1);
        action.extend(cont_means[0].iter().copied());
        action.extend(
            binary_probs[0]
                .iter()
                .map(|&p| if p >= 0.5 { 1.0 } else { 0.0 }),
        );

        let weapon_choice = weapon_logits[0]
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .map(|(idx, _)| idx)
            .unwrap_or(0);
        action.push(POLICY_WEAPON_INDICES[weapon_choice] as f32);

        let h_all = new_state.h.to_vec2()?;
        let c_all = new_state.c.to_vec2()?;
        Ok((action, (h_all[0].clone(), c_all[0].clone())))
    }

    pub fn device_label(&self) -> String {
        format!("{:?}", self.device)
    }

    /// PPO update using sequence-based minibatches for proper LSTM training.
    ///
    /// Instead of shuffling individual timesteps (which destroys LSTM temporal
    /// coherence), we group consecutive timesteps into sequences of SEQ_LEN
    /// and shuffle sequences. Each sequence is processed step-by-step through
    /// the LSTM, allowing gradients to flow through time (truncated BPTT).
    pub fn update(&mut self, bootstrap_values: &[f32]) -> CandleResult<PPOUpdateStats> {
        let buffer_len = self.buffer.len();
        if buffer_len == 0 {
            return Ok(PPOUpdateStats {
                policy_loss: 0.0,
                value_loss: 0.0,
                entropy: 0.0,
                approx_kl: 0.0,
                explained_variance: 0.0,
            });
        }

        let num_envs = self.buffer.num_envs();
        let rollout_steps = self.buffer.num_steps();
        if bootstrap_values.len() != num_envs {
            candle_core::bail!(
                "bootstrap values length {} did not match num_envs {}",
                bootstrap_values.len(),
                num_envs
            )
        }

        // GAE
        let (advantages, returns) = compute_gae_per_env(
            &self.buffer.rewards,
            &self.buffer.values,
            &self.buffer.dones,
            bootstrap_values,
            num_envs,
            rollout_steps,
            self.config.gamma,
            self.config.gae_lambda,
        );

        // Normalize advantages
        let adv_mean = advantages.iter().sum::<f32>() / advantages.len() as f32;
        let adv_var = advantages
            .iter()
            .map(|a| (a - adv_mean).powi(2))
            .sum::<f32>()
            / advantages.len() as f32;
        let adv_std = (adv_var + 1e-8).sqrt();
        let norm_advantages: Vec<f32> = advantages
            .iter()
            .map(|a| (a - adv_mean) / adv_std)
            .collect();

        // ── Build flat tensors from buffer ──
        let obs_flat: Vec<f32> = self.buffer.observations.iter().flatten().copied().collect();
        let obs_tensor = Tensor::from_slice(&obs_flat, (buffer_len, OBS_DIM), &self.device)?;

        let act_flat: Vec<f32> = self.buffer.actions.iter().flatten().copied().collect();
        let actions_tensor =
            Tensor::from_slice(&act_flat, (buffer_len, ACTION_PARAM_DIM), &self.device)?;

        let weapon_indices: Vec<u32> = self
            .buffer
            .weapon_indices
            .iter()
            .map(|&w| w as u32)
            .collect();
        let weapon_tensor = Tensor::from_slice(&weapon_indices, buffer_len, &self.device)?;

        let old_log_probs = Tensor::from_slice(&self.buffer.log_probs, buffer_len, &self.device)?;
        let advantages_tensor = Tensor::from_slice(&norm_advantages, buffer_len, &self.device)?;
        let returns_tensor = Tensor::from_slice(&returns, buffer_len, &self.device)?;

        // ── Build sequence index map ──
        // Buffer layout is time-major interleaved: index = step * num_envs + env
        // Each sequence is SEQ_LEN consecutive steps for one environment.
        let num_seqs_per_env = rollout_steps / SEQ_LEN;
        let total_sequences = num_seqs_per_env * num_envs;
        let seqs_per_mb = (self.config.minibatch_size / SEQ_LEN).max(1);

        // seq_buf_indices[seq_id][t] = buffer index for that timestep
        let mut seq_buf_indices: Vec<[usize; SEQ_LEN]> = Vec::with_capacity(total_sequences);
        // Initial hidden state for each sequence (from buffer at first step)
        let mut init_h_flat: Vec<f32> = Vec::with_capacity(total_sequences * HIDDEN_SIZE);
        let mut init_c_flat: Vec<f32> = Vec::with_capacity(total_sequences * HIDDEN_SIZE);

        for env in 0..num_envs {
            for s in 0..num_seqs_per_env {
                let start_step = s * SEQ_LEN;
                let mut indices = [0usize; SEQ_LEN];
                for t in 0..SEQ_LEN {
                    indices[t] = (start_step + t) * num_envs + env;
                }
                let first_idx = indices[0];
                init_h_flat.extend_from_slice(&self.buffer.hidden_h[first_idx]);
                init_c_flat.extend_from_slice(&self.buffer.hidden_c[first_idx]);
                seq_buf_indices.push(indices);
            }
        }

        let init_h_tensor =
            Tensor::from_slice(&init_h_flat, (total_sequences, HIDDEN_SIZE), &self.device)?;
        let init_c_tensor =
            Tensor::from_slice(&init_c_flat, (total_sequences, HIDDEN_SIZE), &self.device)?;

        // Pre-extract dones for hidden state resets (avoids borrowing buffer in loop)
        let dones_buf: Vec<bool> = self.buffer.dones.clone();

        // ── Training loop with sequence-based minibatches ──
        let mut total_policy_loss = 0.0f32;
        let mut total_value_loss = 0.0f32;
        let mut total_entropy = 0.0f32;
        let mut total_approx_kl = 0.0f32;
        let mut num_updates = 0u32;
        let entropy_coeff = self.effective_entropy_coeff();

        // Anneal learning rate — fast early learning, stable later
        let lr = self.effective_lr();
        self.optimizer.set_learning_rate(lr);

        let mut seq_order: Vec<usize> = (0..total_sequences).collect();

        for _epoch in 0..self.config.num_epochs {
            shuffle_indices(&mut seq_order);

            let mut mb_start = 0;
            while mb_start + seqs_per_mb <= total_sequences {
                let mb_seq_ids = &seq_order[mb_start..mb_start + seqs_per_mb];

                // Gather initial hidden states for this minibatch of sequences
                let seq_idx: Vec<u32> = mb_seq_ids.iter().map(|&s| s as u32).collect();
                let seq_idx_tensor =
                    Tensor::from_slice(&seq_idx, seqs_per_mb, &self.device)?;
                let mut state = LSTMState {
                    h: init_h_tensor.index_select(&seq_idx_tensor, 0)?,
                    c: init_c_tensor.index_select(&seq_idx_tensor, 0)?,
                };

                // Process SEQ_LEN steps sequentially (truncated BPTT)
                let mut step_log_probs: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);
                let mut step_values: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);
                let mut step_old_lp: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);
                let mut step_advantages: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);
                let mut step_returns: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);
                let mut step_entropies: Vec<Tensor> = Vec::with_capacity(SEQ_LEN);

                for t in 0..SEQ_LEN {
                    // Gather buffer indices for timestep t across sequences
                    let buf_idx: Vec<u32> = mb_seq_ids
                        .iter()
                        .map(|&s| seq_buf_indices[s][t] as u32)
                        .collect();
                    let idx_t = Tensor::from_slice(&buf_idx, seqs_per_mb, &self.device)?;

                    let obs_t = obs_tensor.index_select(&idx_t, 0)?;
                    let act_t = actions_tensor.index_select(&idx_t, 0)?;
                    let wpn_t = weapon_tensor.index_select(&idx_t, 0)?;

                    step_old_lp.push(old_log_probs.index_select(&idx_t, 0)?);
                    step_advantages.push(advantages_tensor.index_select(&idx_t, 0)?);
                    step_returns.push(returns_tensor.index_select(&idx_t, 0)?);

                    // Forward pass with current hidden state — gradients flow through
                    let (log_probs_t, values_t, entropy_t, new_state) =
                        self.network
                            .evaluate_actions(&obs_t, &act_t, &wpn_t, &state)?;

                    step_log_probs.push(log_probs_t);
                    step_values.push(values_t);
                    step_entropies.push(entropy_t);

                    // Reset hidden states where episodes ended (zero out done envs)
                    let dones_t: Vec<bool> = mb_seq_ids
                        .iter()
                        .map(|&s| dones_buf[seq_buf_indices[s][t]])
                        .collect();
                    if dones_t.iter().any(|&d| d) {
                        let mask: Vec<f32> = dones_t
                            .iter()
                            .map(|&d| if d { 0.0 } else { 1.0 })
                            .collect();
                        let mask =
                            Tensor::from_slice(&mask, (seqs_per_mb, 1), &self.device)?
                                .broadcast_as(new_state.h.shape())?;
                        state = LSTMState {
                            h: (new_state.h * &mask)?,
                            c: (new_state.c * &mask)?,
                        };
                    } else {
                        state = new_state;
                    }
                }

                // Concatenate all timestep results → [seqs_per_mb * SEQ_LEN]
                let all_log_probs = Tensor::cat(&step_log_probs, 0)?;
                let all_values = Tensor::cat(&step_values, 0)?;
                let all_old_lp = Tensor::cat(&step_old_lp, 0)?;
                let all_advantages = Tensor::cat(&step_advantages, 0)?;
                let all_returns = Tensor::cat(&step_returns, 0)?;
                // Mean entropy over the sequence, kept in the autograd graph so the
                // entropy bonus contributes a real gradient (it previously did not).
                let avg_entropy = {
                    let mut acc = step_entropies[0].clone();
                    for e in step_entropies.iter().skip(1) {
                        acc = (acc + e)?;
                    }
                    acc.affine(1.0 / SEQ_LEN as f64, 0.0)?
                };

                // PPO clipped surrogate loss
                let log_ratio = (&all_log_probs - &all_old_lp)?;
                let ratio = log_ratio.exp()?;
                let approx_kl: f32 =
                    log_ratio.sqr()?.mean_all()?.to_scalar::<f32>()? * 0.5;

                let surr1 = (&ratio * &all_advantages)?;
                let ratio_clamped = ratio.clamp(
                    1.0 - self.config.clip_epsilon as f64,
                    1.0 + self.config.clip_epsilon as f64,
                )?;
                let surr2 = (&ratio_clamped * &all_advantages)?;
                let policy_loss = surr1.minimum(&surr2)?.mean_all()?.neg()?;

                let value_loss = (&all_values - &all_returns)?.sqr()?.mean_all()?;

                let entropy_scalar: f32 = avg_entropy.to_scalar()?;
                let loss = (&policy_loss
                    + value_loss.affine(self.config.value_coeff as f64, 0.0)?)?
                .broadcast_sub(&avg_entropy.affine(entropy_coeff as f64, 0.0)?)?;

                // Backprop, clip the global gradient norm to max_grad_norm (which was
                // configured but never enforced), then apply the optimizer step.
                let mut grads = loss.backward()?;
                let max_norm = self.config.max_grad_norm as f64;
                if max_norm > 0.0 {
                    let vars = self.network.var_map().all_vars();
                    let mut sum_sq = 0.0f64;
                    for v in &vars {
                        if let Some(g) = grads.get(v.as_tensor()) {
                            sum_sq += g.sqr()?.sum_all()?.to_scalar::<f32>()? as f64;
                        }
                    }
                    let norm = sum_sq.sqrt();
                    if norm.is_finite() && norm > max_norm {
                        let scale = max_norm / (norm + 1e-6);
                        let scaled: Vec<(Tensor, Tensor)> = {
                            let mut out = Vec::new();
                            for v in &vars {
                                if let Some(g) = grads.get(v.as_tensor()) {
                                    out.push((v.as_tensor().clone(), g.affine(scale, 0.0)?));
                                }
                            }
                            out
                        };
                        for (t, g) in scaled {
                            grads.insert(&t, g);
                        }
                    }
                }
                self.optimizer.step(&grads)?;

                total_policy_loss += policy_loss.to_scalar::<f32>()?;
                total_value_loss += value_loss.to_scalar::<f32>()?;
                total_entropy += entropy_scalar;
                total_approx_kl += approx_kl;
                num_updates += 1;

                mb_start += seqs_per_mb;
            }
        }

        let explained_variance = explained_variance(&returns, &self.buffer.values);

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

fn explained_variance(returns: &[f32], values: &[f32]) -> f32 {
    if returns.is_empty() || values.is_empty() || returns.len() != values.len() {
        return 0.0;
    }

    let returns_mean = returns.iter().sum::<f32>() / returns.len() as f32;
    let returns_var = returns
        .iter()
        .map(|r| (r - returns_mean).powi(2))
        .sum::<f32>()
        / returns.len() as f32;
    let residual_var = returns
        .iter()
        .zip(values.iter())
        .map(|(r, v)| (r - v).powi(2))
        .sum::<f32>()
        / returns.len() as f32;

    if returns_var < 1e-8 {
        0.0
    } else {
        1.0 - residual_var / returns_var
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

fn select_best_device() -> Device {
    #[cfg(target_os = "macos")]
    {
        if candle_core::utils::metal_is_available() {
            if metal::Device::system_default().is_none() {
                log::warn!(
                    "Metal framework is present but this process cannot see a default Metal device; falling back to CPU"
                );
                return Device::Cpu;
            }
            let previous_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let result = std::panic::catch_unwind(|| Device::new_metal(0));
            std::panic::set_hook(previous_hook);

            match result {
                Ok(Ok(device)) => return device,
                Ok(Err(err)) => {
                    log::warn!("Metal device unavailable, falling back to CPU: {err}");
                }
                Err(_) => {
                    log::warn!("Metal device initialization panicked, falling back to CPU");
                }
            }
        }
    }
    Device::Cpu
}

#[cfg(test)]
mod tests {
    use super::{compute_gae_per_env, explained_variance};

    #[test]
    fn gae_respects_environment_boundaries() {
        let rewards = vec![1.0, 10.0, 2.0, 20.0];
        let values = vec![0.5, 5.0, 0.25, 2.5];
        let dones = vec![false, true, false, false];
        let bootstrap_values = vec![0.0, 100.0];

        let (advantages, returns) =
            compute_gae_per_env(&rewards, &values, &dones, &bootstrap_values, 2, 2, 1.0, 1.0);

        assert!((advantages[0] - 2.5).abs() < 1e-5);
        assert!((advantages[2] - 1.75).abs() < 1e-5);
        assert!((advantages[1] - 5.0).abs() < 1e-5);
        assert!((advantages[3] - 117.5).abs() < 1e-4);

        assert!((returns[0] - 3.0).abs() < 1e-5);
        assert!((returns[1] - 10.0).abs() < 1e-5);
        assert!((returns[2] - 2.0).abs() < 1e-5);
        assert!((returns[3] - 120.0).abs() < 1e-4);
    }

    #[test]
    fn explained_variance_uses_returns_as_baseline() {
        let returns = vec![10.0, 12.0, 14.0, 16.0];
        let values = vec![9.0, 11.0, 15.0, 17.0];

        let ev = explained_variance(&returns, &values);

        assert!(ev > 0.0);
        assert!(ev < 1.0);
    }

    #[test]
    #[ignore]
    fn print_selected_training_device() {
        let trainer = super::PPOTrainer::new(super::PPOConfig::default()).expect("trainer");
        println!("selected_device={}", trainer.device_label());
    }
}
