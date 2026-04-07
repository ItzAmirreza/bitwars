import { useRef, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface LiveBotState {
  pos: [number, number, number];
  vel: [number, number, number];
  target: [number, number, number];
  health: number;
  weapon: number;
  on_ground: boolean;
  action: number[];
}

const WORLD_SIZE = 750;

const BOT_COLORS = [
  '#00ff88', '#4488ff', '#ff4444', '#ffaa00',
  '#ff44ff', '#44ffff', '#aaff44', '#ff8844',
  '#8844ff', '#44ff88', '#ff4488', '#88ff44',
  '#4444ff', '#ff8888', '#88ffaa', '#ffff44',
];

export default function MapView2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let lastPoll = 0;
    let bots: LiveBotState[] = [];

    const draw = (time: number) => {
      animId = requestAnimationFrame(draw);
      if (!canvas.parentElement) return;

      // Resize canvas
      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      // Poll at 5 Hz
      if (time - lastPoll > 200) {
        lastPoll = time;
        invoke<LiveBotState[]>('get_live_bot_state')
          .then((s) => { if (s) bots = s; })
          .catch(() => {});
      }

      const scale = Math.min(w, h) / WORLD_SIZE;

      // Clear
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);

      // Draw each bot + target + velocity arrow
      for (let i = 0; i < bots.length; i++) {
        const b = bots[i];
        const color = BOT_COLORS[i % BOT_COLORS.length];
        const bx = b.pos[0] * scale;
        const bz = b.pos[2] * scale;
        const tx = b.target[0] * scale;
        const tz = b.target[2] * scale;

        // Target (dim)
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.15;
        ctx.fillRect(tx - 3, tz - 3, 6, 6);

        // Line from bot to target (very dim)
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.08;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx, bz);
        ctx.lineTo(tx, tz);
        ctx.stroke();

        // Velocity arrow
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, bz);
        ctx.lineTo(bx + b.vel[0] * 1.5 * scale, bz + b.vel[2] * 1.5 * scale);
        ctx.stroke();

        // Bot dot
        ctx.fillStyle = color;
        ctx.globalAlpha = 1.0;
        ctx.fillRect(bx - 2, bz - 2, 4, 4);
      }

      ctx.globalAlpha = 1.0;

      // Info
      ctx.fillStyle = '#555';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`${bots.length} bots`, 6, h - 6);
    };

    animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div style={{
      background: '#1a1a1a',
      border: '3px solid #3a3a3a',
      height: '100%',
      overflow: 'hidden',
    }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
