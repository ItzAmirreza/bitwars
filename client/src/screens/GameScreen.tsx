import { useEffect, useRef, useState, useCallback } from 'react';
import { Engine } from '../game/Engine';
import type { EngineState } from '../game/Engine';
import { useGameStore } from '../store';
import { SettingsPanel } from './SettingsPanel';

interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

interface KillNotification {
  id: number;
  text: string;
  time: number;
  type: 'kill' | 'death' | 'streak';
}

interface KillFeedEntry {
  id: number;
  killerName: string;
  victimName: string;
  weapon: number;
  time: number;
}

const WEAPON_LABELS: Record<number, string> = {
  0: 'Rifle',
  1: 'Shotgun',
  2: 'RPG',
  3: 'Machine Gun',
  4: 'Grenade',
  100: 'Minigun',
  101: 'Rocket',
};

const MAX_CHAT_MESSAGES = 80;

function getMessageTimestamp(sentAt: { toMillis?: () => bigint } | null | undefined): number {
  if (sentAt && typeof sentAt.toMillis === 'function') {
    return Number(sentAt.toMillis());
  }
  return Date.now();
}

function toDisplayMessage(msg: any): DisplayMessage {
  return {
    id: Number(msg.id),
    senderName: String(msg.senderName),
    text: String(msg.text),
    sentAt: getMessageTimestamp(msg.sentAt),
  };
}

function mergeMessages(prev: DisplayMessage[], next: DisplayMessage[]): DisplayMessage[] {
  const merged = new Map<number, DisplayMessage>();

  for (const message of prev) merged.set(message.id, message);
  for (const message of next) merged.set(message.id, message);

  return Array.from(merged.values())
    .sort((a, b) => (a.sentAt === b.sentAt ? a.id - b.id : a.sentAt - b.sentAt))
    .slice(-MAX_CHAT_MESSAGES);
}

// Type-based coloring: hitscan = cyan, explosive = orange
const TYPE_COLORS = {
  HITSCAN:   { color: 'var(--c-cyan)', rawColor: '#66e0ff' },
  EXPLOSIVE: { color: 'var(--c-amber)', rawColor: '#ff9800' },
} as const;

const WEAPON_DATA = [
  { name: 'RIFLE', ...TYPE_COLORS.HITSCAN,
    type: 'HITSCAN' as const, desc: 'Versatile assault rifle. Reliable at any range.',
    damage: 25, fireRate: 5, range: 80, ammo: 90 },
  { name: 'SHOTGUN', ...TYPE_COLORS.HITSCAN,
    type: 'HITSCAN' as const, desc: '7-pellet burst. Devastating up close.',
    damage: 12, fireRate: 1, range: 30, ammo: 24 },
  { name: 'RPG', ...TYPE_COLORS.EXPLOSIVE,
    type: 'EXPLOSIVE' as const, desc: 'Explosive rocket. Destroys terrain and players.',
    damage: 80, fireRate: 1.0, range: 80, ammo: 12 },
  { name: 'MACHINE GUN', ...TYPE_COLORS.HITSCAN,
    type: 'HITSCAN' as const, desc: 'Rapid fire suppression. Best sustained DPS.',
    damage: 14, fireRate: 13, range: 90, ammo: 180 },
  { name: 'GRENADE', ...TYPE_COLORS.EXPLOSIVE,
    type: 'EXPLOSIVE' as const, desc: 'Arcing grenades. Largest blast radius.',
    damage: 95, fireRate: 1.4, range: 85, ammo: 14 },
];
const WEAPON_INDEXES = [0, 1, 2, 3, 4] as const;

// Vehicle weapon data for HUD
const VEHICLE_WEAPON_DATA = [
  { name: 'MINIGUN', type: 'HITSCAN' as const, color: '#ffaa00', maxAmmo: 300, fireRate: 15, damage: 8 },
  { name: 'ROCKETS', type: 'EXPLOSIVE' as const, color: '#ff4444', maxAmmo: 16, fireRate: 2.5, damage: 45 },
];

// Stat normalization maxima for bar display
const STAT_MAX = { damage: 100, fireRate: 15, range: 100, ammo: 200 } as const;

function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
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

const COMPASS_DIRS = [
  { deg: 0, label: 'N' }, { deg: 45, label: 'NE' }, { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' }, { deg: 180, label: 'S' }, { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' }, { deg: 315, label: 'NW' },
] as const;

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

// Compass bar component
function CompassBar({ heading }: { heading: number }) {
  const barWidth = 300;
  const ticks: { pos: number; label?: string; major: boolean }[] = [];

  for (let d = -180; d <= 540; d += 15) {
    const normD = ((d % 360) + 360) % 360;
    const offset = ((d - heading + 180 + 360) % 360 - 180);
    const pixelPos = (offset / 180) * (barWidth / 2);
    if (Math.abs(pixelPos) > barWidth / 2) continue;

    const dir = COMPASS_DIRS.find((c) => c.deg === normD);
    ticks.push({
      pos: pixelPos + barWidth / 2,
      label: dir?.label,
      major: !!dir,
    });
  }

  return (
    <div style={{
      width: `${barWidth}px`,
      height: '20px',
      position: 'relative',
      overflow: 'hidden',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
    }}>
      {/* Center marker */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: '2px',
        transform: 'translateX(-50%)',
        background: 'var(--c-green)',
        boxShadow: '0 0 6px var(--c-green)',
        zIndex: 2,
      }} />
      {ticks.map((tick, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${tick.pos}px`,
          top: tick.major ? '0px' : '10px',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          {tick.label && (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: tick.label.length === 1 ? '10px' : '8px',
              color: tick.label === 'N' ? 'var(--c-red)' : tick.label.length === 1 ? 'var(--c-text)' : 'var(--c-muted)',
              fontWeight: tick.label.length === 1 ? 'bold' : 'normal',
              letterSpacing: '0.05em',
              lineHeight: '1',
              textShadow: tick.label === 'N' ? '0 0 6px var(--c-red)' : 'none',
            }}>
              {tick.label}
            </span>
          )}
          <div style={{
            width: '1px',
            height: tick.major ? '6px' : '4px',
            background: tick.major ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)',
          }} />
        </div>
      ))}
    </div>
  );
}

export function GameScreen() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const { connection, setScreen, settings, showSettings, setShowSettings, identity, username } = useGameStore();

  const [state, setState] = useState<EngineState>({
    weapon: 0,
    loadout: [0, 1, 2],
    ammo: 90,
    maxAmmo: 90,
    weaponName: 'Rifle',
    weaponColor: '#4488ff',
    fps: 0,
    locked: false,
    playerCount: 1,
    health: 100,
    kills: 0,
    deaths: 0,
    hitMarker: false,
    hitMarkerType: 'none',
    timeOfDay: '12:00',
    weather: 'Clear',
    heading: 0,
    isReloading: false,
    worldReady: false,
    worldLoadProgress: 0,
    mountedVehicleName: null,
    vehicleAltitude: 0,
    vehicleHealth: 0,
    vehicleMaxHealth: 1000,
    vehicleWeapon: 0,
    vehicleWeaponName: 'MINIGUN',
    vehicleAmmo: 0,
    vehicleMaxAmmo: 300,
    vehicleSpeed: 0,
    vehicleReloading: false,
    nearVehicle: false,
  });

  // ── Kill feed from server ──
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);
  const killFeedIdRef = useRef(0);

  // ── Kill/Death tracking ──
  const prevKillsRef = useRef(0);
  const prevDeathsRef = useRef(0);
  const prevHealthRef = useRef(100);
  const [killNotifications, setKillNotifications] = useState<KillNotification[]>([]);
  const [isDead, setIsDead] = useState(false);
  const killNotifIdRef = useRef(0);
  const [killStreak, setKillStreak] = useState(0);
  const killStreakTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [respawnCountdown, setRespawnCountdown] = useState(0);
  const respawnTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Detect kills
  useEffect(() => {
    if (state.kills > prevKillsRef.current) {
      const newStreak = killStreak + 1;
      setKillStreak(newStreak);

      const streakLabels: Record<number, string> = {
        2: 'DOUBLE KILL',
        3: 'TRIPLE KILL',
        4: 'MEGA KILL',
        5: 'UNSTOPPABLE',
      };

      const id = ++killNotifIdRef.current;
      const notifs: KillNotification[] = [{
        id,
        text: 'KILL CONFIRMED',
        time: Date.now(),
        type: 'kill',
      }];

      if (newStreak >= 2 && streakLabels[Math.min(newStreak, 5)]) {
        notifs.push({
          id: ++killNotifIdRef.current,
          text: streakLabels[Math.min(newStreak, 5)]!,
          time: Date.now() + 200,
          type: 'streak',
        });
      }

      setKillNotifications((prev) => [...prev, ...notifs].slice(-5));

      clearTimeout(killStreakTimerRef.current);
      killStreakTimerRef.current = setTimeout(() => setKillStreak(0), 4000);
    }
    prevKillsRef.current = state.kills;
  }, [state.kills, killStreak]);

  // Detect deaths — start respawn countdown
  useEffect(() => {
    if (state.deaths > prevDeathsRef.current) {
      setIsDead(true);
      setKillStreak(0);
      const id = ++killNotifIdRef.current;
      setKillNotifications((prev) => [...prev, {
        id,
        text: 'YOU DIED',
        time: Date.now(),
        type: 'death' as const,
      }].slice(-5));

      // Start 3-second respawn countdown
      const RESPAWN_DELAY = 3;
      setRespawnCountdown(RESPAWN_DELAY);
      clearInterval(respawnTimerRef.current);
      let remaining = RESPAWN_DELAY;
      respawnTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(respawnTimerRef.current);
          setRespawnCountdown(0);
          // Call the server respawn reducer
          if (connection) {
            try {
              connection.reducers.respawn({});
            } catch (e) {
              console.error('[BitWars] Respawn reducer failed:', e);
            }
          }
        } else {
          setRespawnCountdown(remaining);
        }
      }, 1000);
    }
    prevDeathsRef.current = state.deaths;
  }, [state.deaths, connection]);

  // Clear death screen on respawn (server sets health > 0)
  useEffect(() => {
    if (isDead && state.health > 0) {
      setIsDead(false);
      setRespawnCountdown(0);
      clearInterval(respawnTimerRef.current);
    }
  }, [state.health, isDead]);

  // Cleanup respawn timer on unmount
  useEffect(() => {
    return () => clearInterval(respawnTimerRef.current);
  }, []);

  // Track health changes for damage flash
  useEffect(() => {
    prevHealthRef.current = state.health;
  }, [state.health]);

  // Clear old kill notifications
  useEffect(() => {
    if (killNotifications.length === 0) return;
    const timer = setTimeout(() => {
      setKillNotifications((prev) => prev.filter((n) => Date.now() - n.time < 3000));
    }, 3100);
    return () => clearTimeout(timer);
  }, [killNotifications]);

  // ── Chat state ──
  const [chatOpen, setChatOpen] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);
  const [loadoutDraft, setLoadoutDraft] = useState<[number, number, number]>([0, 1, 2]);
  const [activeLoadoutSlot, setActiveLoadoutSlot] = useState(0);
  const [savingLoadout, setSavingLoadout] = useState(false);
  const [chatMessages, setChatMessages] = useState<DisplayMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [, chatTick] = useState(0);
  const [roundTimer, setRoundTimer] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const chatListRef = useRef<HTMLDivElement>(null);
  const localChatIdRef = useRef(-1);

  const pushLocalSystemMessage = useCallback((text: string) => {
    const nextId = localChatIdRef.current;
    localChatIdRef.current -= 1;

    setChatMessages((prev) =>
      mergeMessages(prev, [
        {
          id: nextId,
          senderName: '[SERVER]',
          text,
          sentAt: Date.now(),
        },
      ]),
    );
  }, []);

  // Load chat messages from DB + subscribe to new ones
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.chat_message) return;

    const initial = Array.from(db.chat_message.iter(), (msg: any) => toDisplayMessage(msg));
    setChatMessages(mergeMessages([], initial));

    const handleInsert = (_ctx: unknown, msg: any) => {
      setChatMessages((prev) => mergeMessages(prev, [toDisplayMessage(msg)]));
    };

    db.chat_message.onInsert(handleInsert);

    return () => {
      if (typeof db.chat_message.removeOnInsert === 'function') {
        db.chat_message.removeOnInsert(handleInsert);
      }
    };
  }, [connection]);

  // Subscribe to kill events for the kill feed
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.kill_event) return;

    const handleInsert = (_ctx: unknown, ev: any) => {
      const entry: KillFeedEntry = {
        id: ++killFeedIdRef.current,
        killerName: String(ev.killerName ?? '???'),
        victimName: String(ev.victimName ?? '???'),
        weapon: Number(ev.weapon ?? 0),
        time: Date.now(),
      };
      setKillFeed((prev) => [...prev, entry].slice(-8));
    };

    db.kill_event.onInsert(handleInsert);

    return () => {
      if (typeof db.kill_event.removeOnInsert === 'function') {
        db.kill_event.removeOnInsert(handleInsert);
      }
    };
  }, [connection]);

  // Auto-remove kill feed entries after 6 seconds
  useEffect(() => {
    if (killFeed.length === 0) return;
    const timer = setTimeout(() => {
      setKillFeed((prev) => prev.filter((e) => Date.now() - e.time < 6000));
    }, 6100);
    return () => clearTimeout(timer);
  }, [killFeed]);

  // Round timer countdown from WorldConfig
  useEffect(() => {
    if (!connection) return;
    const db = connection.db as any;
    if (!db.world_config) return;

    const update = () => {
      for (const config of db.world_config.iter()) {
        const startMs = typeof config.roundStart?.toMillis === 'function'
          ? Number(config.roundStart.toMillis()) : 0;
        if (startMs === 0) { setRoundTimer(''); return; }
        const elapsed = (Date.now() - startMs) / 1000;
        const remaining = Math.max(0, 300 - elapsed);
        const m = Math.floor(remaining / 60);
        const s = Math.floor(remaining % 60);
        setRoundTimer(`${m}:${s.toString().padStart(2, '0')}`);
        return;
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [connection]);

  // Periodic tick for message fading (when chat is closed)
  useEffect(() => {
    if (chatOpen) return;
    const interval = setInterval(() => chatTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [chatOpen]);

  // Focus chat input when opened
  useEffect(() => {
    if (chatOpen) {
      const timer = window.setTimeout(() => {
        const input = chatInputRef.current;
        if (!input) return;

        input.focus();
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }, 0);

      return () => window.clearTimeout(timer);
    }
  }, [chatOpen]);

  useEffect(() => {
    if (!chatOpen) return;

    const frame = window.requestAnimationFrame(() => {
      const list = chatListRef.current;
      if (!list) return;
      list.scrollTop = list.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages, chatOpen]);

  const closeLoadout = useCallback(() => {
    setLoadoutOpen(false);
    setSavingLoadout(false);
    engineRef.current?.setLoadoutMenuOpen(false);
  }, []);

  const openLoadout = useCallback(() => {
    if (chatOpen) {
      setChatOpen(false);
      setChatDraft('');
      engineRef.current?.setChatOpen(false);
    }
    setLoadoutDraft(state.loadout);
    setActiveLoadoutSlot(0);
    setLoadoutOpen(true);
    engineRef.current?.setLoadoutMenuOpen(true);
  }, [chatOpen, state.loadout]);

  const assignWeaponToSlot = useCallback((slot: number, weaponIndex: number) => {
    setLoadoutDraft((prev) => {
      const next = [...prev] as [number, number, number];
      const existing = next.indexOf(weaponIndex);
      if (existing >= 0 && existing !== slot) {
        next[existing] = next[slot];
      }
      next[slot] = weaponIndex;
      return next;
    });
  }, []);

  const saveLoadout = useCallback(async () => {
    if (!connection || savingLoadout) return;

    setSavingLoadout(true);
    try {
      await (connection.reducers as any).setLoadout({
        slot1: loadoutDraft[0],
        slot2: loadoutDraft[1],
        slot3: loadoutDraft[2],
      });
      engineRef.current?.setLoadout(loadoutDraft, state.weapon);
      closeLoadout();
    } catch (error) {
      pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to save loadout');
      setSavingLoadout(false);
    }
  }, [connection, savingLoadout, loadoutDraft, state.weapon, closeLoadout, pushLocalSystemMessage]);

  const openChat = useCallback((initialText = '') => {
    if (loadoutOpen) {
      closeLoadout();
    }
    setChatDraft(initialText);
    setChatOpen(true);
    engineRef.current?.setChatOpen(true);
  }, [loadoutOpen, closeLoadout]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatDraft('');
    engineRef.current?.setChatOpen(false);
  }, []);

  const sendChatMessage = useCallback(
    async (text: string) => {
      if (!connection || !text.trim()) return;
      const trimmed = text.trim();

      try {
        await connection.reducers.sendChat({ text: trimmed });
        if (trimmed.toLowerCase() === '/fly') {
          engineRef.current?.toggleFly();
        }
      } catch (error) {
        pushLocalSystemMessage(error instanceof Error ? error.message : 'Failed to send chat message');
      }
    },
    [connection, pushLocalSystemMessage],
  );

  const getMessageOpacity = useCallback(
    (sentAt: number): number => {
      if (chatOpen) return 1;
      const age = (Date.now() - sentAt) / 1000;
      if (age < 6) return 0.9;
      if (age < 10) return 0.9 * (1 - (age - 6) / 4);
      return 0;
    },
    [chatOpen],
  );

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || engineRef.current) return;

    engineRef.current = new Engine(container, connection, setState, identity, username || null);
    engineRef.current.updateSettings(settings);

    return () => {
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
    };
  }, [connection, username]);

  // Sync settings to engine when they change
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.updateSettings(settings);
    }
  }, [settings]);

  // Global key handler: Escape (menus), T (chat), E (loadout)
  const handleGlobalKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        return;
      }

      if (chatOpen || loadoutOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          if (chatOpen) closeChat();
          else closeLoadout();
        }
        if (loadoutOpen && e.code === 'KeyE') {
          e.preventDefault();
          closeLoadout();
        }
        if (loadoutOpen && (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3')) {
          e.preventDefault();
          setActiveLoadoutSlot(Number(e.code.charAt(5)) - 1);
        }
        return;
      }

      if (e.code === 'Escape') {
        e.preventDefault();
        setShowSettings(!showSettings);
        return;
      }

      if (e.code === 'KeyE' && state.locked && !showSettings && !state.mountedVehicleName) {
        e.preventDefault();
        openLoadout();
        return;
      }

      if ((e.code === 'KeyT' || e.code === 'Slash') && state.locked && !showSettings) {
        e.preventDefault();
        openChat(e.code === 'Slash' ? '/' : '');
      }
    },
    [chatOpen, loadoutOpen, showSettings, setShowSettings, state.locked, openChat, openLoadout, closeChat, closeLoadout],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [handleGlobalKey]);

  const handleLeave = () => setScreen('lobby');
  const healthColor = state.health > 50 ? 'var(--c-green)' : state.health > 25 ? 'var(--c-amber)' : 'var(--c-red)';
  const healthRawColor = state.health > 50 ? '#00ff41' : state.health > 25 ? '#ff9800' : '#ff0033';
  const isLowHealth = state.health > 0 && state.health <= 25;
  const isCriticalHealth = state.health > 0 && state.health <= 10;
  const isLowAmmo = state.ammo > 0 && state.ammo <= Math.ceil(state.maxAmmo * 0.2);
  const ammoPercent = state.maxAmmo > 0 ? (state.ammo / state.maxAmmo) * 100 : 0;
  const kdRatio = state.deaths > 0 ? (state.kills / state.deaths).toFixed(1) : state.kills > 0 ? state.kills.toFixed(1) : '0.0';
  const loadingPercent = Math.max(0, Math.min(100, Math.round(state.worldLoadProgress * 100)));

  return (
    <div className="flex flex-col h-full relative">
      {/* Game Canvas */}
      <div ref={canvasRef} className="absolute inset-0" />

      {/* Settings Panel */}
      {showSettings && <SettingsPanel />}

      {/* Startup world streaming overlay */}
      {!state.worldReady && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{
            background: 'radial-gradient(circle at center, rgba(10,16,24,0.86), rgba(2,4,8,0.985))',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ width: 'min(460px, calc(100vw - 40px))' }}>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '20px',
              letterSpacing: '0.08em',
              color: 'var(--c-text)',
              textAlign: 'center',
              textShadow: '0 0 14px rgba(255,255,255,0.2)',
              marginBottom: '10px',
            }}>
              STABILIZING COMBAT ZONE
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--c-muted)',
              textAlign: 'center',
              marginBottom: '14px',
            }}>
              Streaming nearby terrain first
            </div>
            <div style={{
              height: '12px',
              border: '1px solid rgba(255,255,255,0.28)',
              background: 'rgba(255,255,255,0.08)',
              boxShadow: 'inset 0 0 8px rgba(0,0,0,0.45)',
            }}>
              <div style={{
                width: `${loadingPercent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #2f90ff, #60d6ff)',
                boxShadow: '0 0 12px rgba(96,214,255,0.45)',
                transition: 'width 160ms linear',
              }} />
            </div>
            <div style={{
              marginTop: '10px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              letterSpacing: '0.1em',
              color: 'var(--c-blue)',
              textAlign: 'center',
            }}>
              {loadingPercent}%
            </div>
            <div style={{
              marginTop: '8px',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.12em',
              color: 'var(--c-muted)',
              textAlign: 'center',
              textTransform: 'uppercase',
            }}>
              Movement locked until nearby chunks are ready
            </div>
          </div>
        </div>
      )}

      {/* ═══ LOW HEALTH SCREEN EFFECTS ═══ */}
      {isLowHealth && state.locked && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            boxShadow: `inset 0 0 ${isCriticalHealth ? '120px' : '80px'} ${isCriticalHealth ? '40px' : '20px'} rgba(255,0,30,${isCriticalHealth ? 0.3 : 0.15})`,
            animation: isCriticalHealth ? 'low-hp-pulse 0.6s ease-in-out infinite' : 'low-hp-pulse 1s ease-in-out infinite',
          }}
        />
      )}

      {/* ═══ DEATH SCREEN OVERLAY ═══ */}
      {isDead && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{
            background: 'rgba(15,0,0,0.7)',
            animation: 'death-fade-in 0.5s ease-out',
          }}
        >
          <div className="text-center" style={{ animation: 'death-text-in 0.6s ease-out' }}>
            <div style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: '32px',
              color: 'var(--c-red)',
              textShadow: '0 0 30px rgba(255,0,51,0.8), 0 0 60px rgba(255,0,51,0.4)',
              letterSpacing: '0.15em',
              marginBottom: '16px',
            }}>
              YOU DIED
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--c-muted)',
              letterSpacing: '0.15em',
              marginBottom: '8px',
            }}>
              {respawnCountdown > 0 ? `RESPAWNING IN ${respawnCountdown}...` : 'RESPAWNING...'}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--c-muted2)',
              letterSpacing: '0.1em',
            }}>
              K/D: {state.kills}/{state.deaths}
            </div>
          </div>
        </div>
      )}

      {/* ═══ LOADOUT OVERLAY ═══ */}
      {loadoutOpen && (
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
      )}

      {/* ═══ KILL FEED (top-right, who killed who) ═══ */}
      <div className="absolute z-20 pointer-events-none" style={{
        top: '60px',
        right: '8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '2px',
      }}>
        {/* Server kill feed entries */}
        {killFeed.map((entry) => {
          const age = (Date.now() - entry.time) / 1000;
          const opacity = age < 4 ? 1 : Math.max(0, 1 - (age - 4) / 2);
          const weaponLabel = WEAPON_LABELS[entry.weapon] ?? `W${entry.weapon}`;
          const isLocalKiller = entry.killerName === username;
          const isLocalVictim = entry.victimName === username;
          return (
            <div
              key={entry.id}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: '1.3',
                padding: '2px 8px',
                background: 'rgba(0,0,0,0.45)',
                opacity,
                textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                transform: `translateX(${age < 0.2 ? (1 - age / 0.2) * 16 : 0}px)`,
                transition: 'opacity 0.4s',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ color: isLocalKiller ? '#55ff55' : '#ffffff', fontWeight: isLocalKiller ? 700 : 400 }}>
                {entry.killerName}
              </span>
              <span style={{ color: '#888888', margin: '0 5px' }}>[{weaponLabel}]</span>
              <span style={{ color: isLocalVictim ? '#ff5555' : '#ffffff', fontWeight: isLocalVictim ? 700 : 400 }}>
                {entry.victimName}
              </span>
            </div>
          );
        })}
        {/* Local kill/death/streak notifications */}
        {killNotifications.map((notif) => {
          const age = (Date.now() - notif.time) / 1000;
          const opacity = age < 2 ? 1 : Math.max(0, 1 - (age - 2));
          const isStreak = notif.type === 'streak';
          const isDeath = notif.type === 'death';
          return (
            <div
              key={`notif-${notif.id}`}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: isStreak ? '12px' : '11px',
                fontWeight: 'bold',
                color: isDeath ? '#ff5555' : isStreak ? '#ffaa00' : '#55ff55',
                padding: '2px 8px',
                background: 'rgba(0,0,0,0.45)',
                letterSpacing: '0.12em',
                opacity,
                textShadow: isDeath
                  ? '0 0 8px rgba(255,85,85,0.6)'
                  : isStreak
                    ? '0 0 8px rgba(255,170,0,0.6)'
                    : '0 0 6px rgba(85,255,85,0.4)',
                transform: `translateX(${age < 0.2 ? (1 - age / 0.2) * 16 : 0}px)`,
                transition: 'opacity 0.3s',
              }}
            >
              {notif.text}
            </div>
          );
        })}
      </div>

      {/* ═══ TOP HUD BAR ═══ */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div style={{
          background: 'linear-gradient(180deg, rgba(6,8,16,0.8) 0%, rgba(6,8,16,0.3) 70%, transparent 100%)',
          paddingBottom: '8px',
        }}>
          {/* Top row: buttons + round timer + info */}
          <div className="flex items-center justify-between px-4 py-2">
            {/* Left: buttons + player name */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleLeave}
                className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
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
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: showSettings ? 'var(--c-green)' : 'var(--c-muted)',
                  background: 'rgba(6,8,16,0.6)',
                  border: `1px solid ${showSettings ? 'var(--c-green)' : 'var(--c-border)'}`,
                  letterSpacing: '0.1em',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-green)';
                  e.currentTarget.style.color = 'var(--c-green)';
                }}
                onMouseLeave={(e) => {
                  if (!showSettings) {
                    e.currentTarget.style.borderColor = 'var(--c-border)';
                    e.currentTarget.style.color = 'var(--c-muted)';
                  }
                }}
              >
                SETTINGS
              </button>
              <button
                onClick={openLoadout}
                className="pointer-events-auto cursor-pointer px-3 py-1 hud-btn"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: loadoutOpen ? 'var(--c-cyan)' : 'var(--c-muted)',
                  background: 'rgba(6,8,16,0.6)',
                  border: `1px solid ${loadoutOpen ? 'var(--c-cyan)' : 'var(--c-border)'}`,
                  letterSpacing: '0.1em',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--c-cyan)';
                  e.currentTarget.style.color = 'var(--c-cyan)';
                }}
                onMouseLeave={(e) => {
                  if (!loadoutOpen) {
                    e.currentTarget.style.borderColor = 'var(--c-border)';
                    e.currentTarget.style.color = 'var(--c-muted)';
                  }
                }}
              >
                [E] LOADOUT
              </button>

              {/* Player name display */}
              {username && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginLeft: '8px',
                  padding: '3px 10px',
                  background: 'rgba(6,8,16,0.5)',
                  border: '1px solid rgba(0,255,65,0.15)',
                  borderLeft: '2px solid var(--c-green)',
                }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--c-green)',
                    boxShadow: '0 0 6px var(--c-green)',
                  }} />
                  <span style={{
                    fontFamily: 'var(--font-ui)',
                    fontSize: '12px',
                    fontWeight: 700,
                    color: 'var(--c-green)',
                    letterSpacing: '0.08em',
                    textShadow: '0 0 8px rgba(0,255,65,0.3)',
                  }}>
                    {username}
                  </span>
                </div>
              )}
            </div>

            {/* Center: round timer (Valorant style) */}
            {roundTimer && (
              <div style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                }}>
                  ROUND
                </span>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '22px',
                  fontWeight: 'bold',
                  color: roundTimer.startsWith('0:') ? 'var(--c-red)' : 'var(--c-text)',
                  letterSpacing: '0.08em',
                  textShadow: roundTimer.startsWith('0:') ? '0 0 12px var(--c-red)' : '0 0 6px rgba(255,255,255,0.15)',
                  lineHeight: '1',
                  padding: '4px 16px',
                  background: 'rgba(6,8,16,0.7)',
                  border: `1px solid ${roundTimer.startsWith('0:') ? 'rgba(255,0,51,0.4)' : 'var(--c-border)'}`,
                  borderRadius: '2px',
                  animation: roundTimer.startsWith('0:') ? 'hud-critical-flash 1s ease-in-out infinite' : 'none',
                }}>
                  {roundTimer}
                </div>
              </div>
            )}

            {/* Right: alive counter + player count + FPS */}
            <div className="flex items-center gap-4">
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '3px 10px',
                background: 'rgba(6,8,16,0.5)',
                border: '1px solid var(--c-border)',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--c-muted)',
                  letterSpacing: '0.12em',
                }}>
                  ALIVE
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: 'var(--c-green)',
                  textShadow: '0 0 6px rgba(0,255,65,0.3)',
                  lineHeight: '1',
                }}>
                  {state.playerCount}
                </span>
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--c-muted2)',
              }}>
                {state.fps} FPS
              </span>
            </div>
          </div>

          {/* Compass bar (centered) */}
          {state.locked && !chatOpen && !loadoutOpen && (
            <div className="flex justify-center">
              <CompassBar heading={state.heading} />
            </div>
          )}
        </div>
      </div>

      {/* ═══ CROSSHAIR + HIT MARKER ═══ */}
      {state.locked && !chatOpen && !loadoutOpen && (
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

              {/* Hit marker — X shape, colored by hit type */}
              {state.hitMarker && (
                <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
                  <div className="absolute top-1/2 left-1/2" style={{
                    width: state.hitMarkerType === 'player' ? '18px' : '14px',
                    height: '2px',
                    background: state.hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                    transform: 'translate(-50%, -50%) rotate(45deg)',
                    boxShadow: state.hitMarkerType === 'player'
                      ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                      : '0 0 6px rgba(255,255,255,0.5)',
                  }} />
                  <div className="absolute top-1/2 left-1/2" style={{
                    width: state.hitMarkerType === 'player' ? '18px' : '14px',
                    height: '2px',
                    background: state.hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                    transform: 'translate(-50%, -50%) rotate(-45deg)',
                    boxShadow: state.hitMarkerType === 'player'
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
            {state.hitMarker && (
              <div style={{ animation: 'hitmarker-flash 0.2s ease-out' }}>
                <div className="absolute top-1/2 left-1/2" style={{
                  width: state.hitMarkerType === 'player' ? '18px' : '14px',
                  height: '2px',
                  background: state.hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(45deg)',
                  boxShadow: state.hitMarkerType === 'player'
                    ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                    : '0 0 6px rgba(255,255,255,0.5)',
                }} />
                <div className="absolute top-1/2 left-1/2" style={{
                  width: state.hitMarkerType === 'player' ? '18px' : '14px',
                  height: '2px',
                  background: state.hitMarkerType === 'player' ? 'var(--c-red)' : 'rgba(255,255,255,0.95)',
                  transform: 'translate(-50%, -50%) rotate(-45deg)',
                  boxShadow: state.hitMarkerType === 'player'
                    ? '0 0 8px var(--c-red), 0 0 16px rgba(255,0,51,0.4)'
                    : '0 0 6px rgba(255,255,255,0.5)',
                }} />
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Click to deploy overlay */}

      {/* ═══ ENTER HELICOPTER PROMPT (near crosshair) ═══ */}
      {state.locked && !chatOpen && !loadoutOpen && !state.mountedVehicleName && state.nearVehicle && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div style={{
            marginTop: '80px',
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            letterSpacing: '0.1em',
            color: 'var(--c-text)',
            textShadow: '0 0 8px rgba(0,0,0,0.8), 0 0 20px rgba(102,224,255,0.3)',
            background: 'rgba(6,8,16,0.7)',
            border: '1px solid rgba(102,224,255,0.3)',
            padding: '6px 16px',
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: 'var(--c-cyan)', fontWeight: 'bold' }}>[F]</span> ENTER HELICOPTER
          </div>
        </div>
      )}

      {/* ═══ EJECT PROMPT (bottom-center) ═══ */}
      {state.locked && !chatOpen && !loadoutOpen && state.mountedVehicleName && (
        <div className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none z-10">
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            letterSpacing: '0.12em',
            color: 'var(--c-text)',
            textShadow: '0 0 8px rgba(0,0,0,0.8)',
            background: 'rgba(6,8,16,0.65)',
            border: '1px solid rgba(102,224,255,0.25)',
            padding: '5px 14px',
            backdropFilter: 'blur(4px)',
          }}>
            <span style={{ color: 'var(--c-cyan)', fontWeight: 'bold' }}>[F]</span> EJECT
          </div>
        </div>
      )}

      {/* Click to deploy overlay */}
      {!state.locked && state.worldReady && !showSettings && !chatOpen && !loadoutOpen && (
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
              <div className="flex justify-center gap-8">
                <span><span style={{ color: 'var(--c-text)' }}>SHIFT</span> SPRINT</span>
                <span><span style={{ color: 'var(--c-text)' }}>CTRL</span> CROUCH</span>
                <span><span style={{ color: 'var(--c-text)' }}>F</span> VEHICLE</span>
                <span><span style={{ color: 'var(--c-text)' }}>E</span> LOADOUT</span>
                <span><span style={{ color: 'var(--c-text)' }}>T</span> CHAT</span>
                <span><span style={{ color: 'var(--c-text)' }}>ESC</span> SETTINGS</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ CHAT OVERLAY — Minecraft-style ═══ */}
      <div
        className="absolute z-20"
        style={{
          left: '2px',
          bottom: '50%',
          transform: 'translateY(50%)',
          width: 'min(420px, 40vw)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {/* Message list — stacks upward from bottom */}
        <div
          ref={chatListRef}
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: chatOpen ? '45vh' : '180px',
            overflowY: chatOpen ? 'auto' : 'hidden',
            padding: '0 4px 2px 4px',
            overscrollBehavior: 'contain',
            pointerEvents: chatOpen ? 'auto' : 'none',
            maskImage: chatOpen ? 'none' : 'linear-gradient(to bottom, transparent 0%, black 15%)',
            WebkitMaskImage: chatOpen ? 'none' : 'linear-gradient(to bottom, transparent 0%, black 15%)',
          }}
        >
          {chatMessages
            .filter((m) => chatOpen || getMessageOpacity(m.sentAt) > 0.01)
            .slice(chatOpen ? -50 : -10)
            .map((msg) => {
              const isSystem = msg.senderName === '[SERVER]';
              const opacity = chatOpen ? 1 : getMessageOpacity(msg.sentAt);
              return (
                <div
                  key={msg.id}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    lineHeight: '1.3',
                    opacity,
                    padding: '1px 4px',
                    background: chatOpen ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.35)',
                    transition: 'opacity 0.4s',
                    textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                  }}
                >
                  {isSystem ? (
                    <span style={{ color: '#ffaa00' }}>{msg.text}</span>
                  ) : (
                    <>
                      <span style={{ color: '#e0e0e0', fontWeight: 400 }}>{'<'}</span>
                      <span style={{ color: '#55ff55', fontWeight: 400 }}>{msg.senderName}</span>
                      <span style={{ color: '#e0e0e0', fontWeight: 400 }}>{'> '}</span>
                      <span style={{ color: '#ffffff' }}>{msg.text}</span>
                    </>
                  )}
                </div>
              );
            })}
        </div>

        {/* Chat input — full-width bar at the very bottom */}
        {chatOpen && (
          <div style={{ pointerEvents: 'auto' }}>
            <input
              ref={chatInputRef}
              autoFocus
              maxLength={200}
              value={chatDraft}
              placeholder=""
              onChange={(e) => setChatDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (chatDraft.trim()) void sendChatMessage(chatDraft);
                  closeChat();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeChat();
                }
              }}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                background: 'rgba(0,0,0,0.5)',
                border: 'none',
                borderTop: '1px solid rgba(255,255,255,0.15)',
                color: '#ffffff',
                padding: '6px 4px',
                outline: 'none',
                borderRadius: 0,
                caretColor: '#55ff55',
                textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
              }}
            />
          </div>
        )}
      </div>

      {/* ═══ BOTTOM HUD ═══ */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
        <div
          className="px-5 pb-4 pt-16"
          style={{
            background: 'linear-gradient(0deg, rgba(6,8,16,0.7) 0%, rgba(6,8,16,0.2) 60%, transparent 100%)',
          }}
        >
          <div className="flex items-end justify-between">

            {/* ── LEFT PANEL: Health + Weapon silhouette + Ammo ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>

              {/* Health panel — CS:GO style with large number + health cross */}
              <div style={{
                background: 'rgba(6,8,16,0.85)',
                border: `1px solid ${isLowHealth ? healthRawColor : 'var(--c-border)'}`,
                backdropFilter: 'blur(8px)',
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
                    textShadow: `0 0 16px ${healthRawColor}`,
                    animation: isCriticalHealth ? 'hud-critical-flash 0.6s ease-in-out infinite' : 'none',
                    minWidth: '80px',
                  }}>
                    {state.health}
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
                    const filled = state.health >= segThreshold;
                    const partial = !filled && state.health > i * 10;
                    return (
                      <div key={i} style={{
                        flex: 1,
                        background: filled
                          ? healthRawColor
                          : partial
                            ? `${healthRawColor}80`
                            : 'rgba(255,255,255,0.06)',
                        boxShadow: filled ? `0 0 4px ${healthRawColor}40` : 'none',
                        transition: 'all 0.3s ease',
                      }} />
                    );
                  })}
                </div>
              </div>

              {/* Weapon + Ammo combined panel with silhouette (infantry only) */}
              {!state.mountedVehicleName && (
              <div style={{
                background: 'rgba(6,8,16,0.85)',
                border: '1px solid var(--c-border)',
                backdropFilter: 'blur(8px)',
                padding: '8px 14px',
                borderLeft: `3px solid ${WEAPON_DATA[state.weapon].rawColor}`,
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
                    weaponIndex={state.weapon}
                    color={WEAPON_DATA[state.weapon].rawColor}
                    active={true}
                  />
                  {/* Reloading indicator */}
                  {state.isReloading && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
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
                      fontFamily: 'var(--font-mono)',
                      fontSize: '8px',
                      color: 'var(--c-muted)',
                      letterSpacing: '0.15em',
                    }}>
                      WEAPON
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: '14px',
                      fontWeight: 700,
                      color: WEAPON_DATA[state.weapon].color,
                      letterSpacing: '0.1em',
                      textShadow: `0 0 8px ${WEAPON_DATA[state.weapon].rawColor}60`,
                      lineHeight: '1',
                    }}>
                      {WEAPON_DATA[state.weapon].name}
                    </span>
                  </div>

                  <div style={{ width: '1px', height: '24px', background: 'var(--c-border)', margin: '0 8px' }} />

                  {/* Ammo display — CS:GO "current | reserve" style */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1px' }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '8px',
                      color: 'var(--c-muted)',
                      letterSpacing: '0.15em',
                    }}>
                      AMMO
                    </span>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '28px',
                        color: state.ammo === 0 ? 'var(--c-red)' : isLowAmmo ? 'var(--c-amber)' : 'var(--c-text)',
                        fontWeight: 'bold',
                        lineHeight: '1',
                        animation: state.ammo === 0 ? 'hud-critical-flash 0.5s ease-in-out infinite' : isLowAmmo ? 'hud-ammo-warn 1s ease-in-out infinite' : 'none',
                      }}>
                        {state.ammo}
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
                        {state.maxAmmo}
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
                    background: state.ammo === 0 ? 'var(--c-red)' : isLowAmmo ? 'var(--c-amber)' : WEAPON_DATA[state.weapon].rawColor,
                    transition: 'width 0.15s ease, background 0.3s',
                    boxShadow: `0 0 4px ${state.ammo === 0 ? 'var(--c-red)' : isLowAmmo ? 'var(--c-amber)' : WEAPON_DATA[state.weapon].rawColor}`,
                  }} />
                </div>
              </div>
              )}
            </div>

            {/* ── RIGHT PANEL: K/D + Weapon Slots ── */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>

              {/* K/D Panel */}
              <div style={{
                background: 'rgba(6,8,16,0.85)',
                border: '1px solid var(--c-border)',
                backdropFilter: 'blur(8px)',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                borderRight: '3px solid var(--c-border-bright)',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
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
                    textShadow: '0 0 8px rgba(0,255,65,0.3)',
                  }}>{state.kills}</div>
                </div>

                <div style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--c-border)',
                }} />

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
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
                  }}>{state.deaths}</div>
                </div>

                <div style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--c-border)',
                }} />

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
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

              {state.mountedVehicleName && (() => {
                const vw = VEHICLE_WEAPON_DATA[state.vehicleWeapon] ?? VEHICLE_WEAPON_DATA[0];
                const vHealthPct = state.vehicleMaxHealth > 0 ? (state.vehicleHealth / state.vehicleMaxHealth) * 100 : 0;
                const vHealthColor = vHealthPct > 50 ? '#66e0ff' : vHealthPct > 25 ? '#ff9800' : '#ff0033';
                const vAmmoPct = vw.maxAmmo > 0 ? (state.vehicleAmmo / vw.maxAmmo) * 100 : 0;
                const vAmmoLow = state.vehicleAmmo > 0 && state.vehicleAmmo <= Math.ceil(vw.maxAmmo * 0.15);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>

                    {/* Vehicle Health Bar */}
                    <div style={{
                      background: 'rgba(8,18,26,0.88)',
                      border: `1px solid ${vHealthPct <= 25 ? 'rgba(255,0,51,0.4)' : 'rgba(102,224,255,0.25)'}`,
                      borderRight: `3px solid ${vHealthColor}`,
                      backdropFilter: 'blur(8px)',
                      padding: '8px 14px',
                      minWidth: '240px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {/* Helicopter icon */}
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <path d="M2 5h12M8 5v4M4 9h8l1 2H3l1-2z" stroke={vHealthColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                            <circle cx="8" cy="4" r="1.5" stroke={vHealthColor} strokeWidth="1"/>
                          </svg>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '9px',
                            color: 'var(--c-muted)', letterSpacing: '0.14em',
                          }}>VEHICLE</span>
                        </div>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 'bold',
                          color: vHealthColor, lineHeight: '1',
                          textShadow: `0 0 8px ${vHealthColor}80`,
                          animation: vHealthPct <= 25 ? 'hud-critical-flash 0.8s ease-in-out infinite' : 'none',
                        }}>
                          {Math.round(state.vehicleHealth)}
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
                      background: 'rgba(8,18,26,0.88)',
                      border: '1px solid rgba(102,224,255,0.2)',
                      borderRight: `3px solid ${vw.color}`,
                      backdropFilter: 'blur(8px)',
                      padding: '8px 14px',
                      minWidth: '240px',
                    }}>
                      {/* Weapon selector tabs */}
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                        {VEHICLE_WEAPON_DATA.map((w, idx) => {
                          const active = state.vehicleWeapon === idx;
                          return (
                            <div key={w.name} style={{
                              flex: 1,
                              padding: '3px 6px',
                              background: active ? `${w.color}20` : 'rgba(255,255,255,0.03)',
                              border: active ? `1px solid ${w.color}` : '1px solid rgba(255,255,255,0.08)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                              transition: 'all 0.15s ease',
                              position: 'relative',
                              overflow: 'hidden',
                            }}>
                              {active && <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px',
                                background: w.color, boxShadow: `0 0 6px ${w.color}`,
                              }}/>}
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: '8px', fontWeight: 'bold',
                                color: active ? w.color : 'var(--c-muted2)',
                                background: active ? `${w.color}30` : 'rgba(255,255,255,0.05)',
                                padding: '0 3px', borderRadius: '2px', lineHeight: '1.4',
                              }}>{idx + 1}</span>
                              <span style={{
                                fontFamily: 'var(--font-mono)', fontSize: '9px',
                                color: active ? w.color : 'var(--c-muted)',
                                letterSpacing: '0.08em', fontWeight: active ? 'bold' : 'normal',
                              }}>{w.name}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Ammo display */}
                      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                        <span style={{
                          fontFamily: 'var(--font-mono)', fontSize: '8px',
                          color: state.vehicleReloading ? 'var(--c-amber)' : 'var(--c-muted)', letterSpacing: '0.15em',
                          animation: state.vehicleReloading ? 'hud-ammo-warn 0.8s ease-in-out infinite' : 'none',
                        }}>{state.vehicleReloading ? 'RELOADING' : 'AMMO'}</span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '3px' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '24px', fontWeight: 'bold',
                            color: state.vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : 'var(--c-text)',
                            lineHeight: '1',
                            animation: state.vehicleAmmo === 0 ? 'hud-critical-flash 0.5s ease-in-out infinite' : vAmmoLow ? 'hud-ammo-warn 1s ease-in-out infinite' : 'none',
                          }}>{state.vehicleAmmo}</span>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--c-muted)', fontWeight: 'bold',
                          }}>|</span>
                          <span style={{
                            fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--c-muted)',
                          }}>{vw.maxAmmo}</span>
                        </div>
                      </div>
                      {/* Ammo bar */}
                      <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', marginTop: '4px' }}>
                        <div style={{
                          height: '100%', width: `${vAmmoPct}%`,
                          background: state.vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : vw.color,
                          transition: 'width 0.15s ease',
                          boxShadow: `0 0 4px ${state.vehicleAmmo === 0 ? 'var(--c-red)' : vAmmoLow ? 'var(--c-amber)' : vw.color}`,
                        }}/>
                      </div>
                    </div>

                    {/* Telemetry: Altitude + Speed */}
                    <div style={{
                      background: 'rgba(8,18,26,0.88)',
                      border: '1px solid rgba(102,224,255,0.15)',
                      borderRight: '3px solid rgba(102,224,255,0.4)',
                      backdropFilter: 'blur(8px)',
                      padding: '6px 14px',
                      minWidth: '240px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>ALT</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: 'var(--c-text)', lineHeight: '1' }}>
                          {Math.round(state.vehicleAltitude)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)' }}>m</span>
                      </div>
                      <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }}/>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>SPD</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 'bold', color: 'var(--c-text)', lineHeight: '1' }}>
                          {Math.round(state.vehicleSpeed)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--c-muted)' }}>m/s</span>
                      </div>
                      <div style={{ width: '1px', height: '16px', background: 'var(--c-border)' }}/>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: 'var(--c-muted)', letterSpacing: '0.12em' }}>HDG</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 'bold', color: 'var(--c-cyan)', lineHeight: '1' }}>
                          {String(Math.round(((state.heading % 360) + 360) % 360)).padStart(3, '0')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Weapon slots with mini weapon icons and active glow (infantry only) */}
              {!state.mountedVehicleName && (
              <div className="flex gap-1">
                {state.loadout.map((weaponIndex, slotIndex) => {
                  const w = WEAPON_DATA[weaponIndex]!;
                  const active = state.weapon === weaponIndex;
                  return (
                    <div
                      key={`${w.name}-${slotIndex}`}
                      style={{
                        background: active ? `${w.rawColor}15` : 'rgba(6,8,16,0.85)',
                        border: active ? `1px solid ${w.rawColor}` : '1px solid var(--c-border)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '9px',
                        letterSpacing: '0.05em',
                        transition: 'all 0.15s ease',
                        backdropFilter: 'blur(4px)',
                        padding: '5px 8px 4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '3px',
                        minWidth: '60px',
                        position: 'relative',
                        overflow: 'hidden',
                        boxShadow: active ? `0 0 12px ${w.rawColor}30, inset 0 0 12px ${w.rawColor}10` : 'none',
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
                          borderRadius: '2px',
                          lineHeight: '1.2',
                        }}>{slotIndex + 1}</span>
                        <span style={{
                          color: active ? w.color : 'var(--c-muted)',
                          fontWeight: active ? 'bold' : 'normal',
                          textShadow: active ? `0 0 6px ${w.rawColor}40` : 'none',
                          fontSize: '9px',
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
    </div>
  );
}
