import { useState, useEffect, useCallback } from 'react';
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

  const fetchData = useCallback(async () => {
    try {
      const history = await invoke<[number, number][]>('get_reward_history');
      const points: RewardPoint[] = [];
      const windowSize = 100;

      for (let i = 0; i < history.length; i++) {
        const [ep, reward] = history[i];
        // Rolling average
        const start = Math.max(0, i - windowSize + 1);
        let sum = 0;
        for (let j = start; j <= i; j++) {
          sum += history[j][1];
        }
        const avg = sum / (i - start + 1);
        points.push({ episode: ep, reward, avg });
      }

      // Downsample if too many points (keep last 2000)
      if (points.length > 2000) {
        const step = Math.ceil(points.length / 2000);
        const sampled = points.filter((_, i) => i % step === 0 || i === points.length - 1);
        setData(sampled);
      } else {
        setData(points);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchData, 1000);
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
