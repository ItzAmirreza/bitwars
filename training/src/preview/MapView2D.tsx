import { useEffect, useRef } from 'react';
import type { LiveBotState } from './PreviewPage';

const WORLD_SIZE = 750;

const BOT_COLORS = [
  '#00ff88', '#4488ff', '#ff4444', '#ffaa00',
  '#ff44ff', '#44ffff', '#aaff44', '#ff8844',
  '#8844ff', '#44ff88', '#ff4488', '#88ff44',
  '#4444ff', '#ff8888', '#88ffaa', '#ffff44',
];

type Props = {
  bots: LiveBotState[];
  selectedBot: number;
  onSelectBot: (index: number) => void;
};

export default function MapView2D({ bots, selectedBot, onSelectBot }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const botsRef = useRef<LiveBotState[]>(bots);
  const selectedBotRef = useRef(selectedBot);

  botsRef.current = bots;
  selectedBotRef.current = selectedBot;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const draw = () => {
      animId = requestAnimationFrame(draw);
      if (!canvas.parentElement) return;

      const w = canvas.parentElement.clientWidth;
      const h = canvas.parentElement.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const scale = Math.min(w, h) / WORLD_SIZE;
      const currentBots = botsRef.current;
      const selected = selectedBotRef.current;

      ctx.fillStyle = '#101418';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#1d252b';
      ctx.lineWidth = 1;
      for (let world = 0; world <= WORLD_SIZE; world += 50) {
        const p = world * scale;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(w, p);
        ctx.stroke();
      }

      for (let i = 0; i < currentBots.length; i++) {
        const bot = currentBots[i];
        const color = BOT_COLORS[i % BOT_COLORS.length];
        const bx = bot.pos[0] * scale;
        const bz = bot.pos[2] * scale;
        const tx = bot.target[0] * scale;
        const tz = bot.target[2] * scale;
        const isSelected = i === selected;
        const radius = isSelected ? 6 : 4;

        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;

        ctx.globalAlpha = isSelected ? 0.24 : 0.1;
        ctx.beginPath();
        ctx.arc(tx, tz, isSelected ? 8 : 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = isSelected ? 0.22 : 0.08;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(bx, bz);
        ctx.lineTo(tx, tz);
        ctx.stroke();

        const lookLen = isSelected ? 18 : 10;
        const lx = -Math.sin(bot.yaw) * lookLen;
        const lz = -Math.cos(bot.yaw) * lookLen;
        ctx.globalAlpha = isSelected ? 0.95 : 0.45;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(bx, bz);
        ctx.lineTo(bx + lx, bz + lz);
        ctx.stroke();

        const vx = bot.vel[0] * scale * 1.25;
        const vz = bot.vel[2] * scale * 1.25;
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(bx, bz);
        ctx.lineTo(bx + vx, bz + vz);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = isSelected ? '#ffffff' : color;
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.beginPath();
        ctx.arc(bx, bz, radius + 3, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, bz, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = '#76838f';
      ctx.font = '10px "JetBrains Mono"';
      ctx.fillText(`${currentBots.length} bots`, 8, h - 10);
      if (currentBots[selected]) {
        ctx.fillText(`selected #${selected}`, 72, h - 10);
      }
    };

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const scale = Math.min(canvas.width, canvas.height) / WORLD_SIZE;

      let closest = -1;
      let bestDistSq = 18 * 18;
      botsRef.current.forEach((bot, index) => {
        const dx = bot.pos[0] * scale - x;
        const dy = bot.pos[2] * scale - y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          closest = index;
        }
      });

      if (closest >= 0) {
        onSelectBot(closest);
      }
    };

    canvas.addEventListener('click', onClick);
    animId = requestAnimationFrame(draw);
    return () => {
      canvas.removeEventListener('click', onClick);
      cancelAnimationFrame(animId);
    };
  }, [onSelectBot]);

  return (
    <div style={{
      background: '#161b20',
      border: '3px solid #3a3a3a',
      height: '100%',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
      <div style={{
        position: 'absolute',
        top: 8,
        left: 8,
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid #2f3840',
        fontFamily: 'var(--font-pixel)',
        fontSize: 8,
        color: '#a9b7c3',
      }}>
        click bot to follow
      </div>
    </div>
  );
}
