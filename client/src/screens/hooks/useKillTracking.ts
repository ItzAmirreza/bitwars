import { useEffect, useRef, useState } from 'react';
import type { DbConnection } from '../../module_bindings';

export interface KillFeedEntry {
  id: number;
  killerName: string;
  victimName: string;
  weapon: number;
  time: number;
}

export interface KillNotification {
  id: number;
  text: string;
  time: number;
  type: 'kill' | 'death' | 'streak';
}

export function useKillTracking(
  kills: number,
  deaths: number,
  health: number,
  connection: DbConnection | null,
) {
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
    if (kills > prevKillsRef.current) {
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
    prevKillsRef.current = kills;
  }, [kills, killStreak]);

  // Detect deaths — start respawn countdown
  useEffect(() => {
    if (deaths > prevDeathsRef.current) {
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
    prevDeathsRef.current = deaths;
  }, [deaths, connection]);

  // Clear death screen on respawn (server sets health > 0)
  useEffect(() => {
    if (isDead && health > 0) {
      setIsDead(false);
      setRespawnCountdown(0);
      clearInterval(respawnTimerRef.current);
    }
  }, [health, isDead]);

  // Cleanup respawn timer on unmount
  useEffect(() => {
    return () => clearInterval(respawnTimerRef.current);
  }, []);

  // Track health changes for damage flash
  useEffect(() => {
    prevHealthRef.current = health;
  }, [health]);

  // Clear old kill notifications
  useEffect(() => {
    if (killNotifications.length === 0) return;
    const timer = setTimeout(() => {
      setKillNotifications((prev) => prev.filter((n) => Date.now() - n.time < 3000));
    }, 3100);
    return () => clearTimeout(timer);
  }, [killNotifications]);

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

  return {
    killFeed,
    killNotifications,
    isDead,
    respawnCountdown,
  };
}
