import { DbConnection } from './module_bindings';
import type { SubscriptionEventContext, ErrorContext } from './module_bindings';

const SPACETIMEDB_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = import.meta.env.VITE_MODULE_NAME || 'bitwars';

let connection: DbConnection | null = null;
let connecting = false;

export function getConnection(): DbConnection | null {
  return connection;
}

export function connect(
  onConnect: (conn: DbConnection, identity: string, token: string) => void,
  onError: (error: Error) => void,
): void {
  if (connection || connecting) return;

  connecting = true;
  const token = localStorage.getItem('bitwars_token') || undefined;

  try {
    const conn = DbConnection.builder()
      .withUri(SPACETIMEDB_URI)
      .withDatabaseName(MODULE_NAME)
      .withToken(token)
      .onConnect((_connInstance, identity, token) => {
        console.log('[BitWars] Connected:', identity.toHexString());
        localStorage.setItem('bitwars_token', token);
        connection = conn;
        connecting = false;

        conn.subscriptionBuilder()
          .onApplied((_subCtx: SubscriptionEventContext) => {
            console.log('[BitWars] Subscriptions applied');
            onConnect(conn, identity.toHexString(), token);
          })
          .onError((_ctx: ErrorContext) => {
            console.error('[BitWars] Subscription error');
          })
          .subscribe([
            "SELECT * FROM player",
            "SELECT * FROM player_loadout",
            "SELECT * FROM shot_event",
            "SELECT * FROM detach_event",
            "SELECT * FROM player_weapon_state",
            "SELECT * FROM player_movement",
            "SELECT * FROM world_environment",
            "SELECT * FROM world_config",
            "SELECT * FROM chat_message",
            "SELECT * FROM explosion_event",
            "SELECT * FROM world_chunk",
            "SELECT * FROM entity",
            "SELECT * FROM vehicle",
            "SELECT * FROM grenade_projectile",
            "SELECT * FROM kill_event",
          ]);
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => {
        console.error('[BitWars] Connection error:', err);
        connecting = false;
        onError(err);
      })
      .onDisconnect((_ctx: ErrorContext) => {
        console.log('[BitWars] Disconnected');
        connection = null;
        connecting = false;
      })
      .build();

    void conn;
  } catch (error) {
    connecting = false;
    onError(error instanceof Error ? error : new Error('Failed to create SpacetimeDB connection'));
  }
}
