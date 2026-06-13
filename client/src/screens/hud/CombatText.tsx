import type { CombatTextState } from '../../game/Engine';

/**
 * Floating damage numbers near the crosshair. Client-predicted amounts that pop
 * on a confirmed player hit and drift upward as they fade — pairs with the hit
 * marker for crisp "I hit them" feedback. Positions are screen-space px offsets
 * from the crosshair center, computed by the Engine.
 */
export function CombatText({ texts }: { texts: CombatTextState[] }) {
  if (texts.length === 0) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      {texts.map((t) => (
        <div
          key={t.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: `translate(calc(-50% + ${t.x}px), calc(-50% + ${t.y}px)) scale(${t.scale})`,
            opacity: t.opacity,
            fontFamily: 'var(--font-mono)',
            fontSize: '15px',
            fontWeight: 700,
            color: '#ffe14d',
            textShadow: '2px 2px 0 rgba(0,0,0,0.85)',
            letterSpacing: '0.02em',
          }}
        >
          {t.amount}
        </div>
      ))}
    </div>
  );
}
