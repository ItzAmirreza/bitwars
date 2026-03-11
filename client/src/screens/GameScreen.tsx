import { useEffect, useRef, useState } from 'react';
import { Engine } from '../game/Engine';
import type { EngineState } from '../game/Engine';
import { useGameStore } from '../store';

const WEAPON_DATA = [
  { name: 'RIFLE', key: '1', color: 'var(--c-blue)' },
  { name: 'SHOTGUN', key: '2', color: 'var(--c-amber)' },
  { name: 'RPG', key: '3', color: 'var(--c-red)' },
] as const;

export function GameScreen() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const { connection, setScreen } = useGameStore();

  const [state, setState] = useState<EngineState>({
    weapon: 0,
    ammo: 30,
    maxAmmo: 30,
    weaponName: 'Rifle',
    weaponColor: '#4488ff',
    fps: 0,
    locked: false,
    playerCount: 1,
    health: 100,
    kills: 0,
    deaths: 0,
    hitMarker: false,
  });

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || engineRef.current) return;

    engineRef.current = new Engine(container, connection, setState);

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [connection]);

  const handleLeave = () => setScreen('lobby');
  const healthColor = state.health > 50 ? 'var(--c-green)' : state.health > 25 ? 'var(--c-amber)' : 'var(--c-red)';

  return (
    <div className="flex flex-col h-full relative">
      {/* Game Canvas */}
      <div ref={canvasRef} className="absolute inset-0" />

      {/* ═══ HUD OVERLAY ═══ */}

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            background: 'linear-gradient(180deg, rgba(6,8,16,0.7) 0%, transparent 100%)',
          }}
        >
          <button
            onClick={handleLeave}
            className="pointer-events-auto cursor-pointer px-3 py-1"
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

          <div className="flex items-center gap-4">
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.1em',
              }}
            >
              <span style={{ color: 'var(--c-green-dim)' }}>{state.playerCount}</span> ACTIVE
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted2)',
              }}
            >
              {state.fps} FPS
            </span>
          </div>
        </div>
      </div>

      {/* Crosshair + Hit Marker */}
      {state.locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="relative" style={{ width: '24px', height: '24px' }}>
            {/* Top */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ top: '0', width: '2px', height: '7px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Bottom */}
            <div className="absolute left-1/2 -translate-x-1/2" style={{ bottom: '0', width: '2px', height: '7px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Left */}
            <div className="absolute top-1/2 -translate-y-1/2" style={{ left: '0', width: '7px', height: '2px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Right */}
            <div className="absolute top-1/2 -translate-y-1/2" style={{ right: '0', width: '7px', height: '2px', background: 'rgba(255,255,255,0.7)' }} />
            {/* Center dot */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: '2px', height: '2px', background: 'rgba(255,255,255,0.9)' }} />

            {/* Hit marker X — flashes on block hit */}
            {state.hitMarker && (
              <>
                <div className="absolute top-1/2 left-1/2" style={{
                  width: '14px', height: '2px',
                  background: 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                  boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                }} />
                <div className="absolute top-1/2 left-1/2" style={{
                  width: '14px', height: '2px',
                  background: 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(-45deg)',
                  boxShadow: '0 0 6px rgba(255,255,255,0.5)',
                }} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Click to play overlay */}
      {!state.locked && (
        <div
          className="absolute inset-0 flex items-center justify-center z-20 cursor-pointer"
          onClick={() => canvasRef.current?.requestPointerLock()}
          style={{ background: 'rgba(6,8,16,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div className="text-center pointer-events-none">
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-pixel)',
                fontSize: '20px',
                color: 'var(--c-green)',
                letterSpacing: '0.05em',
                marginBottom: '8px',
                textShadow: '0 0 20px rgba(0,255,65,0.5)',
              }}
            >
              CLICK TO DEPLOY
            </div>
            <div className="hr-tactical" style={{ width: '200px', margin: '16px auto' }} />
            <div
              className="anim-fade-up"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted)',
                letterSpacing: '0.15em',
                lineHeight: '2.2',
                animationDelay: '0.2s',
              }}
            >
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>WASD</span> MOVE</span>
                <span><span style={{ color: 'var(--c-text)' }}>MOUSE</span> AIM</span>
                <span><span style={{ color: 'var(--c-text)' }}>LMB</span> FIRE</span>
              </div>
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>SPACE</span> JUMP</span>
                <span><span style={{ color: 'var(--c-text)' }}>R</span> RELOAD</span>
                <span><span style={{ color: 'var(--c-text)' }}>1-3</span> WEAPONS</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BOTTOM HUD ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div
          className="px-4 pb-4 pt-12"
          style={{
            background: 'linear-gradient(0deg, rgba(6,8,16,0.6) 0%, transparent 100%)',
          }}
        >
          <div className="flex items-end justify-between">

            {/* LEFT: Health + Weapon */}
            <div className="flex flex-col gap-2">
              {/* Health */}
              <div
                className="flex items-center gap-3 px-3 py-2"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    color: 'var(--c-muted)',
                    letterSpacing: '0.1em',
                  }}
                >
                  HP
                </span>
                <div
                  style={{
                    width: '100px',
                    height: '4px',
                    background: 'var(--c-border)',
                    position: 'relative',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${state.health}%`,
                      background: healthColor,
                      transition: 'all 0.3s ease',
                      boxShadow: `0 0 8px ${healthColor}`,
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: healthColor,
                    fontWeight: 'bold',
                    minWidth: '30px',
                    textAlign: 'right',
                    textShadow: `0 0 10px ${healthColor}`,
                  }}
                >
                  {state.health}
                </span>
              </div>

              {/* Weapon + Ammo */}
              <div
                className="flex items-center gap-4 px-3 py-2"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '16px',
                    fontWeight: 700,
                    color: WEAPON_DATA[state.weapon].color,
                    letterSpacing: '0.1em',
                    textShadow: `0 0 10px ${WEAPON_DATA[state.weapon].color}`,
                  }}
                >
                  {WEAPON_DATA[state.weapon].name}
                </span>
                <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }} />
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '18px',
                    color: state.ammo === 0 ? 'var(--c-red)' : 'var(--c-text)',
                    fontWeight: 'bold',
                  }}
                >
                  {state.ammo}
                  <span style={{ fontSize: '11px', color: 'var(--c-muted)', fontWeight: 'normal' }}>
                    /{state.maxAmmo}
                  </span>
                </div>
              </div>
            </div>

            {/* RIGHT: K/D + Weapon slots */}
            <div className="flex flex-col items-end gap-2">
              {/* K/D */}
              <div
                className="flex items-center gap-3 px-3 py-1"
                style={{
                  background: 'rgba(6,8,16,0.7)',
                  border: '1px solid var(--c-border)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <span style={{ color: 'var(--c-muted)', fontSize: '9px', letterSpacing: '0.1em' }}>KILLS</span>
                <span style={{ color: 'var(--c-green)', fontWeight: 'bold' }}>{state.kills}</span>
                <div style={{ width: '1px', height: '12px', background: 'var(--c-border)' }} />
                <span style={{ color: 'var(--c-muted)', fontSize: '9px', letterSpacing: '0.1em' }}>DEATHS</span>
                <span style={{ color: 'var(--c-red)', fontWeight: 'bold' }}>{state.deaths}</span>
              </div>

              {/* Weapon slots */}
              <div className="flex gap-1">
                {WEAPON_DATA.map((w, i) => {
                  const active = state.weapon === i;
                  return (
                    <div
                      key={w.name}
                      className="flex items-center gap-1 px-3 py-2"
                      style={{
                        background: active ? 'rgba(255,255,255,0.07)' : 'rgba(6,8,16,0.7)',
                        border: active ? `1px solid ${w.color}` : '1px solid var(--c-border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        letterSpacing: '0.05em',
                        transition: 'all 0.15s ease',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      <span style={{ color: 'var(--c-muted)', fontSize: '9px' }}>{w.key}</span>
                      <span style={{ color: active ? w.color : 'var(--c-muted)' }}>{w.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
