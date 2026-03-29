/**
 * VehiclePhysics.ts — Client-side vehicle physics + rewind-and-replay prediction.
 *
 * Ports the server's helicopter and fighter-jet tick functions to TypeScript
 * so the client can predict the local vehicle immediately on input.
 *
 * The prediction uses the Valve/Source Engine approach:
 *   1. Client runs physics locally on every input → immediate visual response
 *   2. Each input is tagged with a monotonic sequence number and stored
 *   3. The server stores two sequence numbers in the Vehicle table:
 *      - input_seq: last received input packet
 *      - acked_input_seq: last input actually consumed by physics tick
 *   4. When a server Entity update arrives, the client:
 *      a. Reads acked_input_seq from the Vehicle table
 *      b. Discards inputs with seq ≤ acknowledged
 *      c. Starts from the server's authoritative state
 *      d. Replays all remaining unacknowledged inputs through local physics
 *      e. The result should be nearly identical to the current prediction
 *         (zero visible correction) because the physics match
 *
 * IMPORTANT: Every constant, blend rate, and integration step here MUST
 * match the corresponding Rust code in server/vehicles/helicopter.rs and
 * server/vehicles/fighter_jet.rs.
 */

import {
  VEHICLE_TYPES,
  VEHICLE_TICK_INTERVAL_MS,
  HELICOPTER,
  FIGHTER_JET,
  ANTI_AIR,
  WORLD,
  VEHICLE_BLOCK_COLLISION,
} from '../../shared-config';

// ── Shared constants ──

const TICK_DT = VEHICLE_TICK_INTERVAL_MS / 1000;
const WORLD_MIN_X = 2.0;
const WORLD_MAX_X = WORLD.sizeX - 2.0;
const WORLD_MIN_Z = 2.0;
const WORLD_MAX_Z = WORLD.sizeZ - 2.0;
const BOUNDS_BOUNCE = 0.2;
const PI = Math.PI;
const TAU = PI * 2;

// ── Types ──

export interface PhysicsState {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  pitch: number;
}

export interface PhysicsInput {
  forward: number;   // [-1, 1] for heli; [0, 1] throttle for jet
  strafe: number;    // [-1, 1]
  lift: number;      // [-1, 1]
  yaw: number;       // [-1, 1]
}

/** Returns ground surface Y (block top) at the given XZ, optionally capped below `maxY`. */
export type GroundHeightFn = (x: number, z: number, maxY?: number) => number;

/** Returns block type at integer coords (0 = air). */
export type BlockQueryFn = (x: number, y: number, z: number) => number;

/** Info about blocks collided during a physics tick. */
export interface BlockCollisionResult {
  count: number;
  /** Average position of hit blocks (for VFX). */
  cx: number; cy: number; cz: number;
}

// ── Helicopter physics (mirrors server/vehicles/helicopter.rs) ──

export function tickHelicopter(
  s: PhysicsState,
  input: PhysicsInput,
  gnd: GroundHeightFn,
  blockQuery?: BlockQueryFn,
  collisionOut?: BlockCollisionResult,
): PhysicsState {
  let { px, py, pz, vx, vy, vz, yaw, pitch } = s;

  const fwd = clamp(input.forward, -1, 1);
  const str = clamp(input.strafe, -1, 1);
  const lft = clamp(input.lift, -1, 1);
  const ywIn = clamp(input.yaw, -1, 1);

  const yawStep = ywIn * HELICOPTER.maxYawRate * TICK_DT;
  const targetPitch = -fwd * 0.25;
  const maxPitchStep = HELICOPTER.maxPitchRate * TICK_DT;
  const pitchStep = clamp(targetPitch - pitch, -maxPitchStep, maxPitchStep);
  pitch += pitchStep;

  const fwdSpeed = fwd * HELICOPTER.cruiseSpeed;
  const strSpeed = str * HELICOPTER.strafeSpeed;
  const lftSpeed = lft * HELICOPTER.liftSpeed;

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  const targetVx = fx * fwdSpeed + rx * strSpeed;
  const targetVz = fz * fwdSpeed + rz * strSpeed;
  const targetVy = lftSpeed;

  const hb = HELICOPTER.horizBlend;
  const vb = HELICOPTER.vertBlend;
  vx += (targetVx - vx) * hb;
  vz += (targetVz - vz) * hb;
  vy += (targetVy - vy) * vb;

  const drag = HELICOPTER.dragPiloted;
  vx *= drag;
  vz *= drag;

  yaw += yawStep;
  if (yaw > PI) yaw -= TAU;
  if (yaw < -PI) yaw += TAU;

  let nx = px + vx * TICK_DT;
  let ny = py + vy * TICK_DT;
  let nz = pz + vz * TICK_DT;

  if (nx < WORLD_MIN_X) { nx = WORLD_MIN_X; vx = Math.abs(vx) * BOUNDS_BOUNCE; }
  if (nx > WORLD_MAX_X) { nx = WORLD_MAX_X; vx = -Math.abs(vx) * BOUNDS_BOUNCE; }
  if (nz < WORLD_MIN_Z) { nz = WORLD_MIN_Z; vz = Math.abs(vz) * BOUNDS_BOUNCE; }
  if (nz > WORLD_MAX_Z) { nz = WORLD_MAX_Z; vz = -Math.abs(vz) * BOUNDS_BOUNCE; }

  // ── Block collision (BEFORE ground clamping) ──
  // Runs first so destroyed blocks don't push the vehicle upward via ground height.
  if (blockQuery) {
    const col = checkBlockCollision(
      nx, ny, nz,
      HELICOPTER.hitbox.halfX, HELICOPTER.hitbox.halfY, HELICOPTER.hitbox.halfZ,
      HELICOPTER.hitbox.centerY,
      vx, vy, vz,
      blockQuery,
    );
    if (col.count > 0) {
      const f = Math.pow(VEHICLE_BLOCK_COLLISION.speedRetainPerBlock, col.count);
      vx *= f; vy *= f; vz *= f;
      if (collisionOut) {
        collisionOut.count += col.count;
        collisionOut.cx = col.cx; collisionOut.cy = col.cy; collisionOut.cz = col.cz;
      }
    }
  }

  // ── Ground collision ──
  const ground = gnd(nx, nz, ny);
  const minAlt = ground + HELICOPTER.minAltitude;
  if (ny < minAlt) {
    ny = minAlt;
    if (vy < 0) vy *= -0.08;
  }
  if (ny > HELICOPTER.maxAltitude) {
    ny = HELICOPTER.maxAltitude;
    if (vy > 0) vy *= 0.15;
  }

  return { px: nx, py: ny, pz: nz, vx, vy, vz, yaw, pitch };
}

// ── Fighter Jet physics (mirrors server/vehicles/fighter_jet.rs) ──

export function tickFighterJet(
  s: PhysicsState,
  input: PhysicsInput,
  gnd: GroundHeightFn,
  blockQuery?: BlockQueryFn,
  collisionOut?: BlockCollisionResult,
): PhysicsState {
  let { px, py, pz, vx, vy, vz, yaw, pitch } = s;

  const throttle = Math.max(0, clamp(input.forward, -1, 1));
  const brake = Math.max(0, -clamp(input.forward, -1, 1));
  const ywIn = clamp(input.yaw, -1, 1);
  const pitchIn = clamp(input.lift, -1, 1);

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cosPitch = Math.cos(pitch);
  const forwardX = fx * cosPitch;
  const forwardY = Math.sin(pitch);
  const forwardZ = fz * cosPitch;

  let currentSpeed = Math.max(0,
    vx * forwardX + vy * forwardY + vz * forwardZ);

  let targetSpeed = currentSpeed;
  targetSpeed += throttle * FIGHTER_JET.acceleration * TICK_DT;
  targetSpeed -= brake * FIGHTER_JET.brakeDeceleration * TICK_DT;
  if (throttle < 0.1 && brake < 0.1) {
    targetSpeed -= FIGHTER_JET.idleDeceleration * TICK_DT;
  }
  targetSpeed = clamp(targetSpeed, 0, FIGHTER_JET.maxSpeed);

  const yawStep = ywIn * FIGHTER_JET.maxYawRate * TICK_DT;
  yaw += yawStep;
  if (yaw > PI) yaw -= TAU;
  if (yaw < -PI) yaw += TAU;

  const stallFactor = currentSpeed < FIGHTER_JET.stallSpeed
    ? Math.max(0, currentSpeed / FIGHTER_JET.stallSpeed)
    : 1.0;

  const ground = gnd(px, pz, py);
  const onGround = py < ground + FIGHTER_JET.minAltitude + 1.0;
  let pitchTarget: number;
  if (true /* has_pilot */) {
    pitchTarget = pitchIn * 0.7 * stallFactor;
  } else if (onGround || currentSpeed < 2.0) {
    pitchTarget = 0;
  } else {
    pitchTarget = 0.15;
  }
  const maxPitchStep = FIGHTER_JET.maxPitchRate * TICK_DT;
  const pitchStep = clamp(pitchTarget - pitch, -maxPitchStep, maxPitchStep);
  pitch += pitchStep;
  pitch = clamp(pitch, -1.0, 1.0);

  const newFx = -Math.sin(yaw);
  const newFz = -Math.cos(yaw);
  const newCosPitch = Math.cos(pitch);
  const newForwardX = newFx * newCosPitch;
  const newForwardY = Math.sin(pitch);
  const newForwardZ = newFz * newCosPitch;

  const blend = FIGHTER_JET.velocityBlend;
  const tVx = newForwardX * targetSpeed;
  const tVy = newForwardY * targetSpeed * stallFactor;
  const tVz = newForwardZ * targetSpeed;

  vx += (tVx - vx) * blend;
  vz += (tVz - vz) * blend;

  const lift = currentSpeed * FIGHTER_JET.liftFactor * stallFactor;
  const gravityPull = FIGHTER_JET.gravity * (1.0 - stallFactor * 0.7);
  vy += (tVy - vy) * blend;
  vy += (lift - gravityPull) * TICK_DT * 0.5;

  if (stallFactor < 0.5) {
    vy -= FIGHTER_JET.gravity * (1.0 - stallFactor) * TICK_DT;
  }

  const drag = FIGHTER_JET.dragPiloted;
  vx *= drag;
  vz *= drag;
  vy *= drag;

  let nx = px + vx * TICK_DT;
  let ny = py + vy * TICK_DT;
  let nz = pz + vz * TICK_DT;

  if (nx < WORLD_MIN_X) { nx = WORLD_MIN_X; vx = Math.abs(vx) * BOUNDS_BOUNCE; }
  if (nx > WORLD_MAX_X) { nx = WORLD_MAX_X; vx = -Math.abs(vx) * BOUNDS_BOUNCE; }
  if (nz < WORLD_MIN_Z) { nz = WORLD_MIN_Z; vz = Math.abs(vz) * BOUNDS_BOUNCE; }
  if (nz > WORLD_MAX_Z) { nz = WORLD_MAX_Z; vz = -Math.abs(vz) * BOUNDS_BOUNCE; }

  // ── Block collision (BEFORE ground clamping) ──
  // Runs first so destroyed blocks don't push the vehicle upward via ground height.
  if (blockQuery) {
    const col = checkBlockCollision(
      nx, ny, nz,
      FIGHTER_JET.hitbox.halfX, FIGHTER_JET.hitbox.halfY, FIGHTER_JET.hitbox.halfZ,
      FIGHTER_JET.hitbox.centerY,
      vx, vy, vz,
      blockQuery,
    );
    if (col.count > 0) {
      const f = Math.pow(VEHICLE_BLOCK_COLLISION.speedRetainPerBlock, col.count);
      vx *= f; vy *= f; vz *= f;
      if (collisionOut) {
        collisionOut.count += col.count;
        collisionOut.cx = col.cx; collisionOut.cy = col.cy; collisionOut.cz = col.cz;
      }
    }
  }

  // ── Ground collision ──
  const gndHeight = gnd(nx, nz, ny);
  const minAlt = gndHeight + FIGHTER_JET.minAltitude;
  if (ny < minAlt) {
    ny = minAlt;
    if (vy < 0) vy *= -0.05;
  }
  if (ny <= minAlt + 0.5 && currentSpeed < FIGHTER_JET.stallSpeed) {
    vy = 0;
  }
  if (ny > FIGHTER_JET.maxAltitude) {
    ny = FIGHTER_JET.maxAltitude;
    if (vy > 0) vy *= 0.1;
  }

  return { px: nx, py: ny, pz: nz, vx, vy, vz, yaw, pitch };
}

// ── Anti-Air physics (mirrors server/vehicles/anti_air.rs) ──

export function tickAntiAir(
  s: PhysicsState,
  input: PhysicsInput,
  gnd: GroundHeightFn,
): PhysicsState {
  let { px, py, pz, vx, vy, vz, yaw } = s;

  const fwd = clamp(input.forward, -1, 1);
  const str = clamp(input.strafe, -1, 1);
  const ywIn = clamp(input.yaw, -1, 1);

  // Hull yaw
  const yawStep = ywIn * ANTI_AIR.maxYawRate * TICK_DT;
  yaw += yawStep;
  if (yaw > PI) yaw -= TAU;
  if (yaw < -PI) yaw += TAU;

  // Velocity
  const fwdSpeed = fwd * ANTI_AIR.cruiseSpeed;
  const strSpeed = str * ANTI_AIR.strafeSpeed;

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  const targetVx = fx * fwdSpeed + rx * strSpeed;
  const targetVz = fz * fwdSpeed + rz * strSpeed;

  const hb = ANTI_AIR.horizBlend;
  vx += (targetVx - vx) * hb;
  vz += (targetVz - vz) * hb;

  const drag = ANTI_AIR.dragPiloted;
  vx *= drag;
  vz *= drag;

  let nx = px + vx * TICK_DT;
  let ny = py + vy * TICK_DT;
  let nz = pz + vz * TICK_DT;

  // World bounds
  const BB = 0.1;
  if (nx < WORLD_MIN_X) { nx = WORLD_MIN_X; vx = Math.abs(vx) * BB; }
  if (nx > WORLD_MAX_X) { nx = WORLD_MAX_X; vx = -Math.abs(vx) * BB; }
  if (nz < WORLD_MIN_Z) { nz = WORLD_MIN_Z; vz = Math.abs(vz) * BB; }
  if (nz > WORLD_MAX_Z) { nz = WORLD_MAX_Z; vz = -Math.abs(vz) * BB; }

  // Ground snapping: stationary emplacement stays exactly on terrain.
  // `gnd` already matches server AA semantics (surface + 1).
  const ground = gnd(nx, nz) + ANTI_AIR.minAltitude;
  ny = ground;
  vy = 0;

  // pitch stays 0 (ground vehicle)
  return { px: nx, py: ny, pz: nz, vx, vy, vz, yaw, pitch: 0 };
}

// ── Input history entry ──

interface InputEntry {
  seq: number;
  input: PhysicsInput;
}

// ── Rewind-and-replay prediction ──

/** Max entries in the input history (safety cap). */
const MAX_INPUT_HISTORY = 256;
/** Snap threshold — if replay result differs from current prediction by
 *  more than this, teleport instead of smoothing. */
const MAX_SMOOTH_DIST_SQ = 100; // 10 units
/** Ignore tiny positional mismatches to avoid correction chatter. */
const EPSILON_DIST_SQ = 0.25; // 0.5u
/** Position correction half-life for render-only offsets. */
const POS_HALF_LIFE = 0.25;
/** Velocity correction half-life for render-only offsets. */
const VEL_HALF_LIFE = 0.3;
/** Rotation correction half-life for render-only offsets. */
const ROT_HALF_LIFE = 0.15;

export class VehiclePrediction {
  /** Current predicted state (the "head" of the prediction). */
  state: PhysicsState;
  /** State one tick before `state`, for sub-tick interpolation. */
  private prevState: PhysicsState;
  private vehicleType: number;
  private groundFn: GroundHeightFn;
  private blockQueryFn: BlockQueryFn | undefined;
  private accumulator = 0;

  /** Collision info from the most recent advance() call. */
  lastCollision: BlockCollisionResult = { count: 0, cx: 0, cy: 0, cz: 0 };

  /** Ring buffer of recent sent inputs, keyed by packet sequence. */
  private inputHistory: InputEntry[] = [];

  // Render-only correction offsets. These MUST NOT mutate simulation state.
  // They are only applied to the final interpolated render pose.
  private opx = 0; private opy = 0; private opz = 0;
  private ovx = 0; private ovy = 0; private ovz = 0;
  private oyaw = 0; private opitch = 0;

  discardAckedInputs(ackedSeq: number): void {
    while (this.inputHistory.length > 0 && this.inputHistory[0].seq <= ackedSeq) {
      this.inputHistory.shift();
    }
  }

  constructor(
    vehicleType: number,
    initial: PhysicsState,
    groundFn: GroundHeightFn,
    blockQueryFn?: BlockQueryFn,
  ) {
    this.vehicleType = vehicleType;
    this.state = { ...initial };
    this.prevState = { ...initial };
    this.groundFn = groundFn;
    this.blockQueryFn = blockQueryFn;
  }

  /** Run physics forward by `delta` seconds using the latest pilot input.
   *  Returns a sub-tick interpolated render state with render-only correction
   *  offsets applied. */
  advance(
    delta: number,
    input: PhysicsInput,
    onTick?: (input: PhysicsInput) => number,
  ): PhysicsState {
    this.lastCollision.count = 0;
    this.accumulator += delta;

    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;

      const seq = onTick ? onTick(input) : 0;
      this.inputHistory.push({ seq, input: { ...input } });
      if (this.inputHistory.length > MAX_INPUT_HISTORY) {
        this.inputHistory.shift();
      }

      this.prevState = this.state;
      this.state = this.tick(this.state, input, this.lastCollision);
    }

    // ── Per-frame smooth correction decay (render-only) ──
    // Decay stored render offsets gradually. Simulation state is untouched.

    const pd = 1 - Math.pow(0.5, delta / POS_HALF_LIFE);
    this.opx -= this.opx * pd;
    this.opy -= this.opy * pd;
    this.opz -= this.opz * pd;

    const vd = 1 - Math.pow(0.5, delta / VEL_HALF_LIFE);
    this.ovx -= this.ovx * vd;
    this.ovy -= this.ovy * vd;
    this.ovz -= this.ovz * vd;

    const rd = 1 - Math.pow(0.5, delta / ROT_HALF_LIFE);
    this.oyaw -= this.oyaw * rd;
    this.opitch -= this.opitch * rd;

    // Sub-tick interpolation from untouched simulation states
    const alpha = this.accumulator / TICK_DT;
    const result = lerpState(this.prevState, this.state, alpha);

    // Apply render-only offsets after interpolation
    result.px += this.opx;
    result.py += this.opy;
    result.pz += this.opz;
    result.vx += this.ovx;
    result.vy += this.ovy;
    result.vz += this.ovz;
    result.yaw += this.oyaw;
    result.pitch += this.opitch;

    return result;
  }

  /** Rewind-and-replay reconciliation.
   *
   *  Called when the server's authoritative Entity update arrives.
   *  `ackedSeq` is `acked_input_seq` from the Vehicle table — the sequence
   *  number of the last input packet actually consumed by server physics.
   *
   *  Steps:
   *  1. Discard all inputs with seq ≤ ackedSeq (server has processed them)
   *  2. Starting from the server's authoritative state, replay all
   *     remaining unacknowledged inputs through the local physics
   *  3. The result should match our current prediction almost exactly
   *     (because the physics are identical).  Any tiny difference is
   *     absorbed by the visual offset for smooth rendering.
   */
  reconcile(server: PhysicsState, ackedSeq: number): void {
    const before = { ...this.state };

    // 1. Discard acknowledged inputs
    this.discardAckedInputs(ackedSeq);

    // 2. Replay unacknowledged inputs from the server's authoritative state
    let replayState = { ...server };
    let replayPrev = { ...server };
    for (const entry of this.inputHistory) {
      replayPrev = replayState;
      replayState = this.tick(replayState, entry.input);
    }

    // 3. Compare replay to current prediction
    const dx = replayState.px - this.state.px;
    const dy = replayState.py - this.state.py;
    const dz = replayState.pz - this.state.pz;
    const distSq = dx * dx + dy * dy + dz * dz;

    if (distSq <= EPSILON_DIST_SQ) {
      // Tiny mismatch: snap sim state to replay and clear visual offsets to
      // avoid sub-unit correction chatter.
      this.prevState = replayPrev;
      this.state = replayState;
      this.opx = this.opy = this.opz = 0;
      this.ovx = this.ovy = this.ovz = 0;
      this.oyaw = this.opitch = 0;
      return;
    }

    if (distSq > MAX_SMOOTH_DIST_SQ) {
      // Teleport — too far (respawn, map reset, major desync)
      this.prevState = replayPrev;
      this.state = replayState;
      this.opx = this.opy = this.opz = 0;
      this.ovx = this.ovy = this.ovz = 0;
      this.oyaw = this.opitch = 0;
      return;
    }

    // 4. Adopt replay as simulation truth; preserve visual continuity via
    // render-only offsets from previous sim to replayed sim.
    this.prevState = replayPrev;
    this.state = replayState;

    this.opx = before.px - replayState.px;
    this.opy = before.py - replayState.py;
    this.opz = before.pz - replayState.pz;

    this.ovx = before.vx - replayState.vx;
    this.ovy = before.vy - replayState.vy;
    this.ovz = before.vz - replayState.vz;

    // Rotation offset (yaw with wrapping)
    let yawOfs = before.yaw - replayState.yaw;
    yawOfs -= Math.round(yawOfs / TAU) * TAU;
    this.oyaw = yawOfs;
    this.opitch = before.pitch - replayState.pitch;
  }

  /** Hard reset (mount transition). */
  reset(s: PhysicsState): void {
    this.state = { ...s };
    this.prevState = { ...s };
    this.accumulator = 0;
    this.inputHistory = [];
    this.opx = this.opy = this.opz = 0;
    this.ovx = this.ovy = this.ovz = 0;
    this.oyaw = this.opitch = 0;
  }

  private tick(s: PhysicsState, input: PhysicsInput, collisionOut?: BlockCollisionResult): PhysicsState {
    if (this.vehicleType === VEHICLE_TYPES.FighterJet) {
      return tickFighterJet(s, input, this.groundFn, this.blockQueryFn, collisionOut);
    }
    if (this.vehicleType === VEHICLE_TYPES.AntiAir) {
      return tickAntiAir(s, input, this.groundFn);
    }
    return tickHelicopter(s, input, this.groundFn, this.blockQueryFn, collisionOut);
  }
}

// ── Util ──

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Check blocks overlapping a vehicle collision volume. Mirrors server collision.rs. */
function checkBlockCollision(
  px: number, py: number, pz: number,
  halfX: number, halfY: number, halfZ: number,
  centerYOffset: number,
  vx: number, vy: number, vz: number,
  blockQuery: BlockQueryFn,
): { count: number; cx: number; cy: number; cz: number } {
  const speedSq = vx * vx + vy * vy + vz * vz;
  const minSpeed = VEHICLE_BLOCK_COLLISION.minSpeedToCollide;
  if (speedSq < minSpeed * minSpeed) return { count: 0, cx: 0, cy: 0, cz: 0 };
  const speed = Math.sqrt(speedSq);

  const scale = VEHICLE_BLOCK_COLLISION.collisionHitboxScale;
  const hx = halfX * scale;
  const hy = halfY * scale;
  const hz = halfZ * scale;
  const cy = py + centerYOffset;

  const minX = Math.floor(px - hx);
  const maxX = Math.ceil(px + hx);
  const minY = Math.floor(cy - hy);
  const maxY = Math.ceil(cy + hy);
  const minZ = Math.floor(pz - hz);
  const maxZ = Math.ceil(pz + hz);

  let count = 0;
  let sumX = 0, sumY = 0, sumZ = 0;
  const maxBlocks = getEffectiveMaxDestroyedBlocks(speed);

  for (let bx = minX; bx <= maxX; bx++) {
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        if (count >= maxBlocks) break;
        const bt = blockQuery(bx, by, bz);
        // 0 = air, 15 = bedrock — skip both
        if (bt !== 0 && bt !== 15) {
          count++;
          sumX += bx; sumY += by; sumZ += bz;
        }
      }
    }
  }

  if (count === 0) return { count: 0, cx: 0, cy: 0, cz: 0 };
  return { count, cx: sumX / count + 0.5, cy: sumY / count + 0.5, cz: sumZ / count + 0.5 };
}

function getEffectiveMaxDestroyedBlocks(speed: number): number {
  const maxBlocks = VEHICLE_BLOCK_COLLISION.maxBlocksPerTick;
  if (maxBlocks <= 1) return maxBlocks;

  const minSpeed = VEHICLE_BLOCK_COLLISION.minSpeedToCollide;
  const referenceSpeed = Math.max(VEHICLE_BLOCK_COLLISION.speedDestroyReference, minSpeed + 0.001);
  const minFraction = clamp(VEHICLE_BLOCK_COLLISION.minDestroyFraction, 0, 1);
  const t = clamp((speed - minSpeed) / (referenceSpeed - minSpeed), 0, 1);
  const fraction = minFraction + (1 - minFraction) * t;
  return Math.max(1, Math.round(maxBlocks * fraction));
}

function lerpState(a: PhysicsState, b: PhysicsState, t: number): PhysicsState {
  let dyaw = b.yaw - a.yaw;
  dyaw -= Math.round(dyaw / TAU) * TAU;
  return {
    px: a.px + (b.px - a.px) * t,
    py: a.py + (b.py - a.py) * t,
    pz: a.pz + (b.pz - a.pz) * t,
    vx: a.vx + (b.vx - a.vx) * t,
    vy: a.vy + (b.vy - a.vy) * t,
    vz: a.vz + (b.vz - a.vz) * t,
    yaw: a.yaw + dyaw * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
  };
}
