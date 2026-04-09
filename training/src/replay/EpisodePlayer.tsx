import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ReplayFrame {
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  action: number[];
  weapon: number;
  health: number;
  reward: number;
  on_ground: boolean;
  blocks_destroyed: number;
}

interface EpisodeRecording {
  frames: ReplayFrame[];
  total_reward: number;
  episode_length: number;
  spawn_pos: [number, number, number];
  target_pos: [number, number, number];
  strategies_detected: string[];
  timestamp: string;
}

interface EpisodeListItem {
  timestamp: string;
  total_reward: number;
  episode_length: number;
  strategies_detected: string[];
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
  marginBottom: 4,
};

export default function EpisodePlayer() {
  const [episodes, setEpisodes] = useState<EpisodeListItem[]>([]);
  const [selectedTimestamp, setSelectedTimestamp] = useState<string | null>(null);
  const [recording, setRecording] = useState<EpisodeRecording | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [actionStatus, setActionStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Poll only lightweight metadata — no frame data
  const fetchEpisodeList = useCallback(async () => {
    try {
      const list = await invoke<EpisodeListItem[]>('get_episode_list');
      setEpisodes(list);
      // If the selected recording was deleted on the backend, clear it
      if (selectedTimestamp !== null && !list.some((ep) => ep.timestamp === selectedTimestamp)) {
        setSelectedTimestamp(null);
        setRecording(null);
        setFrameIdx(0);
        setIsPlaying(false);
      }
    } catch {
      /* ignore */
    }
  }, [selectedTimestamp]);

  useEffect(() => {
    const interval = setInterval(fetchEpisodeList, 2000);
    fetchEpisodeList();
    return () => clearInterval(interval);
  }, [fetchEpisodeList]);

  // Fetch full frame data only when a replay is selected
  const fetchFullRecording = useCallback(async (timestamp: string) => {
    try {
      const raw = await invoke<string>('get_episode_replay', { timestamp });
      const parsed = JSON.parse(raw) as EpisodeRecording;
      setRecording(parsed);
    } catch {
      setRecording(null);
      setSelectedTimestamp(null);
    }
  }, []);

  // Playback loop
  useEffect(() => {
    if (!isPlaying || !recording) return;

    const step = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      const elapsed = (time - lastTimeRef.current) / 1000;

      if (elapsed >= (1 / 30) / playbackSpeed) {
        lastTimeRef.current = time;
        setFrameIdx((prev) => {
          const next = prev + 1;
          if (next >= recording.frames.length) {
            setIsPlaying(false);
            return recording.frames.length - 1;
          }
          return next;
        });
      }
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, recording, playbackSpeed]);

  const frame = recording?.frames[frameIdx];

  const showActionStatus = (msg: string, ok: boolean) => {
    setActionStatus({ msg, ok });
    window.setTimeout(() => setActionStatus(null), 3000);
  };

  const handleDeleteReplay = async (timestamp: string) => {
    try {
      const msg = await invoke<string>('delete_replay', { timestamp });
      if (selectedTimestamp === timestamp) {
        setSelectedTimestamp(null);
        setRecording(null);
        setFrameIdx(0);
        setIsPlaying(false);
      }
      showActionStatus(msg, true);
      await fetchEpisodeList();
    } catch (e) {
      showActionStatus(String(e), false);
    }
  };

  const handleClearReplays = async () => {
    try {
      const msg = await invoke<string>('clear_replays');
      setSelectedTimestamp(null);
      setRecording(null);
      setFrameIdx(0);
      setIsPlaying(false);
      showActionStatus(msg, true);
      await fetchEpisodeList();
    } catch (e) {
      showActionStatus(String(e), false);
    }
  };

  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ ...labelStyle, marginBottom: 0 }}>EPISODE REPLAY ({episodes.length})</div>
        <button
          onClick={handleClearReplays}
          disabled={episodes.length === 0}
          style={{
            background: episodes.length === 0 ? '#1f1f1f' : '#2a2a2a',
            color: episodes.length === 0 ? '#555' : '#ff6666',
            border: `2px solid ${episodes.length === 0 ? '#2a2a2a' : '#3a3a3a'}`,
            padding: '2px 8px',
            fontFamily: 'var(--font-pixel)',
            fontSize: 7,
            cursor: episodes.length === 0 ? 'default' : 'pointer',
            textTransform: 'uppercase',
          }}
        >
          clear
        </button>
      </div>

      {actionStatus && (
        <div style={{
          padding: '4px 8px',
          marginBottom: 8,
          background: actionStatus.ok ? '#1a2a1a' : '#2a1a1a',
          border: `2px solid ${actionStatus.ok ? '#00ff88' : '#ff4444'}`,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: actionStatus.ok ? '#00ff88' : '#ff4444',
        }}>
          {actionStatus.msg}
        </div>
      )}

      {/* Episode list */}
      {!recording && (
        <div style={{ maxHeight: 200, overflowY: 'auto', marginBottom: 12 }}>
          {episodes.length === 0 && (
            <div style={{ color: '#555', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              No recordings yet — best episodes will appear here
            </div>
          )}
          {episodes.map((ep) => (
            <div
              key={ep.timestamp}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                borderBottom: '1px solid #2a2a2a',
                background: selectedTimestamp === ep.timestamp ? '#1a2a1a' : 'transparent',
              }}
            >
              <div
                onClick={() => {
                  setSelectedTimestamp(ep.timestamp);
                  setFrameIdx(0);
                  setIsPlaying(false);
                  fetchFullRecording(ep.timestamp);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00ff88' }}>
                  R: {ep.total_reward.toFixed(1)}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#888' }}>
                  | {ep.episode_length} frames
                </span>
                {ep.strategies_detected.map((s) => (
                  <span
                    key={s}
                    style={{
                      fontFamily: 'var(--font-pixel)',
                      fontSize: 6,
                      color: '#ffaa00',
                      background: '#2a2a1a',
                      padding: '1px 4px',
                      border: '1px solid #ffaa00',
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
              <button
                onClick={() => handleDeleteReplay(ep.timestamp)}
                style={{
                  background: '#2a2a2a',
                  color: '#ff6666',
                  border: '2px solid #3a3a3a',
                  padding: '2px 8px',
                  fontFamily: 'var(--font-pixel)',
                  fontSize: 7,
                  cursor: 'pointer',
                }}
              >
                DEL
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Playback controls */}
      {recording && (
        <div>
          {/* Timeline */}
          <div style={{ marginBottom: 8 }}>
            <input
              type="range"
              min={0}
              max={recording.frames.length - 1}
              value={frameIdx}
              onChange={(e) => {
                setFrameIdx(parseInt(e.target.value));
                setIsPlaying(false);
              }}
              style={{ width: '100%', accentColor: '#00ff88' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#888' }}>
              <span>Frame {frameIdx}/{recording.frames.length - 1}</span>
              <span>{(frameIdx / 30).toFixed(1)}s / {(recording.frames.length / 30).toFixed(1)}s</span>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <button
              onClick={() => {
                setIsPlaying(!isPlaying);
                lastTimeRef.current = 0;
              }}
              style={{
                background: isPlaying ? '#ffaa00' : '#00ff88',
                color: '#0a0a0a',
                border: '2px solid transparent',
                padding: '4px 12px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 8,
                cursor: 'pointer',
              }}
            >
              {isPlaying ? 'PAUSE' : 'PLAY'}
            </button>
            {[0.25, 0.5, 1, 2, 4].map((speed) => (
              <button
                key={speed}
                onClick={() => setPlaybackSpeed(speed)}
                style={{
                  background: playbackSpeed === speed ? '#4488ff' : '#2a2a2a',
                  color: playbackSpeed === speed ? '#0a0a0a' : '#888',
                  border: `2px solid ${playbackSpeed === speed ? '#4488ff' : '#3a3a3a'}`,
                  padding: '4px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {speed}x
              </button>
            ))}
            <button
              onClick={() => {
                setRecording(null);
                setSelectedTimestamp(null);
                setFrameIdx(0);
                setIsPlaying(false);
              }}
              style={{
                background: '#2a2a2a',
                color: '#ff4444',
                border: '2px solid #3a3a3a',
                padding: '4px 12px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 8,
                cursor: 'pointer',
                marginLeft: 'auto',
              }}
            >
              CLOSE
            </button>
            <button
              onClick={() => {
                if (recording) {
                  void handleDeleteReplay(recording.timestamp);
                }
              }}
              style={{
                background: '#2a2a2a',
                color: '#ff6666',
                border: '2px solid #3a3a3a',
                padding: '4px 12px',
                fontFamily: 'var(--font-pixel)',
                fontSize: 8,
                cursor: 'pointer',
              }}
            >
              DELETE
            </button>
          </div>

          {/* Frame info */}
          {frame && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}>
              <div>
                <div style={labelStyle}>POS</div>
                <div style={{ color: '#e0e0e0' }}>
                  {frame.pos[0].toFixed(1)}, {frame.pos[1].toFixed(1)}, {frame.pos[2].toFixed(1)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>VEL</div>
                <div style={{ color: '#e0e0e0' }}>
                  {Math.sqrt(frame.vel[0] ** 2 + frame.vel[2] ** 2).toFixed(1)} u/s
                </div>
              </div>
              <div>
                <div style={labelStyle}>HEALTH</div>
                <div style={{ color: frame.health > 50 ? '#00ff88' : '#ff4444' }}>
                  {frame.health.toFixed(0)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>REWARD</div>
                <div style={{ color: frame.reward > 0 ? '#00ff88' : '#ff4444' }}>
                  {frame.reward.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Strategies detected */}
          {recording.strategies_detected.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {recording.strategies_detected.map((s) => (
                <span
                  key={s}
                  style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: 7,
                    color: '#ffaa00',
                    background: '#2a2a1a',
                    padding: '2px 6px',
                    border: '1px solid #ffaa00',
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
