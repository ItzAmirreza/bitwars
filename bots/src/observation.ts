/**
 * Builds the 106-dimensional observation vector that the navigation
 * neural network expects.  Matches the layout in
 * training/src-tauri/src/sim/environment.rs :: compute_observation().
 */

import { WORLD } from '../../client/src/shared-config.ts';
import type { WorldSnapshot, BotVec3 } from './world.ts';

const OBS_DIM = 106;
const NUM_RAYS = 48;
const RAY_MAX_DIST = 40;

// ── Public API ──

export interface ObservationInput {
  /** Eye position. */
  pos: BotVec3;
  /** World-space velocity from previous tick. */
  vel: BotVec3;
  /** Navigation yaw (model-internal, not display yaw). */
  yaw: number;
  /** Navigation pitch. */
  pitch: number;
  /** Where the bot is trying to reach. */
  targetPos: BotVec3;
  /** Horizontal distance to target when waypoint was first set. */
  initialDistance: number;
  onGround: boolean;
  isClimbing: boolean;
  isSprinting: boolean;
  health: number;
  maxHealth: number;
  currentWeapon: number;
  /** 0 = fresh, 1 = fully stuck. */
  stagnation: number;
  /** Normalized ammo per weapon slot [0-2], each in 0..1. */
  ammo: [number, number, number];
  /** Normalized cooldown per weapon slot [0-2], each in 0..1. */
  cooldowns: [number, number, number];
}

/** Reusable observation buffer (avoids per-tick allocation). */
const _obs = new Float32Array(OBS_DIM);

export function buildObservation(world: WorldSnapshot, s: ObservationInput): Float32Array {
  const obs = _obs;
  obs.fill(0);
  let i = 0;

  // ── [0–5] Target navigation ──
  const dx = s.targetPos.x - s.pos.x;
  const dy = s.targetPos.y - s.pos.y;
  const dz = s.targetPos.z - s.pos.z;
  const distHz = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const dist3d = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));

  const sinY = Math.sin(s.yaw);
  const cosY = Math.cos(s.yaw);
  const fwdX = -sinY;
  const fwdZ = -cosY;
  const rightX = cosY;
  const rightZ = -sinY;

  const tgtFwd = dx * fwdX + dz * fwdZ;
  const tgtRight = dx * rightX + dz * rightZ;
  const relYaw = Math.atan2(tgtRight, tgtFwd);
  const elev = Math.asin(clamp(dy / dist3d, -1, 1));

  obs[i++] = Math.sin(relYaw); // [0]
  obs[i++] = Math.cos(relYaw); // [1]
  obs[i++] = elev / (Math.PI / 2); // [2]
  obs[i++] = distHz / 50; // [3]
  obs[i++] = dy / 20; // [4]
  obs[i++] = s.initialDistance > 0.01 ? clamp(1 - distHz / s.initialDistance, -1, 1) : 0; // [5]

  // ── [6–8] Egocentric velocity ──
  obs[i++] = (s.vel.x * fwdX + s.vel.z * fwdZ) / 20; // [6] forward
  obs[i++] = (s.vel.x * rightX + s.vel.z * rightZ) / 20; // [7] lateral
  obs[i++] = s.vel.y / 20; // [8] vertical

  // ── [9–12] Time & state ──
  obs[i++] = 0.7; // [9] time remaining (bots have no timeout)
  obs[i++] = clamp(s.stagnation, 0, 1); // [10]
  obs[i++] = s.onGround ? 1 : 0; // [11]
  obs[i++] = Math.min(distHz / 50, 1); // [12]

  // ── [13–60] 48 raycasts ──
  const dirs = computeRayDirections(s.yaw, s.pitch);
  for (let r = 0; r < NUM_RAYS; r++) {
    const d = dirs[r]!;
    obs[i++] = castRay(world, s.pos.x, s.pos.y, s.pos.z, d[0], d[1], d[2]) / RAY_MAX_DIST;
  }

  // ── [61–87] 3×3×3 local terrain grid ──
  const px = Math.floor(s.pos.x);
  const py = Math.floor(s.pos.y - 0.5);
  const pz = Math.floor(s.pos.z);
  for (let dy2 = -1; dy2 <= 1; dy2++) {
    for (let dz2 = -1; dz2 <= 1; dz2++) {
      for (let dx2 = -1; dx2 <= 1; dx2++) {
        obs[i++] = world.getBlock(px + dx2, py + dy2, pz + dz2) !== 0 ? 1 : 0;
      }
    }
  }

  // ── [88–93] Weapon state ──
  obs[i++] = s.ammo[0]; // [88]
  obs[i++] = s.ammo[1]; // [89]
  obs[i++] = s.ammo[2]; // [90]
  obs[i++] = s.cooldowns[0]; // [91]
  obs[i++] = s.cooldowns[1]; // [92]
  obs[i++] = s.cooldowns[2]; // [93]

  // ── [94–99] Status ──
  obs[i++] = s.pitch / (Math.PI / 2); // [94]
  obs[i++] = s.isClimbing ? 1 : 0; // [95]
  obs[i++] = s.isSprinting ? 1 : 0; // [96]
  obs[i++] = s.health / s.maxHealth; // [97]
  obs[i++] = s.currentWeapon / Math.max(1, 2); // [98] 3 weapons → /2
  obs[i++] = 1 / 3; // [99] speed_mult / 3

  // [100–105] reserved (already zero)

  return obs;
}

// ── DDA raycasting (matches training/src-tauri/src/sim/environment.rs) ──

export function castRay(
  world: WorldSnapshot,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 0.0001) return RAY_MAX_DIST;
  dx /= len;
  dy /= len;
  dz /= len;

  let vx = Math.floor(ox);
  let vy = Math.floor(oy);
  let vz = Math.floor(oz);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx !== 0 ? (stepX > 0 ? vx + 1 - ox : ox - vx) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? vy + 1 - oy : oy - vy) / Math.abs(dy) : Infinity;
  let tMaxZ = dz !== 0 ? (stepZ > 0 ? vz + 1 - oz : oz - vz) / Math.abs(dz) : Infinity;

  let dist = 0;
  const worldX = WORLD.sizeX;
  const worldY = WORLD.sizeY;
  const worldZ = WORLD.sizeZ;

  while (dist < RAY_MAX_DIST) {
    if (vx < 0 || vy < 0 || vz < 0 || vx >= worldX || vy >= worldY || vz >= worldZ) {
      return RAY_MAX_DIST;
    }
    if (world.getBlock(vx, vy, vz) !== 0) {
      return Math.min(dist, RAY_MAX_DIST);
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        vx += stepX;
        dist = tMaxX;
        tMaxX += tDeltaX;
      } else {
        vz += stepZ;
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    } else if (tMaxY < tMaxZ) {
      vy += stepY;
      dist = tMaxY;
      tMaxY += tDeltaY;
    } else {
      vz += stepZ;
      dist = tMaxZ;
      tMaxZ += tDeltaZ;
    }
  }
  return RAY_MAX_DIST;
}

// ── Ray directions (matches training sim exactly) ──

type Dir3 = [number, number, number];

function computeRayDirections(yaw: number, pitch: number): Dir3[] {
  const dirs: Dir3[] = [];

  const makeDir = (yawOff: number, pitchOff: number): Dir3 => {
    const ty = yaw + yawOff;
    const tp = clamp(pitch + pitchOff, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    const cp = Math.cos(tp);
    return [-Math.sin(ty) * cp, -Math.sin(tp), -Math.cos(ty) * cp];
  };

  // 5 rings × 8 directions = 40 rays
  const pitches = [0, 0.52, -0.52, 1.05, -1.05];
  for (const p of pitches) {
    for (let k = 0; k < 8; k++) {
      dirs.push(makeDir(k * (Math.PI / 4), p));
    }
  }

  // Straight up / down = 2 rays
  dirs.push(makeDir(0, -1.45));
  dirs.push(makeDir(0, 1.45));

  // Forward-focused = 6 rays
  const fwd: [number, number][] = [
    [0, 0.15],
    [0, -0.15],
    [0.26, 0],
    [-0.26, 0],
    [0.26, 0.15],
    [-0.26, 0.15],
  ];
  for (const [yo, po] of fwd) {
    dirs.push(makeDir(yo, po));
  }

  return dirs; // 48 total
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
