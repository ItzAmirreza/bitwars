use candle_core::{DType, Device, Result as CandleResult, Tensor, D};
use candle_nn::{linear, Linear, Module, VarBuilder, VarMap};
use std::path::Path;

/// Observation space dimension (matches sim::environment::OBSERVATION_DIM).
pub const OBS_DIM: usize = 103;
/// Continuous action dimension (move_dir x2, look_dir x2, jump, sprint, fire).
pub const CONTINUOUS_ACTION_DIM: usize = 7;
/// Discrete weapon count (grenade launcher excluded).
pub const NUM_WEAPONS: usize = 5;
/// LSTM hidden size.
pub const HIDDEN_SIZE: usize = 256;
/// Actor/critic head hidden size.
const HEAD_HIDDEN: usize = 128;

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

    /// Convert to flat f32 vectors for storage in the rollout buffer.
    /// Returns (h_vec, c_vec) each of length HIDDEN_SIZE (for batch index 0).
    pub fn to_vecs(&self, index: usize) -> CandleResult<(Vec<f32>, Vec<f32>)> {
        let h: Vec<f32> = self.h.get(index)?.to_vec1()?;
        let c: Vec<f32> = self.c.get(index)?.to_vec1()?;
        Ok((h, c))
    }

    /// Create from flat f32 vectors (single sample, unsqueezed to [1, HIDDEN_SIZE]).
    pub fn from_vecs(h: &[f32], c: &[f32], device: &Device) -> CandleResult<Self> {
        Ok(LSTMState {
            h: Tensor::from_slice(h, (1, HIDDEN_SIZE), device)?,
            c: Tensor::from_slice(c, (1, HIDDEN_SIZE), device)?,
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
///   Actor head: Linear(HIDDEN_SIZE → HEAD_HIDDEN) + ReLU → Linear(HEAD_HIDDEN → 8) + Tanh
///               + learnable log_std [8]
///   Weapon head: Linear(HEAD_HIDDEN → 6)
///   Critic head: Linear(HIDDEN_SIZE → HEAD_HIDDEN) + ReLU → Linear(HEAD_HIDDEN → 1)
pub struct ActorCritic {
    // Input projection
    input_proj: Linear,
    // LSTM gates: Linear(HIDDEN_SIZE + HIDDEN_SIZE → 4 * HIDDEN_SIZE)
    // Input is [projected_obs, h] concatenated
    lstm_gates: Linear,
    // Actor
    actor_hidden: Linear,
    actor_mean: Linear,
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
        let lstm_gates = linear(HIDDEN_SIZE + HIDDEN_SIZE, 4 * HIDDEN_SIZE, vb.pp("lstm_gates"))?;

        // Actor
        let actor_hidden = linear(HIDDEN_SIZE, HEAD_HIDDEN, vb.pp("actor_hidden"))?;
        let actor_mean = linear(HEAD_HIDDEN, CONTINUOUS_ACTION_DIM, vb.pp("actor_mean"))?;
        let log_std = vb.get_with_hints(
            CONTINUOUS_ACTION_DIM,
            "actor_log_std",
            candle_nn::Init::Const(-0.5),
        )?;
        let weapon_head = linear(HEAD_HIDDEN, NUM_WEAPONS, vb.pp("weapon_head"))?;

        // Critic
        let critic_hidden = linear(HIDDEN_SIZE, HEAD_HIDDEN, vb.pp("critic_hidden"))?;
        let critic_value = linear(HEAD_HIDDEN, 1, vb.pp("critic_value"))?;

        Ok(Self {
            input_proj,
            lstm_gates,
            actor_hidden,
            actor_mean,
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
        let g_gate = chunks[2].tanh()?;                     // cell candidate
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
    /// Returns (action_mean, log_std, weapon_logits, value, new_state)
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
        let action_mean = self.actor_mean.forward(&actor_h)?.tanh()?;
        let weapon_logits = self.weapon_head.forward(&actor_h)?;

        // Critic head
        let critic_h = self.critic_hidden.forward(&new_state.h)?.relu()?;
        let value = self.critic_value.forward(&critic_h)?;

        Ok((action_mean, self.log_std.clone(), weapon_logits, value, new_state))
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
        let (action_mean, log_std, weapon_logits, value, new_state) = self.forward(obs, state)?;

        // Broadcast std
        let std = log_std.exp()?;
        let std_broad = std
            .unsqueeze(0)?
            .broadcast_as((batch_size, CONTINUOUS_ACTION_DIM))?
            .contiguous()?;
        let log_std_broad = log_std
            .unsqueeze(0)?
            .broadcast_as((batch_size, CONTINUOUS_ACTION_DIM))?
            .contiguous()?;

        // Sample continuous actions
        let noise = Tensor::randn(0f32, 1., (batch_size, CONTINUOUS_ACTION_DIM), &self.device)?;
        let continuous_actions = (noise.mul(&std_broad)? + &action_mean)?;

        // Log prob (continuous)
        let diff = (&continuous_actions - &action_mean)?;
        let normalized = diff.div(&std_broad)?;
        let log2pi = (2.0_f64 * std::f64::consts::PI).ln() as f32;
        let log_prob_per_dim = (normalized.sqr()?.affine(-0.5, 0.0)? - &log_std_broad)?
            .broadcast_sub(&Tensor::new(&[0.5 * log2pi], &self.device)?)?;
        let log_prob_continuous = log_prob_per_dim.sum(D::Minus1)?;

        // Sample weapon (categorical)
        let weapon_probs = candle_nn::ops::softmax(&weapon_logits, D::Minus1)?;
        let weapon_probs_all: Vec<Vec<f32>> = (0..batch_size)
            .map(|i| weapon_probs.get(i).and_then(|r| r.to_vec1())
                .unwrap_or_else(|_| vec![1.0 / NUM_WEAPONS as f32; NUM_WEAPONS]))
            .collect();

        let mut weapon_indices = Vec::with_capacity(batch_size);
        let mut weapon_log_probs = Vec::with_capacity(batch_size);
        for probs in &weapon_probs_all {
            let idx = sample_categorical(probs);
            weapon_indices.push(idx);
            weapon_log_probs.push(probs[idx].max(1e-8).ln());
        }

        // Total log prob
        let log_prob_cont: Vec<f32> = log_prob_continuous.to_vec1()?;
        let total_log_probs: Vec<f32> = log_prob_cont.iter()
            .zip(weapon_log_probs.iter())
            .map(|(c, w)| c + w)
            .collect();

        // Values
        let values: Vec<f32> = value.squeeze(1)?.to_vec1()?;

        // Build action vecs
        let cont_actions: Vec<Vec<f32>> = (0..batch_size)
            .map(|i| {
                let mut a: Vec<f32> = continuous_actions.get(i)
                    .and_then(|r| r.to_vec1())
                    .unwrap_or_else(|_| vec![0.0; CONTINUOUS_ACTION_DIM]);
                a.push(weapon_indices[i] as f32);
                a
            })
            .collect();

        Ok((cont_actions, total_log_probs, values, new_state))
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
        let (action_mean, log_std, weapon_logits, value, _new_state) =
            self.forward(obs, state)?;
        let batch_size = obs.dim(0)?;

        // Continuous log prob
        let std = log_std.exp()?.unsqueeze(0)?
            .broadcast_as((batch_size, CONTINUOUS_ACTION_DIM))?;
        let diff = (actions - &action_mean)?;
        let normalized = diff.div(&std)?;
        let log2pi = (2.0_f64 * std::f64::consts::PI).ln() as f32;
        let log_prob_per_dim = (normalized.sqr()?.affine(-0.5, 0.0)? - std.log()?)?
            .broadcast_sub(&Tensor::new(&[0.5 * log2pi], &self.device)?)?;
        let log_prob_continuous = log_prob_per_dim.sum(D::Minus1)?;

        // Continuous entropy
        let half_ln2pie = 0.5 * (2.0_f64 * std::f64::consts::PI * std::f64::consts::E).ln();
        let continuous_entropy = log_std.sum_all()?.to_scalar::<f32>()? as f64
            + half_ln2pie * CONTINUOUS_ACTION_DIM as f64;

        // Weapon log prob
        let weapon_log_probs = candle_nn::ops::log_softmax(&weapon_logits, D::Minus1)?;
        let weapon_indices_2d = weapon_indices.unsqueeze(1)?;
        let weapon_lp = weapon_log_probs.gather(&weapon_indices_2d, 1)?.squeeze(1)?;

        // Weapon entropy
        let weapon_probs = candle_nn::ops::softmax(&weapon_logits, D::Minus1)?;
        let weapon_entropy_per_sample = weapon_probs.mul(&weapon_log_probs)?.neg()?.sum(D::Minus1)?;
        let weapon_entropy: f64 = weapon_entropy_per_sample.mean_all()?.to_scalar::<f32>()? as f64;

        let total_log_prob = (log_prob_continuous + weapon_lp)?;
        let total_entropy = Tensor::new(
            (continuous_entropy + weapon_entropy) as f32,
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

fn sample_categorical(probs: &[f32]) -> usize {
    use rand::Rng;
    let mut rng = rand::thread_rng();
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
