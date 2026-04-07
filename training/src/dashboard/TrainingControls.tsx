import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface TrainingStats {
  episode: number;
  total_steps: number;
  mean_reward: number;
  mean_episode_length: number;
  steps_per_sec: number;
  elapsed_secs: number;
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
  const [numEnvs, setNumEnvs] = useState(64);
  const [lr, setLr] = useState(0.0003);
  const [entropyCoeff, setEntropyCoeff] = useState(0.01);
  const [gamma, setGamma] = useState(0.99);

  // Query backend for actual training status on mount (fixes state loss on tab switch)
  useEffect(() => {
    const syncStatus = async () => {
      try {
        const s = await invoke<TrainingStatusResponse>('get_training_status');
        if (s.is_running && s.is_paused) setStatus('paused');
        else if (s.is_running) setStatus('running');
        else setStatus('stopped');
      } catch { /* ignore */ }
    };
    syncStatus();
  }, []);

  const pollStats = useCallback(async () => {
    // Always poll — sync status from backend too
    try {
      const s = await invoke<TrainingStatusResponse>('get_training_status');
      if (s.is_running && s.is_paused) setStatus('paused');
      else if (s.is_running) setStatus('running');
      else setStatus('stopped');
    } catch { /* ignore */ }

    try {
      const s = await invoke<TrainingStats>('get_training_stats');
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const interval = setInterval(pollStats, 1000);
    return () => clearInterval(interval);
  }, [pollStats]);

  const handleStart = async () => {
    try {
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
                {stats.mean_reward.toFixed(1)}
              </div>
            </div>
            <div>
              <div style={labelStyle}>EP LENGTH</div>
              <div style={valueStyle}>{stats.mean_episode_length.toFixed(0)}</div>
            </div>
            <div>
              <div style={labelStyle}>STEPS/SEC</div>
              <div style={valueStyle}>{stats.steps_per_sec.toFixed(0)}</div>
            </div>
            <div>
              <div style={labelStyle}>ELAPSED</div>
              <div style={valueStyle}>{formatTime(stats.elapsed_secs)}</div>
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
            <div style={labelStyle}>LEARNING RATE</div>
            <input
              type="number"
              value={lr}
              onChange={(e) => setLr(parseFloat(e.target.value) || 0.0003)}
              step={0.0001}
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
              onChange={(e) => setEntropyCoeff(parseFloat(e.target.value) || 0.01)}
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
              onChange={(e) => setGamma(parseFloat(e.target.value) || 0.99)}
              step={0.01}
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
      </div>
    </div>
  );
}
