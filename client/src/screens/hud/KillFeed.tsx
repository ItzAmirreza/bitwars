import type { KillFeedEntry, KillNotification } from './weaponData';
import { WEAPON_LABELS } from './weaponData';

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
  );
}
