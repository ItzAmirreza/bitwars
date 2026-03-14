import { WEAPON_DATA, WEAPON_INDEXES, STAT_MAX } from './weaponData';
import { WeaponSilhouette, StatBar } from './WeaponSVGs';

export interface LoadoutOverlayProps {
  loadoutDraft: [number, number, number];
  activeLoadoutSlot: number;
  savingLoadout: boolean;
  assignWeaponToSlot: (slot: number, weaponIndex: number) => void;
  saveLoadout: () => void;
  closeLoadout: () => void;
  setActiveLoadoutSlot: (slot: number) => void;
}

export function LoadoutOverlay({
  loadoutDraft,
  activeLoadoutSlot,
  savingLoadout,
  assignWeaponToSlot,
  saveLoadout,
  closeLoadout,
  setActiveLoadoutSlot,
}: LoadoutOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      style={{
        background: 'radial-gradient(circle at center, rgba(8,12,20,0.9) 0%, rgba(4,6,12,0.96) 65%, rgba(2,3,8,0.99) 100%)',
        backdropFilter: 'blur(8px)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(960px, calc(100vw - 28px))',
          maxHeight: 'calc(100vh - 34px)',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(14,20,32,0.95) 0%, rgba(8,12,22,0.97) 100%)',
          border: '1px solid rgba(102,224,255,0.2)',
          boxShadow: '0 30px 100px rgba(0,0,0,0.6), inset 0 0 60px rgba(102,224,255,0.06)',
          borderRadius: '12px',
          padding: '24px 28px',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: '12px', marginBottom: '20px',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-pixel)', fontSize: '18px', letterSpacing: '0.1em',
              color: 'var(--c-cyan)',
              textShadow: '0 0 20px rgba(102,224,255,0.35), 0 0 40px rgba(102,224,255,0.15)',
            }}>
              WEAPON LOADOUT
            </div>
            <div style={{
              marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px',
              letterSpacing: '0.08em', color: 'var(--c-muted)', lineHeight: '1.6',
            }}>
              <span style={{ color: 'var(--c-cyan)', opacity: 0.8 }}>1.</span> Click a slot below &nbsp;
              <span style={{ color: 'var(--c-cyan)', opacity: 0.8 }}>2.</span> Choose a weapon from the arsenal &nbsp;
              <span style={{ color: 'var(--c-cyan)', opacity: 0.8 }}>3.</span> Save
            </div>
          </div>
          <button
            onClick={closeLoadout}
            className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--c-muted)',
              background: 'rgba(6,8,16,0.65)', border: '1px solid var(--c-border)',
              letterSpacing: '0.1em', borderRadius: '4px', flexShrink: 0,
            }}
          >
            [E] CLOSE
          </button>
        </div>

        {/* ── Section: Your Loadout Slots ── */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.2em',
          color: 'var(--c-muted)', marginBottom: '8px', textTransform: 'uppercase',
        }}>
          YOUR LOADOUT <span style={{ opacity: 0.5 }}>— click a slot to edit, or press 1 / 2 / 3</span>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px',
          marginBottom: '20px',
        }}>
          {[0, 1, 2].map((slot) => {
            const weaponIndex = loadoutDraft[slot];
            const weapon = WEAPON_DATA[weaponIndex]!;
            const isActive = activeLoadoutSlot === slot;
            return (
              <button
                key={slot}
                onClick={() => setActiveLoadoutSlot(slot)}
                style={{
                  position: 'relative',
                  background: isActive
                    ? `linear-gradient(180deg, ${weapon.rawColor}18 0%, ${weapon.rawColor}08 100%)`
                    : 'rgba(6,8,16,0.7)',
                  border: isActive
                    ? `2px solid ${weapon.rawColor}`
                    : '1px solid var(--c-border)',
                  borderRadius: '10px',
                  padding: isActive ? '12px 14px 10px' : '13px 15px 11px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isActive
                    ? `0 0 20px ${weapon.rawColor}20, inset 0 0 30px ${weapon.rawColor}08`
                    : 'none',
                  overflow: 'hidden',
                }}
              >
                {/* Active editing indicator */}
                {isActive && (
                  <div style={{
                    position: 'absolute', top: '6px', right: '8px',
                    fontFamily: 'var(--font-mono)', fontSize: '7px', letterSpacing: '0.15em',
                    color: weapon.rawColor, background: `${weapon.rawColor}20`,
                    padding: '2px 6px', borderRadius: '3px',
                    border: `1px solid ${weapon.rawColor}40`,
                    animation: 'weapon-silhouette-pulse 2s ease-in-out infinite',
                  }}>
                    EDITING
                  </div>
                )}

                {/* Key binding badge */}
                <div style={{
                  position: 'absolute', top: '6px', left: '8px',
                  fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 'bold',
                  color: isActive ? weapon.rawColor : 'var(--c-muted)',
                  background: isActive ? `${weapon.rawColor}20` : 'rgba(255,255,255,0.05)',
                  width: '20px', height: '20px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  borderRadius: '4px', border: isActive
                    ? `1px solid ${weapon.rawColor}40` : '1px solid var(--c-border)',
                }}>
                  {slot + 1}
                </div>

                {/* Slot label */}
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.15em',
                  color: isActive ? weapon.rawColor : 'var(--c-muted)',
                  marginBottom: '6px',
                }}>
                  SLOT {slot + 1}
                </div>

                {/* Weapon silhouette (larger) */}
                <div style={{
                  display: 'flex', justifyContent: 'center', marginBottom: '6px',
                  opacity: isActive ? 1 : 0.5,
                  transition: 'opacity 0.2s ease',
                }}>
                  <WeaponSilhouette weaponIndex={weaponIndex} color={weapon.rawColor} active={isActive} />
                </div>

                {/* Weapon name */}
                <div style={{
                  fontFamily: 'var(--font-ui)', fontSize: '14px', fontWeight: 700,
                  color: isActive ? weapon.color : 'var(--c-muted)',
                  letterSpacing: '0.06em',
                  textShadow: isActive ? `0 0 10px ${weapon.rawColor}30` : 'none',
                }}>
                  {weapon.name}
                </div>

                {/* Bottom glow bar for active slot */}
                {isActive && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: '10%', right: '10%', height: '2px',
                    background: weapon.rawColor,
                    boxShadow: `0 0 8px ${weapon.rawColor}, 0 -3px 12px ${weapon.rawColor}30`,
                    borderRadius: '1px',
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Section: Weapon Arsenal ── */}
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.2em',
          color: 'var(--c-muted)', marginBottom: '8px', textTransform: 'uppercase',
        }}>
          ARSENAL <span style={{ opacity: 0.5 }}>— pick a weapon for</span>{' '}
          <span style={{ color: WEAPON_DATA[loadoutDraft[activeLoadoutSlot]]?.rawColor ?? 'var(--c-cyan)' }}>
            SLOT {activeLoadoutSlot + 1}
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
          gap: '8px',
        }}>
          {WEAPON_INDEXES.map((weaponIndex) => {
            const weapon = WEAPON_DATA[weaponIndex];
            const inSlot = loadoutDraft.indexOf(weaponIndex);
            const isAssignedToActive = inSlot === activeLoadoutSlot;
            const isInOtherSlot = inSlot >= 0 && !isAssignedToActive;
            return (
              <button
                key={weapon.name}
                onClick={() => assignWeaponToSlot(activeLoadoutSlot, weaponIndex)}
                className="loadout-weapon-card"
                style={{
                  position: 'relative',
                  background: isAssignedToActive
                    ? `linear-gradient(180deg, ${weapon.rawColor}1a 0%, ${weapon.rawColor}08 100%)`
                    : isInOtherSlot
                      ? `${weapon.rawColor}0a`
                      : 'rgba(6,8,16,0.65)',
                  border: isAssignedToActive
                    ? `2px solid ${weapon.rawColor}`
                    : isInOtherSlot
                      ? `1px solid ${weapon.rawColor}66`
                      : '1px solid var(--c-border)',
                  borderRadius: '8px',
                  padding: isAssignedToActive ? '10px 11px 10px' : '11px 12px 11px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  alignItems: 'stretch',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  overflow: 'hidden',
                }}
              >
                {/* Slot assignment badge */}
                {inSlot >= 0 && (
                  <div style={{
                    position: 'absolute', top: '6px', right: '6px',
                    fontFamily: 'var(--font-mono)', fontSize: '7px', fontWeight: 'bold',
                    letterSpacing: '0.1em',
                    color: isAssignedToActive ? weapon.rawColor : `${weapon.rawColor}cc`,
                    background: isAssignedToActive ? `${weapon.rawColor}25` : `${weapon.rawColor}15`,
                    padding: '2px 5px', borderRadius: '3px',
                    border: `1px solid ${weapon.rawColor}${isAssignedToActive ? '50' : '30'}`,
                  }}>
                    SLOT {inSlot + 1}
                  </div>
                )}

                {/* Weapon type badge */}
                <div style={{
                  alignSelf: 'flex-start',
                  fontFamily: 'var(--font-mono)', fontSize: '7px', letterSpacing: '0.15em',
                  color: weapon.rawColor,
                  background: `${weapon.rawColor}18`,
                  padding: '2px 6px', borderRadius: '3px',
                  border: `1px solid ${weapon.rawColor}30`,
                }}>
                  {weapon.type}
                </div>

                {/* Icon + Name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                  <div style={{ flexShrink: 0, opacity: isAssignedToActive ? 1 : 0.7 }}>
                    <WeaponSilhouette weaponIndex={weaponIndex} color={weapon.rawColor} active={isAssignedToActive} />
                  </div>
                </div>

                {/* Name */}
                <div style={{
                  fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 700,
                  color: weapon.color, letterSpacing: '0.05em',
                  textShadow: isAssignedToActive ? `0 0 8px ${weapon.rawColor}30` : 'none',
                }}>
                  {weapon.name}
                </div>

                {/* Description */}
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '8px', lineHeight: '1.5',
                  color: 'var(--c-muted)', letterSpacing: '0.04em',
                  minHeight: '24px',
                }}>
                  {weapon.desc}
                </div>

                {/* Stat bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '2px' }}>
                  <StatBar label="DMG" value={weapon.damage} max={STAT_MAX.damage} color={weapon.rawColor} />
                  <StatBar label="ROF" value={weapon.fireRate} max={STAT_MAX.fireRate} color={weapon.rawColor} />
                  <StatBar label="RNG" value={weapon.range} max={STAT_MAX.range} color={weapon.rawColor} />
                  <StatBar label="MAG" value={weapon.ammo} max={STAT_MAX.ammo} color={weapon.rawColor} />
                </div>

                {/* Status line */}
                <div style={{
                  marginTop: '4px',
                  fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.12em',
                  color: isAssignedToActive
                    ? weapon.rawColor
                    : isInOtherSlot
                      ? `${weapon.rawColor}aa`
                      : 'var(--c-muted2)',
                  textAlign: 'center',
                }}>
                  {isAssignedToActive
                    ? `EQUIPPED IN SLOT ${inSlot + 1}`
                    : isInOtherSlot
                      ? `IN SLOT ${inSlot + 1} — CLICK TO SWAP`
                      : 'CLICK TO EQUIP'}
                </div>

                {/* Bottom glow for equipped weapon */}
                {isAssignedToActive && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: '15%', right: '15%', height: '2px',
                    background: weapon.rawColor,
                    boxShadow: `0 0 6px ${weapon.rawColor}, 0 -2px 8px ${weapon.rawColor}30`,
                    borderRadius: '1px',
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div style={{
          marginTop: '18px', display: 'flex', justifyContent: 'flex-end',
          alignItems: 'center', gap: '10px',
        }}>
          <button
            onClick={closeLoadout}
            className="pointer-events-auto cursor-pointer px-5 py-2 hud-btn"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '10px',
              color: 'var(--c-muted)', background: 'rgba(6,8,16,0.65)',
              border: '1px solid var(--c-border)', letterSpacing: '0.1em',
              borderRadius: '6px',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={() => { void saveLoadout(); }}
            disabled={savingLoadout}
            className="pointer-events-auto cursor-pointer px-5 py-2 hud-btn"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 'bold',
              color: 'var(--c-cyan)', background: 'rgba(6,18,28,0.75)',
              border: '1px solid rgba(102,224,255,0.5)', letterSpacing: '0.1em',
              borderRadius: '6px', opacity: savingLoadout ? 0.7 : 1,
              boxShadow: savingLoadout ? 'none' : '0 0 15px rgba(102,224,255,0.15)',
              transition: 'all 0.15s ease',
            }}
          >
            {savingLoadout ? 'SAVING...' : 'SAVE LOADOUT'}
          </button>
        </div>
      </div>
    </div>
  );
}
