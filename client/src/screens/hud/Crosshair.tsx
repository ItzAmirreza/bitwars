export interface CrosshairProps {
  hitMarker: boolean;
  hitMarkerType: string;
  mountedVehicleName: string | null;
  vehicleWeapon: number;
  vehicleWeaponColor?: string;
}

function HitMarkerX({ type }: { type: string }) {
  const isPlayer = type === 'player';
  const color = isPlayer ? '#ff2d78' : 'rgba(255,255,255,0.95)';
  const size = isPlayer ? '18px' : '14px';
  const offset = isPlayer ? '-9px' : '-7px';
  return (
    <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
      <div style={{
        width: size, height: '2px', background: color,
        transform: 'rotate(45deg)',
        position: 'absolute', top: '50%', left: '50%', marginLeft: offset, marginTop: '-1px',
      }} />
      <div style={{
        width: size, height: '2px', background: color,
        transform: 'rotate(-45deg)',
        position: 'absolute', top: '50%', left: '50%', marginLeft: offset, marginTop: '-1px',
      }} />
    </div>
  );
}

export function Crosshair({ hitMarker, hitMarkerType, mountedVehicleName, vehicleWeapon, vehicleWeaponColor }: CrosshairProps) {
  const isAirMissile = mountedVehicleName === 'Fighter Jet' && vehicleWeapon === 2;
  const missileColor = '#00e5ff';

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
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
        /* Infantry crosshair - chunky pixel style */
        <div className="relative" style={{ width: '32px', height: '32px' }}>
          {/* Top */}
          <div className="absolute left-1/2 -translate-x-1/2" style={{
            top: '2px', width: '2px', height: '8px',
            background: 'rgba(255,255,255,0.8)',
          }} />
          {/* Bottom */}
          <div className="absolute left-1/2 -translate-x-1/2" style={{
            bottom: '2px', width: '2px', height: '8px',
            background: 'rgba(255,255,255,0.8)',
          }} />
          {/* Left */}
          <div className="absolute top-1/2 -translate-y-1/2" style={{
            left: '2px', width: '8px', height: '2px',
            background: 'rgba(255,255,255,0.8)',
          }} />
          {/* Right */}
          <div className="absolute top-1/2 -translate-y-1/2" style={{
            right: '2px', width: '8px', height: '2px',
            background: 'rgba(255,255,255,0.8)',
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
