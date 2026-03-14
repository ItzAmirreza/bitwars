import { COMPASS_DIRS } from './weaponData';

export interface CompassBarProps {
  heading: number;
}

export function CompassBar({ heading }: CompassBarProps) {
  const barWidth = 300;
  const ticks: { pos: number; label?: string; major: boolean }[] = [];

  for (let d = -180; d <= 540; d += 15) {
    const normD = ((d % 360) + 360) % 360;
    const offset = ((d - heading + 180 + 360) % 360 - 180);
    const pixelPos = (offset / 180) * (barWidth / 2);
    if (Math.abs(pixelPos) > barWidth / 2) continue;

    const dir = COMPASS_DIRS.find((c) => c.deg === normD);
    ticks.push({
      pos: pixelPos + barWidth / 2,
      label: dir?.label,
      major: !!dir,
    });
  }

  return (
    <div style={{
      width: `${barWidth}px`,
      height: '20px',
      position: 'relative',
      overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
    }}>
      {/* Center marker */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: '2px',
        transform: 'translateX(-50%)',
        background: 'var(--c-green)',
        boxShadow: '0 0 6px var(--c-green)',
        zIndex: 2,
      }} />
      {ticks.map((tick, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${tick.pos}px`,
          top: tick.major ? '0px' : '10px',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          {tick.label && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: tick.label.length === 1 ? '10px' : '8px',
              color: tick.label === 'N' ? 'var(--c-red)' : tick.label.length === 1 ? 'var(--c-text)' : 'var(--c-muted)',
              fontWeight: tick.label.length === 1 ? 'bold' : 'normal',
              letterSpacing: '0.05em',
              lineHeight: '1',
              textShadow: tick.label === 'N' ? '0 0 6px var(--c-red)' : 'none',
            }}>
              {tick.label}
            </span>
          )}
          <div style={{
            width: '1px',
            height: tick.major ? '6px' : '4px',
            background: tick.major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
          }} />
        </div>
      ))}
    </div>
  );
}
