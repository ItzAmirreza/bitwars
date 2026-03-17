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

export interface TopHudBarProps {
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  loadoutOpen: boolean;
  chatOpen: boolean;
  username: string | null;
  roundTimer: string;
  playerCount: number;
  fps: number;
  serverTps: number;
  heading: number;
  locked: boolean;
  handleLeave: () => void;
  openLoadout: () => void;
}

export function TopHudBar({
  showSettings,
  setShowSettings,
  loadoutOpen,
  chatOpen,
  username,
  roundTimer,
  playerCount,
  fps,
  serverTps,
  heading,
  locked,
  handleLeave,
  openLoadout,
}: TopHudBarProps) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
      <div style={{
        background: 'linear-gradient(180deg, rgba(6,8,16,0.8) 0%, rgba(6,8,16,0.3) 70%, transparent 100%)',
        paddingBottom: '8px',
      }}>
        {/* Top row: buttons + round timer + info */}
        <div className="flex items-center justify-between px-4 py-2">
          {/* Left: buttons + player name */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleLeave}
              className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                background: 'rgba(6,8,16,0.6)',
                border: '1px solid var(--c-border)',
                letterSpacing: '0.1em',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--c-red)';
                e.currentTarget.style.color = 'var(--c-red)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--c-border)';
                e.currentTarget.style.color = 'var(--c-muted)';
              }}
            >
              [ESC] EXIT
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: showSettings ? 'var(--c-green)' : 'var(--c-muted)',
                background: 'rgba(6,8,16,0.6)',
                border: `1px solid ${showSettings ? 'var(--c-green)' : 'var(--c-border)'}`,
                letterSpacing: '0.1em',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--c-green)';
                e.currentTarget.style.color = 'var(--c-green)';
              }}
              onMouseLeave={(e) => {
                if (!showSettings) {
                  e.currentTarget.style.borderColor = 'var(--c-border)';
                  e.currentTarget.style.color = 'var(--c-muted)';
                }
              }}
            >
              SETTINGS
            </button>
            <button
              onClick={openLoadout}
              className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: loadoutOpen ? 'var(--c-cyan)' : 'var(--c-muted)',
                background: 'rgba(6,8,16,0.6)',
                border: `1px solid ${loadoutOpen ? 'var(--c-cyan)' : 'var(--c-border)'}`,
                letterSpacing: '0.1em',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--c-cyan)';
                e.currentTarget.style.color = 'var(--c-cyan)';
              }}
              onMouseLeave={(e) => {
                if (!loadoutOpen) {
                  e.currentTarget.style.borderColor = 'var(--c-border)';
                  e.currentTarget.style.color = 'var(--c-muted)';
                }
              }}
            >
              [E] LOADOUT
            </button>

            {/* Player name display */}
            {username && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginLeft: '8px',
                padding: '3px 10px',
                background: 'rgba(6,8,16,0.5)',
                border: '1px solid rgba(0,255,65,0.15)',
                borderLeft: '2px solid var(--c-green)',
              }}>
                <div style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--c-green)',
                  boxShadow: '0 0 6px var(--c-green)',
                }} />
                <span style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '12px',
                  fontWeight: 700,
                  color: 'var(--c-green)',
                  letterSpacing: '0.08em',
                  textShadow: '0 0 8px rgba(0,255,65,0.3)',
                }}>
                  {username}
                </span>
              </div>
            )}
          </div>

          {/* Center: round timer (Valorant style) */}
          {roundTimer && (
            <div style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '8px',
                color: 'var(--c-muted)',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
              }}>
                ROUND
              </span>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '22px',
                fontWeight: 'bold',
                color: roundTimer.startsWith('0:') ? 'var(--c-red)' : 'var(--c-text)',
                letterSpacing: '0.08em',
                textShadow: roundTimer.startsWith('0:') ? '0 0 12px var(--c-red)' : '0 0 6px rgba(255,255,255,0.15)',
                lineHeight: '1',
                padding: '4px 16px',
                background: 'rgba(6,8,16,0.7)',
                border: `1px solid ${roundTimer.startsWith('0:') ? 'rgba(255,0,51,0.4)' : 'var(--c-border)'}`,
                borderRadius: '2px',
                animation: roundTimer.startsWith('0:') ? 'hud-critical-flash 1s ease-in-out infinite' : 'none',
              }}>
                {roundTimer}
              </div>
            </div>
          )}

          {/* Right: alive counter + player count + FPS */}
          <div className="flex items-center gap-4">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              background: 'rgba(6,8,16,0.5)',
              border: '1px solid var(--c-border)',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--c-muted)',
                letterSpacing: '0.12em',
              }}>
                ALIVE
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                fontWeight: 'bold',
                color: 'var(--c-green)',
                textShadow: '0 0 6px rgba(0,255,65,0.3)',
                lineHeight: '1',
              }}>
                {playerCount}
              </span>
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--c-muted2)',
            }}>
              {fps} FPS / {serverTps} TPS
            </span>
          </div>
        </div>

        {/* Compass bar (centered) */}
        {locked && !chatOpen && !loadoutOpen && (
          <div className="flex justify-center">
            <CompassBar heading={heading} />
          </div>
        )}
      </div>
    </div>
  );
}
