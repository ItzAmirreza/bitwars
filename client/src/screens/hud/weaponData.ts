// ── Shared weapon data constants ──

export const WEAPON_LABELS: Record<number, string> = {
  0: 'Rifle',
  1: 'Shotgun',
  2: 'RPG',
  3: 'Machine Gun',
  4: 'Grenade',
  100: 'Minigun',
  101: 'Rocket',
};

// Type-based coloring: hitscan = cyan, explosive = orange
export const TYPE_COLORS = {
  HITSCAN:   { color: 'var(--c-cyan)', rawColor: '#66e0ff' },
  EXPLOSIVE: { color: 'var(--c-amber)', rawColor: '#ff9800' },
} as const;

export const WEAPON_DATA = [
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

export const WEAPON_INDEXES = [0, 1, 2, 3, 4] as const;

// Vehicle weapon data for HUD
export const VEHICLE_WEAPON_DATA = [
  { name: 'MINIGUN', type: 'HITSCAN' as const, color: '#ffaa00', maxAmmo: 300, fireRate: 15, damage: 8 },
  { name: 'ROCKETS', type: 'EXPLOSIVE' as const, color: '#ff4444', maxAmmo: 16, fireRate: 2.5, damage: 45 },
];

// Stat normalization maxima for bar display
export const STAT_MAX = { damage: 100, fireRate: 15, range: 100, ammo: 200 } as const;

export const COMPASS_DIRS = [
  { deg: 0, label: 'N' }, { deg: 45, label: 'NE' }, { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' }, { deg: 180, label: 'S' }, { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' }, { deg: 315, label: 'NW' },
] as const;

export interface KillNotification {
  id: number;
  text: string;
  time: number;
  type: 'kill' | 'death' | 'streak';
}

export interface KillFeedEntry {
  id: number;
  killerName: string;
  victimName: string;
  weapon: number;
  time: number;
}

export interface DisplayMessage {
  id: number;
  senderName: string;
  text: string;
  sentAt: number;
}

export const MAX_CHAT_MESSAGES = 80;

export function getMessageTimestamp(sentAt: { toMillis?: () => bigint } | null | undefined): number {
  if (sentAt && typeof sentAt.toMillis === 'function') {
    return Number(sentAt.toMillis());
  }
  return Date.now();
}

export function toDisplayMessage(msg: any): DisplayMessage {
  return {
    id: Number(msg.id),
    senderName: String(msg.senderName),
    text: String(msg.text),
    sentAt: getMessageTimestamp(msg.sentAt),
  };
}

export function mergeMessages(prev: DisplayMessage[], next: DisplayMessage[]): DisplayMessage[] {
  const merged = new Map<number, DisplayMessage>();

  for (const message of prev) merged.set(message.id, message);
  for (const message of next) merged.set(message.id, message);

  return Array.from(merged.values())
    .sort((a, b) => (a.sentAt === b.sentAt ? a.id - b.id : a.sentAt - b.sentAt))
    .slice(-MAX_CHAT_MESSAGES);
}
