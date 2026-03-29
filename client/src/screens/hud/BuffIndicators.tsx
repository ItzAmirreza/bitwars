// ── Buff Indicators HUD ──
// Shows active ability buffs with countdown timers.

import { useEffect, useState } from 'react';
import { ABILITY_NAMES } from '../../game/AbilityPickupManager';

export interface ActiveBuff {
  type: number;
  remainingMs: number;
}

const BUFF_COLORS: Record<number, string> = {
  0: '#44ff44', // HealthRegen (won't show as a timed buff)
  1: '#ff4444', // DoubleDamage
  2: '#44ddff', // SpeedBoost
  3: '#ffcc00', // Shield
};

const BUFF_ICONS: Record<number, string> = {
  1: '⚔',
  2: '⚡',
  3: '🛡',
};

interface Props {
  buffs: ActiveBuff[];
}

export function BuffIndicators({ buffs }: Props) {
  const [, setTick] = useState(0);

  // Force re-render every 100ms for countdown update
  useEffect(() => {
    if (buffs.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [buffs.length]);

  if (buffs.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {buffs.map((buff) => {
        const secs = Math.max(0, Math.ceil(buff.remainingMs / 1000));
        const expiring = secs <= 3;
        const color = BUFF_COLORS[buff.type] ?? '#ffffff';
        const icon = BUFF_ICONS[buff.type] ?? '✦';
        const name = ABILITY_NAMES[buff.type] ?? 'Buff';

        return (
          <div
            key={buff.type}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'rgba(12,16,24,0.85)',
              border: `2px solid ${color}`,
              borderRadius: 4,
              fontFamily: 'var(--font-pixel, monospace)',
              fontSize: 13,
              color,
              animation: expiring ? 'buff-pulse 0.5s ease-in-out infinite alternate' : undefined,
              opacity: expiring ? undefined : 0.95,
            }}
          >
            <span style={{ fontSize: 16 }}>{icon}</span>
            <span>{name}</span>
            <span style={{ fontWeight: 'bold', minWidth: 20, textAlign: 'right' }}>
              {secs}s
            </span>
          </div>
        );
      })}
      <style>{`
        @keyframes buff-pulse {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
