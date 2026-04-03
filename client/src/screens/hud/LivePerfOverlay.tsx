import type { EngineLivePerfSnapshot } from '../../game/Engine';

interface LivePerfOverlayProps {
  open: boolean;
  snapshot: EngineLivePerfSnapshot | null;
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(digits);
}

function compactInt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const max = Math.max(20, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function LivePerfOverlay({ open, snapshot }: LivePerfOverlayProps) {
  if (!open || !snapshot) return null;

  const current = snapshot.current;
  const history = snapshot.history;
  const hitchRows = snapshot.recentHitches.slice(0, 3);
  const phaseRows = [...current.phases]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 4);
  const framePoints = sparklinePoints(history.map((frame) => frame.frameMs), 250, 52);

  return (
    <div
      className="absolute top-16 right-3 z-30 pointer-events-none"
      style={{
        width: 'min(360px, calc(100vw - 24px))',
        border: '2px solid #1a1e2e',
        background: 'rgba(7,10,16,0.92)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
        <div style={{
          fontFamily: 'var(--font-pixel)',
          fontSize: '8px',
          letterSpacing: '0.12em',
          color: '#00e5ff',
        }}>
          LIVE PERF
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: '#6b7080',
        }}>
          F7 to close
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', marginBottom: '8px' }}>
        <StatCard label="FPS" value={fmt(current.fps, 0)} accent={current.fps >= 55 ? '#76ff03' : current.fps >= 40 ? '#ffd600' : '#ff5a5a'} />
        <StatCard label="FRAME" value={`${fmt(current.frameMs)}ms`} accent="#00e5ff" />
        <StatCard label="CPU" value={`${fmt(current.cpuFrameMs)}ms`} accent="#ff9f1c" />
        <StatCard label="RENDER" value={`${fmt(current.renderMs)}ms`} accent="#ff6b35" />
      </div>

      <div style={{
        border: '1px solid #1a1e2e',
        background: 'rgba(255,255,255,0.03)',
        padding: '7px 8px',
        marginBottom: '8px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: '#6b7080',
          marginBottom: '2px',
        }}>
          Likely culprit
        </div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: '#e8e8f0',
        }}>
          {current.suspect}
        </div>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          color: '#6b7080',
          marginBottom: '4px',
        }}>
          Recent frame time
        </div>
        <svg width="250" height="52" viewBox="0 0 250 52" style={{ display: 'block', width: '100%', height: '52px', background: 'rgba(255,255,255,0.02)' }}>
          <line x1="0" y1="31.2" x2="250" y2="31.2" stroke="rgba(255,214,0,0.3)" strokeWidth="1" />
          <polyline fill="none" stroke="#00e5ff" strokeWidth="2" points={framePoints} />
        </svg>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#6b7080',
            marginBottom: '4px',
          }}>
            Hottest phases
          </div>
          {phaseRows.map((phase) => (
            <div key={phase.key} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#e8e8f0', marginBottom: '3px' }}>
              <span>{phase.label}</span>
              <span>{fmt(phase.ms)}ms</span>
            </div>
          ))}
        </div>

        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#6b7080',
            marginBottom: '4px',
          }}>
            Scene pressure
          </div>
          <CounterRow label="Draws" value={compactInt(current.counters.drawCalls)} />
          <CounterRow label="Tris" value={compactInt(current.counters.triangles)} />
          <CounterRow label="Chunks" value={`${current.counters.meshedChunks}/${current.counters.loadedChunks}`} />
          <CounterRow label="Dirty" value={`${current.counters.dirtyChunks}`} />
          <CounterRow label="Lights" value={`${current.counters.activeLights}`} />
          <CounterRow label="Projectiles" value={`${current.counters.activeProjectiles}`} />
          <CounterRow label="FX+Debris" value={`${current.counters.activeVfxParticles + current.counters.activeFallingDebris + current.counters.activeSettledDebris}`} />
        </div>
      </div>

      {hitchRows.length > 0 && (
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: '#6b7080',
            marginBottom: '4px',
          }}>
            Recent hitches
          </div>
          {hitchRows.map((hitch) => (
            <div key={hitch.atMs} style={{
              borderTop: '1px solid rgba(255,255,255,0.06)',
              paddingTop: '4px',
              marginTop: '4px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#e8e8f0' }}>
                <span>{hitch.suspect}</span>
                <span>{fmt(hitch.frameMs)}ms</span>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#6b7080' }}>
                {hitch.phase.label} {fmt(hitch.phase.ms)}ms | draws {compactInt(hitch.counters.drawCalls)} | tris {compactInt(hitch.counters.triangles)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ border: '1px solid #1a1e2e', background: 'rgba(255,255,255,0.03)', padding: '6px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: '#6b7080', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: accent }}>{value}</div>
    </div>
  );
}

function CounterRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#e8e8f0', marginBottom: '3px' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
