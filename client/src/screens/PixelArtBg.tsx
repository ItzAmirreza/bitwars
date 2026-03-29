import { useEffect, useRef } from 'react';

// 8x8 pixel patterns — 0=transparent, 1-4=palette colors (brightest to darkest)
const PATTERNS: string[] = [
  // Crosshair
  '00011000' + '00011000' + '00000000' + '11022011' + '11022011' + '00000000' + '00011000' + '00011000',
  // Explosion
  '00100010' + '01211210' + '12333210' + '01344310' + '01344310' + '12333210' + '01211210' + '00100010',
  // Heart
  '01100110' + '12212210' + '12321210' + '12222210' + '01222100' + '00122100' + '00011000' + '00000000',
  // Skull
  '01111110' + '12222210' + '12322310' + '12222210' + '12122110' + '01222100' + '00111100' + '00100100',
  // Block/Cube
  '00111100' + '01222110' + '12222130' + '12222130' + '12222130' + '11111130' + '01333310' + '00111100',
  // Shield
  '11111111' + '12222221' + '12322321' + '12233221' + '12233221' + '01222210' + '00122100' + '00011000',
  // Lightning
  '00001100' + '00011000' + '00110000' + '01111100' + '00011000' + '00110000' + '01100000' + '11000000',
  // Flame
  '00010000' + '00121000' + '00121000' + '01232100' + '01232100' + '12343210' + '12343210' + '01232100',
  // Sword
  '00000012' + '00000121' + '00001210' + '01012100' + '00111000' + '01110000' + '11000000' + '10000000',
  // Arrow up
  '00010000' + '00111000' + '01020100' + '00010000' + '00010000' + '00010000' + '00010000' + '00010000',
  // Waves
  '10000001' + '21000012' + '32100123' + '43211234' + '04322340' + '00433400' + '00044000' + '00000000',
  // Diamond
  '00011000' + '00122100' + '01233210' + '12344321' + '12344321' + '01233210' + '00122100' + '00011000',
  // Bullet
  '00011000' + '00122100' + '00122100' + '00111100' + '00133100' + '00133100' + '00133100' + '00011000',
  // Star
  '00010000' + '00010000' + '01010100' + '00111000' + '01131100' + '00111000' + '01010100' + '00010000',
  // Pixel creature
  '01000010' + '11100111' + '11111111' + '10111101' + '11111111' + '01111110' + '01011010' + '01000010',
  // Crown
  '10010010' + '11011011' + '11111111' + '12222221' + '12222221' + '11111111' + '00000000' + '00000000',
];

const PALETTES = [
  ['#ff6b35', '#ff9f1c', '#ffbf69', '#ffe66d'], // warm
  ['#00e5ff', '#00b8d4', '#40c4ff', '#80d8ff'], // cyan
  ['#ff2d78', '#ff5c8a', '#ff8fb1', '#ffb8d0'], // pink
  ['#76ff03', '#b2ff59', '#ccff90', '#f4ff81'], // lime
  ['#7c4dff', '#b388ff', '#d1c4e9', '#ede7f6'], // purple
  ['#ffd600', '#ffea00', '#fff176', '#fff9c4'], // gold
  ['#ff3d00', '#ff6e40', '#ff9e80', '#ffd0b0'], // fire
  ['#00e676', '#69f0ae', '#b9f6ca', '#e0f7e0'], // mint
];

type FloatingIcon = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pattern: number;
  palette: number;
  size: number;
  opacity: number;
  targetOpacity: number;
  rotation: number;
  vr: number;
};

export function PixelArtBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (!ctx) return;

    let animId: number;
    const icons: FloatingIcon[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    // Spawn initial icons
    const count = Math.min(22, Math.floor((window.innerWidth * window.innerHeight) / 50000));
    for (let i = 0; i < count; i++) {
      icons.push(spawnIcon(canvas.width, canvas.height, true));
    }

    function spawnIcon(w: number, h: number, initial: boolean): FloatingIcon {
      return {
        x: Math.random() * w,
        y: initial ? Math.random() * h : h + 60,
        vx: (Math.random() - 0.5) * 0.15,
        vy: -(0.12 + Math.random() * 0.25),
        pattern: Math.floor(Math.random() * PATTERNS.length),
        palette: Math.floor(Math.random() * PALETTES.length),
        size: 4 + Math.floor(Math.random() * 3), // pixel size 4-6
        opacity: 0,
        targetOpacity: 0.15 + Math.random() * 0.35,
        rotation: 0,
        vr: (Math.random() - 0.5) * 0.003,
      };
    }

    function drawIcon(icon: FloatingIcon) {
      const pattern = PATTERNS[icon.pattern];
      const palette = PALETTES[icon.palette];
      const ps = icon.size; // pixel size
      const totalSize = ps * 8;
      const cardPad = ps * 1.5;
      const cardSize = totalSize + cardPad * 2;

      ctx.save();
      ctx.translate(icon.x, icon.y);
      ctx.rotate(icon.rotation);
      ctx.globalAlpha = icon.opacity;

      // Dark card background
      const r = ps;
      const cx = -cardSize / 2;
      const cy = -cardSize / 2;
      ctx.beginPath();
      ctx.roundRect(cx, cy, cardSize, cardSize, r);
      ctx.fillStyle = 'rgba(18, 22, 32, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw pixels
      const ox = -totalSize / 2;
      const oy = -totalSize / 2;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const val = parseInt(pattern[row * 8 + col]);
          if (val === 0) continue;
          ctx.fillStyle = palette[val - 1];
          ctx.fillRect(ox + col * ps, oy + row * ps, ps - 0.5, ps - 0.5);
        }
      }

      ctx.restore();
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = icons.length - 1; i >= 0; i--) {
        const ic = icons[i];
        ic.x += ic.vx;
        ic.y += ic.vy;
        ic.rotation += ic.vr;

        // Fade in
        if (ic.opacity < ic.targetOpacity) {
          ic.opacity = Math.min(ic.opacity + 0.003, ic.targetOpacity);
        }

        // Remove if off screen
        if (ic.y < -80) {
          icons[i] = spawnIcon(canvas.width, canvas.height, false);
          continue;
        }

        drawIcon(ic);
      }

      animId = requestAnimationFrame(animate);
    }

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
