import { useState } from 'react';
import TrainingControls from './dashboard/TrainingControls';
import RewardChart from './dashboard/RewardChart';
import CheckpointManager from './dashboard/CheckpointManager';
import MapView3D from './preview/MapView3D';
import MapView2D from './preview/MapView2D';
import EpisodePlayer from './replay/EpisodePlayer';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'preview' | 'replay'>('dashboard');

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0a0a0a',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderBottom: '3px solid #3a3a3a',
        background: '#1a1a1a',
        fontFamily: 'var(--font-pixel)',
        fontSize: 10,
      }}>
        <span style={{ color: '#00ff88', fontSize: 14 }}>BITWARS</span>
        <span style={{ color: '#888' }}>NEURAL BOT TRAINING</span>
        <div style={{ flex: 1 }} />
        {(['dashboard', 'preview', 'replay'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              background: view === v ? '#00ff88' : '#2a2a2a',
              color: view === v ? '#0a0a0a' : '#888',
              border: `2px solid ${view === v ? '#00ff88' : '#3a3a3a'}`,
              padding: '6px 16px',
              fontFamily: 'var(--font-pixel)',
              fontSize: 9,
              cursor: 'pointer',
              textTransform: 'uppercase' as const,
            }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 16 }}>
        {/* Dashboard view */}
        {view === 'dashboard' && (
          <div style={{ display: 'flex', gap: 16, height: '100%' }}>
            {/* Left sidebar: controls + checkpoints */}
            <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              <TrainingControls />
              <CheckpointManager />
            </div>
            {/* Main area: charts */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              <RewardChart />
            </div>
          </div>
        )}

        {/* Preview view */}
        {view === 'preview' && (
          <div style={{ display: 'flex', gap: 16, height: '100%' }}>
            <div style={{ flex: 2, height: '100%' }}>
              <MapView3D />
            </div>
            <div style={{ flex: 1, height: '100%' }}>
              <MapView2D />
            </div>
          </div>
        )}

        {/* Replay view */}
        {view === 'replay' && (
          <div style={{ height: '100%' }}>
            <EpisodePlayer />
          </div>
        )}
      </div>
    </div>
  );
}
