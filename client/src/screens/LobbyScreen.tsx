import { useState, useEffect } from 'react';
import { useGameStore } from '../store';
import { menuAudio } from '../menuAudio';

export function LobbyScreen() {
  const { username, connection, setScreen } = useGameStore();
  const settings = useGameStore((s) => s.settings);
  const [mounted, setMounted] = useState(false);

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

  const handleEnterPerf = () => {
    menuAudio.playUIDeploy();
    sessionStorage.setItem('bitwars-open-perf', '1');
    setScreen('game');
  };

  return (
    <div
      className="flex flex-col h-full relative overflow-hidden"
      style={{ background: 'var(--c-bg)' }}
    >
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '800px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(0,255,65,0.04) 0%, transparent 65%)',
          top: '35%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          animation: 'breath 6s ease-in-out infinite',
        }}
      />

      {/* Header */}
      <header
        className="flex items-center justify-between px-8 py-5 relative z-10"
        style={{
          borderBottom: '1px solid var(--c-border)',
          background: 'rgba(6, 8, 16, 0.8)',
          backdropFilter: 'blur(12px)',
          opacity: mounted ? 1 : 0,
          transition: 'opacity 0.4s ease',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div className="flex items-center gap-5">
          <h1
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '20px',
              color: 'var(--c-green)',
              letterSpacing: '0.08em',
              textShadow: '0 0 10px var(--c-green)',
            }}
          >
            BITWARS
          </h1>
        </div>

        <div className="flex items-center gap-6">
          {/* Online count */}
          <div className="flex items-center gap-2">
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: 'var(--c-green)',
                boxShadow: '0 0 6px var(--c-green)',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '15px',
                fontWeight: 600,
                color: '#eaeaf0',
                letterSpacing: '0.05em',
              }}
            >
              {onlineCount} online
            </span>
          </div>

          {/* Player name */}
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--c-amber)',
              letterSpacing: '0.03em',
            }}
          >
            {username}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div
          className="flex flex-col items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 0.5s ease 0.15s',
            gap: '32px',
            width: 'min(480px, calc(100vw - 48px))',
          }}
        >
          {/* Play section */}
          <div className="anim-scale-in w-full" style={{ animationDelay: '0.15s' }}>
            <div
              style={{
                background: 'rgba(15,19,24,0.9)',
                border: '1px solid var(--c-border)',
                padding: '36px 32px 28px',
                textAlign: 'center',
                backdropFilter: 'blur(10px)',
              }}
            >
              <button
                onClick={handleEnterGame}
                onMouseEnter={() => menuAudio.playUIHover()}
                style={{
                  width: '100%',
                  background: 'var(--c-green)',
                  border: 'none',
                  color: '#000',
                  fontFamily: 'var(--font-ui)',
                  fontWeight: 700,
                  fontSize: '24px',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  padding: '22px 32px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: '0 0 30px rgba(0,255,65,0.2)',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 40px rgba(0,255,65,0.4)';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 30px rgba(0,255,65,0.2)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                PLAY
              </button>

              <button
                onClick={handleEnterPerf}
                onMouseEnter={() => menuAudio.playUIHover()}
                style={{
                  width: '100%',
                  marginTop: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                  padding: '12px 16px',
                  letterSpacing: '0.12em',
                  fontFamily: 'var(--font-ui)',
                  border: '1px solid var(--c-border-bright)',
                  color: '#8888a0',
                  background: 'transparent',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  textTransform: 'uppercase',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-cyan)';
                  e.currentTarget.style.color = 'var(--c-cyan)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-border-bright)';
                  e.currentTarget.style.color = '#8888a0';
                }}
              >
                PLAY + TEST HARNESS
              </button>

              <p
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#8888a0',
                  marginTop: '20px',
                  letterSpacing: '0.08em',
                  lineHeight: '1.8',
                }}
              >
                ALL WEAPONS UNLOCKED &bull; NO RULES
              </p>

              {/* Weapon pills */}
              <div className="flex justify-center flex-wrap mt-4" style={{ gap: '8px' }}>
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
                      fontFamily: 'var(--font-ui)',
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '5px 14px',
                      border: `1px solid ${w.color}`,
                      color: w.color,
                      letterSpacing: '0.06em',
                      background: `${w.color}11`,
                    }}
                  >
                    {w.name}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Players list */}
          {onlineCount > 0 && (
            <div className="anim-fade-up w-full" style={{ animationDelay: '0.3s' }}>
              <div
                className="flex items-center justify-between"
                style={{
                  fontFamily: 'var(--font-ui)',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#8888a0',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  marginBottom: '10px',
                  padding: '0 4px',
                }}
              >
                <span>PLAYERS</span>
                <span style={{ color: 'var(--c-green-dim)' }}>{onlineCount}</span>
              </div>
              <div
                style={{
                  background: 'rgba(15,19,24,0.9)',
                  border: '1px solid var(--c-border)',
                  maxHeight: '220px',
                  overflowY: 'auto',
                  backdropFilter: 'blur(6px)',
                }}
              >
                {players.map((p: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between"
                    style={{
                      padding: '10px 16px',
                      fontFamily: 'var(--font-ui)',
                      fontSize: '15px',
                      fontWeight: 600,
                      borderBottom: i < players.length - 1 ? '1px solid var(--c-border)' : 'none',
                      transition: 'background 0.1s',
                      cursor: 'default',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        style={{
                          color: p.username === username ? 'var(--c-amber)' : '#eaeaf0',
                        }}
                      >
                        {p.username || 'Unknown'}
                      </span>
                      {p.username === username && (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#8888a0',
                            letterSpacing: '0.08em',
                          }}
                        >
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4" style={{ fontSize: '14px' }}>
                      <span style={{ color: 'var(--c-green-dim)' }}>K:{p.kills}</span>
                      <span style={{ color: 'var(--c-red-dim)' }}>D:{p.deaths}</span>
                      <span
                        style={{
                          color: '#555570',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13px',
                        }}
                      >
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

      {/* Footer */}
      <footer
        className="flex items-center justify-between px-8 py-4 relative z-10 anim-fade-in"
        style={{
          borderTop: '1px solid var(--c-border)',
          background: 'rgba(6, 8, 16, 0.6)',
          backdropFilter: 'blur(4px)',
          animationDelay: '0.5s',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: '#555570',
            letterSpacing: '0.1em',
          }}
        >
          v0.1.0-ALPHA
        </span>
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: '#555570',
              letterSpacing: '0.1em',
            }}
          >
            SPACETIMEDB
          </span>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--c-green)',
              boxShadow: '0 0 4px var(--c-green)',
            }}
          />
        </div>
      </footer>
    </div>
  );
}
