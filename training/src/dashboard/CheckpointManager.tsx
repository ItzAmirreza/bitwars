import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface CheckpointInfo {
  path: string;
  episode: number;
  mean_reward: number;
  mean_episode_length: number;
  timestamp: string;
  file_size_bytes: number;
}

const panelStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '3px solid #3a3a3a',
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-pixel)',
  fontSize: 8,
  color: '#888',
  textTransform: 'uppercase' as const,
  marginBottom: 8,
};

export default function CheckpointManager() {
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [sortBy, setSortBy] = useState<'episode' | 'reward'>('episode');

  const fetchCheckpoints = useCallback(async () => {
    try {
      const list = await invoke<CheckpointInfo[]>('list_checkpoints');
      setCheckpoints(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchCheckpoints, 5000);
    fetchCheckpoints();
    return () => clearInterval(interval);
  }, [fetchCheckpoints]);

  const sorted = [...checkpoints].sort((a, b) =>
    sortBy === 'episode' ? b.episode - a.episode : b.mean_reward - a.mean_reward,
  );

  const bestReward = checkpoints.reduce(
    (max, c) => Math.max(max, c.mean_reward),
    -Infinity,
  );

  const handleLoad = async (path: string) => {
    try {
      await invoke('load_checkpoint', { path });
    } catch (e) {
      console.error(e);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={labelStyle}>CHECKPOINTS ({checkpoints.length})</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['episode', 'reward'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              style={{
                background: sortBy === s ? '#4488ff' : '#2a2a2a',
                color: sortBy === s ? '#0a0a0a' : '#888',
                border: `2px solid ${sortBy === s ? '#4488ff' : '#3a3a3a'}`,
                padding: '2px 8px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 7,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {sorted.length === 0 && (
          <div style={{ color: '#555', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            No checkpoints yet
          </div>
        )}
        {sorted.map((cp) => (
          <div
            key={cp.path}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderBottom: '1px solid #2a2a2a',
              background: cp.mean_reward === bestReward && checkpoints.length > 1 ? '#1a2a1a' : 'transparent',
            }}
          >
            {cp.mean_reward === bestReward && checkpoints.length > 1 && (
              <span style={{ color: '#00ff88', fontFamily: 'var(--font-pixel)', fontSize: 7 }}>BEST</span>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#e0e0e0' }}>
                EP {cp.episode.toLocaleString()} | R: {cp.mean_reward.toFixed(1)} | L: {cp.mean_episode_length.toFixed(0)}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#555' }}>
                {cp.timestamp} | {formatSize(cp.file_size_bytes)}
              </div>
            </div>
            <button
              onClick={() => handleLoad(cp.path)}
              style={{
                background: '#2a2a2a',
                color: '#4488ff',
                border: '2px solid #3a3a3a',
                padding: '2px 8px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 7,
                cursor: 'pointer',
              }}
            >
              LOAD
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
