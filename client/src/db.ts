import { DbConnection } from './module_bindings';
import type { SubscriptionEventContext, ErrorContext } from './module_bindings';
import { ENTITY_KINDS, VEHICLE_TYPES, WORLD as WORLD_CONFIG } from './shared-config';

const SPACETIMEDB_URI = import.meta.env.VITE_SPACETIMEDB_URI || 'wss://maincloud.spacetimedb.com';
const MODULE_NAME = import.meta.env.VITE_MODULE_NAME || 'bitwars';
let connection: DbConnection | null = null;
let connecting = false;
let baselineSubscription: { unsubscribe: () => void; isEnded: () => boolean } | null = null;
let worldChunkSubscription: { unsubscribe: () => void; isEnded: () => boolean } | null = null;
let worldChunkSubscriptionPending: { unsubscribe: () => void; isEnded: () => boolean } | null = null;

const WORLD_CHUNK_AOI_DEFAULT_RADIUS = 19;
const WORLD_CHUNK_AOI_MARGIN = 6;
const NUM_CHUNKS_X = Math.ceil(WORLD_CONFIG.sizeX / WORLD_CONFIG.chunkSize);
const NUM_CHUNKS_Z = Math.ceil(WORLD_CONFIG.sizeZ / WORLD_CONFIG.chunkSize);
const DEFAULT_WORLD_CHUNK_CX = Math.floor((WORLD_CONFIG.sizeX * 0.5) / WORLD_CONFIG.chunkSize);
const DEFAULT_WORLD_CHUNK_CZ = Math.floor((WORLD_CONFIG.sizeZ * 0.5) / WORLD_CONFIG.chunkSize);

let worldChunkCenterCx = DEFAULT_WORLD_CHUNK_CX;
let worldChunkCenterCz = DEFAULT_WORLD_CHUNK_CZ;
let worldChunkRadius = WORLD_CHUNK_AOI_DEFAULT_RADIUS;
let queuedWorldChunkTarget: { cx: number; cz: number; radius: number } | null = null;

function disposeSubscription(handle: { unsubscribe: () => void; isEnded: () => boolean } | null): void {
  if (!handle) return;
  if (!handle.isEnded()) {
    handle.unsubscribe();
  }
}

export function getConnection(): DbConnection | null {
  return connection;
}

function clampChunkX(cx: number): number {
  return Math.max(0, Math.min(NUM_CHUNKS_X - 1, Math.floor(cx)));
}

function clampChunkZ(cz: number): number {
  return Math.max(0, Math.min(NUM_CHUNKS_Z - 1, Math.floor(cz)));
}

function buildWorldChunkAoiQuery(cx: number, cz: number, radius: number): string {
  const minCx = Math.max(0, cx - radius);
  const maxCx = Math.min(NUM_CHUNKS_X - 1, cx + radius);
  const minCz = Math.max(0, cz - radius);
  const maxCz = Math.min(NUM_CHUNKS_Z - 1, cz + radius);
  return `SELECT * FROM world_chunk WHERE cx >= ${minCx} AND cx <= ${maxCx} AND cz >= ${minCz} AND cz <= ${maxCz}`;
}

function setWorldChunkSubscription(centerCx: number, centerCz: number, radius: number, force: boolean): void {
  if (!connection) return;

  const clampedCx = clampChunkX(centerCx);
  const clampedCz = clampChunkZ(centerCz);
  const clampedRadius = Math.max(6, Math.min(64, Math.floor(radius)));

  if (!force) {
    const dx = Math.abs(clampedCx - worldChunkCenterCx);
    const dz = Math.abs(clampedCz - worldChunkCenterCz);
    if (clampedRadius === worldChunkRadius && dx <= WORLD_CHUNK_AOI_MARGIN && dz <= WORLD_CHUNK_AOI_MARGIN) {
      return;
    }
  }

  if (worldChunkSubscriptionPending) {
    queuedWorldChunkTarget = { cx: clampedCx, cz: clampedCz, radius: clampedRadius };
    return;
  }

  const query = buildWorldChunkAoiQuery(clampedCx, clampedCz, clampedRadius);

  const nextHandle = connection.subscriptionBuilder()
    .onApplied((_subCtx: SubscriptionEventContext) => {
      if (worldChunkSubscriptionPending !== nextHandle) return;

      const previous = worldChunkSubscription;
      worldChunkSubscription = nextHandle;
      worldChunkSubscriptionPending = null;
      worldChunkCenterCx = clampedCx;
      worldChunkCenterCz = clampedCz;
      worldChunkRadius = clampedRadius;

      if (previous && previous !== nextHandle) {
        disposeSubscription(previous);
      }

      if (queuedWorldChunkTarget) {
        const next = queuedWorldChunkTarget;
        queuedWorldChunkTarget = null;
        setWorldChunkSubscription(next.cx, next.cz, next.radius, false);
      }
    })
    .onError((_ctx: ErrorContext) => {
      console.error('[BitWars] world_chunk AOI subscription error');
    })
    .subscribe([
      query,
    ]) as { unsubscribe: () => void; isEnded: () => boolean };

  worldChunkSubscriptionPending = nextHandle;

  // Initial subscription path: no existing handle, so promote immediately.
  if (!worldChunkSubscription) {
    worldChunkSubscription = nextHandle;
    worldChunkSubscriptionPending = null;
    worldChunkCenterCx = clampedCx;
    worldChunkCenterCz = clampedCz;
    worldChunkRadius = clampedRadius;
  }
}

export function updateWorldChunkSubscriptionAoi(centerCx: number, centerCz: number, radius = WORLD_CHUNK_AOI_DEFAULT_RADIUS): void {
  setWorldChunkSubscription(centerCx, centerCz, radius, false);
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
            // Keep vehicle/entity streams stable for prediction + fire origin.
            // These must not churn with AOI chunk resubscriptions.
            `SELECT * FROM entity WHERE kind = ${ENTITY_KINDS.Vehicle}`,
            `SELECT * FROM vehicle WHERE vehicle_type = ${VEHICLE_TYPES.Helicopter}`,
            `SELECT * FROM vehicle WHERE vehicle_type = ${VEHICLE_TYPES.FighterJet}`,
          ]) as { unsubscribe: () => void; isEnded: () => boolean };

        setWorldChunkSubscription(DEFAULT_WORLD_CHUNK_CX, DEFAULT_WORLD_CHUNK_CZ, WORLD_CHUNK_AOI_DEFAULT_RADIUS, true);
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => {
        console.error('[BitWars] Connection error:', err);
        connecting = false;
        disposeSubscription(baselineSubscription);
        baselineSubscription = null;
        disposeSubscription(worldChunkSubscription);
        worldChunkSubscription = null;
        disposeSubscription(worldChunkSubscriptionPending);
        worldChunkSubscriptionPending = null;
        queuedWorldChunkTarget = null;
        onError(err);
      })
      .onDisconnect((_ctx: ErrorContext) => {
        console.log('[BitWars] Disconnected');
        disposeSubscription(baselineSubscription);
        baselineSubscription = null;
        disposeSubscription(worldChunkSubscription);
        worldChunkSubscription = null;
        disposeSubscription(worldChunkSubscriptionPending);
        worldChunkSubscriptionPending = null;
        queuedWorldChunkTarget = null;
        worldChunkCenterCx = DEFAULT_WORLD_CHUNK_CX;
        worldChunkCenterCz = DEFAULT_WORLD_CHUNK_CZ;
        worldChunkRadius = WORLD_CHUNK_AOI_DEFAULT_RADIUS;
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
