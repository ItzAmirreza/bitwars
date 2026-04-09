import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import MapView3D from './MapView3D';
import MapView2D from './MapView2D';

export interface LiveBotState {
  pos: [number, number, number];
  vel: [number, number, number];
  yaw: number;
  pitch: number;
  target: [number, number, number];
  health: number;
  weapon: number;
  on_ground: boolean;
  action: number[];
}

interface PreviewFrame {
  bots: LiveBotState[];
  terrain_revision: number;
}

export default function PreviewPage() {
  const [bots, setBots] = useState<LiveBotState[]>([]);
  const [selectedBot, setSelectedBot] = useState(0);
  const [followMode, setFollowMode] = useState<'follow' | 'free'>('follow');
  const [previewMode, setPreviewMode] = useState<'training' | 'eval'>('training');
  const [terrainRevision, setTerrainRevision] = useState(0);
  const [frameId, setFrameId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let inFlight = false;

    const poll = async () => {
      if (cancelled) return;
      if (inFlight) {
        timer = window.setTimeout(poll, 25);
        return;
      }

      inFlight = true;
      try {
        const frame = await invoke<PreviewFrame>('get_preview_frame');
        if (!cancelled) {
          setBots(Array.isArray(frame?.bots) ? frame.bots : []);
          setTerrainRevision(Number.isFinite(frame?.terrain_revision) ? frame.terrain_revision : 0);
          setFrameId((prev) => prev + 1);
        }
      } catch {
        // ignore transient preview errors while training boots
      } finally {
        inFlight = false;
        if (!cancelled) {
          timer = window.setTimeout(poll, 60);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (bots.length === 0) {
      if (selectedBot !== 0) setSelectedBot(0);
      return;
    }
    if (selectedBot >= bots.length) {
      setSelectedBot(bots.length - 1);
    }
  }, [bots.length, selectedBot]);

  useEffect(() => {
    invoke('set_preview_bot', { botIndex: selectedBot }).catch(() => {});
  }, [selectedBot]);

  useEffect(() => {
    invoke('set_preview_mode', { deterministic: previewMode === 'eval' }).catch(() => {});
  }, [previewMode]);

  const selectedBotState = useMemo(
    () => bots[selectedBot] ?? null,
    [bots, selectedBot],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {(['training', 'eval'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setPreviewMode(mode)}
            style={{
              border: '1px solid #3a3a3a',
              background: previewMode === mode ? '#1f3a2a' : '#191919',
              color: previewMode === mode ? '#8df0a9' : '#c9c9c9',
              padding: '6px 10px',
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            {mode === 'training' ? 'Sampled Train Preview' : 'Deterministic Eval Preview'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, height: '100%' }}>
        <div style={{ flex: 2, height: '100%' }}>
        <MapView3D
          bots={bots}
          selectedBot={selectedBot}
          onSelectBot={setSelectedBot}
          followMode={followMode}
          onToggleFollow={() => setFollowMode((mode) => (mode === 'follow' ? 'free' : 'follow'))}
          selectedBotState={selectedBotState}
          terrainRevision={terrainRevision}
          frameId={frameId}
        />
      </div>
        <div style={{ flex: 1, height: '100%' }}>
          <MapView2D
            bots={bots}
            selectedBot={selectedBot}
            onSelectBot={setSelectedBot}
          />
        </div>
      </div>
    </div>
  );
}
