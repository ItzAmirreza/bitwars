import { useEffect, useState } from 'react';
import type { DbConnection } from '../../module_bindings';

export function useRoundTimer(connection: DbConnection | null) {
  const [roundTimer, setRoundTimer] = useState('');

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

  return roundTimer;
}
