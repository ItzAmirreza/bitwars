// ── Weapon SVG silhouettes ──
function RifleSVG({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="rifle-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         filter={glow ? 'url(#rifle-glow)' : undefined} opacity={glow ? 1 : 0.6}>
        {/* Barrel */}
        <line x1="2" y1="12" x2="38" y2="12" />
        {/* Front sight */}
        <line x1="35" y1="9" x2="35" y2="12" />
        {/* Receiver body */}
        <rect x="38" y="9" width="22" height="7" rx="1" />
        {/* Magazine */}
        <rect x="46" y="16" width="6" height="8" rx="0.5" />
        {/* Stock */}
        <line x1="60" y1="10" x2="76" y2="10" />
        <line x1="60" y1="16" x2="72" y2="16" />
        <line x1="76" y1="10" x2="76" y2="14" />
        <line x1="72" y1="16" x2="76" y2="14" />
        {/* Grip */}
        <line x1="56" y1="16" x2="54" y2="24" />
        <line x1="54" y1="24" x2="58" y2="24" />
        <line x1="58" y1="24" x2="59" y2="18" />
        {/* Trigger guard */}
        <path d="M50 16 Q50 20 54 20" fill="none" />
      </g>
    </svg>
  );
}

function ShotgunSVG({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="shotgun-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         filter={glow ? 'url(#shotgun-glow)' : undefined} opacity={glow ? 1 : 0.6}>
        {/* Double barrel */}
        <line x1="2" y1="11" x2="36" y2="11" />
        <line x1="2" y1="14" x2="36" y2="14" />
        {/* Barrel end */}
        <ellipse cx="3" cy="12.5" rx="2" ry="2.5" />
        {/* Pump */}
        <rect x="22" y="9" width="10" height="8" rx="1" />
        {/* Receiver */}
        <rect x="36" y="9" width="16" height="8" rx="1" />
        {/* Stock */}
        <line x1="52" y1="10" x2="76" y2="10" />
        <line x1="52" y1="17" x2="68" y2="17" />
        <line x1="76" y1="10" x2="76" y2="14" />
        <line x1="68" y1="17" x2="76" y2="14" />
        {/* Grip */}
        <line x1="48" y1="17" x2="46" y2="24" />
        <line x1="46" y1="24" x2="50" y2="24" />
        <line x1="50" y1="24" x2="51" y2="19" />
        {/* Trigger guard */}
        <path d="M44 17 Q44 21 47 21" fill="none" />
      </g>
    </svg>
  );
}

function RpgSVG({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="rpg-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         filter={glow ? 'url(#rpg-glow)' : undefined} opacity={glow ? 1 : 0.6}>
        {/* Warhead cone */}
        <path d="M2 12.5 L12 9 L12 16 Z" />
        {/* Tube */}
        <rect x="12" y="9" width="44" height="7" rx="2" />
        {/* Wider front opening ring */}
        <ellipse cx="12" cy="12.5" rx="1" ry="4" />
        {/* Rear exhaust opening */}
        <ellipse cx="56" cy="12.5" rx="1" ry="4.5" />
        {/* Rear flare */}
        <line x1="56" y1="8" x2="60" y2="6" />
        <line x1="56" y1="17" x2="60" y2="19" />
        {/* Grip + trigger */}
        <line x1="36" y1="16" x2="34" y2="24" />
        <line x1="34" y1="24" x2="38" y2="24" />
        <line x1="38" y1="24" x2="39" y2="18" />
        {/* Sight */}
        <line x1="24" y1="5" x2="24" y2="9" />
        <line x1="22" y1="5" x2="26" y2="5" />
        {/* Shoulder rest */}
        <rect x="48" y="16" width="8" height="4" rx="1" />
      </g>
    </svg>
  );
}

function MachineGunSVG({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="mg-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         filter={glow ? 'url(#mg-glow)' : undefined} opacity={glow ? 1 : 0.6}>
        <line x1="2" y1="12" x2="40" y2="12" />
        <rect x="40" y="8" width="20" height="9" rx="1" />
        <rect x="28" y="9" width="10" height="7" rx="1" />
        <rect x="45" y="17" width="10" height="6" rx="1" />
        <line x1="60" y1="10" x2="76" y2="10" />
        <line x1="60" y1="17" x2="72" y2="17" />
        <line x1="76" y1="10" x2="76" y2="14" />
        <line x1="72" y1="17" x2="76" y2="14" />
      </g>
    </svg>
  );
}

function GrenadeSVG({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <svg width="80" height="28" viewBox="0 0 80 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {glow && (
        <defs>
          <filter id="grenade-glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      )}
      <g stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
         filter={glow ? 'url(#grenade-glow)' : undefined} opacity={glow ? 1 : 0.6}>
        <ellipse cx="12" cy="13" rx="7" ry="6" />
        <line x1="16" y1="8" x2="22" y2="5" />
        <line x1="22" y1="5" x2="27" y2="5" />
        <rect x="27" y="4" width="43" height="9" rx="2" />
        <line x1="70" y1="8.5" x2="76" y2="8.5" />
        <line x1="50" y1="13" x2="50" y2="23" />
      </g>
    </svg>
  );
}

function WeaponSilhouette({ weaponIndex, color, active }: { weaponIndex: number; color: string; active: boolean }) {
  switch (weaponIndex) {
    case 0: return <RifleSVG color={color} glow={active} />;
    case 1: return <ShotgunSVG color={color} glow={active} />;
    case 2: return <RpgSVG color={color} glow={active} />;
    case 3: return <MachineGunSVG color={color} glow={active} />;
    case 4: return <GrenadeSVG color={color} glow={active} />;
    default: return null;
  }
}

// Re-export WeaponSilhouette for use in BottomHud
export { WeaponSilhouette };

import { getWeaponHudData, WEAPON_DEFINITIONS, WEAPON_INDEXES as REGISTRY_INDEXES } from '../../game/WeaponRegistry';

// Build WEAPON_DATA from the registry (same shape the component expects)
const WEAPON_DATA = WEAPON_DEFINITIONS.map((_, i) => getWeaponHudData(i));
const WEAPON_INDEXES = REGISTRY_INDEXES;

// Stat normalization maxima for bar display
const STAT_MAX = { damage: 100, fireRate: 15, range: 100, ammo: 200 } as const;

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        fontFamily: 'var(--font-pixel)', fontSize: '6px', color: 'var(--c-muted)',
        letterSpacing: '0.1em', width: '28px', flexShrink: 0, textAlign: 'right',
      }}>{label}</span>
      <div style={{
        flex: 1, height: '4px', background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: color,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)',
        width: '22px', textAlign: 'right', flexShrink: 0,
      }}>{value}</span>
    </div>
  );
}

export interface LoadoutOverlayProps {
  loadoutDraft: [number, number, number];
  activeLoadoutSlot: number;
  savingLoadout: boolean;
  assignWeaponToSlot: (slot: number, weaponIndex: number) => void;
  saveLoadout: () => Promise<void>;
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
        background: 'rgba(10,12,20,0.92)',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(960px, calc(100vw - 28px))',
          maxHeight: 'calc(100vh - 34px)',
          overflowY: 'auto',
          background: 'rgba(12,16,24,0.98)',
          border: '3px solid #1a1e2e',
          boxShadow: '6px 6px 0 rgba(0,0,0,0.4)',
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
              fontFamily: 'var(--font-pixel)', fontSize: '14px', letterSpacing: '0.1em',
              color: '#ff6b35',
              textShadow: '3px 3px 0 rgba(0,0,0,0.5)',
            }}>
              WEAPON LOADOUT
            </div>
            <div style={{
              marginTop: '8px', fontFamily: 'var(--font-pixel)', fontSize: '7px',
              letterSpacing: '0.08em', color: 'var(--c-muted)', lineHeight: '2',
            }}>
              <span style={{ color: '#ff6b35', opacity: 0.8 }}>1.</span> Click a slot below &nbsp;
              <span style={{ color: '#ff6b35', opacity: 0.8 }}>2.</span> Choose a weapon from the arsenal &nbsp;
              <span style={{ color: '#ff6b35', opacity: 0.8 }}>3.</span> Save
            </div>
          </div>
          <button
            onClick={closeLoadout}
            className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
            style={{
              fontFamily: 'var(--font-pixel)', fontSize: '7px', color: 'var(--c-muted)',
              background: 'rgba(12,16,24,0.88)', border: '2px solid #1a1e2e',
              letterSpacing: '0.1em', flexShrink: 0,
            }}
          >
            [E] CLOSE
          </button>
        </div>

        {/* ── Section: Your Loadout Slots ── */}
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: '7px', letterSpacing: '0.2em',
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
                    ? `${weapon.rawColor}15`
                    : 'rgba(12,16,24,0.88)',
                  border: isActive
                    ? `2px solid ${weapon.rawColor}`
                    : '2px solid #1a1e2e',
                  padding: '12px 14px 10px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                  boxShadow: isActive
                    ? `3px 3px 0 rgba(0,0,0,0.3)`
                    : 'none',
                  overflow: 'hidden',
                }}
              >
                {/* Active editing indicator */}
                {isActive && (
                  <div style={{
                    position: 'absolute', top: '6px', right: '8px',
                    fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.15em',
                    color: weapon.rawColor, background: `${weapon.rawColor}20`,
                    padding: '2px 6px',
                    border: `2px solid ${weapon.rawColor}40`,
                    animation: 'weapon-silhouette-pulse 2s ease-in-out infinite',
                  }}>
                    EDITING
                  </div>
                )}

                {/* Key binding badge */}
                <div style={{
                  position: 'absolute', top: '6px', left: '8px',
                  fontFamily: 'var(--font-pixel)', fontSize: '7px', fontWeight: 400,
                  color: isActive ? weapon.rawColor : 'var(--c-muted)',
                  background: isActive ? `${weapon.rawColor}20` : 'rgba(255,255,255,0.05)',
                  width: '20px', height: '20px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  border: isActive
                    ? `2px solid ${weapon.rawColor}40` : '2px solid #1a1e2e',
                }}>
                  {slot + 1}
                </div>

                {/* Slot label */}
                <div style={{
                  fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.15em',
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
                  fontFamily: 'var(--font-pixel)', fontSize: '9px', fontWeight: 400,
                  color: isActive ? weapon.color : 'var(--c-muted)',
                  letterSpacing: '0.06em',
                  textShadow: isActive ? `2px 2px 0 rgba(0,0,0,0.5)` : 'none',
                }}>
                  {weapon.name}
                </div>

                {/* Bottom glow bar for active slot */}
                {isActive && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px',
                    background: weapon.rawColor,
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Section: Weapon Arsenal ── */}
        <div style={{
          fontFamily: 'var(--font-pixel)', fontSize: '7px', letterSpacing: '0.2em',
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
                    ? `${weapon.rawColor}15`
                    : isInOtherSlot
                      ? `${weapon.rawColor}0a`
                      : 'rgba(12,16,24,0.88)',
                  border: isAssignedToActive
                    ? `2px solid ${weapon.rawColor}`
                    : isInOtherSlot
                      ? `2px solid ${weapon.rawColor}66`
                      : '2px solid #1a1e2e',
                  padding: '10px 11px 10px',
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
                    fontFamily: 'var(--font-pixel)', fontSize: '6px', fontWeight: 400,
                    letterSpacing: '0.1em',
                    color: isAssignedToActive ? weapon.rawColor : `${weapon.rawColor}cc`,
                    background: isAssignedToActive ? `${weapon.rawColor}25` : `${weapon.rawColor}15`,
                    padding: '2px 5px',
                    border: `2px solid ${weapon.rawColor}${isAssignedToActive ? '50' : '30'}`,
                  }}>
                    SLOT {inSlot + 1}
                  </div>
                )}

                {/* Weapon type badge */}
                <div style={{
                  alignSelf: 'flex-start',
                  fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.15em',
                  color: weapon.rawColor,
                  background: `${weapon.rawColor}18`,
                  padding: '2px 6px',
                  border: `2px solid ${weapon.rawColor}30`,
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
                  fontFamily: 'var(--font-pixel)', fontSize: '8px', fontWeight: 400,
                  color: weapon.color, letterSpacing: '0.05em',
                  textShadow: isAssignedToActive ? `2px 2px 0 rgba(0,0,0,0.5)` : 'none',
                }}>
                  {weapon.name}
                </div>

                {/* Description */}
                <div style={{
                  fontFamily: 'var(--font-pixel)', fontSize: '6px', lineHeight: '1.8',
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
                  fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.12em',
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
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px',
                    background: weapon.rawColor,
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
              fontFamily: 'var(--font-pixel)', fontSize: '7px',
              color: 'var(--c-muted)', background: 'rgba(12,16,24,0.88)',
              border: '2px solid #1a1e2e', letterSpacing: '0.1em',
            }}
          >
            CANCEL
          </button>
          <button
            onClick={() => { void saveLoadout(); }}
            disabled={savingLoadout}
            className="pointer-events-auto cursor-pointer px-5 py-2 hud-btn"
            style={{
              fontFamily: 'var(--font-pixel)', fontSize: '8px', fontWeight: 400,
              color: '#ff6b35', background: 'rgba(12,16,24,0.88)',
              border: '2px solid #ff6b35', letterSpacing: '0.1em',
              opacity: savingLoadout ? 0.7 : 1,
              boxShadow: savingLoadout ? 'none' : '3px 3px 0 rgba(0,0,0,0.3)',
              transition: 'all 0.1s',
            }}
          >
            {savingLoadout ? 'SAVING...' : 'SAVE LOADOUT'}
          </button>
        </div>
      </div>
    </div>
  );
}
