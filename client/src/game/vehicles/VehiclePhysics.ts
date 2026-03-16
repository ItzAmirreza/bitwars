/**
 * VehiclePhysics.ts — Client-side vehicle physics + rewind-and-replay prediction.
 *
 * Ports the server's helicopter and fighter-jet tick functions to TypeScript
 * so the client can predict the local vehicle immediately on input.
 *
 * The prediction uses the Valve/Source Engine approach:
 *   1. Client runs physics locally on every input → immediate visual response
 *   2. Each input is tagged with a monotonic sequence number and stored
 *   3. The server stores the last received input_seq in the Vehicle table
 *   4. When a server Entity update arrives, the client:
 *      a. Reads the acknowledged input_seq from the Vehicle table
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
  WORLD,
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

/** Returns ground surface Y (block top) at the given XZ. */
export type GroundHeightFn = (x: number, z: number) => number;

// ── Helicopter physics (mirrors server/vehicles/helicopter.rs) ──

export function tickHelicopter(
  s: PhysicsState,
  input: PhysicsInput,
  gnd: GroundHeightFn,
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

  const ground = gnd(nx, nz);
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

  const ground = gnd(px, pz);
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

  const gndHeight = gnd(nx, nz);
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

// ── Input history entry ──

interface InputEntry {
  seq: number;
  input: PhysicsInput;
}

// ── Rewind-and-replay prediction ──

/** Max entries in the input history (safety cap). At 30Hz input rate and
 *  200ms RTT, unacked count is ~6.  64 covers extreme cases. */
const MAX_INPUT_HISTORY = 64;
/** Snap threshold — if replay result differs from current prediction by
 *  more than this, teleport instead of smoothing. */
const MAX_SMOOTH_DIST_SQ = 100; // 10 units
/** Position correction half-life.  2s is very slow — ~0.6% of movement
 *  per frame at 60fps.  Completely invisible but prevents unbounded drift. */
const POS_HALF_LIFE = 2.0;
/** Velocity correction half-life.  300ms converges in ~1s. */
const VEL_HALF_LIFE = 0.3;
/** Rotation correction half-life. */
const ROT_HALF_LIFE = 0.2;

export class VehiclePrediction {
  /** Current predicted state (the "head" of the prediction). */
  state: PhysicsState;
  /** State one tick before `state`, for sub-tick interpolation. */
  private prevState: PhysicsState;
  private vehicleType: number;
  private groundFn: GroundHeightFn;
  private accumulator = 0;

  /** Monotonic tick counter — incremented each time a physics tick runs.
   *  Used as the sequence number sent with vehicle inputs. */
  tickSeq = 0;
  /** Ring buffer of recent inputs, keyed by tickSeq. */
  private inputHistory: InputEntry[] = [];

  // Correction offsets (disabled for diagnostic — kept for re-enablement)
  private opx = 0; private opy = 0; private opz = 0;
  // @ts-ignore: kept for re-enablement
  private ovx = 0; private ovy = 0; private ovz = 0;
  // @ts-ignore: kept for re-enablement
  private oyaw = 0; private opitch = 0;

  // Debug
  private _lastDbg = 0;
  private _dbgFrame = 0;
  private _lastRenderPx = 0;

  constructor(
    vehicleType: number,
    initial: PhysicsState,
    groundFn: GroundHeightFn,
  ) {
    this.vehicleType = vehicleType;
    this.state = { ...initial };
    this.prevState = { ...initial };
    this.groundFn = groundFn;
  }

  /** Run physics forward by `delta` seconds using the given pilot input.
   *  Each physics tick increments `tickSeq` and stores the input in the
   *  history buffer for future replay.  Returns a sub-tick interpolated
   *  render state. */
  advance(delta: number, input: PhysicsInput): PhysicsState {
    this.accumulator += delta;

    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      this.tickSeq++;

      this.inputHistory.push({ seq: this.tickSeq, input: { ...input } });
      if (this.inputHistory.length > MAX_INPUT_HISTORY) {
        this.inputHistory.shift();
      }

      this.prevState = this.state;
      this.state = this.tick(this.state, input);
    }

    // ── Per-frame smooth correction ──
    // Apply stored offsets gradually each frame (not as 30Hz spikes).
    // Half-lives are very slow so individual corrections are invisible.

    // Position: 2s half-life — prevents unbounded drift
    const pd = 1 - Math.pow(0.5, delta / POS_HALF_LIFE);
    const pcx = this.opx * pd, pcy = this.opy * pd, pcz = this.opz * pd;
    this.state.px -= pcx;      this.prevState.px -= pcx;
    this.state.py -= pcy;      this.prevState.py -= pcy;
    this.state.pz -= pcz;      this.prevState.pz -= pcz;
    this.opx -= pcx; this.opy -= pcy; this.opz -= pcz;

    // Velocity: 300ms half-life — keeps trajectories aligned
    const vd = 1 - Math.pow(0.5, delta / VEL_HALF_LIFE);
    const vcx = this.ovx * vd, vcy = this.ovy * vd, vcz = this.ovz * vd;
    this.state.vx -= vcx;      this.prevState.vx -= vcx;
    this.state.vy -= vcy;      this.prevState.vy -= vcy;
    this.state.vz -= vcz;      this.prevState.vz -= vcz;
    this.ovx -= vcx; this.ovy -= vcy; this.ovz -= vcz;

    // Rotation: 200ms half-life — prevents heading drift
    const rd = 1 - Math.pow(0.5, delta / ROT_HALF_LIFE);
    const ryaw = this.oyaw * rd, rpitch = this.opitch * rd;
    this.state.yaw -= ryaw;     this.prevState.yaw -= ryaw;
    this.state.pitch -= rpitch;  this.prevState.pitch -= rpitch;
    this.oyaw -= ryaw; this.opitch -= rpitch;

    // Sub-tick interpolation for smooth rendering
    const alpha = this.accumulator / TICK_DT;
    const result = lerpState(this.prevState, this.state, alpha);

    // DEBUG
    this._dbgFrame++;
    if (this._dbgFrame % 30 === 0) {
      const dpx = result.px - this._lastRenderPx;
      const speed = Math.sqrt(result.vx ** 2 + result.vy ** 2 + result.vz ** 2);
      const posDrift = Math.sqrt(this.opx ** 2 + this.opy ** 2 + this.opz ** 2);
      console.log(`[RENDER] dpx=${dpx.toFixed(4)} px=${result.px.toFixed(2)} speed=${speed.toFixed(1)} posDrift=${posDrift.toFixed(2)} dt=${delta.toFixed(4)}`);
    }
    this._lastRenderPx = result.px;

    return result;
  }

  /** Rewind-and-replay reconciliation.
   *
   *  Called when the server's authoritative Entity update arrives.
   *  `ackedSeq` is the `input_seq` from the Vehicle table — the sequence
   *  number of the last input the server processed for this tick.
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
    // 1. Discard acknowledged inputs
    while (this.inputHistory.length > 0 && this.inputHistory[0].seq <= ackedSeq) {
      this.inputHistory.shift();
    }

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

    if (distSq > MAX_SMOOTH_DIST_SQ) {
      // Teleport — too far (respawn, map reset, major desync)
      this.prevState = replayPrev;
      this.state = replayState;
      return;
    }

    // DEBUG
    const dist = Math.sqrt(distSq);
    const now = performance.now();
    if (!this._lastDbg || now - this._lastDbg > 300) {
      this._lastDbg = now;
      const speed = Math.sqrt(this.state.vx ** 2 + this.state.vy ** 2 + this.state.vz ** 2);
      console.log(`[RECONCILE] replayed=${this.inputHistory.length} mismatch=${dist.toFixed(3)} speed=${speed.toFixed(1)} opx=${this.opx.toFixed(2)}`);
    }

    // 4. ACCUMULATE the offset (don't overwrite).
    //    The old offset is still decaying in advance().  The new mismatch
    //    is ADDED on top so both old and new corrections converge smoothly.
    //    advance() applies them per-frame via exponential decay.

    // Store the CURRENT mismatch as the offset for advance() to decay.
    // opx = how far the prediction is ahead of the replay.
    // advance() does: state.px -= opx * decay (pushes prediction toward replay).
    this.opx = this.state.px - replayState.px;
    this.opy = this.state.py - replayState.py;
    this.opz = this.state.pz - replayState.pz;

    // Velocity offset
    this.ovx = this.state.vx - replayState.vx;
    this.ovy = this.state.vy - replayState.vy;
    this.ovz = this.state.vz - replayState.vz;

    // Rotation offset (yaw with wrapping)
    let yawOfs = this.state.yaw - replayState.yaw;
    yawOfs -= Math.round(yawOfs / TAU) * TAU;
    this.oyaw = yawOfs;
    this.opitch = this.state.pitch - replayState.pitch;
  }

  /** Hard reset (mount transition). */
  reset(s: PhysicsState): void {
    this.state = { ...s };
    this.prevState = { ...s };
    this.accumulator = 0;
    this.tickSeq = 0;
    this.inputHistory = [];
    this.opx = this.opy = this.opz = 0;
    this.ovx = this.ovy = this.ovz = 0;
    this.oyaw = this.opitch = 0;
  }

  private tick(s: PhysicsState, input: PhysicsInput): PhysicsState {
    if (this.vehicleType === VEHICLE_TYPES.FighterJet) {
      return tickFighterJet(s, input, this.groundFn);
    }
    return tickHelicopter(s, input, this.groundFn);
  }
}

// ── Util ──

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
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


