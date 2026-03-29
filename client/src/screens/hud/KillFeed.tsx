interface KillFeedEntry {
  id: number;
  killerName: string;
  victimName: string;
  weapon: number;
  time: number;
}

interface KillNotification {
  id: number;
  text: string;
  time: number;
  type: 'kill' | 'death' | 'streak';
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

export type { KillFeedEntry, KillNotification };

export interface KillFeedProps {
  killFeed: KillFeedEntry[];
  killNotifications: KillNotification[];
  username: string | null;
}

export function KillFeed({ killFeed, killNotifications, username }: KillFeedProps) {
  return (
    <div className="absolute z-20 pointer-events-none" style={{
      top: '60px',
      right: '8px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: '2px',
    }}>
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
              fontFamily: 'var(--font-pixel)',
              fontSize: '7px',
              lineHeight: '1.6',
              padding: '3px 8px',
              background: 'rgba(12,16,24,0.8)',
              border: '2px solid #1a1e2e',
              opacity,
              transform: `translateX(${age < 0.2 ? (1 - age / 0.2) * 16 : 0}px)`,
              transition: 'opacity 0.4s',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: isLocalKiller ? '#76ff03' : '#e8e8f0', fontWeight: isLocalKiller ? 700 : 400 }}>
              {entry.killerName}
            </span>
            <span style={{ color: '#4a4e5e', margin: '0 5px' }}>[{weaponLabel}]</span>
            <span style={{ color: isLocalVictim ? '#ff2d78' : '#e8e8f0', fontWeight: isLocalVictim ? 700 : 400 }}>
              {entry.victimName}
            </span>
          </div>
        );
      })}
      {killNotifications.map((notif) => {
        const age = (Date.now() - notif.time) / 1000;
        const opacity = age < 2 ? 1 : Math.max(0, 1 - (age - 2));
        const isStreak = notif.type === 'streak';
        const isDeath = notif.type === 'death';
        const color = isDeath ? '#ff2d78' : isStreak ? '#ffd600' : '#76ff03';
        return (
          <div
            key={`notif-${notif.id}`}
            style={{
              fontFamily: 'var(--font-pixel)',
              fontSize: isStreak ? '8px' : '7px',
              fontWeight: 'bold',
              color,
              padding: '3px 8px',
              background: 'rgba(12,16,24,0.8)',
              border: `2px solid ${color}44`,
              letterSpacing: '0.1em',
              opacity,
              transform: `translateX(${age < 0.2 ? (1 - age / 0.2) * 16 : 0}px)`,
              transition: 'opacity 0.3s',
            }}
          >
            {notif.text}
          </div>
        );
      })}
    </div>
  );
}
