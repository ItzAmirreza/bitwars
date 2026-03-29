import { WeaponSilhouette } from './LoadoutOverlay';
import { getWeaponHudData, WEAPON_DEFINITIONS } from '../../game/WeaponRegistry';

// Build WEAPON_DATA from the registry (same shape the component expects)
const WEAPON_DATA = WEAPON_DEFINITIONS.map((_, i) => getWeaponHudData(i));

// Mini weapon icons for the slot indicators
function MiniRifleSVG({ color }: { color: string }) {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.8">
        <line x1="1" y1="6" x2="15" y2="6" />
        <rect x="15" y="4" width="9" height="4" rx="0.5" />
        <line x1="24" y1="5" x2="31" y2="5" />
        <line x1="24" y1="8" x2="29" y2="8" />
        <line x1="31" y1="5" x2="31" y2="7" />
        <line x1="29" y1="8" x2="31" y2="7" />
        <line x1="19" y1="8" x2="18" y2="12" />
      </g>
    </svg>
  );
}

function MiniShotgunSVG({ color }: { color: string }) {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.8">
        <line x1="1" y1="5" x2="14" y2="5" />
        <line x1="1" y1="7" x2="14" y2="7" />
        <rect x="14" y="4" width="7" height="5" rx="0.5" />
        <line x1="21" y1="5" x2="31" y2="5" />
        <line x1="21" y1="9" x2="27" y2="9" />
        <line x1="31" y1="5" x2="31" y2="7" />
        <line x1="27" y1="9" x2="31" y2="7" />
        <line x1="18" y1="9" x2="17" y2="12" />
      </g>
    </svg>
  );
}

function MiniRpgSVG({ color }: { color: string }) {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.8">
        <path d="M1 6 L5 4 L5 9 Z" />
        <rect x="5" y="4" width="18" height="5" rx="1" />
        <ellipse cx="23" cy="6.5" rx="0.5" ry="3" />
        <line x1="14" y1="9" x2="13" y2="13" />
        <line x1="10" y1="2" x2="10" y2="4" />
      </g>
    </svg>
  );
}

function MiniMachineGunSVG({ color }: { color: string }) {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.8">
        <line x1="1" y1="6" x2="15" y2="6" />
        <rect x="15" y="4" width="8" height="5" rx="0.5" />
        <rect x="17" y="9" width="5" height="3" rx="0.5" />
        <line x1="23" y1="5" x2="31" y2="5" />
        <line x1="23" y1="9" x2="28" y2="9" />
      </g>
    </svg>
  );
}

function MiniGrenadeSVG({ color }: { color: string }) {
  return (
    <svg width="32" height="14" viewBox="0 0 32 14" fill="none">
      <g stroke={color} strokeWidth="1" strokeLinecap="round" opacity="0.8">
        <ellipse cx="5" cy="7" rx="3" ry="2.5" />
        <line x1="7" y1="5" x2="10" y2="4" />
        <rect x="10" y="4" width="18" height="5" rx="1" />
        <line x1="28" y1="6.5" x2="31" y2="6.5" />
        <line x1="20" y1="9" x2="20" y2="12" />
      </g>
    </svg>
  );
}

function MiniWeaponIcon({ weaponIndex, color }: { weaponIndex: number; color: string }) {
  switch (weaponIndex) {
    case 0: return <MiniRifleSVG color={color} />;
    case 1: return <MiniShotgunSVG color={color} />;
    case 2: return <MiniRpgSVG color={color} />;
    case 3: return <MiniMachineGunSVG color={color} />;
    case 4: return <MiniGrenadeSVG color={color} />;
    default: return null;
  }
}

export interface BottomHudProps {
  health: number;
  weapon: number;
  ammo: number;
  maxAmmo: number;
  isReloading: boolean;
  kills: number;
  deaths: number;
  loadout: [number, number, number];
  heading: number;
  mountedVehicleName: string | null;
  vehicleHealth: number;
  vehicleMaxHealth: number;
  vehicleWeapon: number;
  vehicleAmmo: number;
  vehicleReloading: boolean;
  vehicleMaxAmmo: number;
  vehicleAltitude: number;
  vehicleSpeed: number;
  vehicleThrottle: number;
  vehicleWeaponSlots: { name: string; color: string }[];
}

export function BottomHud({
  health,
  weapon,
  ammo,
  maxAmmo,
  isReloading,
  kills,
  deaths,
  loadout,
  heading,
  mountedVehicleName,
  vehicleHealth,
  vehicleMaxHealth,
  vehicleWeapon,
  vehicleAmmo,
  vehicleReloading,
  vehicleMaxAmmo,
  vehicleAltitude,
  vehicleSpeed,
  vehicleThrottle,
  vehicleWeaponSlots,
}: BottomHudProps) {
  const healthColor = health > 50 ? 'var(--c-green)' : health > 25 ? 'var(--c-amber)' : 'var(--c-red)';
  const healthRawColor = health > 50 ? '#00ff41' : health > 25 ? '#ff9800' : '#ff0033';
  const isLowHealth = health > 0 && health <= 25;
  const isCriticalHealth = health > 0 && health <= 10;
  const isLowAmmo = ammo > 0 && ammo <= Math.ceil(maxAmmo * 0.2);
  const ammoPercent = maxAmmo > 0 ? (ammo / maxAmmo) * 100 : 0;
  const kdRatio = deaths > 0 ? (kills / deaths).toFixed(1) : kills > 0 ? kills.toFixed(1) : '0.0';

  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
      <div className="px-5 pb-4 pt-2">
        <div className="flex items-end justify-between">

          {/* ── LEFT PANEL: Health + Weapon silhouette + Ammo ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>

            {/* Health panel — CS:GO style with large number + health cross */}
            <div style={{
              background: 'rgba(12,16,24,0.88)',
              border: `2px solid ${isLowHealth ? healthRawColor : '#1a1e2e'}`,
              padding: '10px 14px',
              minWidth: '260px',
              transition: 'border-color 0.3s',
              borderLeft: `3px solid ${healthRawColor}`,
              animation: isLowHealth ? 'hud-low-hp-border 1s ease-in-out infinite' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Health cross icon */}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <rect x="7" y="2" width="6" height="16" rx="1" fill={healthRawColor} opacity="0.9" />
                  <rect x="2" y="7" width="16" height="6" rx="1" fill={healthRawColor} opacity="0.9" />
                </svg>
                {/* Big health number */}
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '38px',
                  color: healthColor,
                  fontWeight: 'bold',
                  lineHeight: '1',
                  textShadow: `2px 2px 0 rgba(0,0,0,0.5)`,
                  animation: isCriticalHealth ? 'hud-critical-flash 0.6s ease-in-out infinite' : 'none',
                  minWidth: '80px',
                }}>
                  {health}
                </span>
                {/* Armor/shield placeholder */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '2px',
                  opacity: 0.3,
                  marginLeft: 'auto',
                }}>
                  <svg width="16" height="18" viewBox="0 0 16 18" fill="none">
                    <path d="M8 1 L14 4 L14 10 Q14 15 8 17 Q2 15 2 10 L2 4 Z" stroke="var(--c-muted)" strokeWidth="1.5" fill="none" />
                  </svg>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '8px',
                    color: 'var(--c-muted2)',
                    letterSpacing: '0.1em',
                  }}>
                    --
                  </span>
                </div>
              </div>
              {/* Segmented health bar (10 segments) */}
              <div style={{ display: 'flex', gap: '2px', height: '4px', marginTop: '8px' }}>
                {Array.from({ length: 10 }, (_, i) => {
                  const segThreshold = (i + 1) * 10;
                  const filled = health >= segThreshold;
                  const partial = !filled && health > i * 10;
                  return (
                    <div key={i} style={{
                      flex: 1,
                      background: filled
                        ? healthRawColor
                        : partial
                          ? `${healthRawColor}80`
                          : 'rgba(255,255,255,0.06)',
                      boxShadow: 'none',
                      transition: 'all 0.3s ease',
                    }} />
                  );
                })}
              </div>
            </div>

            {/* Weapon + Ammo combined panel with silhouette (infantry only) */}
            {!mountedVehicleName && (
            <div style={{
              background: 'rgba(12,16,24,0.88)',
              border: '2px solid #1a1e2e',
              padding: '8px 14px',
              borderLeft: `3px solid ${WEAPON_DATA[weapon].rawColor}`,
              minWidth: '260px',
            }}>
              {/* Weapon silhouette */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}>
                <WeaponSilhouette
                  weaponIndex={weapon}
                  color={WEAPON_DATA[weapon].rawColor}
                  active={true}
                />
                {/* Reloading indicator */}
                {isReloading && (
                  <span style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '7px',
                    color: 'var(--c-amber)',
                    letterSpacing: '0.15em',
                    animation: 'hud-ammo-warn 0.8s ease-in-out infinite',
                  }}>
                    RELOADING
                  </span>
                )}
              </div>

              {/* Weapon name + ammo row */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}>
                {/* Weapon name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '6px',
                    color: 'var(--c-muted)',
                    letterSpacing: '0.15em',
                  }}>
                    WEAPON
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '9px',
                    fontWeight: 400,
                    color: WEAPON_DATA[weapon].color,
                    letterSpacing: '0.1em',
                    textShadow: `2px 2px 0 rgba(0,0,0,0.5)`,
                    lineHeight: '1',
                  }}>
                    {WEAPON_DATA[weapon].name}
                  </span>
                </div>

                <div style={{ width: '1px', height: '24px', background: 'var(--c-border)', margin: '0 8px' }} />

                {/* Ammo display — CS:GO "current | reserve" style */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '6px',
                    color: 'var(--c-muted)',
                    letterSpacing: '0.15em',
                  }}>
                    AMMO
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '28px',
                      color: ammo === 0 ? 'var(--c-red)' : isLowAmmo ? 'var(--c-amber)' : 'var(--c-text)',
                      fontWeight: 'bold',
                      lineHeight: '1',
                      animation: ammo === 0 ? 'hud-critical-flash 0.5s ease-in-out infinite' : isLowAmmo ? 'hud-ammo-warn 1s ease-in-out infinite' : 'none',
                    }}>
                      {ammo}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '14px',
                      color: 'var(--c-muted)',
                      fontWeight: 'bold',
                    }}>
                      |
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '16px',
                      color: 'var(--c-muted)',
                    }}>
                      {maxAmmo}
                    </span>
                  </div>
                </div>
              </div>

              {/* Ammo bar */}
              <div style={{
                height: '3px',
                background: 'rgba(255,255,255,0.06)',
                marginTop: '6px',
              }}>
                <div style={{
                  height: '100%',
                  width: `${ammoPercent}%`,
                  background: ammo === 0 ? 'var(--c-red)' : isLowAmmo ? 'var(--c-amber)' : WEAPON_DATA[weapon].rawColor,
                  transition: 'width 0.15s ease, background 0.3s',
                  boxShadow: 'none',
                }} />
              </div>
            </div>
            )}
          </div>

          {/* ── RIGHT PANEL: K/D + Weapon Slots ── */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>

            {/* K/D Panel */}
            <div style={{
              background: 'rgba(12,16,24,0.88)',
              border: '2px solid #1a1e2e',
              padding: '8px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              borderRight: '3px solid var(--c-border-bright)',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '6px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.15em',
                  marginBottom: '2px',
                }}>KILLS</div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '20px',
                  color: 'var(--c-green)',
                  fontWeight: 'bold',
                  lineHeight: '1',
                }}>{kills}</div>
              </div>

              <div style={{
                width: '1px',
                height: '28px',
                background: 'var(--c-border)',
              }} />

              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '6px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.15em',
                  marginBottom: '2px',
                }}>DEATHS</div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '20px',
                  color: 'var(--c-red-dim)',
                  fontWeight: 'bold',
                  lineHeight: '1',
                }}>{deaths}</div>
              </div>

              <div style={{
                width: '1px',
                height: '28px',
                background: 'var(--c-border)',
              }} />

              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '6px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.15em',
                  marginBottom: '2px',
                }}>K/D</div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '20px',
                  color: 'var(--c-cyan)',
                  fontWeight: 'bold',
                  lineHeight: '1',
                }}>{kdRatio}</div>
              </div>
            </div>

            {/* ── JET THROTTLE + AIRSPEED BARS (fixed, flanking crosshair) ── */}
            {mountedVehicleName === 'Fighter Jet' && (() => {
              const thrFill = Math.max(0, Math.min(1, vehicleThrottle));
              const spdFill = Math.max(0, Math.min(1, vehicleSpeed / 80));
              const barHeight = 120;
              const barWidth = 8;
              const barStyle: React.CSSProperties = {
                position: 'fixed',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                pointerEvents: 'none',
                zIndex: 10,
              };
              return (<>
                {/* Left: Throttle */}
                <div style={{ ...barStyle, left: 'calc(50% - 140px)' }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.12em',
                    color: '#ff9800', opacity: 0.8,
                  }}>THR</span>
                  <div style={{
                    width: barWidth, height: barHeight,
                    background: 'rgba(6,8,16,0.7)',
                    border: '1px solid rgba(255,152,0,0.3)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: `${thrFill * 100}%`,
                      background: 'linear-gradient(0deg, #ff9800, #ffb74d)',
                      boxShadow: '0 0 6px rgba(255,152,0,0.5)',
                      transition: 'height 0.1s ease',
                    }} />
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 'bold',
                    color: '#ff9800', lineHeight: '1',
                  }}>{Math.round(thrFill * 100)}%</span>
                </div>
                {/* Right: Airspeed */}
                <div style={{ ...barStyle, left: 'auto', right: 'calc(50% - 140px)' }}>
                  <span style={{
                    fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.12em',
                    color: '#66e0ff', opacity: 0.8,
                  }}>SPD</span>
                  <div style={{
                    width: barWidth, height: barHeight,
                    background: 'rgba(6,8,16,0.7)',
                    border: '1px solid rgba(102,224,255,0.3)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: `${spdFill * 100}%`,
                      background: 'linear-gradient(0deg, #66e0ff, #99ecff)',
                      boxShadow: '0 0 6px rgba(102,224,255,0.5)',
                      transition: 'height 0.1s ease',
                    }} />
                  </div>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '9px', fontWeight: 'bold',
                    color: '#66e0ff', lineHeight: '1',
                  }}>{Math.round(vehicleSpeed)}</span>
                </div>
              </>);
            })()}

            {mountedVehicleName && (() => {
              const vwSlot = vehicleWeaponSlots[vehicleWeapon] ?? vehicleWeaponSlots[0];
              const vwColor = vwSlot?.color ?? '#ffaa00';
              const vHealthPct = vehicleMaxHealth > 0 ? (vehicleHealth / vehicleMaxHealth) * 100 : 0;
              const vHealthColor = vHealthPct > 50 ? '#66e0ff' : vHealthPct > 25 ? '#ff9800' : '#ff0033';
              const vAmmoPct = vehicleMaxAmmo > 0 ? (vehicleAmmo / vehicleMaxAmmo) * 100 : 0;
              const vAmmoLow = vehicleAmmo > 0 && vehicleAmmo <= Math.ceil(vehicleMaxAmmo * 0.15);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>

                  {/* Vehicle Health Bar */}
                  <div style={{
                    background: 'rgba(12,16,24,0.88)',
                    border: `2px solid ${vHealthPct <= 25 ? 'rgba(255,0,51,0.4)' : '#1a1e2e'}`,
                    borderRight: `3px solid ${vHealthColor}`,
                    padding: '8px 14px',
                    minWidth: '240px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {/* Vehicle icon (type-specific) */}
                        {mountedVehicleName === 'Fighter Jet' ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 8h12M8 3l2 5-2 1-2-1 2-5zM5 8l-2 3h2l1-1M11 8l2 3h-2l-1-1z" stroke={vHealthColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 5h12M8 5v4M4 9h8l1 2H3l1-2z" stroke={vHealthColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="8" cy="4" r="1.5" stroke={vHealthColor} strokeWidth="1"/>
                          </svg>
                        )}
                        <span style={{
                          fontFamily: 'var(--font-pixel)', fontSize: '6px',
                          color: 'var(--c-muted)', letterSpacing: '0.14em',
                        }}>VEHICLE</span>
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 'bold',
                        color: vHealthColor, lineHeight: '1',
                        animation: vHealthPct <= 25 ? 'hud-critical-flash 0.8s ease-in-out infinite' : 'none',
                      }}>
                        {Math.round(vehicleHealth)}
                      </span>
                    </div>
                    {/* Segmented health bar */}
                    <div style={{ display: 'flex', gap: '1px', height: '4px' }}>
                      {Array.from({ length: 20 }, (_, i) => {
                        const segPct = ((i + 1) / 20) * 100;
                        const filled = vHealthPct >= segPct;
                        const partial = !filled && vHealthPct > (i / 20) * 100;
                        return (
                          <div key={i} style={{
                            flex: 1,
                            background: filled ? vHealthColor : partial ? `${vHealthColor}60` : 'rgba(255,255,255,0.06)',
                            boxShadow: filled ? `0 0 3px ${vHealthColor}30` : 'none',
                            transition: 'all 0.3s ease',
                          }} />
                        );
                      })}
                    </div>
                  </div>

                  {/* Vehicle Weapon + Ammo Panel */}
                  <div style={{
                    background: 'rgba(12,16,24,0.88)',
                    border: '2px solid #1a1e2e',
                    borderRight: `3px solid ${vwColor}`,
                    padding: '8px 14px',
                    minWidth: '240px',
                  }}>
                    {/* Weapon selector tabs */}
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                      {vehicleWeaponSlots.map((slot, idx) => {
                        const active = vehicleWeapon === idx;
                        return (
                          <div key={slot.name} style={{
                            flex: 1,
                            padding: '3px 6px',
                            background: active ? `${slot.color}20` : 'rgba(255,255,255,0.03)',
                            border: active ? `2px solid ${slot.color}` : '2px solid #1a1e2e',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                            transition: 'all 0.15s ease',
                            position: 'relative',
                            overflow: 'hidden',
                          }}>
                            {active && <div style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px',
                              background: slot.color, boxShadow: `0 0 6px ${slot.color}`,
                            }}/>}
                            <span style={{
                              fontFamily: 'var(--font-pixel)', fontSize: '6px', fontWeight: 400,
                              color: active ? slot.color : 'var(--c-muted2)',
                              background: active ? `${slot.color}30` : 'rgba(255,255,255,0.05)',
                              padding: '0 3px', lineHeight: '1.4',
                            }}>{idx + 1}</span>
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: '9px',
                              color: active ? slot.color : 'var(--c-muted)',
                              letterSpacing: '0.08em', fontWeight: active ? 'bold' : 'normal',
                            }}>{slot.name}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Ammo display */}
                    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                      <span style={{
                        fontFamily: 'var(--font-pixel)', fontSize: '6px',
                        color: vehicleReloading ? 'var(--c-amber)' : 'var(--c-muted)', letterSpacing: '0.15em',
                        animation: vehicleReloading ? 'hud-ammo-warn 0.8s ease-in-out infinite' : 'none',
                      }}>{vehicleReloading ? 'RELOADING' : 'AMMO'}</span>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '24px', fontWeight: 'bold',
                          color: vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : 'var(--c-text)',
                          lineHeight: '1',
                          animation: vehicleAmmo === 0 ? 'hud-critical-flash 0.5s ease-in-out infinite' : vAmmoLow ? 'hud-ammo-warn 1s ease-in-out infinite' : 'none',
                        }}>{vehicleAmmo}</span>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--c-muted)', fontWeight: 'bold',
                        }}>|</span>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--c-muted)',
                        }}>{vehicleMaxAmmo}</span>
                      </div>
                    </div>
                    {/* Ammo bar */}
                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', marginTop: '4px' }}>
                      <div style={{
                        height: '100%', width: `${vAmmoPct}%`,
                        background: vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : vwColor,
                        transition: 'width 0.15s ease',
                        boxShadow: `0 0 4px ${vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : vwColor}`,
                      }}/>
                    </div>
                  </div>

                  {/* Telemetry: Altitude + Speed */}
                  <div style={{
                    background: 'rgba(12,16,24,0.88)',
                    border: '2px solid #1a1e2e',
                    borderRight: '3px solid rgba(102,224,255,0.4)',
                    padding: '6px 14px',
                    minWidth: '240px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '6px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>ALT</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: 'var(--c-text)', lineHeight: '1' }}>
                        {Math.round(vehicleAltitude)}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)' }}>m</span>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }}/>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '6px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>SPD</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: 'var(--c-text)', lineHeight: '1' }}>
                        {Math.round(vehicleSpeed)}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)' }}>m/s</span>
                    </div>
                    <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }}/>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontFamily: 'var(--font-pixel)', fontSize: '6px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>HDG</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 'bold', color: 'var(--c-cyan)', lineHeight: '1' }}>
                        {String(Math.round(((heading % 360) + 360) % 360)).padStart(3, '0')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Weapon slots with mini weapon icons and active glow (infantry only) */}
            {!mountedVehicleName && (
            <div className="flex gap-1">
              {loadout.map((weaponIndex, slotIndex) => {
                const w = WEAPON_DATA[weaponIndex]!;
                const active = weapon === weaponIndex;
                return (
                  <div
                    key={`${w.name}-${slotIndex}`}
                    style={{
                      background: active ? `${w.rawColor}15` : 'rgba(12,16,24,0.88)',
                      border: active ? `2px solid ${w.rawColor}` : '2px solid #1a1e2e',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '7px',
                      letterSpacing: '0.05em',
                      transition: 'all 0.1s',
                      padding: '5px 8px 4px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '3px',
                      minWidth: '60px',
                      position: 'relative',
                      overflow: 'hidden',
                      boxShadow: active ? `3px 3px 0 rgba(0,0,0,0.3)` : 'none',
                    }}
                  >
                    {active && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: w.rawColor,
                        boxShadow: `0 0 8px ${w.rawColor}, 0 -2px 8px ${w.rawColor}40`,
                      }} />
                    )}
                    <MiniWeaponIcon weaponIndex={weaponIndex} color={active ? w.rawColor : 'var(--c-muted)'} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{
                        fontSize: '8px',
                        color: active ? 'var(--c-text)' : 'var(--c-muted2)',
                        background: active ? `${w.rawColor}30` : 'rgba(255,255,255,0.05)',
                        padding: '1px 3px',
                        lineHeight: '1.2',
                      }}>{slotIndex + 1}</span>
                      <span style={{
                        color: active ? w.color : 'var(--c-muted)',
                        fontWeight: active ? 'bold' : 'normal',
                        textShadow: 'none',
                        fontSize: '7px',
                      }}>{w.name}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
