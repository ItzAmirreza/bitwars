import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface RewardPoint {
  episode: number;
  reward: number;
  avg: number;
}

/** Max chart data points fed to Recharts. More than this hammers the SVG renderer. */
const MAX_CHART_POINTS = 500;

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

export default function RewardChart() {
  const [data, setData] = useState<RewardPoint[]>([]);
  const inFlightRef = useRef(false);
  const lastLenRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const history = await invoke<[number, number][]>('get_reward_history');
      if (!Array.isArray(history)) {
        setData([]);
        inFlightRef.current = false;
        return;
      }

      // Skip re-render if nothing changed — the biggest CPU saver
      if (history.length === lastLenRef.current) {
        inFlightRef.current = false;
        return;
      }
      lastLenRef.current = history.length;

      const windowSize = 100;
      const sanitizedHistory = history.filter(
        (point): point is [number, number] =>
          Array.isArray(point)
          && point.length >= 2
          && Number.isFinite(point[0])
          && Number.isFinite(point[1]),
      );

      // O(n) sliding window
      const points: RewardPoint[] = new Array(sanitizedHistory.length);
      let windowSum = 0;
      for (let i = 0; i < sanitizedHistory.length; i++) {
        const [ep, reward] = sanitizedHistory[i];
        windowSum += reward;
        if (i >= windowSize) {
          windowSum -= sanitizedHistory[i - windowSize][1];
        }
        const count = Math.min(i + 1, windowSize);
        const avg = windowSum / count;
        points[i] = { episode: ep, reward, avg: Number.isFinite(avg) ? avg : 0 };
      }

      // Downsample for Recharts SVG rendering (max MAX_CHART_POINTS)
      if (points.length > MAX_CHART_POINTS) {
        const step = points.length / MAX_CHART_POINTS;
        const sampled: RewardPoint[] = [];
        for (let i = 0; i < MAX_CHART_POINTS - 1; i++) {
          sampled.push(points[Math.floor(i * step)]);
        }
        sampled.push(points[points.length - 1]);
        setData(sampled);
      } else {
        setData(points);
      }
    } catch { /* ignore */ }
    inFlightRef.current = false;
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchData, 3000);
    fetchData();
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div style={panelStyle}>
      <div style={labelStyle}>REWARD PER EPISODE</div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#2a2a2a"
          />
          <XAxis
            dataKey="episode"
            stroke="#555"
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' }}
            label={{
              value: 'Episode',
              position: 'insideBottom',
              offset: -5,
              style: { fontSize: 8, fontFamily: 'var(--font-pixel)', fill: '#888' },
            }}
          />
          <YAxis
            stroke="#555"
            tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' }}
          />
          <Tooltip
            contentStyle={{
              background: '#1a1a1a',
              border: '2px solid #3a3a3a',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          />
          <Legend
            wrapperStyle={{
              fontFamily: 'var(--font-pixel)',
              fontSize: 8,
            }}
          />
          <Line
            type="monotone"
            dataKey="reward"
            stroke="#3a3a3a"
            dot={false}
            strokeWidth={1}
            name="Raw"
          />
          <Line
            type="monotone"
            dataKey="avg"
            stroke="#00ff88"
            dot={false}
            strokeWidth={2}
            name="Avg (100)"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
