import { DbConnection } from './module_bindings';
import type { SubscriptionEventContext, ErrorContext } from './module_bindings';
import { ENTITY_KINDS, VEHICLE_TYPES } from './shared-config';

const SPACETIMEDB_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = import.meta.env.VITE_MODULE_NAME || 'bitwars';
let connection: DbConnection | null = null;
let connecting = false;
let baselineSubscription: { unsubscribe: () => void; isEnded: () => boolean } | null = null;

function disposeSubscription(handle: { unsubscribe: () => void; isEnded: () => boolean } | null): void {
  if (!handle) return;
  if (!handle.isEnded()) {
    handle.unsubscribe();
  }
}

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

        baselineSubscription = conn.subscriptionBuilder()
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
            "SELECT * FROM player_ammo",
            // player_fire_state and player_movement are server-private
            // (not needed client-side, reduces subscription scan load)
            "SELECT * FROM world_environment WHERE id = 1",
            "SELECT * FROM world_config WHERE id = 1",
            "SELECT * FROM chat_message",
            "SELECT * FROM explosion_event",
            "SELECT * FROM grenade_projectile",
            "SELECT * FROM kill_event",
            "SELECT * FROM vehicle_destroy_event",
            "SELECT * FROM world_chunk",
            // Keep vehicle/entity streams stable for prediction + fire origin.
            // These must not churn with AOI chunk resubscriptions.
            `SELECT * FROM entity WHERE kind = ${ENTITY_KINDS.Vehicle}`,
            `SELECT * FROM vehicle WHERE vehicle_type = ${VEHICLE_TYPES.Helicopter}`,
            `SELECT * FROM vehicle WHERE vehicle_type = ${VEHICLE_TYPES.FighterJet}`,
          ]) as { unsubscribe: () => void; isEnded: () => boolean };
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => {
        console.error('[BitWars] Connection error:', err);
        connecting = false;
        disposeSubscription(baselineSubscription);
        baselineSubscription = null;
        onError(err);
      })
      .onDisconnect((_ctx: ErrorContext) => {
        console.log('[BitWars] Disconnected');
        disposeSubscription(baselineSubscription);
        baselineSubscription = null;
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
