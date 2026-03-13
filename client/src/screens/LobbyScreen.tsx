import { useState, useEffect } from 'react';
import { useGameStore } from '../store';
import { menuAudio } from '../menuAudio';

export function LobbyScreen() {
  const { username, connection, setScreen } = useGameStore();
  const settings = useGameStore((s) => s.settings);
  const [mounted, setMounted] = useState(false);
  const [hoverDeploy, setHoverDeploy] = useState(false);

  const players = connection
    ? Array.from(connection.db.player.iter()).filter((p: any) => p.online)
    : [];
  const onlineCount = players.length;

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
    menuAudio.startMenuAmbience();
    menuAudio.playUINavigate();
    setMounted(true);
    return () => {
      menuAudio.stopMenuAmbience();
    };
  }, []);

  useEffect(() => {
    menuAudio.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume]);

  const handleEnterGame = () => {
    menuAudio.playUIDeploy();
    setScreen('game');
  };

  return (
    <div className="scanlines hex-bg flex flex-col h-full relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none anim-breath"
        style={{
          width: '1000px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,255,65,0.06) 0%, rgba(0,170,255,0.02) 40%, transparent 70%)',
          top: '30%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 py-4 anim-fade-in relative z-10"
        style={{
          borderBottom: '1px solid var(--c-border)',
          background: 'rgba(6, 8, 16, 0.6)',
          backdropFilter: 'blur(8px)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.4s ease',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div className="flex items-center gap-4">
          <h1
            className="glow-green"
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '16px',
              color: 'var(--c-green)',
              letterSpacing: '0.05em',
            }}
          >
            BITWARS
          </h1>
          <div className="gradient-line" style={{ width: '40px' }} />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
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
                fontSize: '13px',
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
              background: 'rgba(0, 255, 65, 0.03)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
            }}
          >
            <span style={{ color: 'var(--c-muted)', fontSize: '11px' }}>CALLSIGN:</span>
            <span style={{ color: 'var(--c-amber)', letterSpacing: '0.05em' }}>{username}</span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div
          className="flex flex-col items-center gap-8"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s ease 0.2s',
          }}
        >
          {/* Mission briefing box */}
          <div
            className="anim-scale-in"
            style={{
              animationDelay: '0.2s',
              width: 'min(500px, calc(100vw - 40px))',
              position: 'relative',
            }}
          >
            {/* Top glow line */}
            <div
              className="gradient-line"
              style={{ position: 'absolute', top: 0, left: '10%', right: '10%' }}
            />

            <div
              className="corner-brackets px-10 py-8 text-center"
              style={{
                background: 'linear-gradient(180deg, rgba(15,19,24,0.95) 0%, rgba(10,14,20,0.95) 100%)',
                border: '1px solid var(--c-border)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.3em',
                  marginBottom: '20px',
                }}
              >
                MISSION SELECT
              </div>

              <button
                onClick={handleEnterGame}
                onMouseEnter={() => {
                  setHoverDeploy(true);
                  menuAudio.playUIHover();
                }}
                onMouseLeave={() => setHoverDeploy(false)}
                className="btn-primary w-full glitch-hover"
                style={{
                  fontSize: '22px',
                  padding: '22px 32px',
                  letterSpacing: '0.2em',
                }}
              >
                ENTER SANDBOX
              </button>

              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--c-muted)',
                  marginTop: '20px',
                  letterSpacing: '0.1em',
                  lineHeight: '1.8',
                }}
              >
                PUBLIC SERVER // EXPLORE, SHOOT, DESTROY
                <br />
                <span style={{ color: 'var(--c-green-dim)' }}>ALL WEAPONS UNLOCKED</span> // NO RULES
              </p>

              {/* Weapon preview row */}
              <div
                className="flex justify-center gap-2 mt-5"
                style={{ opacity: hoverDeploy ? 1 : 0.5, transition: 'opacity 0.3s', flexWrap: 'wrap' }}
              >
                {[
                  { name: 'RIFLE', color: 'var(--c-blue)' },
                  { name: 'SHOTGUN', color: 'var(--c-amber)' },
                  { name: 'RPG', color: 'var(--c-red)' },
                  { name: 'MACHINE GUN', color: 'var(--c-cyan)' },
                  { name: 'GRENADE', color: 'var(--c-green)' },
                ].map((w) => (
                  <div
                    key={w.name}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      padding: '5px 12px',
                      border: `1px solid ${w.color}`,
                      color: w.color,
                      letterSpacing: '0.08em',
                      background: `${w.color}11`,
                    }}
                  >
                    {w.name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Online players list */}
          {onlineCount > 0 && (
            <div
              className="anim-fade-up"
              style={{
                animationDelay: '0.4s',
                width: 'min(500px, calc(100vw - 40px))',
              }}
            >
              <div
                className="flex items-center justify-between"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.2em',
                  marginBottom: '8px',
                  padding: '0 2px',
                }}
              >
                <span>ACTIVE OPERATORS</span>
                <span style={{ color: 'var(--c-green-dim)' }}>{onlineCount}</span>
              </div>
              <div
                style={{
                  background: 'rgba(15, 19, 24, 0.9)',
                  border: '1px solid var(--c-border)',
                  padding: '4px',
                  maxHeight: '200px',
                  overflowY: 'auto',
                  backdropFilter: 'blur(6px)',
                  position: 'relative',
                }}
              >
                {/* Top gradient line */}
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '20px',
                    right: '20px',
                    height: '1px',
                    background: 'linear-gradient(90deg, transparent, var(--c-green-dim), transparent)',
                  }}
                />
                {players.map((p: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2 px-3"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      borderBottom: i < players.length - 1 ? '1px solid rgba(26, 34, 48, 0.6)' : 'none',
                      transition: 'background 0.15s',
                      cursor: 'default',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 65, 0.03)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="status-dot" style={{ width: '6px', height: '6px' }} />
                      <span style={{ color: p.username === username ? 'var(--c-amber)' : 'var(--c-text)' }}>
                        {p.username || 'Unknown'}
                      </span>
                      {p.username === username && (
                        <span style={{ fontSize: '10px', color: 'var(--c-muted)', letterSpacing: '0.1em' }}>YOU</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3" style={{ fontSize: '12px' }}>
                      <span style={{ color: 'var(--c-green-dim)' }}>K:{p.kills}</span>
                      <span style={{ color: 'var(--c-red-dim)' }}>D:{p.deaths}</span>
                      <span style={{ color: 'var(--c-muted2)' }}>
                        {p.kills + p.deaths > 0
                          ? ((p.kills / Math.max(1, p.deaths)) as number).toFixed(1)
                          : '0.0'}
                      </span>
                    </div>
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
          background: 'rgba(6, 8, 16, 0.6)',
          backdropFilter: 'blur(4px)',
          animationDelay: '0.6s',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--c-muted2)',
            letterSpacing: '0.15em',
          }}
        >
          BITWARS.IO // v0.1.0-ALPHA
        </span>
        <div className="flex items-center gap-4">
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--c-muted2)',
              letterSpacing: '0.15em',
            }}
          >
            SPACETIMEDB MAINCLOUD
          </span>
          <div className="status-dot" style={{ width: '6px', height: '6px' }} />
        </div>
      </footer>
    </div>
  );
}
