const COMPASS_DIRS = [
  { deg: 0, label: 'N' }, { deg: 45, label: 'NE' }, { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' }, { deg: 180, label: 'S' }, { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' }, { deg: 315, label: 'NW' },
] as const;

function CompassBar({ heading }: { heading: number }) {
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
      borderBottom: '2px solid #1a1e2e',
    }}>
      {/* Center marker - square pixel */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: '2px',
        transform: 'translateX(-50%)',
        background: '#ff6b35',
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
              fontFamily: 'var(--font-pixel)',
              fontSize: tick.label.length === 1 ? '7px' : '6px',
              color: tick.label === 'N' ? '#ff2d78' : tick.label.length === 1 ? '#e8e8f0' : '#4a4e5e',
              fontWeight: 'normal',
              letterSpacing: '0.05em',
              lineHeight: '1',
            }}>
              {tick.label}
            </span>
          )}
          <div style={{
            width: tick.major ? '2px' : '1px',
            height: tick.major ? '6px' : '4px',
            background: tick.major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
          }} />
        </div>
      ))}
    </div>
  );
}

export interface TopHudBarProps {
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  loadoutOpen: boolean;
  chatOpen: boolean;
  username: string | null;
  roundTimerLabel: string;
  roundTimer: string;
  roundTimerCritical: boolean;
  playerCount: number;
  fps: number;
  serverTps: number;
  heading: number;
  locked: boolean;
  handleLeave: () => void;
  openLoadout: () => void;
}

const hudBtnBase: React.CSSProperties = {
  fontFamily: 'var(--font-pixel)',
  fontSize: '7px',
  background: 'rgba(12,16,24,0.85)',
  border: '2px solid #1a1e2e',
  letterSpacing: '0.08em',
  cursor: 'pointer',
  padding: '4px 8px',
  transition: 'all 0.1s',
};

export function TopHudBar({
  showSettings, setShowSettings, loadoutOpen, chatOpen, username,
  roundTimerLabel, roundTimer, roundTimerCritical, playerCount, fps, serverTps, heading, locked, handleLeave, openLoadout,
}: TopHudBarProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
      <div style={{
        background: 'rgba(10,12,20,0.85)',
        borderBottom: '2px solid #1a1e2e',
        paddingBottom: '4px',
      }}>
        {/* Top row */}
        <div className="flex items-center justify-between px-4 py-2">
          {/* Left: buttons + player name */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleLeave}
              className="pointer-events-auto"
              style={{ ...hudBtnBase, color: '#6b7080' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ff2d78'; e.currentTarget.style.color = '#ff2d78'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1a1e2e'; e.currentTarget.style.color = '#6b7080'; }}
            >
              [ESC] EXIT
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="pointer-events-auto"
              style={{
                ...hudBtnBase,
                color: showSettings ? '#ff6b35' : '#6b7080',
                borderColor: showSettings ? '#ff6b35' : '#1a1e2e',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ff6b35'; e.currentTarget.style.color = '#ff6b35'; }}
              onMouseLeave={(e) => {
                if (!showSettings) { e.currentTarget.style.borderColor = '#1a1e2e'; e.currentTarget.style.color = '#6b7080'; }
              }}
            >
              SETTINGS
            </button>
            <button
              className="pointer-events-auto"
              style={{ ...hudBtnBase, color: '#6b7080' }}
              title="Press F8 in-game"
            >
              [F8] TEST
            </button>
            <button
              onClick={openLoadout}
              className="pointer-events-auto"
              style={{
                ...hudBtnBase,
                color: loadoutOpen ? '#00e5ff' : '#6b7080',
                borderColor: loadoutOpen ? '#00e5ff' : '#1a1e2e',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#00e5ff'; e.currentTarget.style.color = '#00e5ff'; }}
              onMouseLeave={(e) => {
                if (!loadoutOpen) { e.currentTarget.style.borderColor = '#1a1e2e'; e.currentTarget.style.color = '#6b7080'; }
              }}
            >
              [E] LOADOUT
            </button>

            {username && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                marginLeft: '6px', padding: '3px 8px',
                background: 'rgba(12,16,24,0.85)',
                border: '2px solid #1a1e2e',
                borderLeft: '3px solid #76ff03',
              }}>
                <div style={{ width: '6px', height: '6px', background: '#76ff03' }} />
                <span style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '7px',
                  color: '#76ff03',
                  letterSpacing: '0.06em',
                }}>
                  {username}
                </span>
              </div>
            )}
          </div>

          {/* Center: round timer */}
          {roundTimer && (
            <div style={{
              position: 'absolute', left: '50%', transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            }}>
              <span style={{
                fontFamily: 'var(--font-pixel)', fontSize: '6px',
                color: '#4a4e5e', letterSpacing: '0.2em',
              }}>
                {roundTimerLabel}
              </span>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '22px',
                fontWeight: 'bold',
                color: roundTimerCritical ? '#ff2d78' : '#e8e8f0',
                letterSpacing: '0.08em',
                lineHeight: '1',
                padding: '4px 14px',
                background: 'rgba(12,16,24,0.9)',
                border: `2px solid ${roundTimerCritical ? '#ff2d78' : '#1a1e2e'}`,
                animation: roundTimerCritical ? 'hud-critical-flash 1s ease-in-out infinite' : 'none',
              }}>
                {roundTimer}
              </div>
            </div>
          )}

          {/* Right: alive + FPS */}
          <div className="flex items-center gap-4">
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '3px 8px',
              background: 'rgba(12,16,24,0.85)',
              border: '2px solid #1a1e2e',
            }}>
              <span style={{
                fontFamily: 'var(--font-pixel)', fontSize: '6px',
                color: '#4a4e5e', letterSpacing: '0.12em',
              }}>
                ALIVE
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                fontWeight: 'bold',
                color: '#76ff03',
                lineHeight: '1',
              }}>
                {playerCount}
              </span>
            </div>
            <span style={{
              fontFamily: 'var(--font-pixel)', fontSize: '6px', color: '#4a4e5e',
            }}>
              {fps} FPS / {serverTps} TPS
            </span>
          </div>
        </div>

        {/* Compass */}
        {locked && !chatOpen && !loadoutOpen && (
          <div className="flex justify-center">
            <CompassBar heading={heading} />
          </div>
        )}
      </div>
    </div>
  );
}
