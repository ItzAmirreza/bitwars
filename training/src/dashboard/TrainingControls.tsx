import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface TrainingStats {
  episode: number;
  total_steps: number;
  mean_reward: number;
  mean_episode_length: number;
  steps_per_sec: number;
  elapsed_secs: number;
  success_rate: number;
  timeout_rate: number;
  stall_rate: number;
  rpg_usage_rate: number;
  block_destroy_rate: number;
  policy_loss: number;
  value_loss: number;
  entropy: number;
  approx_kl: number;
  explained_variance: number;
  current_task: string;
  device: string;
}

interface TrainingConfigView {
  lr: number;
  gamma: number;
  entropy_coeff: number;
  num_envs: number;
  rollout_length: number;
  seed: number;
}

const panelStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '3px solid #3a3a3a',
  padding: 16,
  fontFamily: 'var(--font-mono)',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-pixel)',
  fontSize: 8,
  color: '#888',
  textTransform: 'uppercase' as const,
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 18,
  color: '#00ff88',
  fontWeight: 700,
};

const buttonStyle = (active: boolean, color: string): React.CSSProperties => ({
  background: active ? color : '#2a2a2a',
  color: active ? '#0a0a0a' : '#888',
  border: `2px solid ${active ? color : '#3a3a3a'}`,
  padding: '8px 20px',
  fontFamily: 'var(--font-pixel)',
  fontSize: 9,
  cursor: 'pointer',
  textTransform: 'uppercase' as const,
});

interface TrainingStatusResponse {
  is_running: boolean;
  is_paused: boolean;
}

export default function TrainingControls() {
  const [status, setStatus] = useState<'stopped' | 'running' | 'paused'>('stopped');
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [numEnvs, setNumEnvs] = useState(32);
  const [lr, setLr] = useState(0.00025);
  const [entropyCoeff, setEntropyCoeff] = useState(0.004);
  const [gamma, setGamma] = useState(0.995);
  const [rolloutLength, setRolloutLength] = useState(256);

  // Query backend for actual training status on mount (fixes state loss on tab switch)
  useEffect(() => {
    const syncBackendState = async () => {
      try {
        const config = await invoke<TrainingConfigView>('get_training_config');
        setNumEnvs(config.num_envs);
        setLr(config.lr);
        setEntropyCoeff(config.entropy_coeff);
        setGamma(config.gamma);
        setRolloutLength(config.rollout_length);
      } catch { /* ignore */ }

      try {
        const s = await invoke<TrainingStatusResponse>('get_training_status');
        if (s.is_running && s.is_paused) setStatus('paused');
        else if (s.is_running) setStatus('running');
        else setStatus('stopped');
      } catch { /* ignore */ }
    };
    syncBackendState();
  }, []);

  const inFlightRef = useRef(false);

  const pollStats = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const s = await invoke<TrainingStatusResponse>('get_training_status');
      if (s.is_running && s.is_paused) setStatus('paused');
      else if (s.is_running) setStatus('running');
      else setStatus('stopped');
    } catch { /* ignore */ }

    try {
      const s = await invoke<TrainingStats>('get_training_stats');
      setStats(normalizeTrainingStats(s));
    } catch { /* ignore */ }
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    const interval = setInterval(pollStats, 2000);
    return () => clearInterval(interval);
  }, [pollStats]);

  const handleApplySettings = async () => {
    await invoke('update_hyperparams', {
      params: {
        lr,
        gamma,
        entropy_coeff: entropyCoeff,
        num_envs: numEnvs,
        rollout_length: rolloutLength,
      },
    });
  };

  const handleStart = async () => {
    try {
      await handleApplySettings();
      await invoke('start_training');
      setStatus('running');
    } catch (e) {
      console.error(e);
    }
  };

  const handlePause = async () => {
    try {
      await invoke('pause_training');
      setStatus('paused');
    } catch (e) {
      console.error(e);
    }
  };

  const handleResume = async () => {
    try {
      await invoke('resume_training');
      setStatus('running');
    } catch (e) {
      console.error(e);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('stop_training');
      setStatus('stopped');
      setStats(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveCheckpoint = async () => {
    try {
      await invoke('save_checkpoint_now');
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return `${h}h ${m}m ${s}s`;
  };

  const renderMetric = (value: number, digits = 0) => (
    Number.isFinite(value) ? value.toFixed(digits) : '--'
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Status + Controls */}
      <div style={panelStyle}>
        <div style={{ ...labelStyle, marginBottom: 12 }}>TRAINING CONTROLS</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {status === 'stopped' && (
            <button onClick={handleStart} style={buttonStyle(true, '#00ff88')}>
              START
            </button>
          )}
          {status === 'running' && (
            <button onClick={handlePause} style={buttonStyle(true, '#ffaa00')}>
              PAUSE
            </button>
          )}
          {status === 'paused' && (
            <button onClick={handleResume} style={buttonStyle(true, '#00ff88')}>
              RESUME
            </button>
          )}
          {status !== 'stopped' && (
            <button onClick={handleStop} style={buttonStyle(true, '#ff4444')}>
              STOP
            </button>
          )}
          {status !== 'stopped' && (
            <button onClick={handleSaveCheckpoint} style={buttonStyle(false, '#4488ff')}>
              SAVE CHECKPOINT
            </button>
          )}
        </div>

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8,
            height: 8,
            background: status === 'running' ? '#00ff88' : status === 'paused' ? '#ffaa00' : '#ff4444',
            boxShadow: `0 0 8px ${status === 'running' ? '#00ff88' : status === 'paused' ? '#ffaa00' : '#ff4444'}`,
          }} />
          <span style={{ fontFamily: 'var(--font-pixel)', fontSize: 9, color: '#e0e0e0' }}>
            {status.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Live Stats */}
      {stats && (
        <div style={panelStyle}>
          <div style={{ ...labelStyle, marginBottom: 12 }}>LIVE STATS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={labelStyle}>EPISODE</div>
              <div style={valueStyle}>{stats.episode.toLocaleString()}</div>
            </div>
            <div>
              <div style={labelStyle}>TOTAL STEPS</div>
              <div style={valueStyle}>{stats.total_steps.toLocaleString()}</div>
            </div>
            <div>
              <div style={labelStyle}>MEAN REWARD</div>
              <div style={{ ...valueStyle, color: stats.mean_reward > 0 ? '#00ff88' : '#ff4444' }}>
                {renderMetric(stats.mean_reward, 1)}
              </div>
            </div>
            <div>
              <div style={labelStyle}>EP LENGTH</div>
              <div style={valueStyle}>{renderMetric(stats.mean_episode_length, 0)}</div>
            </div>
            <div>
              <div style={labelStyle}>TASK</div>
              <div style={{ ...valueStyle, fontSize: 14, color: '#88ddff' }}>
                {stats.current_task || 'pending'}
              </div>
            </div>
            <div>
              <div style={labelStyle}>STEPS/SEC</div>
              <div style={valueStyle}>{renderMetric(stats.steps_per_sec, 0)}</div>
            </div>
            <div>
              <div style={labelStyle}>ELAPSED</div>
              <div style={valueStyle}>{formatTime(stats.elapsed_secs)}</div>
            </div>
            <div>
              <div style={labelStyle}>SUCCESS</div>
              <div style={valueStyle}>{renderMetric(stats.success_rate * 100, 0)}%</div>
            </div>
            <div>
              <div style={labelStyle}>TIMEOUT</div>
              <div style={{ ...valueStyle, color: '#ffaa00' }}>{renderMetric(stats.timeout_rate * 100, 0)}%</div>
            </div>
            <div>
              <div style={labelStyle}>STALL</div>
              <div style={{ ...valueStyle, color: '#ff6666' }}>{renderMetric(stats.stall_rate * 100, 0)}%</div>
            </div>
            <div>
              <div style={labelStyle}>RPG USE</div>
              <div style={valueStyle}>{renderMetric(stats.rpg_usage_rate * 100, 1)}%</div>
            </div>
            <div>
              <div style={labelStyle}>BLOCKS/EP</div>
              <div style={valueStyle}>{renderMetric(stats.block_destroy_rate, 1)}</div>
            </div>
            <div>
              <div style={labelStyle}>KL</div>
              <div style={valueStyle}>{renderMetric(stats.approx_kl, 4)}</div>
            </div>
            <div>
              <div style={labelStyle}>ENTROPY</div>
              <div style={valueStyle}>{renderMetric(stats.entropy, 2)}</div>
            </div>
            <div>
              <div style={labelStyle}>EXPLAINED VAR</div>
              <div style={valueStyle}>{renderMetric(stats.explained_variance, 2)}</div>
            </div>
            <div>
              <div style={labelStyle}>DEVICE</div>
              <div style={{ ...valueStyle, fontSize: 13 }}>{stats.device || 'pending'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Hyperparameters */}
      <div style={panelStyle}>
        <div style={{ ...labelStyle, marginBottom: 12 }}>HYPERPARAMETERS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={labelStyle}>ENVIRONMENTS</div>
            <input
              type="number"
              value={numEnvs}
              onChange={(e) => setNumEnvs(parseInt(e.target.value) || 1)}
              min={1}
              max={128}
              disabled={status !== 'stopped'}
              style={{
                background: '#0a0a0a',
                border: '2px solid #3a3a3a',
                color: '#e0e0e0',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                width: '100%',
              }}
            />
          </div>
          <div>
            <div style={labelStyle}>ROLLOUT</div>
            <input
              type="number"
              value={rolloutLength}
              onChange={(e) => setRolloutLength(parseInt(e.target.value) || 256)}
              min={64}
              max={2048}
              step={64}
              disabled={status !== 'stopped'}
              style={{
                background: '#0a0a0a',
                border: '2px solid #3a3a3a',
                color: '#e0e0e0',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                width: '100%',
              }}
            />
          </div>
          <div>
            <div style={labelStyle}>LEARNING RATE</div>
            <input
              type="number"
              value={lr}
              onChange={(e) => setLr(parseFloat(e.target.value) || 0.00025)}
              step={0.00001}
              style={{
                background: '#0a0a0a',
                border: '2px solid #3a3a3a',
                color: '#e0e0e0',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                width: '100%',
              }}
            />
          </div>
          <div>
            <div style={labelStyle}>ENTROPY COEFF</div>
            <input
              type="number"
              value={entropyCoeff}
              onChange={(e) => setEntropyCoeff(parseFloat(e.target.value) || 0.004)}
              step={0.001}
              style={{
                background: '#0a0a0a',
                border: '2px solid #3a3a3a',
                color: '#e0e0e0',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                width: '100%',
              }}
            />
          </div>
          <div>
            <div style={labelStyle}>DISCOUNT (GAMMA)</div>
            <input
              type="number"
              value={gamma}
              onChange={(e) => setGamma(parseFloat(e.target.value) || 0.995)}
              step={0.001}
              min={0}
              max={1}
              style={{
                background: '#0a0a0a',
                border: '2px solid #3a3a3a',
                color: '#e0e0e0',
                padding: '4px 8px',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                width: '100%',
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#777' }}>
            Defaults are backend-selected for this machine.
          </div>
          <button
            onClick={handleApplySettings}
            style={buttonStyle(true, '#4488ff')}
          >
            APPLY
          </button>
        </div>
      </div>
    </div>
  );
}

function normalizeTrainingStats(raw: TrainingStats): TrainingStats {
  return {
    episode: coerceFinite(raw.episode, 0),
    total_steps: coerceFinite(raw.total_steps, 0),
    mean_reward: coerceFinite(raw.mean_reward, 0),
    mean_episode_length: coerceFinite(raw.mean_episode_length, 0),
    steps_per_sec: coerceFinite(raw.steps_per_sec, 0),
    elapsed_secs: coerceFinite(raw.elapsed_secs, 0),
    success_rate: clamp01(coerceFinite(raw.success_rate, 0)),
    timeout_rate: clamp01(coerceFinite(raw.timeout_rate, 0)),
    stall_rate: clamp01(coerceFinite(raw.stall_rate, 0)),
    rpg_usage_rate: clamp01(coerceFinite(raw.rpg_usage_rate, 0)),
    block_destroy_rate: coerceFinite(raw.block_destroy_rate, 0),
    policy_loss: coerceFinite(raw.policy_loss, 0),
    value_loss: coerceFinite(raw.value_loss, 0),
    entropy: coerceFinite(raw.entropy, 0),
    approx_kl: coerceFinite(raw.approx_kl, 0),
    explained_variance: coerceFinite(raw.explained_variance, 0),
    current_task: typeof raw.current_task === 'string' ? raw.current_task : '',
    device: typeof raw.device === 'string' ? raw.device : 'unknown',
  };
}

function coerceFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
