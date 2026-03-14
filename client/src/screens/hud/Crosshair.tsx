import { VEHICLE_WEAPON_DATA } from './weaponData';
import type { EngineState } from '../../game/Engine';

export interface CrosshairProps {
  state: EngineState;
}

function HitMarkerX({ hitMarkerType }: { hitMarkerType: 'block' | 'player' | 'none' }) {
  const size = hitMarkerType === 'player' ? '18px' : '14px';
  const bg = hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)';
  const shadow = hitMarkerType === 'player'
    ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
    : '0 0 6px rgba(255,255,255,0.5)';

  return (
    <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
      <div className="absolute top-1/2 left-1/2" style={{
        width: size, height: '2px', background: bg,
        transform: 'translate(-50%, -50%) rotate(45deg)',
        boxShadow: shadow,
      }} />
      <div className="absolute top-1/2 left-1/2" style={{
        width: size, height: '2px', background: bg,
        transform: 'translate(-50%, -50%) rotate(-45deg)',
        boxShadow: shadow,
      }} />
    </div>
  );
}

export function Crosshair({ state }: CrosshairProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      {state.mountedVehicleName ? (
        /* ── Vehicle targeting reticle ── */
        <div className="relative" style={{ width: '64px', height: '64px' }}>
          {/* Outer circle */}
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            <circle cx="32" cy="32" r="28" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1" opacity="0.4" strokeDasharray="4 4"/>
            {/* Cardinal ticks */}
            <line x1="32" y1="2" x2="32" y2="8" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="32" y1="56" x2="32" y2="62" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="2" y1="32" x2="8" y2="32" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            <line x1="56" y1="32" x2="62" y2="32" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1.5" opacity="0.7"/>
            {/* Inner circle */}
            <circle cx="32" cy="32" r="6" stroke={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} strokeWidth="1" opacity="0.6"/>
            {/* Center dot */}
            <circle cx="32" cy="32" r="1.5" fill={VEHICLE_WEAPON_DATA[state.vehicleWeapon]?.color ?? '#ffaa00'} opacity="0.9"/>
          </svg>

          {/* Hit marker */}
          {state.hitMarker && <HitMarkerX hitMarkerType={state.hitMarkerType} />}
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

          {/* Hit marker */}
          {state.hitMarker && <HitMarkerX hitMarkerType={state.hitMarkerType} />}
        </div>
      )}
    </div>
  );
}
