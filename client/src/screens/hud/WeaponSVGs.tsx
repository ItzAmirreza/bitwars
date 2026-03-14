// ── Weapon SVG silhouettes and stat bar ──

export function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--c-muted)',
        letterSpacing: '0.1em', width: '28px', flexShrink: 0, textAlign: 'right',
      }}>{label}</span>
      <div style={{
        flex: 1, height: '4px', background: 'rgba(255,255,255,0.06)',
        borderRadius: '2px', overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '2px',
          background: `linear-gradient(90deg, ${color}cc, ${color})`,
          boxShadow: `0 0 6px ${color}40`,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--c-muted)',
        width: '22px', textAlign: 'right', flexShrink: 0,
      }}>{value}</span>
    </div>
  );
}

export function RifleSVG({ color, glow }: { color: string; glow?: boolean }) {
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

export function ShotgunSVG({ color, glow }: { color: string; glow?: boolean }) {
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

export function RpgSVG({ color, glow }: { color: string; glow?: boolean }) {
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

export function MachineGunSVG({ color, glow }: { color: string; glow?: boolean }) {
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

export function GrenadeSVG({ color, glow }: { color: string; glow?: boolean }) {
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

export function WeaponSilhouette({ weaponIndex, color, active }: { weaponIndex: number; color: string; active: boolean }) {
  switch (weaponIndex) {
    case 0: return <RifleSVG color={color} glow={active} />;
    case 1: return <ShotgunSVG color={color} glow={active} />;
    case 2: return <RpgSVG color={color} glow={active} />;
    case 3: return <MachineGunSVG color={color} glow={active} />;
    case 4: return <GrenadeSVG color={color} glow={active} />;
    default: return null;
  }
}

// Mini weapon icons for the slot indicators
export function MiniRifleSVG({ color }: { color: string }) {
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

export function MiniShotgunSVG({ color }: { color: string }) {
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

export function MiniRpgSVG({ color }: { color: string }) {
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

export function MiniMachineGunSVG({ color }: { color: string }) {
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

export function MiniGrenadeSVG({ color }: { color: string }) {
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

export function MiniWeaponIcon({ weaponIndex, color }: { weaponIndex: number; color: string }) {
  switch (weaponIndex) {
    case 0: return <MiniRifleSVG color={color} />;
    case 1: return <MiniShotgunSVG color={color} />;
    case 2: return <MiniRpgSVG color={color} />;
    case 3: return <MiniMachineGunSVG color={color} />;
    case 4: return <MiniGrenadeSVG color={color} />;
    default: return null;
  }
}
