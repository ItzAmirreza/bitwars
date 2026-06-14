import { ENTITY_KINDS, PLAYER, WORLD, WEAPONS_CONFIG } from '../../client/src/shared-config.ts';
import { DbConnection } from '../../client/src/module_bindings/index.ts';
import {
  buildPlayerMovementFlags,
  hasPlayerMovementFlag,
  PLAYER_MOVEMENT_FLAG_CLIMBING,
  PLAYER_MOVEMENT_FLAG_GROUNDED,
  PLAYER_MOVEMENT_FLAG_SPRINTING,
} from '../../client/src/game/playerMovementFlags.ts';
import { WorldSnapshot, type BotVec3 } from './world.ts';
import { NeuralNavigator } from './neural.ts';
import { computeVehicleControl, VEHICLE_TYPE } from './vehicles.ts';
import { buildObservation } from './observation.ts';
import { runtimeDiagnostics } from './diagnostics.ts';
import { BotMovementState } from './movement.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MATCH_STATE_ACTIVE = 1;
const WORLD_CHUNK_RADIUS = 5;
const WORLD_CHUNK_MARGIN = 2;
const BOT_EYE_HEIGHT = PLAYER.eyeHeight;
const BOT_HALF_WIDTH = 0.3;
const RIFLE_INDEX = 0;
const SHOTGUN_INDEX = 1;
const RPG_INDEX = 2;
const MACHINE_GUN_INDEX = 3;
const GRENADE_LAUNCHER_INDEX = 4;
const SNIPER_INDEX = 5;
const ALL_WEAPON_INDICES = [RIFLE_INDEX, SHOTGUN_INDEX, RPG_INDEX, MACHINE_GUN_INDEX, GRENADE_LAUNCHER_INDEX, SNIPER_INDEX] as const;
const TARGET_ACQUIRE_RANGE = 70;
const TARGET_KEEP_RANGE = 85;
const TARGET_SHOOT_RANGE = 62;
const IDEAL_RIFLE_RANGE = 24;
const MIN_TARGET_REACTION_MS = 280;
const MAX_TARGET_REACTION_MS = 430;
const MIN_TARGET_MEMORY_MS = 1200;
const MAX_TARGET_MEMORY_MS = 2800;
const MIN_BURST_SHOTS = 3;
const MAX_BURST_SHOTS = 6;
const MIN_BURST_COOLDOWN_MS = 320;
const MAX_BURST_COOLDOWN_MS = 760;
const RESPAWN_DELAY_MS = 3200;
const MAX_TURN_RATE = Math.PI * 1.35;
const MAX_PITCH_RATE = Math.PI * 1.1;

// ── Vehicle piloting tuning (indexed by vehicleType: 0=heli,1=jet,2=AA,3=APC) ──
const VEHICLE_SEEK_RANGE = 150; // consider grabbing an unoccupied vehicle within this (m)
const VEHICLE_LOW_HP = [180, 140, 220, 320]; // dismount below this health
const VEHICLE_FIRE_INTERVAL = [90, 360, 70, 1000]; // ms between vehicle weapon shots
const VEHICLE_TURRET_RATE = Math.PI * 2.2; // rad/s — how fast the bot swings its vehicle aim

// ── Per-bot personality ─────────────────────────────────────────────────────
// Each bot derives a stable "personality" from its name so the roster plays like
// distinct people, not identical clones: different reaction speed, aim rate,
// aggression, look bias, and burst discipline — all within human-plausible ranges.
interface BotPersonality {
  reactionMinMs: number;
  reactionMaxMs: number;
  turnRate: number;
  acquireRange: number;
  pitchBias: number;
  burstMin: number;
  burstMax: number;
  vehicleAffinity: number; // 0..1 eagerness to grab/pilot a vehicle when one is near
}

function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePersonality(name: string): BotPersonality {
  const rng = mulberry32(hashStringToSeed(name));
  const skill = rng(); // 0 = looser/slower, 1 = sharper
  // Center the reaction window on the shared baseline, scaled by skill.
  const reactionCenter =
    ((MIN_TARGET_REACTION_MS + MAX_TARGET_REACTION_MS) / 2) * (0.72 + (1 - skill) * 0.5);
  return {
    reactionMinMs: Math.round(reactionCenter - 45),
    reactionMaxMs: Math.round(reactionCenter + 95),
    turnRate: MAX_TURN_RATE * (0.85 + skill * 0.3),
    acquireRange: TARGET_ACQUIRE_RANGE * (0.85 + rng() * 0.27),
    pitchBias: -0.08 + rng() * 0.13,
    burstMin: Math.max(2, MIN_BURST_SHOTS + (rng() < 0.5 ? 0 : 1)),
    burstMax: Math.max(4, MAX_BURST_SHOTS + (rng() < 0.5 ? 0 : 2)),
    vehicleAffinity: 0.12 + rng() * 0.45,
  };
}
const WAYPOINT_RADIUS = 2.5;
const WAYPOINT_LIFETIME_MS = 9000;
const MAX_STEP_UP = 0.6;
const MAX_CLIMB_UP = 1.85;
const JUMP_COOLDOWN_MS = 140;
const STUCK_REPATH_MS = 900;
const MIN_IDLE_RADIUS = 24;
const MAX_IDLE_RADIUS = 52;
const HEARING_RADIUS = 42;
const EXPLOSION_HEARING_RADIUS = 58;
const HEARD_CONTACT_MS = 3200;
const MAX_VIEW_DOT = -0.2;
const SPAWN_RUSH_MS = 4200;
const BREACH_COOLDOWN_MS = 2400;
const MIN_SAFE_FOOT_Y = 3;

const TRAINING_STEP_SEC = 1 / 30;
const HARD_RECONCILE_DIST = 2.5;
const HARD_RECONCILE_Y = 1.8;
const SOFT_RECONCILE_DIST = 0.45;
const SOFT_RECONCILE_Y = 0.55;
const AIRBORNE_RECONCILE_DIST = 4.0;
const AIRBORNE_RECONCILE_Y = 3.2;
const SENT_MOVEMENT_HISTORY_MS = 1500;
const SENT_SNAPSHOT_MATCH_DIST = 0.12;
const SENT_SNAPSHOT_MATCH_VEL = 0.8;
const NAV_MAX_YAW_DELTA = 0.35;
const NAV_MAX_PITCH_DELTA = 0.25;
const NAV_MODEL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../model/navigation.safetensors',
);

type IdentityLike = {
  toHexString?: () => string;
};

type MatchStateRow = {
  state: number;
};

type PlayerRow = {
  identity: IdentityLike;
  profileId: number | bigint;
  username: string;
  characterPreset: number;
  movementFlags: number;
  pos: BotVec3;
  vel: BotVec3;
  rot: { yaw: number; pitch: number };
  health: number;
  maxHealth: number;
  currentWeapon: number;
  kills: number;
  deaths: number;
  spawnProtected: boolean;
  online: boolean;
  mountedVehicleId: number | bigint;
};

type EntityRow = {
  id: number | bigint;
  kind: number;
  subtype: number;
  pos: BotVec3;
  vel: BotVec3;
  rot: { yaw: number; pitch: number };
  scale: number;
  active: boolean;
};

type VehicleRow = {
  entityId: number | bigint;
  vehicleType: number;
  pilotIdentity?: IdentityLike | null;
  health: number;
  weaponType?: number;
  weaponAmmoPrimary?: number;
  weaponAmmoSecondary?: number;
  weaponAmmoTertiary?: number;
};

type SubscriptionHandle = {
  unsubscribe: () => void;
  isEnded?: () => boolean;
};

export type BotRuntimeOptions = {
  index: number;
  name: string;
  uri: string;
  moduleName: string;
  tickMs: number;
  tokenDir: string;
};

type TrackedTarget = {
  identityHex: string;
  lastSeenAt: number;
  reactionReadyAt: number;
};

type MoveDirective = {
  x: number;
  z: number;
  expiresAt: number;
};

type CoverDirective = {
  anchorX: number;
  anchorZ: number;
  peekX: number;
  peekZ: number;
  targetIdentityHex: string;
  expiresAt: number;
  phase: 'hide' | 'peek';
  phaseUntil: number;
};

type HeardContact = {
  x: number;
  y: number;
  z: number;
  expiresAt: number;
  source: 'shot' | 'explosion';
};

type BotTarget =
  | { kind: 'player'; player: PlayerRow }
  | { kind: 'vehicle'; vehicle: VehicleRow; entity: EntityRow };

type SearchHotspot = {
  x: number;
  y: number;
  z: number;
  members: number;
};

type SentMovementSample = {
  at: number;
  pos: BotVec3;
  vel: BotVec3;
  grounded: boolean;
  climbing: boolean;
  sprinting: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function distSq(a: BotVec3, b: BotVec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function normalize2D(x: number, z: number): { x: number; z: number; len: number } {
  const len = Math.sqrt(x * x + z * z);
  if (len <= 0.0001) return { x: 0, z: 0, len: 0 };
  return { x: x / len, z: z / len, len };
}

function normalize3D(x: number, y: number, z: number): BotVec3 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len <= 0.0001) return { x: 0, y: 0, z: -1 };
  return { x: x / len, y: y / len, z: z / len };
}

function identityHex(identity: IdentityLike | null | undefined): string {
  if (identity && typeof identity.toHexString === 'function') {
    return identity.toHexString();
  }
  return '';
}

function angleWrap(angle: number): number {
  if (angle > Math.PI) return angle - Math.PI * 2;
  if (angle < -Math.PI) return angle + Math.PI * 2;
  return angle;
}

function approachAngle(current: number, target: number, maxDelta: number): number {
  const delta = angleWrap(target - current);
  return current + clamp(delta, -maxDelta, maxDelta);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function stableUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export class HeadlessBitBot {
  private readonly world = new WorldSnapshot();
  private readonly options: BotRuntimeOptions;
  private conn: DbConnection | null = null;
  private baselineSubscription: SubscriptionHandle | null = null;
  private worldSubscription: SubscriptionHandle | null = null;
  private worldListenersBound = false;
  private identityHexValue: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private chunkCenterCx = Math.floor((WORLD.sizeX * 0.5) / WORLD.chunkSize);
  private chunkCenterCz = Math.floor((WORLD.sizeZ * 0.5) / WORLD.chunkSize);
  private trackedTarget: TrackedTarget | null = null;
  private moveDirective: MoveDirective | null = null;
  private strafeSign = Math.random() < 0.5 ? -1 : 1;
  private strafeFlipAt = 0;
  private yaw = 0;
  private pitch = 0;
  private movementState: BotMovementState | null = null;
  private sentMovementHistory: SentMovementSample[] = [];
  private lastTickAt = 0;
  private nextFireAt = 0;
  private burstShotsRemaining = 0;
  private burstCooldownUntil = 0;
  private respawnAt = 0;
  private claimedUsername = false;
  private activeName: string;
  private readonly personality: BotPersonality;
  private jumpCooldownUntil = 0;
  private blockedSince = 0;
  private lastHealth = PLAYER.maxHealth;
  private underFireUntil = 0;
  private coverDirective: CoverDirective | null = null;
  private lastProgressAt = 0;
  private lastProgressPos: BotVec3 | null = null;
  private forcedUnstickUntil = 0;
  private forcedUnstickDir: { x: number; z: number } | null = null;
  private heardContact: HeardContact | null = null;
  private spawnRushUntil = 0;
  private lastSpawnProtected = false;
  private currentLoadout: [number, number, number] = [RIFLE_INDEX, SHOTGUN_INDEX, RPG_INDEX];
  private pendingLoadout: [number, number, number] | null = null;
  private selectedWeapon = RIFLE_INDEX;
  private lastShotAt = 0;
  private lastBreachAt = 0;
  private lastBreachLoadoutRequestAt = 0;

  // ── Neural navigation state ──
  private neuralNav: NeuralNavigator | null = null;
  private navYaw = 0;
  private navPitch = 0;
  private navStagnationTimer = 0;
  private navPrevDist = 0;
  private navInitialDist = 0;
  private navLastTargetX = 0;
  private navLastTargetZ = 0;
  private lastGrounded = true;
  private lastClimbing = false;
  private lastSprinting = false;
  private usingNeuralThisTick = false;
  private wasUsingNeural = false;
  private pendingNeuralJump = false;

  // ── Vehicle piloting state ──
  private vehicleInputSeq = 1;
  private seekVehicleId: number | bigint | null = null;
  private seekAbortAt = 0;
  private nextVehicleSeekCheckAt = 0;
  private vehicleNoTargetSince = 0;
  private lastVehicleSwitchAt = 0;
  private nextVehicleFireAt = 0;
  private lastVehicleReloadAt = 0;

  constructor(options: BotRuntimeOptions) {
    this.options = options;
    this.activeName = options.name;
    this.personality = makePersonality(options.name);
    console.log(
      `[bot:${options.name}] personality react=${this.personality.reactionMinMs}-${this.personality.reactionMaxMs}ms ` +
        `turn=${this.personality.turnRate.toFixed(2)} acq=${this.personality.acquireRange.toFixed(0)} ` +
        `pitchBias=${this.personality.pitchBias.toFixed(2)} burst=${this.personality.burstMin}-${this.personality.burstMax}`,
    );
    try {
      this.neuralNav = new NeuralNavigator(NAV_MODEL_PATH);
    } catch {
      console.warn(`[bot:${options.name}] neural model not found, using classic navigation`);
    }
  }

  start(): void {
    const token = this.loadSavedToken();
    const conn = DbConnection.builder()
      .withUri(this.options.uri)
      .withDatabaseName(this.options.moduleName)
      .withCompression('none')
      .withToken(token)
      .onConnect((_connection, identity, issuedToken) => {
        this.identityHexValue = identity.toHexString();
        this.saveToken(issuedToken);
        this.installBaselineSubscription(conn);
      })
      .onConnectError((_ctx, error) => {
        console.error(`[bot:${this.options.name}] connect error`, error);
      })
      .onDisconnect((_ctx, error) => {
        console.error(`[bot:${this.options.name}] disconnected`, error);
      })
      .build();

    this.conn = conn;
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.baselineSubscription?.unsubscribe();
    this.worldSubscription?.unsubscribe();
    this.conn?.disconnect?.();
  }

  private installBaselineSubscription(conn: DbConnection): void {
    this.baselineSubscription = conn
      .subscriptionBuilder()
      .onApplied(() => {
        this.refreshWorldSubscription(true);
        if (!this.tickTimer) {
          this.lastTickAt = Date.now();
          this.tickTimer = setInterval(() => {
            void this.tick();
          }, this.options.tickMs);
        }
        this.bindWorldListeners();
        if (!this.claimedUsername) {
          void this.claimUsername();
        }
      })
      .onError((_ctx) => {
        console.error(`[bot:${this.options.name}] baseline subscription error`);
      })
      .subscribe([
        'SELECT * FROM player',
        'SELECT * FROM player_loadout',
        'SELECT * FROM player_ammo',
        `SELECT * FROM entity WHERE kind = ${ENTITY_KINDS.Vehicle}`,
        'SELECT * FROM vehicle',
        'SELECT * FROM shot_event',
        'SELECT * FROM explosion_event',
        'SELECT * FROM match_state WHERE id = 1',
        'SELECT * FROM world_config WHERE id = 1',
      ]) as SubscriptionHandle;
  }

  private refreshWorldSubscription(force: boolean): void {
    const me = this.getSelf();
    const centerX = this.movementState?.pos.x ?? me?.pos.x ?? WORLD.sizeX * 0.5;
    const centerZ = this.movementState?.pos.z ?? me?.pos.z ?? WORLD.sizeZ * 0.5;
    const nextCx = clamp(
      Math.floor(centerX / WORLD.chunkSize),
      0,
      Math.ceil(WORLD.sizeX / WORLD.chunkSize) - 1,
    );
    const nextCz = clamp(
      Math.floor(centerZ / WORLD.chunkSize),
      0,
      Math.ceil(WORLD.sizeZ / WORLD.chunkSize) - 1,
    );

    if (
      !force &&
      Math.abs(nextCx - this.chunkCenterCx) <= WORLD_CHUNK_MARGIN &&
      Math.abs(nextCz - this.chunkCenterCz) <= WORLD_CHUNK_MARGIN
    ) {
      return;
    }

    this.chunkCenterCx = nextCx;
    this.chunkCenterCz = nextCz;
    this.worldSubscription?.unsubscribe();

    const minCx = clamp(nextCx - WORLD_CHUNK_RADIUS, 0, Math.ceil(WORLD.sizeX / WORLD.chunkSize));
    const maxCx = clamp(nextCx + WORLD_CHUNK_RADIUS, 0, Math.ceil(WORLD.sizeX / WORLD.chunkSize));
    const minCz = clamp(nextCz - WORLD_CHUNK_RADIUS, 0, Math.ceil(WORLD.sizeZ / WORLD.chunkSize));
    const maxCz = clamp(nextCz + WORLD_CHUNK_RADIUS, 0, Math.ceil(WORLD.sizeZ / WORLD.chunkSize));
    const query = `SELECT * FROM world_chunk WHERE cx >= ${minCx} AND cx <= ${maxCx} AND cz >= ${minCz} AND cz <= ${maxCz}`;

    const conn = this.conn;
    if (!conn) return;

    this.worldSubscription = conn
      .subscriptionBuilder()
      .onApplied(() => {
        for (const chunk of conn.db.world_chunk.iter() as Iterable<any>) {
          this.world.upsertChunk(chunk);
        }
      })
      .onError((_ctx) => {
        console.error(`[bot:${this.options.name}] world subscription error`);
      })
      .subscribe([query]) as SubscriptionHandle;

  }

  private bindWorldListeners(): void {
    if (!this.conn || this.worldListenersBound) return;
    this.worldListenersBound = true;
    this.conn.db.world_chunk.onInsert((_ctx: unknown, chunk: any) => {
      this.world.upsertChunk(chunk);
    });
    this.conn.db.world_chunk.onUpdate((_ctx: unknown, _oldChunk: any, chunk: any) => {
      this.world.upsertChunk(chunk);
    });
    this.conn.db.world_chunk.onDelete((_ctx: unknown, chunk: any) => {
      this.world.removeChunk(chunk);
    });
    this.conn.db.shot_event.onInsert((_ctx: unknown, shot: any) => {
      this.onShotEvent(shot);
    });
    this.conn.db.explosion_event.onInsert((_ctx: unknown, explosion: any) => {
      this.onExplosionEvent(explosion);
    });
  }

  private onShotEvent(shot: any): void {
    if (!this.identityHexValue) return;
    const shooterHex = identityHex(shot.shooter);
    if (!shooterHex || shooterHex === this.identityHexValue) return;
    const me = this.getSelf();
    if (!me) return;
    const origin = shot.origin as BotVec3 | undefined;
    if (!origin) return;
    if (distSq(me.pos, origin) > HEARING_RADIUS * HEARING_RADIUS) return;
    this.heardContact = {
      x: origin.x,
      y: origin.y,
      z: origin.z,
      expiresAt: Date.now() + HEARD_CONTACT_MS,
      source: 'shot',
    };
  }

  private onExplosionEvent(explosion: any): void {
    if (!this.identityHexValue) return;
    const originHex = identityHex(explosion.origin);
    if (!originHex || originHex === this.identityHexValue) return;
    const me = this.getSelf();
    if (!me) return;
    const pos = explosion.pos as BotVec3 | undefined;
    if (!pos) return;
    if (distSq(me.pos, pos) > EXPLOSION_HEARING_RADIUS * EXPLOSION_HEARING_RADIUS) return;
    this.heardContact = {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      expiresAt: Date.now() + HEARD_CONTACT_MS,
      source: 'explosion',
    };
  }

  private getSelf(): PlayerRow | null {
    if (!this.conn || !this.identityHexValue) return null;
    for (const row of this.conn.db.player.iter() as Iterable<any>) {
      if (identityHex(row.identity) === this.identityHexValue) {
        return row as PlayerRow;
      }
    }
    return null;
  }

  private movementSnapshotFromPlayer(me: PlayerRow): {
    pos: BotVec3;
    vel: BotVec3;
    grounded: boolean;
    climbing: boolean;
    sprinting: boolean;
  } {
    const climbing = hasPlayerMovementFlag(me.movementFlags, PLAYER_MOVEMENT_FLAG_CLIMBING);
    const grounded = hasPlayerMovementFlag(me.movementFlags, PLAYER_MOVEMENT_FLAG_GROUNDED) && !climbing;
    return {
      pos: me.pos,
      vel: me.vel,
      grounded,
      climbing,
      sprinting: hasPlayerMovementFlag(me.movementFlags, PLAYER_MOVEMENT_FLAG_SPRINTING),
    };
  }

  private syncMovementState(me: PlayerRow): void {
    const now = Date.now();
    const snapshot = this.movementSnapshotFromPlayer(me);
    if (!this.movementState) {
      this.movementState = BotMovementState.fromSnapshot(snapshot);
      this.yaw = me.rot.yaw;
      this.pitch = me.rot.pitch;
      this.navYaw = this.yaw;
      this.navPitch = this.pitch;
      this.lastGrounded = snapshot.grounded;
      this.lastClimbing = snapshot.climbing;
      this.lastSprinting = snapshot.sprinting;
      return;
    }

    const dx = snapshot.pos.x - this.movementState.pos.x;
    const dy = snapshot.pos.y - this.movementState.pos.y;
    const dz = snapshot.pos.z - this.movementState.pos.z;
    const horizontalDrift = Math.sqrt(dx * dx + dz * dz);
    const verticalDrift = Math.abs(dy);
    const matchedSentSample = this.matchRecentSentSnapshot(snapshot, now);
    const localAirborne =
      !this.movementState.onGround ||
      this.movementState.isClimbing ||
      Math.abs(this.movementState.velY) > 0.4;
    const snapshotAirborne =
      !snapshot.grounded ||
      snapshot.climbing ||
      Math.abs(snapshot.vel.y) > 0.4;
    const hardReset = localAirborne || snapshotAirborne
      ? horizontalDrift > AIRBORNE_RECONCILE_DIST || verticalDrift > AIRBORNE_RECONCILE_Y
      : horizontalDrift > HARD_RECONCILE_DIST || verticalDrift > HARD_RECONCILE_Y;
    const softReset =
      !localAirborne &&
      !snapshotAirborne &&
      (horizontalDrift > SOFT_RECONCILE_DIST || verticalDrift > SOFT_RECONCILE_Y);
    if (matchedSentSample && !hardReset) {
      runtimeDiagnostics.recordReconcile(this.activeName, horizontalDrift, verticalDrift, 'none');
      return;
    }

    runtimeDiagnostics.recordReconcile(
      this.activeName,
      horizontalDrift,
      verticalDrift,
      hardReset ? 'hard' : softReset ? 'soft' : 'none',
    );

    if (hardReset) {
      this.movementState.syncHard(snapshot);
      this.yaw = me.rot.yaw;
      this.pitch = me.rot.pitch;
      this.navYaw = this.yaw;
      this.navPitch = this.pitch;
      this.lastGrounded = snapshot.grounded;
      this.lastClimbing = snapshot.climbing;
      this.lastSprinting = snapshot.sprinting;
      return;
    }

    if (softReset) {
      this.movementState.nudgeToward(snapshot, 0.35, 0.45);
    }
  }

  private getActiveSelf(me: PlayerRow): PlayerRow {
    if (!this.movementState) {
      return me;
    }
    return {
      ...me,
      pos: { ...this.movementState.pos },
      vel: this.movementState.velocity(),
      rot: { yaw: this.yaw, pitch: this.pitch },
    };
  }

  private pruneSentMovementHistory(now: number): void {
    const cutoff = now - SENT_MOVEMENT_HISTORY_MS;
    this.sentMovementHistory = this.sentMovementHistory.filter((sample) => sample.at >= cutoff);
  }

  private matchRecentSentSnapshot(snapshot: {
    pos: BotVec3;
    vel: BotVec3;
    grounded: boolean;
    climbing: boolean;
    sprinting: boolean;
  }, now: number): SentMovementSample | null {
    this.pruneSentMovementHistory(now);
    for (let i = this.sentMovementHistory.length - 1; i >= 0; i--) {
      const sample = this.sentMovementHistory[i]!;
      const dx = sample.pos.x - snapshot.pos.x;
      const dy = sample.pos.y - snapshot.pos.y;
      const dz = sample.pos.z - snapshot.pos.z;
      const posDrift = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (posDrift > SENT_SNAPSHOT_MATCH_DIST) continue;
      const dvx = sample.vel.x - snapshot.vel.x;
      const dvy = sample.vel.y - snapshot.vel.y;
      const dvz = sample.vel.z - snapshot.vel.z;
      const velDrift = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
      if (velDrift > SENT_SNAPSHOT_MATCH_VEL) continue;
      if (sample.grounded !== snapshot.grounded) continue;
      if (sample.climbing !== snapshot.climbing) continue;
      return sample;
    }
    return null;
  }

  private async claimUsername(): Promise<void> {
    if (!this.conn || this.claimedUsername) return;
    const candidates = [this.options.name];
    for (let attempt = 0; attempt < 4; attempt++) {
      candidates.push(`${this.options.name}-${Math.random().toString(36).slice(2, 6)}`);
    }

    for (const username of candidates) {
      try {
        await this.conn.reducers.setUsername({
          username,
          characterPreset: this.options.index % PLAYER.numCharacterPresets,
        });
        this.activeName = username;
        this.claimedUsername = true;
        this.pendingLoadout = this.chooseRandomLoadout();
        await this.applyPendingLoadout();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Username already taken')) {
          console.error(`[bot:${this.options.name}] set_username failed`, error);
          return;
        }
      }
    }

    console.error(`[bot:${this.options.name}] could not claim a unique username`);
  }

  private chooseRandomLoadout(): [number, number, number] {
    const bag = [...ALL_WEAPON_INDICES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j]!, bag[i]!];
    }
    return [bag[0]!, bag[1]!, bag[2]!];
  }

  private async applyPendingLoadout(): Promise<void> {
    if (!this.conn || !this.pendingLoadout) return;
    const [slot1, slot2, slot3] = this.pendingLoadout;
    try {
      await this.conn.reducers.setLoadout({ slot1, slot2, slot3 });
      this.currentLoadout = [slot1, slot2, slot3];
      this.selectedWeapon = slot1;
      this.pendingLoadout = null;
    } catch (error) {
      console.error(`[bot:${this.activeName}] set_loadout failed`, error);
    }
  }

  private getAmmoForWeapon(weaponIndex: number): number {
    if (!this.conn || !this.identityHexValue) return 0;
    for (const row of this.conn.db.player_ammo.iter() as Iterable<any>) {
      if (identityHex((row as any).identity) !== this.identityHexValue) continue;
      if (Number((row as any).weaponIndex) !== weaponIndex) continue;
      return Number((row as any).ammo ?? 0);
    }
    return 0;
  }

  private syncCurrentLoadoutFromDb(me: PlayerRow): void {
    if (!this.conn) return;
    const profileId = Number(me.profileId ?? 0);
    if (!Number.isFinite(profileId) || profileId <= 0) return;

    for (const row of this.conn.db.player_loadout.iter() as Iterable<any>) {
      if (Number((row as any).profileId ?? 0) !== profileId) continue;
      const nextLoadout: [number, number, number] = [
        Number((row as any).slot1 ?? RIFLE_INDEX),
        Number((row as any).slot2 ?? SHOTGUN_INDEX),
        Number((row as any).slot3 ?? RPG_INDEX),
      ];
      this.currentLoadout = nextLoadout;
      if (!nextLoadout.includes(this.selectedWeapon)) {
        this.selectedWeapon = nextLoadout[0];
        this.burstShotsRemaining = 0;
      }
      return;
    }
  }

  private loadSavedToken(): string | undefined {
    const tokenPath = this.tokenPath();
    if (!fs.existsSync(tokenPath)) return undefined;
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    return token || undefined;
  }

  private saveToken(token: string): void {
    const tokenPath = this.tokenPath();
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, token, 'utf8');
  }

  private tokenPath(): string {
    return path.join(this.options.tokenDir, `bot-${String(this.options.index + 1).padStart(2, '0')}.token`);
  }

  private fireWeapon(payload: {
    origin: BotVec3;
    direction: BotVec3;
    weapon: number;
    hitPlayers: any[];
    hitVehicles: bigint[];
    hitBlocks: BotVec3[];
  }): void {
    if (!this.conn) return;
    void this.conn.reducers.fireWeapon(payload).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Cannot fire while spawn protected') ||
        message.includes('No ammo') ||
        message.includes('Cannot fire while dead') ||
        message.includes('Weapons are disabled during intermission')
      ) {
        return;
      }
      if (message.includes('Firing too fast')) {
        const now = Date.now();
        this.lastShotAt = now;
        this.nextFireAt = now + this.weaponCooldownMs(payload.weapon) + randomBetween(40, 120);
        this.burstShotsRemaining = 0;
        return;
      }
      if (message.includes('Weapon not in loadout')) {
        const me = this.getSelf();
        if (me) {
          this.syncCurrentLoadoutFromDb(me);
        }
        this.burstShotsRemaining = 0;
        this.nextFireAt = Date.now() + randomBetween(120, 260);
        return;
      }
      console.error(`[bot:${this.activeName}] fire_weapon failed`, error);
    });
  }

  private sendProjectileImpact(payload: {
    shotOrigin: BotVec3;
    impactPos: BotVec3;
    direction: BotVec3;
    weapon: number;
    travelTimeMs: number;
    hitPlayers: any[];
    hitVehicles: bigint[];
  }): void {
    if (!this.conn) return;
    void this.conn.reducers.projectileImpact({
      shotOrigin: payload.shotOrigin,
      impactPos: payload.impactPos,
      direction: payload.direction,
      weapon: payload.weapon,
      travelTimeMs: Math.max(0, Math.round(payload.travelTimeMs)),
      hitPlayers: payload.hitPlayers,
      hitVehicles: payload.hitVehicles,
      hitBlocks: [],
      shotEventId: 0n,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Not a projectile weapon') || message.includes('Grenade impacts are server-authoritative')) {
        return;
      }
      console.error(`[bot:${this.activeName}] projectile_impact failed`, error);
    });
  }

  private sendPosition(payload: {
    pos: BotVec3;
    vel: BotVec3;
    rot: { yaw: number; pitch: number };
    weapon: number;
    movementFlags: number;
  }): void {
    if (!this.conn) return;
    const now = Date.now();
    this.sentMovementHistory.push({
      at: now,
      pos: { ...payload.pos },
      vel: { ...payload.vel },
      grounded: hasPlayerMovementFlag(payload.movementFlags, PLAYER_MOVEMENT_FLAG_GROUNDED),
      climbing: hasPlayerMovementFlag(payload.movementFlags, PLAYER_MOVEMENT_FLAG_CLIMBING),
      sprinting: hasPlayerMovementFlag(payload.movementFlags, PLAYER_MOVEMENT_FLAG_SPRINTING),
    });
    this.pruneSentMovementHistory(now);
    void this.conn.reducers.updatePosition(payload).catch((error: unknown) => {
      console.error(`[bot:${this.activeName}] update_position failed`, error);
    });
  }

  private sendRespawn(): void {
    if (!this.conn) return;
    void this.conn.reducers.respawn({}).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Not registered')) return;
      console.error(`[bot:${this.activeName}] respawn failed`, error);
    });
  }

  private isMatchActive(): boolean {
    if (!this.conn) return false;
    for (const row of this.conn.db.match_state.iter() as Iterable<any>) {
      return Number((row as MatchStateRow).state) === MATCH_STATE_ACTIVE;
    }
    return false;
  }

  private listEnemies(me: PlayerRow): PlayerRow[] {
    if (!this.conn) return [];
    const meHex = identityHex(me.identity);
    const enemies: PlayerRow[] = [];
    for (const row of this.conn.db.player.iter() as Iterable<any>) {
      const player = row as PlayerRow;
      if (identityHex(player.identity) === meHex) continue;
      if (!player.online || player.health <= 0 || player.spawnProtected) continue;
      if (Number(player.mountedVehicleId ?? 0) !== 0) continue;
      if (!player.username.trim()) continue;
      enemies.push(player);
    }
    return enemies;
  }

  private listVehicleTargets(): Array<{ vehicle: VehicleRow; entity: EntityRow }> {
    if (!this.conn) return [];
    const vehicles: Array<{ vehicle: VehicleRow; entity: EntityRow }> = [];
    for (const row of this.conn.db.vehicle.iter() as Iterable<any>) {
      const vehicle = row as VehicleRow;
      if (Number(vehicle.health ?? 0) <= 0) continue;
      if (!vehicle.pilotIdentity) continue;
      const entity = this.conn.db.entity.id.find(vehicle.entityId as any) as EntityRow | undefined;
      if (!entity || !entity.active || Number(entity.kind) !== ENTITY_KINDS.Vehicle) continue;
      vehicles.push({ vehicle, entity });
    }
    return vehicles;
  }

  private currentLookVector(): BotVec3 {
    return normalize3D(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
  }

  private canSeePoint(me: PlayerRow, point: BotVec3, allowPeripheral: boolean): boolean {
    if (!this.world.isColumnLoaded(me.pos.x, me.pos.z) || !this.world.isColumnLoaded(point.x, point.z)) {
      return false;
    }
    if (!this.world.hasLineOfSight(me.pos, point)) return false;
    const toPoint = normalize3D(point.x - me.pos.x, point.y - me.pos.y, point.z - me.pos.z);
    const look = this.currentLookVector();
    const dot = toPoint.x * look.x + toPoint.y * look.y + toPoint.z * look.z;
    return allowPeripheral || dot >= MAX_VIEW_DOT;
  }

  private estimatePlayerTargetScore(me: PlayerRow, enemy: PlayerRow, d2: number, now: number): number {
    const distance = Math.sqrt(d2);
    const kdPenalty = enemy.kills / Math.max(1, enemy.deaths + 1);
    const healthFactor = 1 - enemy.health / Math.max(1, enemy.maxHealth || PLAYER.maxHealth);
    const selfHealthFactor = me.health / Math.max(1, me.maxHealth || PLAYER.maxHealth);
    let score = 9;
    score += healthFactor * 3.2;
    score -= distance * 0.06;
    score -= kdPenalty * 0.8;
    score += selfHealthFactor * 1.1;
    if (now < this.underFireUntil) score -= 0.8;
    if (enemy.health <= 40) score += 1.8;
    return score;
  }

  private estimateVehicleTargetScore(me: PlayerRow, entity: EntityRow, vehicle: VehicleRow, now: number): number {
    const d2 = distSq(me.pos, entity.pos);
    const distance = Math.sqrt(d2);
    const hasAntiVehicle = this.currentLoadout.some((weapon) => [RPG_INDEX, GRENADE_LAUNCHER_INDEX, SNIPER_INDEX].includes(weapon));
    let score = hasAntiVehicle ? 6.5 : 3.5;
    score -= distance * 0.05;
    score += Number(vehicle.health) <= 80 ? 2.2 : 0;
    if (vehicle.pilotIdentity) score += 1.8;
    if (now < this.underFireUntil) score -= 1.2;
    return score;
  }

  private getPreferredTarget(me: PlayerRow, now: number): BotTarget | null {
    const enemies = this.listEnemies(me);
    const vehicles = this.listVehicleTargets();
    const peripheralLock = this.trackedTarget !== null || (this.heardContact !== null && now < this.heardContact.expiresAt);
    let bestTarget: BotTarget | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
      const d2 = distSq(me.pos, enemy.pos);
      const distance = Math.sqrt(d2);
      if (distance > TARGET_KEEP_RANGE) continue;
      if (distance > this.personality.acquireRange && this.trackedTarget?.identityHex !== identityHex(enemy.identity)) continue;
      const targetEye = this.targetEye(enemy);
      if (!this.canSeePoint(me, targetEye, peripheralLock)) continue;
      if (now < this.underFireUntil && distance > 38 && Math.random() < 0.18) continue;
      const score = this.estimatePlayerTargetScore(me, enemy, d2, now);
      if (score <= bestScore) continue;
      bestScore = score;
      bestTarget = { kind: 'player', player: enemy };
    }

    for (const { vehicle, entity } of vehicles) {
      const d2 = distSq(me.pos, entity.pos);
      const distance = Math.sqrt(d2);
      if (distance > 95) continue;
      if (!this.canSeePoint(me, entity.pos, peripheralLock)) continue;
      const score = this.estimateVehicleTargetScore(me, entity, vehicle, now);
      if (score <= bestScore) continue;
      bestScore = score;
      bestTarget = { kind: 'vehicle', vehicle, entity };
    }

    if (bestTarget?.kind === 'player') {
      const nextIdentity = identityHex(bestTarget.player.identity);
      if (this.trackedTarget?.identityHex !== nextIdentity) {
        this.trackedTarget = {
          identityHex: nextIdentity,
          lastSeenAt: now,
          reactionReadyAt: now + randomBetween(this.personality.reactionMinMs, this.personality.reactionMaxMs),
        };
      } else if (this.trackedTarget) {
        this.trackedTarget.lastSeenAt = now;
      }
      return bestTarget;
    }

    if (this.trackedTarget && now - this.trackedTarget.lastSeenAt <= randomBetween(MIN_TARGET_MEMORY_MS, MAX_TARGET_MEMORY_MS)) {
      const retained = enemies.find((enemy) => identityHex(enemy.identity) === this.trackedTarget?.identityHex);
      if (retained) return { kind: 'player', player: retained };
    }

    this.trackedTarget = null;
    return bestTarget;
  }

  private buildSearchHotspots(me: PlayerRow): SearchHotspot[] {
    const enemies = this.listEnemies(me);
    const vehicles = this.listVehicleTargets();
    const sources: BotVec3[] = [
      ...enemies.map((enemy) => enemy.pos),
      ...vehicles.map(({ entity }) => entity.pos),
    ];
    const hotspots: SearchHotspot[] = [];

    for (const source of sources) {
      let merged = false;
      for (const hotspot of hotspots) {
        const dx = source.x - hotspot.x;
        const dz = source.z - hotspot.z;
        if (dx * dx + dz * dz > 18 * 18) continue;
        hotspot.x = (hotspot.x * hotspot.members + source.x) / (hotspot.members + 1);
        hotspot.y = (hotspot.y * hotspot.members + source.y) / (hotspot.members + 1);
        hotspot.z = (hotspot.z * hotspot.members + source.z) / (hotspot.members + 1);
        hotspot.members += 1;
        merged = true;
        break;
      }
      if (!merged) {
        hotspots.push({
          x: source.x,
          y: source.y,
          z: source.z,
          members: 1,
        });
      }
    }

    return hotspots;
  }

  private countLivePlayersNear(me: PlayerRow, x: number, z: number, radius: number): number {
    if (!this.conn) return 0;
    const radiusSq = radius * radius;
    let count = 0;
    const meHex = identityHex(me.identity);
    for (const row of this.conn.db.player.iter() as Iterable<any>) {
      const player = row as PlayerRow;
      if (identityHex(player.identity) === meHex) continue;
      if (!player.online || player.health <= 0) continue;
      const dx = player.pos.x - x;
      const dz = player.pos.z - z;
      if (dx * dx + dz * dz <= radiusSq) {
        count++;
      }
    }
    return count;
  }

  private chooseSearchWaypoint(me: PlayerRow, now: number): MoveDirective | null {
    const hotspots = this.buildSearchHotspots(me);
    if (hotspots.length === 0) {
      return null;
    }

    let bestWaypoint: MoveDirective | null = null;
    let bestScore = -Infinity;
    const timeBucket = Math.floor(now / 3500);

    for (let hotspotIndex = 0; hotspotIndex < hotspots.length; hotspotIndex++) {
      const hotspot = hotspots[hotspotIndex]!;
      const toHotspotX = hotspot.x - me.pos.x;
      const toHotspotZ = hotspot.z - me.pos.z;
      const d2 = toHotspotX * toHotspotX + toHotspotZ * toHotspotZ;
      const distance = Math.sqrt(d2);
      const toward = normalize2D(toHotspotX, toHotspotZ);
      if (toward.len <= 0.01) continue;

      const baseScore = hotspot.members * 2.4 - distance * 0.055;
      const laneCount = hotspot.members >= 3 ? 8 : 6;

      for (let lane = 0; lane < laneCount; lane++) {
        const seed = (this.options.index + 1) * 101 + hotspotIndex * 37 + lane * 17 + timeBucket * 13;
        const angle = (Math.PI * 2 * lane) / laneCount + stableUnit(seed) * 0.55;
        const ringRadius = clamp(8 + hotspot.members * 1.8 + stableUnit(seed + 1) * 6, 7, 18);
        const candidateX = clamp(hotspot.x + Math.cos(angle) * ringRadius, 2, WORLD.sizeX - 2);
        const candidateZ = clamp(hotspot.z + Math.sin(angle) * ringRadius, 2, WORLD.sizeZ - 2);
        const candidateFootY = this.groundFootYAt(candidateX, me.pos.y - BOT_EYE_HEIGHT, candidateZ);
        if (candidateFootY === null) continue;

        const laneDx = candidateX - me.pos.x;
        const laneDz = candidateZ - me.pos.z;
        const laneDir = normalize2D(laneDx, laneDz);
        const forwardBias = laneDir.x * toward.x + laneDir.z * toward.z;
        const localDensity = this.countLivePlayersNear(me, candidateX, candidateZ, 10);
        const score =
          baseScore +
          forwardBias * 1.4 -
          Math.sqrt(laneDx * laneDx + laneDz * laneDz) * 0.015 -
          localDensity * 0.9 +
          stableUnit(seed + 2) * 0.25;

        if (score <= bestScore) continue;
        bestScore = score;
        bestWaypoint = {
          x: candidateX,
          z: candidateZ,
          expiresAt: now + randomBetween(1800, 3200),
        };
      }
    }

    return bestWaypoint;
  }

  private chooseWaypoint(now: number, me: PlayerRow): MoveDirective {
    if (this.heardContact && now < this.heardContact.expiresAt) {
      return {
        x: clamp(this.heardContact.x + randomBetween(-6, 6), 2, WORLD.sizeX - 2),
        z: clamp(this.heardContact.z + randomBetween(-6, 6), 2, WORLD.sizeZ - 2),
        expiresAt: now + randomBetween(1800, 2800),
      };
    }

    const searchWaypoint = this.chooseSearchWaypoint(me, now);
    if (searchWaypoint) {
      return searchWaypoint;
    }

    const radius = randomBetween(MIN_IDLE_RADIUS, MAX_IDLE_RADIUS);
    const angle = Math.random() * Math.PI * 2;
    const targetX = clamp(me.pos.x + Math.cos(angle) * radius, 2, WORLD.sizeX - 2);
    const targetZ = clamp(me.pos.z + Math.sin(angle) * radius, 2, WORLD.sizeZ - 2);
    return {
      x: targetX,
      z: targetZ,
      expiresAt: now + WAYPOINT_LIFETIME_MS,
    };
  }

  private chooseSpawnExitWaypoint(me: PlayerRow, now: number): MoveDirective {
    const centerX = WORLD.sizeX * 0.5;
    const centerZ = WORLD.sizeZ * 0.5;
    const away = normalize2D(me.pos.x - centerX, me.pos.z - centerZ);
    const dir = away.len > 0.1 ? away : { x: Math.cos(this.yaw), z: Math.sin(this.yaw), len: 1 };
    return {
      x: clamp(me.pos.x + dir.x * randomBetween(26, 40), 2, WORLD.sizeX - 2),
      z: clamp(me.pos.z + dir.z * randomBetween(26, 40), 2, WORLD.sizeZ - 2),
      expiresAt: now + SPAWN_RUSH_MS,
    };
  }

  private targetEye(target: PlayerRow): BotVec3 {
    return { x: target.pos.x, y: target.pos.y - 0.12, z: target.pos.z };
  }

  private eyeFromFoot(x: number, footY: number, z: number): BotVec3 {
    return { x, y: footY + BOT_EYE_HEIGHT, z };
  }

  private shouldSeekCover(me: PlayerRow, target: PlayerRow | null, now: number): boolean {
    if (!target) return false;
    if (now < this.underFireUntil) return true;
    if (me.health <= PLAYER.maxHealth * 0.38) return true;
    const dx = target.pos.x - me.pos.x;
    const dz = target.pos.z - me.pos.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return distance < 16;
  }

  private chooseWeaponForTarget(me: PlayerRow, target: BotTarget | null): number {
    const available = this.currentLoadout.filter((weapon) => this.getAmmoForWeapon(weapon) > 0);
    const pool = available.length > 0 ? available : this.currentLoadout;
    if (!target) {
      return pool.includes(RIFLE_INDEX) ? RIFLE_INDEX : pool[0]!;
    }

    const targetPos = target.kind === 'player' ? target.player.pos : target.entity.pos;
    const distance = Math.sqrt(distSq(me.pos, targetPos));
    let bestWeapon = pool[0]!;
    let bestScore = -Infinity;

    for (const weapon of pool) {
      const ammo = this.getAmmoForWeapon(weapon);
      const def = WEAPONS_CONFIG[weapon]!;
      let score = ammo > 0 ? 5 : -100;
      score -= Math.abs(distance - this.idealRangeForWeapon(weapon, target.kind)) * 0.07;
      if (target.kind === 'vehicle') {
        score += [RPG_INDEX, GRENADE_LAUNCHER_INDEX].includes(weapon) ? 4.0 : 0;
        score += weapon === SNIPER_INDEX ? 1.2 : 0;
        score -= weapon === SHOTGUN_INDEX ? 4.5 : 0;
      } else {
        score += weapon === SHOTGUN_INDEX && distance < 18 ? 3.8 : 0;
        score += weapon === MACHINE_GUN_INDEX && distance < 42 ? 2.4 : 0;
        score += weapon === SNIPER_INDEX && distance > 38 ? 2.8 : 0;
        score += weapon === GRENADE_LAUNCHER_INDEX && distance > 16 ? 1.6 : 0;
        score -= weapon === RPG_INDEX && distance < 14 ? 2.6 : 0;
      }
      score -= def.delivery === 'server_projectile' && distance < 10 ? 2.2 : 0;
      if (score > bestScore) {
        bestScore = score;
        bestWeapon = weapon;
      }
    }

    if (this.selectedWeapon !== bestWeapon) {
      this.burstShotsRemaining = 0;
    }
    this.selectedWeapon = bestWeapon;
    return bestWeapon;
  }

  private idealRangeForWeapon(weapon: number, targetKind: BotTarget['kind']): number {
    if (targetKind === 'vehicle') {
      switch (weapon) {
        case RPG_INDEX: return 42;
        case GRENADE_LAUNCHER_INDEX: return 28;
        case SNIPER_INDEX: return 55;
        case MACHINE_GUN_INDEX: return 35;
        default: return 26;
      }
    }

    switch (weapon) {
      case SHOTGUN_INDEX: return 12;
      case RPG_INDEX: return 30;
      case MACHINE_GUN_INDEX: return 25;
      case GRENADE_LAUNCHER_INDEX: return 24;
      case SNIPER_INDEX: return 62;
      default: return IDEAL_RIFLE_RANGE;
    }
  }

  private chooseBreachWeapon(): number | null {
    const candidates = [RPG_INDEX, GRENADE_LAUNCHER_INDEX];
    for (const weapon of candidates) {
      if (this.currentLoadout.includes(weapon) && this.getAmmoForWeapon(weapon) > 0) {
        return weapon;
      }
    }
    return null;
  }

  private ensureBreachingLoadout(now: number): boolean {
    if (this.currentLoadout.includes(RPG_INDEX)) {
      return true;
    }
    if (this.pendingLoadout?.includes(RPG_INDEX)) {
      return false;
    }
    if (now - this.lastBreachLoadoutRequestAt < 1500) {
      return false;
    }

    const keepWeapons = this.currentLoadout.filter((weapon) => weapon !== RPG_INDEX);
    const nextLoadout: [number, number, number] = [
      RPG_INDEX,
      keepWeapons[0] ?? RIFLE_INDEX,
      keepWeapons[1] ?? MACHINE_GUN_INDEX,
    ];
    this.pendingLoadout = nextLoadout;
    this.lastBreachLoadoutRequestAt = now;
    this.burstShotsRemaining = 0;
    this.selectedWeapon = RPG_INDEX;
    void this.applyPendingLoadout();
    return false;
  }

  private findObstacleImpactPos(
    me: PlayerRow,
    dirX: number,
    dirZ: number,
    currentFootY: number,
  ): BotVec3 | null {
    const distances = [0.8, 1.2, 1.6, 2.1, 2.8];
    const heightOffsets = [0.35, 0.8, 1.2, 1.55];

    for (const distance of distances) {
      const x = clamp(me.pos.x + dirX * distance, 1, WORLD.sizeX - 1);
      const z = clamp(me.pos.z + dirZ * distance, 1, WORLD.sizeZ - 1);
      for (const heightOffset of heightOffsets) {
        const y = currentFootY + heightOffset;
        if (this.world.getBlock(x, y, z) === 0) continue;
        return {
          x: Math.floor(x) + 0.5,
          y: Math.floor(y) + 0.5,
          z: Math.floor(z) + 0.5,
        };
      }
    }

    return null;
  }

  private tryBreachObstacle(
    me: PlayerRow,
    dirX: number,
    dirZ: number,
    currentFootY: number,
    now: number,
  ): boolean {
    if (now - this.lastBreachAt < BREACH_COOLDOWN_MS) {
      return false;
    }

    if (!this.ensureBreachingLoadout(now)) {
      return false;
    }

    const weapon = this.chooseBreachWeapon();
    if (weapon === null) {
      return false;
    }

    const impactPos = this.findObstacleImpactPos(me, dirX, dirZ, currentFootY);
    if (!impactPos) {
      return false;
    }

    const direction = normalize3D(impactPos.x - me.pos.x, impactPos.y - me.pos.y, impactPos.z - me.pos.z);
    this.selectedWeapon = weapon;
    this.burstShotsRemaining = 0;
    this.fireWeapon({
      origin: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
      direction,
      weapon,
      hitPlayers: [],
      hitVehicles: [],
      hitBlocks: [],
    });

    if (WEAPONS_CONFIG[weapon]!.delivery === 'projectile') {
      const projectileSpeed = Math.max(1, Number(WEAPONS_CONFIG[weapon]!.projectileSpeed ?? 0));
      const dx = impactPos.x - me.pos.x;
      const dy = impactPos.y - me.pos.y;
      const dz = impactPos.z - me.pos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.sendProjectileImpact({
        shotOrigin: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
        impactPos,
        direction,
        weapon,
        travelTimeMs: (distance / projectileSpeed) * 1000,
        hitPlayers: [],
        hitVehicles: [],
      });
    }

    this.lastBreachAt = now;
    this.lastShotAt = now;
    this.nextFireAt = now + this.weaponCooldownMs(weapon) + randomBetween(180, 320);
    return true;
  }

  private weaponCooldownMs(weapon: number): number {
    const fireRate = Math.max(0.01, Number(WEAPONS_CONFIG[weapon]?.fireRate ?? 1));
    return 1000 / fireRate;
  }

  private updateProgressState(me: PlayerRow, now: number): void {
    if (!this.lastProgressPos) {
      this.lastProgressPos = { ...me.pos };
      this.lastProgressAt = now;
      return;
    }

    if (distSq(this.lastProgressPos, me.pos) >= 1.8 * 1.8) {
      this.lastProgressPos = { ...me.pos };
      this.lastProgressAt = now;
      return;
    }

    if (now - this.lastProgressAt < STUCK_REPATH_MS) {
      return;
    }

    const angle = this.yaw + this.strafeSign * randomBetween(0.9, 1.5);
    this.forcedUnstickUntil = now + randomBetween(900, 1400);
    this.forcedUnstickDir = { x: -Math.sin(angle), z: -Math.cos(angle) };
    this.strafeSign *= -1;
    this.moveDirective = this.chooseWaypoint(now, me);
    this.coverDirective = null;
    this.lastProgressAt = now;
    this.lastProgressPos = { ...me.pos };
  }

  private refreshCoverDirective(me: PlayerRow, target: PlayerRow | null, now: number): void {
    if (!target || !this.shouldSeekCover(me, target, now)) {
      this.coverDirective = null;
      return;
    }

    const targetHex = identityHex(target.identity);
    if (
      this.coverDirective &&
      this.coverDirective.targetIdentityHex === targetHex &&
      now < this.coverDirective.expiresAt
    ) {
      if (now >= this.coverDirective.phaseUntil) {
        if (this.coverDirective.phase === 'hide') {
          this.coverDirective.phase = 'peek';
          this.coverDirective.phaseUntil = now + randomBetween(280, 560);
        } else {
          this.coverDirective.phase = 'hide';
          this.coverDirective.phaseUntil = now + randomBetween(420, 900);
        }
      }
      return;
    }

    this.coverDirective = this.findCoverDirective(me, target, now);
  }

  private findCoverDirective(me: PlayerRow, target: PlayerRow, now: number): CoverDirective | null {
    const currentFootY = me.pos.y - BOT_EYE_HEIGHT;
    const retreat = normalize2D(me.pos.x - target.pos.x, me.pos.z - target.pos.z);
    if (retreat.len <= 0.01) {
      return null;
    }

    const side = { x: -retreat.z, z: retreat.x };
    const targetEye = this.targetEye(target);
    const distanceBands = [4, 6, 8, 10, 12];
    const lateralOffsets = [0, -1.5, 1.5, -3.0, 3.0];
    let best: { score: number; cover: CoverDirective } | null = null;

    for (const retreatDist of distanceBands) {
      for (const lateral of lateralOffsets) {
        const anchorX = clamp(me.pos.x + retreat.x * retreatDist + side.x * lateral, 1, WORLD.sizeX - 1);
        const anchorZ = clamp(me.pos.z + retreat.z * retreatDist + side.z * lateral, 1, WORLD.sizeZ - 1);
        const anchorFootY = this.groundFootYAt(anchorX, currentFootY, anchorZ);
        if (anchorFootY === null) continue;
        if (Math.abs(anchorFootY - currentFootY) > MAX_CLIMB_UP + 0.7) continue;

        const anchorEye = this.eyeFromFoot(anchorX, anchorFootY, anchorZ);
        if (this.world.hasLineOfSight(anchorEye, targetEye)) continue;

        for (const peekSign of [-1, 1] as const) {
          const peekX = clamp(anchorX + side.x * peekSign * 1.15 - retreat.x * 0.35, 1, WORLD.sizeX - 1);
          const peekZ = clamp(anchorZ + side.z * peekSign * 1.15 - retreat.z * 0.35, 1, WORLD.sizeZ - 1);
          const peekFootY = this.groundFootYAt(peekX, anchorFootY, peekZ);
          if (peekFootY === null) continue;
          if (Math.abs(peekFootY - anchorFootY) > MAX_STEP_UP + 0.8) continue;

          const peekEye = this.eyeFromFoot(peekX, peekFootY, peekZ);
          if (!this.world.hasLineOfSight(peekEye, targetEye)) continue;

          const anchorDist = Math.sqrt((anchorX - me.pos.x) ** 2 + (anchorZ - me.pos.z) ** 2);
          const peekDist = Math.sqrt((peekX - target.pos.x) ** 2 + (peekZ - target.pos.z) ** 2);
          const score = 10 - anchorDist * 0.7 - Math.abs(lateral) * 0.25 - peekDist * 0.03;

          if (!best || score > best.score) {
            best = {
              score,
              cover: {
                anchorX,
                anchorZ,
                peekX,
                peekZ,
                targetIdentityHex: identityHex(target.identity),
                expiresAt: now + randomBetween(2600, 4200),
                phase: 'hide',
                phaseUntil: now + randomBetween(350, 780),
              },
            };
          }
        }
      }
    }

    return best?.cover ?? null;
  }

  private positionClear(x: number, footY: number, z: number): boolean {
    if (x < 1 || z < 1 || x >= WORLD.sizeX - 1 || z >= WORLD.sizeZ - 1) {
      return false;
    }

    const hw = BOT_HALF_WIDTH;
    const points = [
      [x, z],
      [x - hw, z - hw],
      [x + hw, z - hw],
      [x - hw, z + hw],
      [x + hw, z + hw],
    ] as const;

    for (const [sx, sz] of points) {
      for (let yOff = 0.2; yOff < 1.8; yOff += 0.45) {
        if (this.world.getBlock(sx, footY + yOff, sz) !== 0) {
          return false;
        }
      }
    }

    return true;
  }

  private groundFootYAt(x: number, referenceFootY: number, z: number): number | null {
    const hw = BOT_HALF_WIDTH;
    const points = [
      [x, z],
      [x - hw, z - hw],
      [x + hw, z - hw],
      [x - hw, z + hw],
      [x + hw, z + hw],
    ] as const;
    const scanStart = Math.min(WORLD.sizeY - 1, referenceFootY + MAX_CLIMB_UP + 2.5);

    let bestGround = -1;
    for (const [sx, sz] of points) {
      const ground = this.world.getGroundHeightBelow(sx, scanStart, sz);
      if (ground >= 0) {
        bestGround = Math.max(bestGround, ground + 1);
      }
    }

    if (bestGround < 0) {
      return null;
    }
    if (!this.positionClear(x, bestGround, z)) {
      return null;
    }
    return bestGround;
  }

  /** Scan from the top of the world to find the actual surface foot Y. */
  private findSurfaceFootY(x: number, z: number): number | null {
    const hw = BOT_HALF_WIDTH;
    const points = [
      [x, z],
      [x - hw, z - hw],
      [x + hw, z - hw],
      [x - hw, z + hw],
      [x + hw, z + hw],
    ] as const;

    let bestGround = -1;
    for (const [sx, sz] of points) {
      const ground = this.world.getGroundHeightBelow(sx, WORLD.sizeY - 1, sz);
      if (ground >= 0) {
        bestGround = Math.max(bestGround, ground + 1);
      }
    }

    if (bestGround < 0) return null;
    if (!this.positionClear(x, bestGround, z)) return null;
    return bestGround;
  }

  private shouldJumpObstacle(
    me: PlayerRow,
    dirX: number,
    dirZ: number,
    currentFootY: number,
    sprinting: boolean,
    now: number,
  ): boolean {
    if (now < this.jumpCooldownUntil) {
      return false;
    }

    const probeDist = BOT_HALF_WIDTH + 0.38;
    const lowProbeX = me.pos.x + dirX * probeDist;
    const lowProbeZ = me.pos.z + dirZ * probeDist;
    const lowBlocked =
      this.world.getBlock(lowProbeX, currentFootY + 0.45, lowProbeZ) !== 0 ||
      this.world.getBlock(lowProbeX, currentFootY + 0.9, lowProbeZ) !== 0;
    const headClear =
      this.world.getBlock(lowProbeX, currentFootY + 1.45, lowProbeZ) === 0 &&
      this.world.getBlock(lowProbeX, currentFootY + 1.78, lowProbeZ) === 0;

    if (!lowBlocked || !headClear) {
      return false;
    }

    const landingDist = sprinting ? 2.3 : 1.8;
    const landingX = clamp(me.pos.x + dirX * landingDist, 1, WORLD.sizeX - 1);
    const landingZ = clamp(me.pos.z + dirZ * landingDist, 1, WORLD.sizeZ - 1);
    const landingFootY = this.groundFootYAt(landingX, currentFootY + 1.6, landingZ);
    if (landingFootY === null) {
      return false;
    }

    return Math.abs(landingFootY - currentFootY) <= MAX_CLIMB_UP + 0.9;
  }

  private chooseTraversalDirection(
    me: PlayerRow,
    desired: { x: number; z: number; len: number },
    currentFootY: number,
    speed: number,
    dtSec: number,
    target: BotTarget | null,
    preferCover: boolean,
  ): { x: number; z: number } {
    if (desired.len <= 0.001) {
      return { x: 0, z: 0 };
    }

    const baseAngle = Math.atan2(desired.z, desired.x);
    const offsets = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4];
    const targetEye = target
      ? (target.kind === 'player' ? this.targetEye(target.player) : target.entity.pos)
      : null;
    let best: { score: number; x: number; z: number } | null = null;

    for (const offset of offsets) {
      const angle = baseAngle + offset;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      const probeX = clamp(me.pos.x + dirX * speed * dtSec, 1, WORLD.sizeX - 1);
      const probeZ = clamp(me.pos.z + dirZ * speed * dtSec, 1, WORLD.sizeZ - 1);
      const probeFootY = this.groundFootYAt(probeX, currentFootY, probeZ);
      if (probeFootY === null) continue;

      const rise = probeFootY - currentFootY;
      if (rise > MAX_CLIMB_UP + 0.8) continue;

      const lookX = clamp(me.pos.x + dirX * speed * dtSec * 2.0, 1, WORLD.sizeX - 1);
      const lookZ = clamp(me.pos.z + dirZ * speed * dtSec * 2.0, 1, WORLD.sizeZ - 1);
      const lookFootY = this.groundFootYAt(lookX, probeFootY, lookZ);

      let score = dirX * desired.x + dirZ * desired.z;
      score -= Math.abs(offset) * 0.08;
      score -= Math.max(0, rise - MAX_STEP_UP) * 0.15;
      if (lookFootY !== null && Math.abs(lookFootY - probeFootY) <= MAX_CLIMB_UP + 0.4) {
        score += 0.35;
      }

      if (targetEye) {
        const probeEye = this.eyeFromFoot(probeX, probeFootY, probeZ);
        const hasLos = this.world.hasLineOfSight(probeEye, targetEye);
        score += preferCover ? (hasLos ? -0.85 : 0.7) : (hasLos ? 0.22 : -0.14);
      }

      if (!best || score > best.score) {
        best = { score, x: dirX, z: dirZ };
      }
    }

    return best ?? { x: desired.x, z: desired.z };
  }

  private neuralNavigate(
    me: PlayerRow,
    navTarget: BotVec3,
    dtSec: number,
  ): { moveX: number; moveZ: number; sprinting: boolean; shouldJump: boolean } {
    // Track stagnation (how stuck the bot is)
    const dx = navTarget.x - me.pos.x;
    const dz = navTarget.z - me.pos.z;
    const distToTarget = Math.sqrt(dx * dx + dz * dz);

    if (
      this.navLastTargetX !== navTarget.x ||
      this.navLastTargetZ !== navTarget.z ||
      this.navInitialDist <= 0
    ) {
      this.navInitialDist = distToTarget;
      this.navPrevDist = distToTarget;
      this.navStagnationTimer = 0;
      this.navLastTargetX = navTarget.x;
      this.navLastTargetZ = navTarget.z;
    }

    if (distToTarget < this.navPrevDist - 0.25) {
      this.navStagnationTimer = 0;
      this.navPrevDist = distToTarget;
    } else {
      this.navStagnationTimer += dtSec;
    }

    // Weapon ammo (normalized, constant across sub-steps)
    const ammo: [number, number, number] = [
      this.normalizeAmmo(RIFLE_INDEX),
      this.normalizeAmmo(SHOTGUN_INDEX),
      this.normalizeAmmo(RPG_INDEX),
    ];
    const stagnation = Math.min(this.navStagnationTimer / 8, 1);

    const subSteps = Math.max(1, Math.round(dtSec / TRAINING_STEP_SEC));
    const subDt = dtSec / subSteps;
    const stepRatio = subDt / TRAINING_STEP_SEC;
    const simState = this.movementState?.clone() ?? BotMovementState.fromSnapshot(this.movementSnapshotFromPlayer(me));
    let moveX = 0;
    let moveZ = 0;
    let sprinting = false;
    let shouldJump = false;

    for (let step = 0; step < subSteps; step++) {
      const obs = buildObservation(this.world, {
        pos: simState.pos,
        vel: simState.velocity(),
        yaw: this.navYaw,
        pitch: this.navPitch,
        targetPos: navTarget,
        initialDistance: this.navInitialDist,
        onGround: simState.onGround,
        isClimbing: simState.isClimbing,
        isSprinting: simState.isSprinting,
        health: me.health,
        maxHealth: me.maxHealth,
        currentWeapon: this.selectedWeapon,
        stagnation,
        ammo,
        cooldowns: [0, 0, 0],
      });

      const action = this.neuralNav!.forward(obs);

      this.navYaw = angleWrap(this.navYaw + action.yawDelta * NAV_MAX_YAW_DELTA * stepRatio);
      this.navPitch = clamp(
        this.navPitch + action.pitchDelta * NAV_MAX_PITCH_DELTA * stepRatio,
        -Math.PI / 2 + 0.01,
        Math.PI / 2 - 0.01,
      );

      const sinN = Math.sin(this.navYaw);
      const cosN = Math.cos(this.navYaw);
      moveX = -sinN * action.forward + cosN * action.strafe;
      moveZ = -cosN * action.forward + -sinN * action.strafe;
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 0.001) { moveX /= len; moveZ /= len; }

      sprinting = action.sprint && action.forward > 0;
      shouldJump = action.jump;
      simState.step(subDt, { wishX: moveX, wishZ: moveZ, jump: action.jump, sprint: sprinting }, this.world);
    }

    return { moveX, moveZ, sprinting, shouldJump };
  }

  private normalizeAmmo(weapon: number): number {
    const max = Number(WEAPONS_CONFIG[weapon]?.maxAmmo ?? 1);
    return max > 0 ? this.getAmmoForWeapon(weapon) / max : 0;
  }

  private computeMovement(me: PlayerRow, target: BotTarget | null, now: number, dtSec: number): {
    nextPos: BotVec3;
    velocity: BotVec3;
    sprinting: boolean;
    grounded: boolean;
    climbing: boolean;
  } {
    const state = this.movementState;
    if (!state) {
      return {
        nextPos: { ...me.pos },
        velocity: { ...me.vel },
        sprinting: this.lastSprinting,
        grounded: this.lastGrounded,
        climbing: this.lastClimbing,
      };
    }

    if (!this.world.isColumnLoaded(state.pos.x, state.pos.z)) {
      return {
        nextPos: { ...state.pos },
        velocity: { x: 0, y: 0, z: 0 },
        sprinting: false,
        grounded: state.onGround,
        climbing: state.isClimbing,
      };
    }

    const earlyFootY = state.pos.y - BOT_EYE_HEIGHT;
    if (earlyFootY < MIN_SAFE_FOOT_Y) {
      const surfaceFootY = this.findSurfaceFootY(state.pos.x, state.pos.z);
      if (surfaceFootY !== null && surfaceFootY > earlyFootY) {
        state.setPosition({
          x: state.pos.x,
          y: clamp(surfaceFootY + BOT_EYE_HEIGHT, 0.5, WORLD.sizeY - 0.5),
          z: state.pos.z,
        });
        return {
          nextPos: { ...state.pos },
          velocity: state.velocity(),
          sprinting: false,
          grounded: true,
          climbing: false,
        };
      }
    }

    if (me.spawnProtected && now >= this.spawnRushUntil) {
      this.spawnRushUntil = now + SPAWN_RUSH_MS;
      this.moveDirective = this.chooseSpawnExitWaypoint(me, now);
    }
    if (!this.moveDirective || now >= this.moveDirective.expiresAt) {
      this.moveDirective = this.chooseWaypoint(now, me);
    }

    let desiredMoveX = 0;
    let desiredMoveZ = 0;
    let sprinting = false;
    let wantsJump = false;
    let desiredGoal: { x: number; z: number } | null = null;
    const playerTarget = target?.kind === 'player' ? target.player : null;
    const targetPos = target?.kind === 'player' ? target.player.pos : target?.entity.pos ?? null;
    const seekingCover = this.shouldSeekCover(me, playerTarget, now);

    if (target && targetPos && (target.kind !== 'player' || this.trackedTarget)) {
      const reactionReady = target.kind === 'vehicle' || (this.trackedTarget !== null && now >= this.trackedTarget.reactionReadyAt);
      this.refreshCoverDirective(me, playerTarget, now);
      const dx = targetPos.x - me.pos.x;
      const dz = targetPos.z - me.pos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      const toward = normalize2D(dx, dz);
      if (now >= this.strafeFlipAt) {
        this.strafeSign *= -1;
        this.strafeFlipAt = now + randomBetween(450, 1100);
      }

      if (this.coverDirective) {
        const anchorDx = this.coverDirective.anchorX - me.pos.x;
        const anchorDz = this.coverDirective.anchorZ - me.pos.z;
        if (Math.sqrt(anchorDx * anchorDx + anchorDz * anchorDz) > 1.4) {
          this.coverDirective.phase = 'hide';
        }
        const coverTarget =
          this.coverDirective.phase === 'peek'
            ? { x: this.coverDirective.peekX, z: this.coverDirective.peekZ }
            : { x: this.coverDirective.anchorX, z: this.coverDirective.anchorZ };
        desiredGoal = coverTarget;
        const coverDx = coverTarget.x - me.pos.x;
        const coverDz = coverTarget.z - me.pos.z;
        const coverDir = normalize2D(coverDx, coverDz);
        desiredMoveX = coverDir.x;
        desiredMoveZ = coverDir.z;
        sprinting = coverDir.len > 5.5 && this.coverDirective.phase === 'hide';
      } else if (!reactionReady) {
        desiredMoveX = -toward.z * this.strafeSign * 0.7 - toward.x * 0.15;
        desiredMoveZ = toward.x * this.strafeSign * 0.7 - toward.z * 0.15;
        desiredGoal = { x: me.pos.x - toward.x * 3, z: me.pos.z - toward.z * 3 };
      } else if (distance > IDEAL_RIFLE_RANGE + 10) {
        if (this.neuralNav) {
          // Use neural navigation to path toward distant target
          if (!this.usingNeuralThisTick) {
            this.navYaw = this.yaw;
            this.navPitch = this.pitch;
          }
          this.usingNeuralThisTick = true;
          const nav = this.neuralNavigate(me, { x: targetPos.x, y: targetPos.y, z: targetPos.z }, dtSec);
          desiredMoveX = nav.moveX;
          desiredMoveZ = nav.moveZ;
          sprinting = nav.sprinting;
          this.pendingNeuralJump = nav.shouldJump;
        } else {
          desiredMoveX = toward.x + toward.z * this.strafeSign * 0.55;
          desiredMoveZ = toward.z - toward.x * this.strafeSign * 0.55;
          sprinting = true;
        }
        desiredGoal = { x: targetPos.x, z: targetPos.z };
      } else if ((target.kind === 'player' && distance < IDEAL_RIFLE_RANGE - 6) || me.health <= PLAYER.maxHealth * 0.38) {
        desiredMoveX = -toward.x * 0.7 + toward.z * this.strafeSign * 0.95;
        desiredMoveZ = -toward.z * 0.7 - toward.x * this.strafeSign * 0.95;
        desiredGoal = { x: me.pos.x - toward.x * 6, z: me.pos.z - toward.z * 6 };
      } else {
        desiredMoveX = toward.z * this.strafeSign * 1.1 + toward.x * 0.22;
        desiredMoveZ = -toward.x * this.strafeSign * 1.1 + toward.z * 0.22;
        desiredGoal = { x: targetPos.x + toward.z * this.strafeSign * 5, z: targetPos.z - toward.x * this.strafeSign * 5 };
      }

      if (
        !this.coverDirective &&
        reactionReady &&
        distance > 12 &&
        distance < 34 &&
        Math.abs(me.vel.y) < 0.5 &&
        Math.random() < 0.01
      ) {
        if (now >= this.jumpCooldownUntil) {
          wantsJump = true;
          this.jumpCooldownUntil = now + JUMP_COOLDOWN_MS;
        }
      }
    } else if (this.neuralNav) {
      // ── Neural navigation ──
      this.coverDirective = null;
      if (!this.wasUsingNeural) {
        // Transitioning to neural nav: sync yaw + reset LSTM
        this.navYaw = this.yaw;
        this.navPitch = this.pitch;
        this.neuralNav?.resetState();
        this.navStagnationTimer = 0;
        this.navInitialDist = 0;
      }
      this.usingNeuralThisTick = true;
      const navTarget: BotVec3 = { x: this.moveDirective.x, y: me.pos.y, z: this.moveDirective.z };
      const nav = this.neuralNavigate(me, navTarget, dtSec);
      desiredMoveX = nav.moveX;
      desiredMoveZ = nav.moveZ;
      sprinting = nav.sprinting;
      this.pendingNeuralJump = nav.shouldJump;
      desiredGoal = { x: this.moveDirective.x, z: this.moveDirective.z };
      const goalDist = normalize2D(this.moveDirective.x - me.pos.x, this.moveDirective.z - me.pos.z).len;
      if (goalDist <= WAYPOINT_RADIUS) {
        this.moveDirective = this.chooseWaypoint(now, me);
      }
    } else {
      this.coverDirective = null;
      const goalDx = this.moveDirective.x - me.pos.x;
      const goalDz = this.moveDirective.z - me.pos.z;
      const goal = normalize2D(goalDx, goalDz);
      const roamStrafe = this.strafeSign * 0.2;
      desiredMoveX = goal.x + goal.z * roamStrafe;
      desiredMoveZ = goal.z - goal.x * roamStrafe;
      sprinting = goal.len > 10;
      desiredGoal = { x: this.moveDirective.x, z: this.moveDirective.z };
      if (goal.len <= WAYPOINT_RADIUS) {
        this.moveDirective = this.chooseWaypoint(now, me);
      }
    }

    if (now < this.forcedUnstickUntil && this.forcedUnstickDir) {
      desiredMoveX = this.forcedUnstickDir.x;
      desiredMoveZ = this.forcedUnstickDir.z;
      sprinting = true;
      desiredGoal = {
        x: clamp(me.pos.x + this.forcedUnstickDir.x * 8, 1, WORLD.sizeX - 1),
        z: clamp(me.pos.z + this.forcedUnstickDir.z * 8, 1, WORLD.sizeZ - 1),
      };
      // Override neural direction when stuck — let the fallback push us out
      if (this.usingNeuralThisTick) {
        this.usingNeuralThisTick = false;
      }
    } else if (this.forcedUnstickUntil !== 0) {
      this.forcedUnstickUntil = 0;
      this.forcedUnstickDir = null;
    }

    const move = normalize2D(desiredMoveX, desiredMoveZ);
    const currentFootY = state.pos.y - BOT_EYE_HEIGHT;
    if (this.pendingNeuralJump) {
      wantsJump = true;
    }
    this.pendingNeuralJump = false;

    const probeSpeed = sprinting ? 18 : 12;
    const steeredMove = this.usingNeuralThisTick || !state.onGround
      ? { x: move.x, z: move.z }
      : this.chooseTraversalDirection(me, move, currentFootY, probeSpeed, dtSec, target, seekingCover);

    if (
      !wantsJump &&
      state.onGround &&
      move.len > 0.001 &&
      now >= this.jumpCooldownUntil &&
      this.shouldJumpObstacle(me, steeredMove.x, steeredMove.z, currentFootY, sprinting, now)
    ) {
      wantsJump = true;
      this.jumpCooldownUntil = now + JUMP_COOLDOWN_MS;
    }

    const before = { ...state.pos };
    const step = state.step(
      dtSec,
      {
        wishX: steeredMove.x,
        wishZ: steeredMove.z,
        jump: wantsJump,
        sprint: sprinting,
      },
      this.world,
    );

    const horizontalMoved = Math.sqrt(
      (step.pos.x - before.x) * (step.pos.x - before.x) +
      (step.pos.z - before.z) * (step.pos.z - before.z),
    );
    const blocked =
      move.len > 0.001 &&
      step.grounded &&
      (step.collidedX || step.collidedZ) &&
      horizontalMoved < 0.05;

    if (blocked) {
      if (this.blockedSince === 0) {
        this.blockedSince = now;
      }

      if (
        step.grounded &&
        now - this.blockedSince >= 450 &&
        this.tryBreachObstacle(me, steeredMove.x, steeredMove.z, currentFootY, now)
      ) {
        this.blockedSince = now;
      }

      if (now - this.blockedSince >= STUCK_REPATH_MS) {
        const fallbackAngle = Math.atan2(steeredMove.z, steeredMove.x) + this.strafeSign * randomBetween(0.9, 1.4);
        this.forcedUnstickUntil = now + randomBetween(700, 1200);
        this.forcedUnstickDir = { x: Math.cos(fallbackAngle), z: Math.sin(fallbackAngle) };
        this.moveDirective = this.chooseWaypoint(now, me);
        this.coverDirective = null;
        this.strafeSign *= -1;
        this.blockedSince = now;
      }
    } else {
      this.blockedSince = 0;
    }

    if (desiredGoal && distSq(step.pos, { x: desiredGoal.x, y: step.pos.y, z: desiredGoal.z }) <= 1.4 * 1.4) {
      this.forcedUnstickUntil = 0;
      this.forcedUnstickDir = null;
    }

    return {
      nextPos: { ...step.pos },
      velocity: step.vel,
      sprinting: step.sprinting,
      grounded: step.grounded,
      climbing: step.climbing,
    };
  }

  // ── Vehicle seeking & piloting ──────────────────────────────────────────

  private vehicleTransform(
    entityId: number | bigint,
  ): { pos: BotVec3; vel: BotVec3; yaw: number; pitch: number } | null {
    const e = this.conn?.db.entity.id.find(entityId as any) as EntityRow | undefined;
    if (!e) return null;
    return {
      pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z },
      vel: { x: e.vel.x, y: e.vel.y, z: e.vel.z },
      yaw: e.rot.yaw,
      pitch: e.rot.pitch,
    };
  }

  private mountRangeFor(vehicleType: number): number {
    switch (vehicleType) {
      case VEHICLE_TYPE.HELICOPTER:
        return 8.0;
      case VEHICLE_TYPE.APC:
        return 5.5;
      default:
        return 6.5; // jet, anti-air
    }
  }

  private findSeekableVehicle(me: PlayerRow): { entityId: number | bigint; pos: BotVec3 } | null {
    if (!this.conn) return null;
    let best: { entityId: number | bigint; pos: BotVec3; d2: number } | null = null;
    for (const row of this.conn.db.vehicle.iter() as Iterable<any>) {
      const v = row as VehicleRow;
      if (v.pilotIdentity) continue; // only unoccupied → we become pilot
      if (Number(v.health ?? 0) <= 0) continue;
      const e = this.conn.db.entity.id.find(v.entityId as any) as EntityRow | undefined;
      if (!e || !e.active) continue;
      const dx = e.pos.x - me.pos.x;
      const dz = e.pos.z - me.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > VEHICLE_SEEK_RANGE * VEHICLE_SEEK_RANGE) continue;
      if (!best || d2 < best.d2) {
        best = { entityId: v.entityId, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z }, d2 };
      }
    }
    return best ? { entityId: best.entityId, pos: best.pos } : null;
  }

  /** Returns true while actively heading to mount a vehicle (suppress infantry combat). */
  private updateVehicleSeek(me: PlayerRow, now: number): boolean {
    if (!this.conn) return false;
    if (this.seekVehicleId === null && now >= this.nextVehicleSeekCheckAt) {
      this.nextVehicleSeekCheckAt = now + 1500;
      if (Math.random() < this.personality.vehicleAffinity) {
        const found = this.findSeekableVehicle(me);
        if (found) {
          this.seekVehicleId = found.entityId;
          this.seekAbortAt = now + 16000;
        }
      }
    }
    if (this.seekVehicleId === null) return false;

    const v = this.conn.db.vehicle.entityId.find(this.seekVehicleId as any) as VehicleRow | undefined;
    const e = v ? (this.conn.db.entity.id.find(this.seekVehicleId as any) as EntityRow | undefined) : undefined;
    if (!v || !e || v.pilotIdentity || Number(v.health ?? 0) <= 0 || now >= this.seekAbortAt) {
      this.seekVehicleId = null;
      return false;
    }
    const dist = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
    if (dist <= this.mountRangeFor(v.vehicleType) - 0.5) {
      void this.conn.reducers.interactVehicle({} as any).catch(() => {});
      this.seekVehicleId = null; // mounted next tick
      return true;
    }
    // Path toward the vehicle via the normal nav waypoint.
    this.moveDirective = { x: e.pos.x, z: e.pos.z, expiresAt: now + 4000 };
    return true;
  }

  private pickVehicleTarget(
    me: PlayerRow,
    vehicleType: number,
    vpos: BotVec3,
  ): { pos: BotVec3; isAir: boolean; player?: PlayerRow; vehicleEntityId?: number | bigint } | null {
    if (!this.conn) return null;
    const myMount = Number(me.mountedVehicleId ?? 0);
    const range = vehicleType === VEHICLE_TYPE.ANTI_AIR ? 200 : vehicleType === VEHICLE_TYPE.FIGHTER_JET ? 150 : 110;
    type Cand = {
      pos: BotVec3;
      isAir: boolean;
      score: number;
      player?: PlayerRow;
      vehicleEntityId?: number | bigint;
    };
    const cands: Cand[] = [];
    const consider = (
      pos: BotVec3,
      isAir: boolean,
      baseScore: number,
      player?: PlayerRow,
      vehicleEntityId?: number | bigint,
    ) => {
      const d = Math.hypot(pos.x - vpos.x, pos.y - vpos.y, pos.z - vpos.z);
      if (d > range) return;
      let score = baseScore - d * 0.02;
      if (vehicleType === VEHICLE_TYPE.ANTI_AIR && isAir) score += 100; // AA hunts aircraft
      cands.push({ pos, isAir, score, player, vehicleEntityId });
    };
    for (const p of this.listEnemies(me)) {
      if (Number(p.mountedVehicleId ?? 0) !== 0) continue;
      consider({ x: p.pos.x, y: p.pos.y + 0.2, z: p.pos.z }, false, 5, p);
    }
    for (const { vehicle, entity } of this.listVehicleTargets()) {
      if (Number(vehicle.entityId) === myMount) continue;
      const isAir =
        vehicle.vehicleType === VEHICLE_TYPE.HELICOPTER || vehicle.vehicleType === VEHICLE_TYPE.FIGHTER_JET;
      consider({ x: entity.pos.x, y: entity.pos.y, z: entity.pos.z }, isAir, isAir ? 7 : 5.5, undefined, vehicle.entityId);
    }
    if (cands.length === 0) return null;
    let best = cands[0]!;
    for (const c of cands) if (c.score > best.score) best = c;
    return { pos: best.pos, isAir: best.isAir, player: best.player, vehicleEntityId: best.vehicleEntityId };
  }

  private tickVehicle(me: PlayerRow, now: number, dtSec: number): void {
    const conn = this.conn;
    if (!conn) return;
    const v = conn.db.vehicle.entityId.find(me.mountedVehicleId as any) as VehicleRow | undefined;
    const tf = this.vehicleTransform(me.mountedVehicleId);
    if (!v || !tf) return;
    const amPilot = v.pilotIdentity ? identityHex(v.pilotIdentity) === this.identityHexValue : false;
    if (!amPilot) return; // passenger: just ride

    const vType = Number(v.vehicleType);
    const target = this.pickVehicleTarget(me, vType, tf.pos);
    if (target) this.vehicleNoTargetSince = 0;
    else if (this.vehicleNoTargetSince === 0) this.vehicleNoTargetSince = now;

    const lowHp = Number(v.health ?? 0) <= (VEHICLE_LOW_HP[vType] ?? 200);
    const bored = this.vehicleNoTargetSince !== 0 && now - this.vehicleNoTargetSince > 14000;
    if (lowHp || bored) {
      void conn.reducers.interactVehicle({} as any).catch(() => {});
      this.vehicleNoTargetSince = 0;
      return;
    }

    const ctrl = computeVehicleControl({
      type: vType,
      pos: tf.pos,
      vel: tf.vel,
      yaw: tf.yaw,
      pitch: tf.pitch,
      target: target ? target.pos : null,
      targetIsAir: target ? target.isAir : false,
      hasTarget: !!target,
      ammoPrimary: Number(v.weaponAmmoPrimary ?? 0),
      ammoSecondary: Number(v.weaponAmmoSecondary ?? 0),
      ammoTertiary: Number(v.weaponAmmoTertiary ?? 0),
      dt: dtSec,
    });

    this.vehicleInputSeq = Math.max(2, this.vehicleInputSeq + 1);
    void conn.reducers
      .updateVehicleInput({
        forward: ctrl.forward,
        strafe: ctrl.strafe,
        lift: ctrl.lift,
        yaw: ctrl.yaw,
        boosting: ctrl.boosting,
        inputSeq: this.vehicleInputSeq,
      } as any)
      .catch(() => {});

    // Aim the pilot's look at the target so the turret/weapon visually tracks
    // (server uses pilot look for aim; mounted pos is seat-locked server-side).
    // Rate-limit the swing so it isn't a robotic instant snap.
    if (ctrl.aimDir) {
      const desiredYaw = Math.atan2(-ctrl.aimDir.x, -ctrl.aimDir.z);
      const desiredPitch = clamp(Math.asin(clamp(ctrl.aimDir.y, -1, 1)), -1.45, 1.45);
      this.yaw = approachAngle(this.yaw, desiredYaw, VEHICLE_TURRET_RATE * dtSec);
      this.pitch = clamp(
        this.pitch + clamp(desiredPitch - this.pitch, -VEHICLE_TURRET_RATE * dtSec, VEHICLE_TURRET_RATE * dtSec),
        -1.45,
        1.45,
      );
    }
    this.sendPosition({
      pos: tf.pos,
      vel: tf.vel,
      rot: { yaw: this.yaw, pitch: this.pitch },
      weapon: this.selectedWeapon,
      movementFlags: buildPlayerMovementFlags({
        sprinting: false,
        crouching: false,
        sliding: false,
        climbing: false,
        grounded: true,
      }),
    });

    if (ctrl.weaponSlot !== Number(v.weaponType ?? 0) && now - this.lastVehicleSwitchAt > 250) {
      this.lastVehicleSwitchAt = now;
      void conn.reducers.switchVehicleWeapon({ weaponIndex: ctrl.weaponSlot } as any).catch(() => {});
    }
    const slotAmmo = [
      Number(v.weaponAmmoPrimary ?? 0),
      Number(v.weaponAmmoSecondary ?? 0),
      Number(v.weaponAmmoTertiary ?? 0),
    ];
    const curSlot = Number(v.weaponType ?? 0);
    if ((slotAmmo[curSlot] ?? 0) <= 0) {
      // Out of ammo on this slot — reload (server enforces the reload delay).
      if (now - this.lastVehicleReloadAt > 600) {
        this.lastVehicleReloadAt = now;
        void conn.reducers.reloadVehicleWeapon({} as any).catch(() => {});
      }
    } else if (ctrl.fire && ctrl.aimDir && target && now >= this.nextVehicleFireAt) {
      this.nextVehicleFireAt = now + (VEHICLE_FIRE_INTERVAL[vType] ?? 150);
      const hitPlayers = target.player ? [target.player.identity] : [];
      const hitVehicles = target.vehicleEntityId != null ? [BigInt(target.vehicleEntityId as any)] : [];
      void conn.reducers
        .fireVehicleWeapon({
          direction: { x: ctrl.aimDir.x, y: ctrl.aimDir.y, z: ctrl.aimDir.z },
          hitPlayers,
          hitVehicles,
          hitBlocks: [],
        } as any)
        .catch(() => {});
    }
  }

  private updateLook(me: PlayerRow, target: BotTarget | null, movement: BotVec3, dtSec: number): void {
    let desiredYaw = this.yaw;
    let desiredPitch = 0;

    if (target) {
      const aimPos = target.kind === 'player'
        ? { x: target.player.pos.x, y: target.player.pos.y - 0.1, z: target.player.pos.z }
        : { x: target.entity.pos.x, y: target.entity.pos.y + 0.7, z: target.entity.pos.z };
      const tx = aimPos.x - me.pos.x;
      const ty = aimPos.y - me.pos.y;
      const tz = aimPos.z - me.pos.z;
      const horiz = Math.max(0.001, Math.sqrt(tx * tx + tz * tz));
      desiredYaw = Math.atan2(-tx, -tz);
      desiredPitch = clamp(Math.atan2(ty, horiz), -1.0, 1.0);
    } else if (this.usingNeuralThisTick) {
      desiredYaw = this.navYaw;
      // The nav model rails its internal pitch to "stare at the ground" because
      // that maximizes raycast coverage of nearby terrain — great for navigation,
      // but it makes the avatar look robotic. The model still uses its full
      // navPitch for observations (see computeNeuralAction); here we only clamp
      // the *displayed* pitch to a natural near-level range. The bot isn't aiming
      // while navigating, so this is purely cosmetic and doesn't affect pathing.
      desiredPitch = clamp(this.navPitch + this.personality.pitchBias, -0.3, 0.22);
    } else if (Math.abs(movement.x) > 0.01 || Math.abs(movement.z) > 0.01) {
      desiredYaw = Math.atan2(-movement.x, -movement.z);
      desiredPitch = this.personality.pitchBias;
    }

    this.yaw = approachAngle(this.yaw, desiredYaw, this.personality.turnRate * dtSec);
    this.pitch = clamp(
      this.pitch + clamp(desiredPitch - this.pitch, -MAX_PITCH_RATE * dtSec, MAX_PITCH_RATE * dtSec),
      -1.0,
      1.0,
    );
  }

  private maybeFire(me: PlayerRow, target: BotTarget | null, weapon: number, now: number): void {
    const conn = this.conn;
    if (!conn || !target) return;
    if (target.kind === 'player' && (!this.trackedTarget || now < this.trackedTarget.reactionReadyAt)) return;
    if (now < this.nextFireAt || now < this.burstCooldownUntil) return;

    const earliestWeaponReadyAt = this.lastShotAt + this.weaponCooldownMs(weapon);
    if (now < earliestWeaponReadyAt) {
      this.nextFireAt = Math.max(this.nextFireAt, earliestWeaponReadyAt + randomBetween(8, 40));
      return;
    }

    const targetPos = target.kind === 'player'
      ? { x: target.player.pos.x, y: target.player.pos.y - 0.12, z: target.player.pos.z }
      : { x: target.entity.pos.x, y: target.entity.pos.y + 0.7, z: target.entity.pos.z };
    const targetVel = target.kind === 'player' ? target.player.vel : target.entity.vel;
    const toTarget = {
      x: targetPos.x - me.pos.x,
      y: targetPos.y - me.pos.y,
      z: targetPos.z - me.pos.z,
    };
    const distance = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z);
    const maxShootRange = target.kind === 'vehicle' ? 95 : TARGET_SHOOT_RANGE;
    if (distance > maxShootRange) return;

    const idealRange = this.idealRangeForWeapon(weapon, target.kind);
    const distanceOverIdeal = Math.max(0, distance - idealRange);
    const isPrecisionSingleShot =
      weapon === RIFLE_INDEX ||
      weapon === SNIPER_INDEX ||
      weapon === RPG_INDEX ||
      weapon === GRENADE_LAUNCHER_INDEX;

    const desired = normalize3D(toTarget.x, toTarget.y, toTarget.z);
    const currentLook = normalize3D(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const aimDot = desired.x * currentLook.x + desired.y * currentLook.y + desired.z * currentLook.z;
    const aimThreshold = weapon === SHOTGUN_INDEX ? 0.9 : weapon === MACHINE_GUN_INDEX ? 0.92 : 0.95;
    if (aimDot < aimThreshold) return;

    if (!this.world.hasLineOfSight(me.pos, targetPos)) return;

    if (this.burstShotsRemaining <= 0) {
      if (weapon === MACHINE_GUN_INDEX) {
        this.burstShotsRemaining = randomInt(6, 12);
      } else if (weapon === SNIPER_INDEX || weapon === RPG_INDEX || weapon === GRENADE_LAUNCHER_INDEX) {
        this.burstShotsRemaining = 1;
      } else if (weapon === SHOTGUN_INDEX) {
        this.burstShotsRemaining = randomInt(1, 2);
      } else {
        this.burstShotsRemaining = randomInt(this.personality.burstMin, this.personality.burstMax);
      }
    }

    const mySpeed = Math.sqrt(me.vel.x * me.vel.x + me.vel.z * me.vel.z);
    const targetSpeed = Math.sqrt(targetVel.x * targetVel.x + targetVel.z * targetVel.z);
    const targetTrackingPenalty = targetSpeed * (weapon === SNIPER_INDEX ? 0.07 : isPrecisionSingleShot ? 0.05 : 0.025);
    const distanceTrackingPenalty = isPrecisionSingleShot
      ? distanceOverIdeal * (weapon === SNIPER_INDEX ? 0.022 : 0.014)
      : distanceOverIdeal * 0.004;
    const motionPenalty = mySpeed * 0.02 + targetTrackingPenalty + distanceTrackingPenalty;
    const pressurePenalty = now < this.underFireUntil ? 0.015 : 0;
    let jitterScale = 0.022 + distance * 0.00078 + motionPenalty * 0.022 + pressurePenalty;
    if (weapon === SHOTGUN_INDEX) jitterScale += 0.03;
    if (weapon === RIFLE_INDEX) jitterScale *= 1.28;
    if (weapon === SNIPER_INDEX) jitterScale *= 1.95;
    if (weapon === RPG_INDEX || weapon === GRENADE_LAUNCHER_INDEX) jitterScale *= 1.18;
    const skipShotChance = clamp(
      0.1 +
      distance * 0.003 +
      motionPenalty * 0.1 +
      pressurePenalty * 4 +
      (isPrecisionSingleShot ? distanceOverIdeal * 0.006 : 0),
      0.08,
      weapon === SNIPER_INDEX ? 0.58 : 0.46,
    );
    if (Math.random() < skipShotChance) {
      this.nextFireAt = now + randomBetween(40, 150);
      return;
    }

    const jittered = normalize3D(
      desired.x + randomBetween(-jitterScale, jitterScale),
      desired.y + randomBetween(-jitterScale * 0.9, jitterScale * 0.9),
      desired.z + randomBetween(-jitterScale, jitterScale),
    );
    let hitChance = clamp(0.46 - distance * 0.0045 - motionPenalty * 0.13 - pressurePenalty * 2.5, 0.06, 0.42);
    if (weapon === RIFLE_INDEX) {
      hitChance = clamp(
        0.38 - distance * 0.005 - targetSpeed * 0.022 - distanceOverIdeal * 0.0045 - pressurePenalty * 2.8,
        0.05,
        0.28,
      );
    }
    if (weapon === SHOTGUN_INDEX) hitChance = clamp(0.7 - distance * 0.03 - motionPenalty * 0.08, 0.06, 0.55);
    if (weapon === MACHINE_GUN_INDEX) hitChance = clamp(0.34 - distance * 0.0026 - motionPenalty * 0.08, 0.06, 0.32);
    if (weapon === SNIPER_INDEX) {
      hitChance = clamp(
        0.34 - distance * 0.0024 - targetSpeed * 0.03 - distanceOverIdeal * 0.0065 - pressurePenalty * 3,
        0.03,
        0.22,
      );
    }
    if (weapon === RPG_INDEX || weapon === GRENADE_LAUNCHER_INDEX) {
      hitChance = clamp(
        0.28 - distance * 0.0012 - targetSpeed * 0.018 - distanceOverIdeal * 0.0025,
        0.05,
        0.22,
      );
    }
    const landedHit = Math.random() <= hitChance;
    const hitPlayers: any[] = target.kind === 'player' && landedHit ? [target.player.identity] : [];
    const hitVehicles: bigint[] = target.kind === 'vehicle' && landedHit && Math.random() <= (weapon === SHOTGUN_INDEX ? 0.12 : 0.88)
      ? [BigInt(target.vehicle.entityId as bigint | number)]
      : [];

    this.fireWeapon({
      origin: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
      direction: jittered,
      weapon,
      hitPlayers,
      hitVehicles,
      hitBlocks: [],
    });
    this.lastShotAt = now;

    if (WEAPONS_CONFIG[weapon]!.delivery === 'projectile') {
      const missOffsetScale = target.kind === 'vehicle' ? 4.0 : 3.2;
      const impactPos = landedHit
        ? (target.kind === 'player'
          ? { x: target.player.pos.x, y: target.player.pos.y, z: target.player.pos.z }
          : { x: target.entity.pos.x, y: target.entity.pos.y + 0.7, z: target.entity.pos.z })
        : {
          x: targetPos.x + randomBetween(-missOffsetScale, missOffsetScale),
          y: targetPos.y + randomBetween(-1.2, 1.8),
          z: targetPos.z + randomBetween(-missOffsetScale, missOffsetScale),
        };
      const projectileSpeed = Math.max(1, Number(WEAPONS_CONFIG[weapon]!.projectileSpeed ?? 0));
      this.sendProjectileImpact({
        shotOrigin: { x: me.pos.x, y: me.pos.y, z: me.pos.z },
        impactPos,
        direction: jittered,
        weapon,
        travelTimeMs: (distance / projectileSpeed) * 1000,
        hitPlayers,
        hitVehicles,
      });
    }

    this.burstShotsRemaining--;
    this.nextFireAt = now + this.weaponCooldownMs(weapon) + randomBetween(10, 85);
    if (this.burstShotsRemaining <= 0) {
      const cooldownMin = weapon === MACHINE_GUN_INDEX ? 420 : weapon === SNIPER_INDEX ? 700 : MIN_BURST_COOLDOWN_MS;
      const cooldownMax = weapon === MACHINE_GUN_INDEX ? 980 : weapon === SNIPER_INDEX ? 1300 : MAX_BURST_COOLDOWN_MS;
      this.burstCooldownUntil = now + randomBetween(cooldownMin, cooldownMax);
    }
  }

  private async tick(): Promise<void> {
    const conn = this.conn;
    const me = this.getSelf();
    if (!conn || !me) return;

    const tickStartedAt = performance.now();
    const now = Date.now();
    const actualDtMs = this.lastTickAt > 0 ? now - this.lastTickAt : this.options.tickMs;
    const dtSec = clamp(actualDtMs / 1000, 1 / 120, 0.25);
    this.lastTickAt = now;
    this.refreshWorldSubscription(false);

    try {
      if (me.health <= 0) {
        this.coverDirective = null;
        this.trackedTarget = null;
        this.movementState = null;
        this.sentMovementHistory = [];
        this.forcedUnstickUntil = 0;
        this.forcedUnstickDir = null;
        this.burstShotsRemaining = 0;
        this.nextFireAt = 0;
        // Reset neural nav state on death
        this.neuralNav?.resetState();
        this.navStagnationTimer = 0;
        this.navInitialDist = 0;
        this.usingNeuralThisTick = false;
        if (!this.pendingLoadout) {
          this.pendingLoadout = this.chooseRandomLoadout();
          void this.applyPendingLoadout();
        }
        if (this.respawnAt === 0) {
          this.respawnAt = now + RESPAWN_DELAY_MS;
        }
        if (now >= this.respawnAt) {
          this.sendRespawn();
          this.respawnAt = 0;
        }
        this.lastHealth = PLAYER.maxHealth;
        this.lastSpawnProtected = false;
        return;
      }
      this.respawnAt = 0;

      if (!this.isMatchActive()) {
        return;
      }

      this.syncCurrentLoadoutFromDb(me);
      this.syncMovementState(me);
      const self = this.getActiveSelf(me);

      // If mounted in a vehicle, run the vehicle pilot loop and skip infantry logic.
      if (Number(me.mountedVehicleId ?? 0) !== 0) {
        this.tickVehicle(me, now, dtSec);
        return;
      }

      if (me.spawnProtected && !this.lastSpawnProtected) {
        this.spawnRushUntil = now + SPAWN_RUSH_MS;
        this.moveDirective = this.chooseSpawnExitWaypoint(self, now);
        if (this.pendingLoadout) {
          void this.applyPendingLoadout();
        }
      }
      this.lastSpawnProtected = me.spawnProtected;

      if (me.health < this.lastHealth) {
        this.underFireUntil = now + randomBetween(1600, 2600);
        this.coverDirective = null;
        this.strafeFlipAt = now;
      }
      this.lastHealth = me.health;
      if (this.heardContact && now >= this.heardContact.expiresAt) {
        this.heardContact = null;
      }
      this.updateProgressState(self, now);

      this.usingNeuralThisTick = false;
      this.pendingNeuralJump = false;

      const seekingVehicle = this.updateVehicleSeek(self, now);
      const target = seekingVehicle ? null : this.getPreferredTarget(self, now);
      this.chooseWeaponForTarget(self, target);
      const movement = this.computeMovement(self, target, now, dtSec);
      const liveSelf = this.getActiveSelf(me);
      this.updateLook(liveSelf, target, movement.velocity, dtSec);
      this.maybeFire(liveSelf, target, this.selectedWeapon, now);

      // Track state for next neural observation
      this.lastGrounded = movement.grounded;
      this.lastClimbing = movement.climbing;
      this.lastSprinting = movement.sprinting;
      this.wasUsingNeural = this.usingNeuralThisTick;

      this.sendPosition({
        pos: movement.nextPos,
        vel: movement.velocity,
        rot: { yaw: this.yaw, pitch: this.pitch },
        weapon: this.selectedWeapon,
        movementFlags: buildPlayerMovementFlags({
          sprinting: movement.sprinting,
          crouching: false,
          sliding: false,
          climbing: movement.climbing,
          grounded: movement.grounded,
        }),
      });
    } finally {
      runtimeDiagnostics.recordTick(
        this.activeName,
        actualDtMs,
        this.options.tickMs,
        performance.now() - tickStartedAt,
      );
    }
  }
}
