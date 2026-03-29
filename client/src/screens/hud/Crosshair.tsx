export interface CrosshairProps {
  hitMarker: boolean;
  hitMarkerType: string;
  mountedVehicleName: string | null;
  vehicleWeapon: number;
  vehicleWeaponColor?: string;
}

export function Crosshair({ hitMarker, hitMarkerType, mountedVehicleName, vehicleWeapon, vehicleWeaponColor }: CrosshairProps) {
  const isAirMissile = mountedVehicleName === 'Fighter Jet' && vehicleWeapon === 2;
  const missileColor = '#00ccff';

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      {mountedVehicleName && isAirMissile ? (
        /* ── Air Missile targeting reticle ── */
        <div className="relative" style={{ width: '160px', height: '160px' }}>
          <svg width="160" height="160" viewBox="0 0 160 160" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            {/* Outer diamond targeting frame */}
            <path d="M80 12 L148 80 L80 148 L12 80 Z" stroke={missileColor} strokeWidth="1" opacity="0.25" strokeDasharray="6 4"/>
            {/* Inner diamond */}
            <path d="M80 40 L120 80 L80 120 L40 80 Z" stroke={missileColor} strokeWidth="1.5" opacity="0.5"/>
            {/* Corner brackets - top */}
            <path d="M68 30 L80 18 L92 30" stroke={missileColor} strokeWidth="1.5" opacity="0.7" fill="none"/>
            {/* Corner brackets - bottom */}
            <path d="M68 130 L80 142 L92 130" stroke={missileColor} strokeWidth="1.5" opacity="0.7" fill="none"/>
            {/* Corner brackets - left */}
            <path d="M30 68 L18 80 L30 92" stroke={missileColor} strokeWidth="1.5" opacity="0.7" fill="none"/>
            {/* Corner brackets - right */}
            <path d="M130 68 L142 80 L130 92" stroke={missileColor} strokeWidth="1.5" opacity="0.7" fill="none"/>
            {/* Cross ticks */}
            <line x1="80" y1="60" x2="80" y2="72" stroke={missileColor} strokeWidth="1.5" opacity="0.8"/>
            <line x1="80" y1="88" x2="80" y2="100" stroke={missileColor} strokeWidth="1.5" opacity="0.8"/>
            <line x1="60" y1="80" x2="72" y2="80" stroke={missileColor} strokeWidth="1.5" opacity="0.8"/>
            <line x1="88" y1="80" x2="100" y2="80" stroke={missileColor} strokeWidth="1.5" opacity="0.8"/>
            {/* Center pip */}
            <circle cx="80" cy="80" r="2" fill={missileColor} opacity="0.9"/>
            {/* Rotating scan ring */}
            <circle cx="80" cy="80" r="35" stroke={missileColor} strokeWidth="0.8" opacity="0.3" strokeDasharray="8 52" style={{
              transformOrigin: '80px 80px',
              animation: 'air-missile-scan 3s linear infinite',
            }}/>
          </svg>
          {/* MISSILE label */}
          <div style={{
            position: 'absolute', bottom: '-20px', left: '50%', transform: 'translateX(-50%)',
            fontFamily: 'var(--font-mono)', fontSize: '8px', letterSpacing: '0.2em',
            color: missileColor, opacity: 0.7,
          }}>AIR MISSILE</div>

          {/* Hit marker */}
          {hitMarker && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', animation: 'hitmarker-flash 0.2s ease-out' }}>
              <div style={{
                width: hitMarkerType === 'player' ? '18px' : '14px',
                height: '2px',
                background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                transform: 'rotate(45deg)',
                position: 'absolute', top: '50%', left: '50%', marginLeft: hitMarkerType === 'player' ? '-9px' : '-7px', marginTop: '-1px',
                boxShadow: hitMarkerType === 'player' ? '0 0 8px var(--c-red)' : '0 0 6px rgba(255,255,255,0.5)',
              }} />
              <div style={{
                width: hitMarkerType === 'player' ? '18px' : '14px',
                height: '2px',
                background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                transform: 'rotate(-45deg)',
                position: 'absolute', top: '50%', left: '50%', marginLeft: hitMarkerType === 'player' ? '-9px' : '-7px', marginTop: '-1px',
                boxShadow: hitMarkerType === 'player' ? '0 0 8px var(--c-red)' : '0 0 6px rgba(255,255,255,0.5)',
              }} />
            </div>
          )}
        </div>
      ) : mountedVehicleName ? (
        /* ── Vehicle targeting reticle ── */
        <div className="relative" style={{ width: '64px', height: '64px' }}>
          {/* Outer circle */}
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            <circle cx="32" cy="32" r="28" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1" opacity="0.4" strokeDasharray="4 4"/>
            {/* Cardinal ticks */}
            <line x1="32" y1="2" x2="32" y2="8" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="32" y1="56" x2="32" y2="62" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="2" y1="32" x2="8" y2="32" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="56" y1="32" x2="62" y2="32" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            {/* Inner circle */}
            <circle cx="32" cy="32" r="6" stroke={vehicleWeaponColor ?? '#ffaa00'} strokeWidth="1" opacity="0.6"/>
            {/* Center dot */}
            <circle cx="32" cy="32" r="1.5" fill={vehicleWeaponColor ?? '#ffaa00'} opacity="0.9"/>
          </svg>

          {/* Hit marker — X shape, colored by hit type */}
          {hitMarker && (
            <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
              <div className="absolute top-1/2 left-1/2" style={{
                width: hitMarkerType === 'player' ? '18px' : '14px',
                height: '2px',
                background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                transform: 'translate(-50%, -50%) rotate(45deg)',
                boxShadow: hitMarkerType === 'player'
                  ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                  : '0 0 6px rgba(255,255,255,0.5)',
              }} />
              <div className="absolute top-1/2 left-1/2" style={{
                width: hitMarkerType === 'player' ? '18px' : '14px',
                height: '2px',
                background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                transform: 'translate(-50%, -50%) rotate(-45deg)',
                boxShadow: hitMarkerType === 'player'
                  ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                  : '0 0 6px rgba(255,255,255,0.5)',
              }} />
            </div>
          )}
        </div>
      ) : (
        /* ── Infantry crosshair ── */
        <div className="relative" style={{ width: '32px', height: '32px' }}>
        {/* Crosshair lines with gap */}
        {/* Top */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{
          top: '2px', width: '2px', height: '8px',
          background: 'rgba(255,255,255,0.75)',
          boxShadow: '0 0 3px rgba(0,0,0,0.5)',
        }} />
        {/* Bottom */}
        <div className="absolute left-1/2 -translate-x-1/2" style={{
          bottom: '2px', width: '2px', height: '8px',
          background: 'rgba(255,255,255,0.75)',
          boxShadow: '0 0 3px rgba(0,0,0,0.5)',
        }} />
        {/* Left */}
        <div className="absolute top-1/2 -translate-y-1/2" style={{
          left: '2px', width: '8px', height: '2px',
          background: 'rgba(255,255,255,0.75)',
          boxShadow: '0 0 3px rgba(0,0,0,0.5)',
        }} />
        {/* Right */}
        <div className="absolute top-1/2 -translate-y-1/2" style={{
          right: '2px', width: '8px', height: '2px',
          background: 'rgba(255,255,255,0.75)',
          boxShadow: '0 0 3px rgba(0,0,0,0.5)',
        }} />
        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{
          width: '2px', height: '2px',
          background: 'rgba(255,255,255,0.95)',
          boxShadow: '0 0 4px rgba(255,255,255,0.3)',
        }} />

        {/* Hit marker — X shape, colored by hit type */}
        {hitMarker && (
          <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
            <div className="absolute top-1/2 left-1/2" style={{
              width: hitMarkerType === 'player' ? '18px' : '14px',
              height: '2px',
              background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
              transform: 'translate(-50%, -50%) rotate(45deg)',
              boxShadow: hitMarkerType === 'player'
                ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                : '0 0 6px rgba(255,255,255,0.5)',
            }} />
            <div className="absolute top-1/2 left-1/2" style={{
              width: hitMarkerType === 'player' ? '18px' : '14px',
              height: '2px',
              background: hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
              transform: 'translate(-50%, -50%) rotate(-45deg)',
              boxShadow: hitMarkerType === 'player'
                ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                : '0 0 6px rgba(255,255,255,0.5)',
            }} />
          </div>
        )}
      </div>
      )}
    </div>
  );
}
