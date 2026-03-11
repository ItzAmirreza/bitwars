import { useGameStore } from '../store';

export function LobbyScreen() {
  const { username, connection, setScreen } = useGameStore();

  const players = connection
    ? Array.from(connection.db.player.iter()).filter((p: any) => p.online)
    : [];
  const onlineCount = players.length;

  return (
    <div className="scanlines grid-bg flex flex-col h-full relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '800px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,255,65,0.04) 0%, transparent 70%)',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 anim-fade-in relative z-10"
        style={{ borderBottom: '1px solid var(--c-border)' }}
      >
        <div className="flex items-center gap-4">
          <h1
            className="glow-green"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              color: 'var(--c-green)',
              letterSpacing: '0.05em',
            }}
          >
            BITWARS
          </h1>
          <div className="hr-tactical" style={{ width: '40px' }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--c-muted)',
              letterSpacing: '0.15em',
            }}
          >
            COMMAND CENTER
          </span>
        </div>

        <div className="flex items-center gap-6">
          {/* Online count */}
          <div className="flex items-center gap-2">
            <span className="status-dot" />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--c-green-dim)',
                letterSpacing: '0.1em',
              }}
            >
              {onlineCount} ONLINE
            </span>
          </div>

          {/* Player name */}
          <div
            className="flex items-center gap-2 px-3 py-1"
            style={{
              border: '1px solid var(--c-border)',
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
            }}
          >
            <span style={{ color: 'var(--c-muted)', fontSize: '10px' }}>CALLSIGN:</span>
            <span style={{ color: 'var(--c-amber)', letterSpacing: '0.05em' }}>{username}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div className="flex flex-col items-center gap-8">
          {/* Mission briefing box */}
          <div
            className="corner-brackets tactical-border anim-fade-up px-10 py-8 text-center"
            style={{
              animationDelay: '0.2s',
              background: 'linear-gradient(180deg, var(--c-surface) 0%, var(--c-bg2) 100%)',
              minWidth: '400px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--c-muted)',
                letterSpacing: '0.3em',
                marginBottom: '16px',
              }}
            >
              ── MISSION SELECT ──
            </div>

            <button
              onClick={() => setScreen('game')}
              className="btn-primary w-full glitch-hover"
              style={{ fontSize: '18px', padding: '18px 32px' }}
            >
              ENTER SANDBOX
            </button>

            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                marginTop: '16px',
                letterSpacing: '0.1em',
                lineHeight: '1.6',
              }}
            >
              PUBLIC SERVER // EXPLORE, SHOOT, DESTROY
              <br />
              ALL WEAPONS UNLOCKED // NO RULES
            </p>
          </div>

          {/* Online players list */}
          {onlineCount > 0 && (
            <div
              className="anim-fade-up"
              style={{
                animationDelay: '0.4s',
                width: '400px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.2em',
                  marginBottom: '8px',
                }}
              >
                ── ACTIVE OPERATORS ──
              </div>
              <div
                className="tactical-border"
                style={{
                  background: 'var(--c-surface)',
                  padding: '8px 12px',
                  maxHeight: '120px',
                  overflowY: 'auto',
                }}
              >
                {players.map((p: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      borderBottom: i < players.length - 1 ? '1px solid var(--c-border)' : 'none',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="status-dot" style={{ width: '5px', height: '5px' }} />
                      <span style={{ color: 'var(--c-text)' }}>{p.username || 'Unknown'}</span>
                    </div>
                    <span style={{ color: 'var(--c-muted)', fontSize: '9px' }}>
                      K:{p.kills} D:{p.deaths}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <footer
        className="flex items-center justify-between px-6 py-3 anim-fade-in"
        style={{
          borderTop: '1px solid var(--c-border)',
          animationDelay: '0.6s',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--c-muted2)',
            letterSpacing: '0.15em',
          }}
        >
          BITWARS.IO // v0.1.0-ALPHA
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--c-muted2)',
            letterSpacing: '0.15em',
          }}
        >
          SPACETIMEDB MAINCLOUD
        </span>
      </footer>
    </div>
  );
}
