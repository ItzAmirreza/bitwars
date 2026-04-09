use candle_core::{DType, Device, Result as CandleResult, Tensor, Var, D};
use candle_nn::{linear, Linear, Module, VarBuilder, VarMap};
use rand::Rng;
use std::path::Path;

/// Observation space dimension (matches sim::environment::OBSERVATION_DIM).
pub const OBS_DIM: usize = crate::sim::environment::OBSERVATION_DIM;
/// Continuous action dimension: forward, strafe, yaw delta, pitch delta.
pub const CONTINUOUS_ACTION_DIM: usize = 4;
/// Binary action dimension: jump, sprint, fire.
pub const BINARY_ACTION_DIM: usize = 3;
/// Output width of the shared actor head.
///
/// This remains 7 so existing checkpoints keep the same tensor shape even though
/// the last 3 values are now interpreted as Bernoulli logits instead of Gaussian
/// action means.
pub const ACTION_PARAM_DIM: usize = CONTINUOUS_ACTION_DIM + BINARY_ACTION_DIM;
/// Weapon head width kept at the original 5 logits for checkpoint compatibility.
pub const WEAPON_HEAD_DIM: usize = 5;
/// Only the default infantry loadout is available to the training bot.
pub const POLICY_WEAPON_INDICES: [usize; 3] = [0, 1, 2];
pub const POLICY_WEAPON_DIM: usize = POLICY_WEAPON_INDICES.len();
/// LSTM hidden size.
pub const HIDDEN_SIZE: usize = 256;
/// Actor/critic head hidden size.
const HEAD_HIDDEN: usize = 128;
const INITIAL_ACTION_BIAS: [f32; ACTION_PARAM_DIM] = [0.0, 0.0, 0.0, 0.0, -1.4, 0.9, -1.2];
const INITIAL_WEAPON_BIAS: [f32; WEAPON_HEAD_DIM] = [0.7, -0.1, 0.0, -5.0, -5.0];

// ── LSTM Hidden State ──

/// LSTM hidden state: (h, c) each of shape [batch, HIDDEN_SIZE].
#[derive(Clone)]
pub struct LSTMState {
    pub h: Tensor,
    pub c: Tensor,
}

impl LSTMState {
    /// Create a zero-initialized hidden state for a given batch size.
    #[allow(dead_code)]
    pub fn zeros(batch_size: usize, device: &Device) -> CandleResult<Self> {
        Ok(LSTMState {
            h: Tensor::zeros((batch_size, HIDDEN_SIZE), DType::F32, device)?,
            c: Tensor::zeros((batch_size, HIDDEN_SIZE), DType::F32, device)?,
        })
    }

    /// Stack multiple single-sample states into a batched state.
    pub fn stack(states: &[(Vec<f32>, Vec<f32>)], device: &Device) -> CandleResult<Self> {
        let batch = states.len();
        let h_flat: Vec<f32> = states.iter().flat_map(|(h, _)| h.iter().copied()).collect();
        let c_flat: Vec<f32> = states.iter().flat_map(|(_, c)| c.iter().copied()).collect();
        Ok(LSTMState {
            h: Tensor::from_slice(&h_flat, (batch, HIDDEN_SIZE), device)?,
            c: Tensor::from_slice(&c_flat, (batch, HIDDEN_SIZE), device)?,
        })
    }
}

// ── Actor-Critic with LSTM ──

/// Actor-Critic network with LSTM backbone for sequential decision making.
///
/// Architecture:
///   Input projection: Linear(OBS_DIM → HIDDEN_SIZE) + ReLU
///   LSTM cell: (input, h, c) → (new_h, new_c)
///   Actor head: Linear(HIDDEN_SIZE → HEAD_HIDDEN) + ReLU → Linear(HEAD_HIDDEN → 7)
///               first 4 dims = Gaussian means for move/look
///               last 3 dims = Bernoulli logits for jump/sprint/fire
///               + learnable log_std [7] (only first 4 dims are used)
///   Weapon head: Linear(HEAD_HIDDEN → 5), only first 3 logits are used
///   Critic head: Linear(HIDDEN_SIZE → HEAD_HIDDEN) + ReLU → Linear(HEAD_HIDDEN → 1)
pub struct ActorCritic {
    // Input projection
    input_proj: Linear,
    // LSTM gates: Linear(HIDDEN_SIZE + HIDDEN_SIZE → 4 * HIDDEN_SIZE)
    // Input is [projected_obs, h] concatenated
    lstm_gates: Linear,
    // Actor
    actor_hidden: Linear,
    actor_params: Linear,
    log_std: Tensor,
    weapon_head: Linear,
    // Critic
    critic_hidden: Linear,
    critic_value: Linear,
    // Storage
    var_map: VarMap,
    device: Device,
}

impl ActorCritic {
    pub fn new(device: &Device) -> CandleResult<Self> {
        let var_map = VarMap::new();
        let vb = VarBuilder::from_varmap(&var_map, DType::F32, device);

        // Input projection: obs → hidden
        let input_proj = linear(OBS_DIM, HIDDEN_SIZE, vb.pp("input_proj"))?;

        // LSTM gates: [projected_input, h] → 4 * HIDDEN_SIZE (i, f, g, o gates)
        let lstm_gates = linear(
            HIDDEN_SIZE + HIDDEN_SIZE,
            4 * HIDDEN_SIZE,
            vb.pp("lstm_gates"),
        )?;

        // Actor
        let actor_hidden = linear(HIDDEN_SIZE, HEAD_HIDDEN, vb.pp("actor_hidden"))?;
        let actor_params = linear(HEAD_HIDDEN, ACTION_PARAM_DIM, vb.pp("actor_mean"))?;
        let log_std = vb.get_with_hints(
            ACTION_PARAM_DIM,
            "actor_log_std",
            candle_nn::Init::Const(-0.5),
        )?;
        let weapon_head = linear(HEAD_HIDDEN, WEAPON_HEAD_DIM, vb.pp("weapon_head"))?;

        // Critic
        let critic_hidden = linear(HIDDEN_SIZE, HEAD_HIDDEN, vb.pp("critic_hidden"))?;
        let critic_value = linear(HEAD_HIDDEN, 1, vb.pp("critic_value"))?;

        if let Some(bias) = actor_params.bias() {
            let bias = Var::from_tensor(bias)?;
            let init = Tensor::from_slice(&INITIAL_ACTION_BIAS, ACTION_PARAM_DIM, device)?;
            bias.set(&init)?;
        }
        if let Some(bias) = weapon_head.bias() {
            let bias = Var::from_tensor(bias)?;
            let init = Tensor::from_slice(&INITIAL_WEAPON_BIAS, WEAPON_HEAD_DIM, device)?;
            bias.set(&init)?;
        }

        Ok(Self {
            input_proj,
            lstm_gates,
            actor_hidden,
            actor_params,
            log_std,
            weapon_head,
            critic_hidden,
            critic_value,
            var_map,
            device: device.clone(),
        })
    }

    /// LSTM cell forward pass.
    ///
    /// input: [batch, HIDDEN_SIZE] (projected observation)
    /// state: LSTMState with h, c each [batch, HIDDEN_SIZE]
    /// Returns new LSTMState.
    fn lstm_forward(&self, input: &Tensor, state: &LSTMState) -> CandleResult<LSTMState> {
        // Concatenate input and h → [batch, 2 * HIDDEN_SIZE]
        let combined = Tensor::cat(&[input, &state.h], 1)?;

        // Compute all 4 gates at once → [batch, 4 * HIDDEN_SIZE]
        let gates = self.lstm_gates.forward(&combined)?;

        // Split into 4 gates, each [batch, HIDDEN_SIZE]
        let chunks = gates.chunk(4, 1)?;
        let i_gate = candle_nn::ops::sigmoid(&chunks[0])?; // input gate
        let f_gate = candle_nn::ops::sigmoid(&chunks[1])?; // forget gate
        let g_gate = chunks[2].tanh()?; // cell candidate
        let o_gate = candle_nn::ops::sigmoid(&chunks[3])?; // output gate

        // New cell state: c' = f * c + i * g
        let new_c = (f_gate.mul(&state.c)? + i_gate.mul(&g_gate)?)?;

        // New hidden state: h' = o * tanh(c')
        let new_h = o_gate.mul(&new_c.tanh()?)?;

        Ok(LSTMState { h: new_h, c: new_c })
    }

    /// Full forward pass: obs + hidden state → outputs + new hidden state.
    ///
    /// obs: [batch, OBS_DIM]
    /// state: LSTMState with h, c each [batch, HIDDEN_SIZE]
    ///
    /// Returns (action_params, log_std, weapon_logits, value, new_state)
    pub fn forward(
        &self,
        obs: &Tensor,
        state: &LSTMState,
    ) -> CandleResult<(Tensor, Tensor, Tensor, Tensor, LSTMState)> {
        // Project input
        let projected = self.input_proj.forward(obs)?.relu()?;

        // LSTM step
        let new_state = self.lstm_forward(&projected, state)?;

        // Actor head (uses new hidden state)
        let actor_h = self.actor_hidden.forward(&new_state.h)?.relu()?;
        let action_params = self.actor_params.forward(&actor_h)?;
        let weapon_logits = self.weapon_head.forward(&actor_h)?;

        // Critic head
        let critic_h = self.critic_hidden.forward(&new_state.h)?.relu()?;
        let value = self.critic_value.forward(&critic_h)?;

        Ok((
            action_params,
            self.log_std.clone(),
            weapon_logits,
            value,
            new_state,
        ))
    }

    /// Sample actions for a batch, given observations and LSTM hidden states.
    ///
    /// Returns (actions, log_probs, values, new_state)
    pub fn sample_actions_batch(
        &self,
        obs: &Tensor,
        state: &LSTMState,
    ) -> CandleResult<(Vec<Vec<f32>>, Vec<f32>, Vec<f32>, LSTMState)> {
        let batch_size = obs.dim(0)?;
        let (action_params, log_std, weapon_logits, value, new_state) = self.forward(obs, state)?;

        let cont_means = action_params.narrow(1, 0, CONTINUOUS_ACTION_DIM)?.tanh()?;
        let binary_logits = action_params.narrow(1, CONTINUOUS_ACTION_DIM, BINARY_ACTION_DIM)?;
        let weapon_logits = weapon_logits.narrow(1, 0, POLICY_WEAPON_DIM)?;
        let log_std = log_std.narrow(0, 0, CONTINUOUS_ACTION_DIM)?;

        let cont_means_all: Vec<Vec<f32>> = cont_means.to_vec2()?;
        let binary_logits_all: Vec<Vec<f32>> = binary_logits.to_vec2()?;
        let weapon_logits_all: Vec<Vec<f32>> = weapon_logits.to_vec2()?;
        let log_std_vec: Vec<f32> = log_std.to_vec1()?;
        let std_vec: Vec<f32> = log_std_vec.iter().map(|&v| v.exp()).collect();

        let mut rng = rand::thread_rng();
        let mut actions = Vec::with_capacity(batch_size);
        let mut log_probs = Vec::with_capacity(batch_size);

        for i in 0..batch_size {
            let mut action = Vec::with_capacity(ACTION_PARAM_DIM + 1);
            let mut total_log_prob = 0.0f32;

            for dim in 0..CONTINUOUS_ACTION_DIM {
                let mean = cont_means_all[i][dim];
                let std = std_vec[dim];
                let mut sampled = mean + std * sample_standard_normal(&mut rng);
                if dim < CONTINUOUS_ACTION_DIM {
                    sampled = sampled.clamp(-1.0, 1.0);
                }
                total_log_prob += gaussian_log_prob(sampled, mean, log_std_vec[dim], std);
                action.push(sampled);
            }

            for logit in &binary_logits_all[i] {
                let prob = sigmoid(*logit).clamp(1e-6, 1.0 - 1e-6);
                let sampled = if rng.gen::<f32>() < prob { 1.0 } else { 0.0 };
                total_log_prob += if sampled > 0.5 {
                    prob.ln()
                } else {
                    (1.0 - prob).ln()
                };
                action.push(sampled);
            }

            let weapon_probs = softmax_vec(&weapon_logits_all[i]);
            let weapon_choice = sample_categorical(&weapon_probs, &mut rng);
            total_log_prob += weapon_probs[weapon_choice].max(1e-8).ln();
            action.push(POLICY_WEAPON_INDICES[weapon_choice] as f32);

            actions.push(action);
            log_probs.push(total_log_prob);
        }

        let values: Vec<f32> = value.squeeze(1)?.to_vec1()?;
        Ok((actions, log_probs, values, new_state))
    }

    /// Evaluate actions under current policy with stored hidden states.
    ///
    /// obs: [batch, OBS_DIM]
    /// actions: [batch, CONTINUOUS_ACTION_DIM]
    /// weapon_indices: [batch] u32
    /// state: LSTMState for this batch (stored from collection time)
    pub fn evaluate_actions(
        &self,
        obs: &Tensor,
        actions: &Tensor,
        weapon_indices: &Tensor,
        state: &LSTMState,
    ) -> CandleResult<(Tensor, Tensor, Tensor)> {
        let (action_params, log_std, weapon_logits, value, _new_state) =
            self.forward(obs, state)?;
        let batch_size = obs.dim(0)?;

        let cont_means = action_params.narrow(1, 0, CONTINUOUS_ACTION_DIM)?.tanh()?;
        let binary_logits = action_params.narrow(1, CONTINUOUS_ACTION_DIM, BINARY_ACTION_DIM)?;
        let cont_actions = actions.narrow(1, 0, CONTINUOUS_ACTION_DIM)?;
        let binary_actions = actions.narrow(1, CONTINUOUS_ACTION_DIM, BINARY_ACTION_DIM)?;

        // Continuous log prob
        let std = log_std
            .exp()?
            .unsqueeze(0)?
            .narrow(1, 0, CONTINUOUS_ACTION_DIM)?
            .broadcast_as((batch_size, CONTINUOUS_ACTION_DIM))?;
        let log_std_broad = log_std
            .narrow(0, 0, CONTINUOUS_ACTION_DIM)?
            .unsqueeze(0)?
            .broadcast_as((batch_size, CONTINUOUS_ACTION_DIM))?;
        let diff = (&cont_actions - &cont_means)?;
        let normalized = diff.div(&std)?;
        let log2pi = (2.0_f64 * std::f64::consts::PI).ln() as f32;
        let log_prob_per_dim = (normalized.sqr()?.affine(-0.5, 0.0)? - log_std_broad)?
            .broadcast_sub(&Tensor::new(&[0.5 * log2pi], &self.device)?)?;
        let log_prob_continuous = log_prob_per_dim.sum(D::Minus1)?;

        // Bernoulli log prob / entropy for jump, sprint, fire.
        let one = Tensor::ones((batch_size, BINARY_ACTION_DIM), DType::F32, &self.device)?;
        let binary_probs = candle_nn::ops::sigmoid(&binary_logits)?.clamp(1e-6, 1.0 - 1e-6)?;
        let binary_log_probs = ((&binary_actions * &binary_probs.log()?)?
            + ((&one - &binary_actions)? * (&one - &binary_probs)?.log()?)?)?
        .sum(D::Minus1)?;
        let binary_entropy = ((&binary_probs * &binary_probs.log()?)?
            + ((&one - &binary_probs)? * (&one - &binary_probs)?.log()?)?)?
        .neg()?
        .sum(D::Minus1)?
        .mean_all()?;

        // Continuous entropy.
        let half_ln2pie = 0.5 * (2.0_f64 * std::f64::consts::PI * std::f64::consts::E).ln();
        let continuous_entropy = log_std
            .narrow(0, 0, CONTINUOUS_ACTION_DIM)?
            .sum_all()?
            .to_scalar::<f32>()? as f64
            + half_ln2pie * CONTINUOUS_ACTION_DIM as f64;

        // Weapon log prob
        let weapon_logits = weapon_logits.narrow(1, 0, POLICY_WEAPON_DIM)?;
        let weapon_log_probs = candle_nn::ops::log_softmax(&weapon_logits, D::Minus1)?;
        let weapon_indices_2d = weapon_indices.unsqueeze(1)?;
        let weapon_lp = weapon_log_probs.gather(&weapon_indices_2d, 1)?.squeeze(1)?;

        // Weapon entropy
        let weapon_probs = candle_nn::ops::softmax(&weapon_logits, D::Minus1)?;
        let weapon_entropy_per_sample =
            weapon_probs.mul(&weapon_log_probs)?.neg()?.sum(D::Minus1)?;
        let weapon_entropy: f64 = weapon_entropy_per_sample.mean_all()?.to_scalar::<f32>()? as f64;

        let total_log_prob = ((log_prob_continuous + binary_log_probs)? + weapon_lp)?;
        let total_entropy = Tensor::new(
            (continuous_entropy + binary_entropy.to_scalar::<f32>()? as f64 + weapon_entropy)
                as f32,
            &self.device,
        )?;
        let value_squeezed = value.squeeze(1)?;

        Ok((total_log_prob, value_squeezed, total_entropy))
    }

    #[allow(dead_code)]
    pub fn save<P: AsRef<Path>>(&self, path: P) -> CandleResult<()> {
        self.var_map.save(path.as_ref())?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn load<P: AsRef<Path>>(&mut self, path: P) -> CandleResult<()> {
        self.var_map.load(path.as_ref())?;
        Ok(())
    }

    pub fn var_map(&self) -> &VarMap {
        &self.var_map
    }

    #[allow(dead_code)]
    pub fn device(&self) -> &Device {
        &self.device
    }
}

fn sample_categorical<R: rand::Rng + ?Sized>(probs: &[f32], rng: &mut R) -> usize {
    let rng_val: f32 = rng.gen();
    let mut cumulative = 0.0;
    for (i, &p) in probs.iter().enumerate() {
        cumulative += p;
        if rng_val <= cumulative {
            return i;
        }
    }
    probs.len() - 1
}

fn softmax_vec(logits: &[f32]) -> Vec<f32> {
    let max_logit = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|v| (*v - max_logit).exp()).collect();
    let sum = exps.iter().sum::<f32>().max(1e-8);
    exps.into_iter().map(|v| v / sum).collect()
}

fn sigmoid(v: f32) -> f32 {
    1.0 / (1.0 + (-v).exp())
}

fn gaussian_log_prob(action: f32, mean: f32, log_std: f32, std: f32) -> f32 {
    let normalized = (action - mean) / std.max(1e-6);
    let log2pi = (2.0_f32 * std::f32::consts::PI).ln();
    -0.5 * normalized * normalized - log_std - 0.5 * log2pi
}

fn sample_standard_normal<R: rand::Rng + ?Sized>(rng: &mut R) -> f32 {
    let u1 = (1.0 - rng.gen::<f32>()).clamp(1e-7, 1.0);
    let u2 = rng.gen::<f32>();
    (-2.0 * u1.ln()).sqrt() * (2.0 * std::f32::consts::PI * u2).cos()
}
