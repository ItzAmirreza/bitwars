import { useEffect, useMemo, useState } from 'react';
import type { PerfRunResult } from '../game/PerfHarness';
import type { PerfRunSummary } from '../game/PerfHistoryStore';

interface PerfPanelProps {
  open: boolean;
  running: boolean;
  progress: number;
  lastRun: PerfRunResult | null;
  summaries: PerfRunSummary[];
  selectedRun: PerfRunResult | null;
  compareRun: PerfRunResult | null;
  onClose: () => void;
  onRun: () => void;
  onRefresh: () => void;
  onSelectRun: (id: string) => void;
  onSelectCompareRun: (id: string) => void;
  onDeleteRun: (id: string) => void;
  onClear: () => void;
  onExportRun: (id: string) => void;
  onImportRun: (jsonText: string) => void;
}

type MetricKey =
  | 'fps'
  | 'frameMs'
  | 'cpuFrameMs'
  | 'drawCalls'
  | 'triangles'
  | 'loadedChunks'
  | 'pendingChunkRequests'
  | 'activeProjectiles'
  | 'activeVfxParticles'
  | 'activeFallingDebris'
  | 'activeSettledDebris'
  | 'activeRemotePlayers'
  | 'dynamicLights'
  | 'jsHeapUsedMB';

const METRICS: Array<{ key: MetricKey; label: string }> = [
  { key: 'fps', label: 'FPS' },
  { key: 'frameMs', label: 'Frame ms' },
  { key: 'cpuFrameMs', label: 'CPU frame ms' },
  { key: 'drawCalls', label: 'Draw calls' },
  { key: 'triangles', label: 'Triangles' },
  { key: 'loadedChunks', label: 'Loaded chunks' },
  { key: 'pendingChunkRequests', label: 'Pending chunk requests' },
  { key: 'activeProjectiles', label: 'Projectiles' },
  { key: 'activeVfxParticles', label: 'VFX particles' },
  { key: 'activeFallingDebris', label: 'Falling debris' },
  { key: 'activeSettledDebris', label: 'Settled debris' },
  { key: 'activeRemotePlayers', label: 'Remote players' },
  { key: 'dynamicLights', label: 'Dynamic lights' },
  { key: 'jsHeapUsedMB', label: 'JS heap MB' },
];

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

function deltaFmt(current: number, baseline: number, inverse = false): { text: string; color: string } {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline === 0) {
    return { text: '-', color: 'var(--c-muted)' };
  }
  const pct = ((current - baseline) / baseline) * 100;
  const better = inverse ? pct < 0 : pct > 0;
  const color = better ? 'var(--c-green)' : pct === 0 ? 'var(--c-muted)' : 'var(--c-red)';
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(2)}%`, color };
}

function MiniGraph({ run, metric }: { run: PerfRunResult; metric: MetricKey }) {
  const width = 520;
  const height = 150;
  const padding = 10;

  const { points, min, max } = useMemo(() => {
    if (!run.samples.length) {
      return { points: '', min: 0, max: 1 };
    }
    const values = run.samples.map((s) => Number(s[metric]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.0001, max - min);
    const lastT = Math.max(0.001, run.samples[run.samples.length - 1]!.t);
    const pts: string[] = [];
    for (let i = 0; i < run.samples.length; i++) {
      const s = run.samples[i]!;
      const x = padding + (s.t / lastT) * (width - padding * 2);
      const y = height - padding - ((Number(s[metric]) - min) / span) * (height - padding * 2);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return { points: pts.join(' '), min, max };
  }, [run, metric]);

  return (
    <div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--c-muted)',
        marginBottom: '4px',
      }}>
        <span>{METRICS.find((m) => m.key === metric)?.label}</span>
        <span>min {fmt(min)} / max {fmt(max)}</span>
      </div>
      <svg width={width} height={height} style={{ background: 'rgba(7,10,16,0.8)', border: '1px solid var(--c-border)' }}>
        <polyline
          fill="none"
          stroke="var(--c-cyan)"
          strokeWidth="1.5"
          points={points}
        />
      </svg>
    </div>
  );
}

function phaseBreakdown(run: PerfRunResult): Array<{ phase: string; sec: number; pct: number }> {
  if (run.samples.length === 0) return [];
  const firstT = run.samples[0]!.t;
  const lastT = run.samples[run.samples.length - 1]!.t;
  const duration = Math.max(0.001, lastT - firstT);
  const map = new Map<string, number>();
  for (let i = 1; i < run.samples.length; i++) {
    const a = run.samples[i - 1]!;
    const b = run.samples[i]!;
    const dt = Math.max(0, b.t - a.t);
    map.set(a.phase, (map.get(a.phase) ?? 0) + dt);
  }
  return Array.from(map.entries())
    .map(([phase, sec]) => ({ phase, sec, pct: (sec / duration) * 100 }))
    .sort((a, b) => b.sec - a.sec);
}

function CompareGraph({
  primary,
  secondary,
  metric,
}: {
  primary: PerfRunResult;
  secondary: PerfRunResult;
  metric: MetricKey;
}) {
  const width = 520;
  const height = 170;
  const padding = 10;

  const graph = useMemo(() => {
    const pVals = primary.samples.map((s) => Number(s[metric]));
    const sVals = secondary.samples.map((s) => Number(s[metric]));
    const all = [...pVals, ...sVals];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = Math.max(0.0001, max - min);

    const mk = (run: PerfRunResult) => {
      const lastT = Math.max(0.001, run.samples[run.samples.length - 1]?.t ?? 1);
      const pts: string[] = [];
      for (let i = 0; i < run.samples.length; i++) {
        const s = run.samples[i]!;
        const x = padding + (s.t / lastT) * (width - padding * 2);
        const y = height - padding - ((Number(s[metric]) - min) / span) * (height - padding * 2);
        pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return pts.join(' ');
    };

    return {
      min,
      max,
      p: mk(primary),
      s: mk(secondary),
    };
  }, [primary, secondary, metric]);

  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-muted)' }}>
        <span>Overlay comparison ({METRICS.find((m) => m.key === metric)?.label})</span>
        <span>min {fmt(graph.min)} / max {fmt(graph.max)}</span>
      </div>
      <svg width={width} height={height} style={{ background: 'rgba(7,10,16,0.8)', border: '1px solid var(--c-border)' }}>
        <polyline fill="none" stroke="var(--c-cyan)" strokeWidth="1.5" points={graph.p} />
        <polyline fill="none" stroke="var(--c-amber)" strokeWidth="1.5" points={graph.s} />
      </svg>
      <div style={{ display: 'flex', gap: '12px', marginTop: '4px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
        <span style={{ color: 'var(--c-cyan)' }}>Current run</span>
        <span style={{ color: 'var(--c-amber)' }}>Compare run</span>
      </div>
    </div>
  );
}

export function PerfPanel(props: PerfPanelProps) {
  const {
    open,
    running,
    progress,
    lastRun,
    summaries,
    selectedRun,
    compareRun,
    onClose,
    onRun,
    onRefresh,
    onSelectRun,
    onSelectCompareRun,
    onDeleteRun,
    onClear,
    onExportRun,
    onImportRun,
  } = props;

  const [metric, setMetric] = useState<MetricKey>('fps');
  const [compareRunId, setCompareRunId] = useState<string>('');

  const [importText, setImportText] = useState('');

  useEffect(() => {
    if (open) onRefresh();
  }, [open, onRefresh]);

  if (!open) return null;

  const focusRun = selectedRun ?? lastRun;
  const compareSummary = compareRun?.summary;

  return (
    <div className="absolute inset-0 z-40" style={{ background: 'rgba(2,6,12,0.82)', backdropFilter: 'blur(6px)' }}>
      <div style={{
        position: 'absolute',
        inset: '30px 40px',
        border: '1px solid var(--c-border)',
        background: 'rgba(8,12,18,0.96)',
        display: 'grid',
        gridTemplateColumns: '340px 1fr',
      }}>
        <div style={{ borderRight: '1px solid var(--c-border)', padding: '14px', overflowY: 'auto' }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.12em',
            color: 'var(--c-cyan)',
            marginBottom: '10px',
            fontSize: '12px',
          }}>
            PERFORMANCE HARNESS
          </div>

          <button
            onClick={onRun}
            disabled={running}
            style={{
              width: '100%',
              marginBottom: '8px',
              padding: '10px',
              fontFamily: 'var(--font-mono)',
              border: '1px solid var(--c-green)',
              background: running ? 'rgba(0,255,102,0.15)' : 'rgba(0,255,102,0.08)',
              color: 'var(--c-green)',
              cursor: running ? 'default' : 'pointer',
            }}
          >
            {running ? 'RUNNING TEST...' : 'RUN 60s CLIENT TEST'}
          </button>

          {running && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{
                height: '10px',
                border: '1px solid var(--c-border)',
                background: 'rgba(255,255,255,0.06)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, progress * 100))}%`,
                  background: 'linear-gradient(90deg, #2fd4ff, #66e0ff)',
                }} />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <button onClick={onRefresh} style={{ flex: 1, fontFamily: 'var(--font-mono)', padding: '6px' }}>Refresh</button>
            <button onClick={onClear} style={{ flex: 1, fontFamily: 'var(--font-mono)', padding: '6px' }}>Clear all</button>
          </div>

          <div style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--c-muted)',
            fontSize: '10px',
            letterSpacing: '0.1em',
            marginBottom: '4px',
          }}>
            IMPORT RUN JSON
          </div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={4}
            placeholder="Paste exported run JSON"
            style={{
              width: '100%',
              marginBottom: '6px',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              background: 'rgba(4,8,14,0.8)',
              color: 'var(--c-text)',
              border: '1px solid var(--c-border)',
              padding: '6px',
            }}
          />
          <button
            onClick={() => {
              if (!importText.trim()) return;
              onImportRun(importText.trim());
              setImportText('');
            }}
            style={{ width: '100%', marginBottom: '10px', fontFamily: 'var(--font-mono)', padding: '6px' }}
          >
            Import JSON
          </button>

          <div style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--c-muted)',
            fontSize: '10px',
            letterSpacing: '0.1em',
            marginBottom: '6px',
          }}>
            HISTORY
          </div>
          {summaries.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--c-border)', marginBottom: '8px', padding: '8px' }}>
              <button
                onClick={() => onSelectRun(s.id)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--c-text)',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <div style={{ fontSize: '11px', color: 'var(--c-cyan)' }}>
                  {s.gitBranch && s.gitBranch !== 'unknown'
                    ? <><span style={{ color: 'var(--c-green)' }}>{s.gitBranch}</span> <span style={{ color: 'var(--c-muted)' }}>@{s.gitCommit}</span> &mdash; </>
                    : null}
                  {new Date(s.createdAt).toLocaleString()}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--c-muted)' }}>
                  avg FPS {fmt(s.summary.avgFps)} | p1 FPS {fmt(s.summary.p1Fps)} | p99 {fmt(s.summary.p99FrameMs)}ms
                </div>
              </button>
              <button onClick={() => onDeleteRun(s.id)} style={{ marginTop: '6px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>Delete</button>
              <button onClick={() => onExportRun(s.id)} style={{ marginTop: '6px', marginLeft: '8px', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>Export</button>
            </div>
          ))}
        </div>

        <div style={{ padding: '14px', overflowY: 'auto' }}>
          {!focusRun && (
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-muted)' }}>
              Run a test to generate per-frame data and graphs.
            </div>
          )}

          {focusRun && (
            <>
              {focusRun.metadata?.gitBranch && focusRun.metadata.gitBranch !== 'unknown' && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  marginBottom: '8px',
                  padding: '6px 8px',
                  background: 'rgba(4,8,14,0.6)',
                  border: '1px solid var(--c-border)',
                }}>
                  <span style={{ color: 'var(--c-green)' }}>{focusRun.metadata.gitBranch}</span>
                  <span style={{ color: 'var(--c-muted)' }}> @ </span>
                  <span style={{ color: 'var(--c-cyan)' }}>{focusRun.metadata.gitCommit}</span>
                  <span style={{ color: 'var(--c-muted)' }}> &mdash; {new Date(focusRun.createdAt).toLocaleString()}</span>
                </div>
              )}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
                gap: '8px',
                marginBottom: '12px',
              }}>
                <Stat label="AVG FPS" value={fmt(focusRun.summary.avgFps)} delta={compareSummary ? deltaFmt(focusRun.summary.avgFps, compareSummary.avgFps, false) : undefined} />
                <Stat label="P1 FPS" value={fmt(focusRun.summary.p1Fps)} delta={compareSummary ? deltaFmt(focusRun.summary.p1Fps, compareSummary.p1Fps, false) : undefined} />
                <Stat label="P99 MS" value={fmt(focusRun.summary.p99FrameMs)} delta={compareSummary ? deltaFmt(focusRun.summary.p99FrameMs, compareSummary.p99FrameMs, true) : undefined} />
                <Stat label="CPU P99" value={fmt(focusRun.summary.p99CpuFrameMs)} delta={compareSummary ? deltaFmt(focusRun.summary.p99CpuFrameMs, compareSummary.p99CpuFrameMs, true) : undefined} />
                <Stat label="TRI AVG" value={fmt(focusRun.summary.avgTriangles)} delta={compareSummary ? deltaFmt(focusRun.summary.avgTriangles, compareSummary.avgTriangles, true) : undefined} />
                <Stat label="DRAW AVG" value={fmt(focusRun.summary.avgDrawCalls)} delta={compareSummary ? deltaFmt(focusRun.summary.avgDrawCalls, compareSummary.avgDrawCalls, true) : undefined} />
                <Stat label="CHUNKS AVG" value={fmt(focusRun.summary.avgLoadedChunks)} delta={compareSummary ? deltaFmt(focusRun.summary.avgLoadedChunks, compareSummary.avgLoadedChunks, false) : undefined} />
                <Stat label="HEAP PEAK" value={fmt(focusRun.summary.peakJsHeapUsedMB)} delta={compareSummary ? deltaFmt(focusRun.summary.peakJsHeapUsedMB, compareSummary.peakJsHeapUsedMB, true) : undefined} />
              </div>

              <div style={{ marginBottom: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-muted)' }}>Compare with:</span>
                <select
                  value={compareRunId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCompareRunId(id);
                    onSelectCompareRun(id);
                  }}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    padding: '6px',
                    background: 'rgba(8,12,18,0.8)',
                    color: 'var(--c-text)',
                    border: '1px solid var(--c-border)',
                  }}
                >
                  <option value="">None</option>
                  {summaries
                    .filter((s) => s.id !== focusRun.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {new Date(s.createdAt).toLocaleString()} | FPS {fmt(s.summary.avgFps)}
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                {METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      padding: '6px 8px',
                      border: metric === m.key ? '1px solid var(--c-cyan)' : '1px solid var(--c-border)',
                      color: metric === m.key ? 'var(--c-cyan)' : 'var(--c-muted)',
                      background: 'rgba(8,12,18,0.6)',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <MiniGraph run={focusRun} metric={metric} />

              {compareRun && <CompareGraph primary={focusRun} secondary={compareRun} metric={metric} />}

              <div style={{ marginTop: '12px' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-muted)', marginBottom: '6px' }}>Scenario phase coverage</div>
                {phaseBreakdown(focusRun).map((p) => (
                  <div key={p.phase} style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-text)', marginBottom: '2px' }}>
                    <span>{p.phase}</span>
                    <span>{fmt(p.sec)}s ({fmt(p.pct)}%)</span>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-muted)' }}>
                {focusRun.samples.length} samples captured ({fmt(focusRun.durationSec)}s). One sample per animation frame.
              </div>
            </>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            fontFamily: 'var(--font-mono)',
            border: '1px solid var(--c-border)',
            background: 'rgba(8,12,18,0.8)',
            color: 'var(--c-text)',
            padding: '6px 10px',
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { text: string; color: string };
}) {
  return (
    <div style={{ border: '1px solid var(--c-border)', padding: '8px', background: 'rgba(8,12,18,0.7)' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--c-text)' }}>{value}</div>
      {delta && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: delta.color }}>{delta.text}</div>
      )}
    </div>
  );
}
