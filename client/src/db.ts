import { DbConnection } from './module_bindings';
import type { SubscriptionEventContext, ErrorContext } from './module_bindings';

const SPACETIMEDB_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = import.meta.env.VITE_MODULE_NAME || 'bitwars';

let connection: DbConnection | null = null;

export function getConnection(): DbConnection | null {
  return connection;
}

export function connect(
  onConnect: (conn: DbConnection, identity: string, token: string) => void,
  onError: (error: Error) => void,
): void {
  const token = localStorage.getItem('bitwars_token') || undefined;

  const conn = DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(MODULE_NAME)
    .withToken(token)
    .onConnect((_connInstance, identity, token) => {
      console.log('[BitWars] Connected:', identity.toHexString());
      localStorage.setItem('bitwars_token', token);
      connection = conn;

      conn.subscriptionBuilder()
        .onApplied((_subCtx: SubscriptionEventContext) => {
          console.log('[BitWars] Subscriptions applied');
          onConnect(conn, identity.toHexString(), token);
        })
        .onError((_ctx: ErrorContext) => {
          console.error('[BitWars] Subscription error');
        })
        .subscribeToAllTables();
    })
    .onConnectError((_ctx: ErrorContext, err: Error) => {
      console.error('[BitWars] Connection error:', err);
      onError(err);
    })
    .onDisconnect((_ctx: ErrorContext) => {
      console.log('[BitWars] Disconnected');
      connection = null;
    })
    .build();
}
