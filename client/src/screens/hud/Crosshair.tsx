import type { DamageIndicatorState } from '../../game/Engine';

export interface CrosshairProps {
  hitMarker: boolean;
  hitMarkerType: string;
  mountedVehicleName: string | null;
  vehicleWeapon: number;
  vehicleWeaponColor?: string;
  damageIndicators: DamageIndicatorState[];
  crosshairSpread?: number;
  sniperScoped?: boolean;
}

function HitMarkerX({ type }: { type: string }) {
  // 'kill' = server-confirmed kill: bigger, thicker, bright red.
  // 'vehicle' = round struck a vehicle: amber, to read as metal-on-metal.
  const isKill = type === 'kill';
  const isPlayer = type === 'player';
  const isVehicle = type === 'vehicle';
  const color = isKill ? '#ff2030' : isPlayer ? '#ff2d78' : isVehicle ? '#ffae34' : 'rgba(255,255,255,0.95)';
  const sizePx = isKill ? 26 : isPlayer ? 18 : isVehicle ? 17 : 14;
  const thick = isKill ? 3 : 2;
  const size = `${sizePx}px`;
  const offset = `${-sizePx / 2}px`;
  const glow = isKill
    ? 'drop-shadow(0 0 5px rgba(255,32,48,0.9))'
    : isVehicle ? 'drop-shadow(0 0 4px rgba(255,174,52,0.85))' : 'none';
  return (
    <div style={{ animation: 'hitmarker-flash 0.2s ease-out', filter: glow }}>
      <div style={{
        width: size, height: `${thick}px`, background: color,
        transform: 'rotate(45deg)',
        position: 'absolute', top: '50%', left: '50%', marginLeft: offset, marginTop: `${-thick / 2}px`,
      }} />
      <div style={{
        width: size, height: `${thick}px`, background: color,
        transform: 'rotate(-45deg)',
        position: 'absolute', top: '50%', left: '50%', marginLeft: offset, marginTop: `${-thick / 2}px`,
      }} />
    </div>
  );
}

function SniperScope({ hitMarker, hitMarkerType }: { hitMarker: boolean; hitMarkerType: string }) {
  const scopeColor = '#e040ff';
  const scopeColorDim = 'rgba(224,64,255,0.3)';
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 11 }}>
      {/* Scope vignette - dark corners */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(circle at center, transparent 28%, rgba(0,0,0,0.7) 52%, rgba(0,0,0,0.95) 60%)',
      }} />
      {/* Scope reticle */}
      <svg
        style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
        width="300" height="300" viewBox="0 0 300 300" fill="none"
      >
        {/* Outer ring */}
        <rect x="20" y="20" width="260" height="260" stroke={scopeColorDim} strokeWidth="2" fill="none" />
        {/* Inner ring */}
        <rect x="80" y="80" width="140" height="140" stroke={scopeColorDim} strokeWidth="1.5" fill="none" />
        {/* Crosshair lines - vertical */}
        <line x1="150" y1="10" x2="150" y2="120" stroke={scopeColor} strokeWidth="2" opacity="0.7" />
        <line x1="150" y1="180" x2="150" y2="290" stroke={scopeColor} strokeWidth="2" opacity="0.7" />
        {/* Crosshair lines - horizontal */}
        <line x1="10" y1="150" x2="120" y2="150" stroke={scopeColor} strokeWidth="2" opacity="0.7" />
        <line x1="180" y1="150" x2="290" y2="150" stroke={scopeColor} strokeWidth="2" opacity="0.7" />
        {/* Range tick marks */}
        <line x1="145" y1="190" x2="155" y2="190" stroke={scopeColor} strokeWidth="1.5" opacity="0.5" />
        <line x1="145" y1="210" x2="155" y2="210" stroke={scopeColor} strokeWidth="1.5" opacity="0.4" />
        <line x1="145" y1="230" x2="155" y2="230" stroke={scopeColor} strokeWidth="1.5" opacity="0.3" />
        {/* Center dot */}
        <rect x="148" y="148" width="4" height="4" fill={scopeColor} opacity="0.95" />
        {/* Corner brackets */}
        <path d="M24 40 L24 24 L40 24" stroke={scopeColor} strokeWidth="2" opacity="0.5" fill="none" />
        <path d="M276 40 L276 24 L260 24" stroke={scopeColor} strokeWidth="2" opacity="0.5" fill="none" />
        <path d="M24 260 L24 276 L40 276" stroke={scopeColor} strokeWidth="2" opacity="0.5" fill="none" />
        <path d="M276 260 L276 276 L260 276" stroke={scopeColor} strokeWidth="2" opacity="0.5" fill="none" />
      </svg>
      {/* Zoom label */}
      <div style={{
        position: 'absolute', bottom: 'calc(50% - 170px)', left: '50%', transform: 'translateX(-50%)',
        fontFamily: 'var(--font-pixel)', fontSize: '7px', letterSpacing: '0.15em',
        color: scopeColor, opacity: 0.6,
      }}>4X SCOPE</div>
      {/* Hit marker */}
      {hitMarker && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
          <HitMarkerX type={hitMarkerType} />
        </div>
      )}
    </div>
  );
}

export function Crosshair({
  hitMarker,
  hitMarkerType,
  mountedVehicleName,
  vehicleWeapon,
  vehicleWeaponColor,
  damageIndicators,
  crosshairSpread = 0,
  sniperScoped,
}: CrosshairProps) {
  // Dynamic accuracy bloom: bars push outward from center while firing/moving.
  const gap = Math.max(0, Math.min(1, crosshairSpread)) * 9;
  const isAirMissile = mountedVehicleName === 'Fighter Jet' && vehicleWeapon === 2;
  const missileColor = '#00e5ff';

  if (sniperScoped) {
    return (
      <>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          {damageIndicators.map((indicator) => {
            const scale = 0.85 + indicator.intensity * 0.34;
            return (
              <div
                key={indicator.id}
                style={{
                  position: 'absolute', left: '50%', top: '50%',
                  width: '152px', height: '152px',
                  transform: `translate(-50%, -50%) rotate(${indicator.angle}deg) scale(${scale})`,
                  transformOrigin: 'center', opacity: indicator.opacity,
                  filter: `drop-shadow(0 0 ${10 + indicator.intensity * 14}px rgba(255,45,120,0.5))`,
                }}
              >
                <svg width="56" height="36" viewBox="0 0 56 36" fill="none"
                  style={{ position: 'absolute', left: '50%', top: '6px', transform: 'translateX(-50%)', overflow: 'visible' }}>
                  <path d="M8 25 C15 12 21 9 28 9 C35 9 41 12 48 25" stroke="rgba(255,45,120,0.32)" strokeWidth="3" strokeLinecap="round" />
                  <path d="M18 28 L28 14 L38 28" stroke="#ff5d8f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M22 28 L28 20 L34 28" stroke="rgba(255,232,240,0.95)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            );
          })}
        </div>
        <SniperScope hitMarker={hitMarker} hitMarkerType={hitMarkerType} />
      </>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      {damageIndicators.map((indicator) => {
        const scale = 0.9 + indicator.intensity * 0.18;
        return (
          <div
            key={indicator.id}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: '152px',
              height: '152px',
              transform: `translate(-50%, -50%) rotate(${indicator.angle}deg) scale(${scale})`,
              transformOrigin: 'center',
              opacity: indicator.opacity,
              filter: `drop-shadow(0 0 ${10 + indicator.intensity * 14}px rgba(255,45,120,0.5))`,
            }}
          >
            <svg
              width="56"
              height="36"
              viewBox="0 0 56 36"
              fill="none"
              style={{
                position: 'absolute',
                left: '50%',
                top: '6px',
                transform: 'translateX(-50%)',
                overflow: 'visible',
              }}
            >
              <path
                d="M8 25 C15 12 21 9 28 9 C35 9 41 12 48 25"
                stroke="rgba(255,45,120,0.32)"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M18 28 L28 14 L38 28"
                stroke="#ff5d8f"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 28 L28 20 L34 28"
                stroke="rgba(255,232,240,0.95)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      })}

      {mountedVehicleName && isAirMissile ? (
        /* Air Missile targeting reticle - pixel style */
        <div className="relative" style={{ width: '160px', height: '160px' }}>
          <svg width="160" height="160" viewBox="0 0 160 160" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* Outer diamond */}
            <path d="M80 12 L148 80 L80 148 L12 80 Z" stroke={missileColor} strokeWidth="1.5" opacity="0.25" strokeDasharray="8 4"/>
            {/* Inner diamond */}
            <path d="M80 40 L120 80 L80 120 L40 80 Z" stroke={missileColor} strokeWidth="2" opacity="0.5"/>
            {/* Corner brackets */}
            <path d="M68 30 L80 18 L92 30" stroke={missileColor} strokeWidth="2" opacity="0.7" fill="none"/>
            <path d="M68 130 L80 142 L92 130" stroke={missileColor} strokeWidth="2" opacity="0.7" fill="none"/>
            <path d="M30 68 L18 80 L30 92" stroke={missileColor} strokeWidth="2" opacity="0.7" fill="none"/>
            <path d="M130 68 L142 80 L130 92" stroke={missileColor} strokeWidth="2" opacity="0.7" fill="none"/>
            {/* Cross ticks */}
            <line x1="80" y1="60" x2="80" y2="72" stroke={missileColor} strokeWidth="2" opacity="0.8"/>
            <line x1="80" y1="88" x2="80" y2="100" stroke={missileColor} strokeWidth="2" opacity="0.8"/>
            <line x1="60" y1="80" x2="72" y2="80" stroke={missileColor} strokeWidth="2" opacity="0.8"/>
            <line x1="88" y1="80" x2="100" y2="80" stroke={missileColor} strokeWidth="2" opacity="0.8"/>
            {/* Center pixel */}
            <rect x="78" y="78" width="4" height="4" fill={missileColor} opacity="0.9"/>
            {/* Rotating scan */}
            <circle cx="80" cy="80" r="35" stroke={missileColor} strokeWidth="1" opacity="0.3" strokeDasharray="8 52" style={{
              transformOrigin: '80px 80px',
              animation: 'air-missile-scan 3s linear infinite',
            }}/>
          </svg>
          <div style={{
            position: 'absolute', bottom: '-20px', left: '50%', transform: 'translateX(-50%)',
            fontFamily: 'var(--font-pixel)', fontSize: '6px', letterSpacing: '0.2em',
            color: missileColor, opacity: 0.7,
          }}>AIR MISSILE</div>
          {hitMarker && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
              <HitMarkerX type={hitMarkerType} />
            </div>
          )}
        </div>
      ) : mountedVehicleName ? (
        /* Vehicle reticle - pixel style */
        <div className="relative" style={{ width: '64px', height: '64px' }}>
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            <circle cx="32" cy="32" r="28" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="1.5" opacity="0.4" strokeDasharray="4 4"/>
            <line x1="32" y1="2" x2="32" y2="8" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="2" opacity="0.7"/>
            <line x1="32" y1="56" x2="32" y2="62" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="2" opacity="0.7"/>
            <line x1="2" y1="32" x2="8" y2="32" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="2" opacity="0.7"/>
            <line x1="56" y1="32" x2="62" y2="32" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="2" opacity="0.7"/>
            <circle cx="32" cy="32" r="6" stroke={vehicleWeaponColor ?? '#ff6b35'} strokeWidth="1.5" opacity="0.6"/>
            <rect x="30.5" y="30.5" width="3" height="3" fill={vehicleWeaponColor ?? '#ff6b35'} opacity="0.9"/>
          </svg>
          {hitMarker && <HitMarkerX type={hitMarkerType} />}
        </div>
      ) : (
        /* Infantry crosshair - chunky pixel style (bars bloom outward with spread) */
        <div className="relative" style={{ width: '32px', height: '32px' }}>
          {/* Top */}
          <div className="absolute left-1/2" style={{
            top: '2px', width: '2px', height: '8px',
            background: 'rgba(255,255,255,0.8)',
            transform: `translate(-50%, ${-gap}px)`,
          }} />
          {/* Bottom */}
          <div className="absolute left-1/2" style={{
            bottom: '2px', width: '2px', height: '8px',
            background: 'rgba(255,255,255,0.8)',
            transform: `translate(-50%, ${gap}px)`,
          }} />
          {/* Left */}
          <div className="absolute top-1/2" style={{
            left: '2px', width: '8px', height: '2px',
            background: 'rgba(255,255,255,0.8)',
            transform: `translate(${-gap}px, -50%)`,
          }} />
          {/* Right */}
          <div className="absolute top-1/2" style={{
            right: '2px', width: '8px', height: '2px',
            background: 'rgba(255,255,255,0.8)',
            transform: `translate(${gap}px, -50%)`,
          }} />
          {/* Center pixel */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{
            width: '2px', height: '2px',
            background: 'rgba(255,255,255,0.95)',
          }} />
          {hitMarker && <HitMarkerX type={hitMarkerType} />}
        </div>
      )}
    </div>
  );
}
