import * as THREE from 'three';
import type { VoxelWorld } from './VoxelWorld';
import type { AudioSystem } from './AudioSystem';
import {
  type FallingBlock,
  type SettledDebris,
  type BlockSettleParams,
  getBlockMat,
  type FallingBlockPool,
  MAX_FALLING,
  SETTLED_DEBRIS_LIFETIME_MS,
} from './PhysicsTypes';

// ── Blast Occlusion ──

export function applyBlastOcclusion(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  scale: number,
): { x: number; y: number; z: number } {
  let xDir = dirX;
  let yDir = dirY;
  let zDir = dirZ;
  const probe = Math.max(0.28, 0.52 * scale);
  const cellY = Math.floor(y);

  if (Math.abs(xDir) > 0.01) {
    const tx = Math.floor(x + Math.sign(xDir) * probe);
    if (world.getBlock(tx, cellY, Math.floor(z)) !== 0) xDir = -xDir * 0.55;
  }
  if (Math.abs(zDir) > 0.01) {
    const tz = Math.floor(z + Math.sign(zDir) * probe);
    if (world.getBlock(Math.floor(x), cellY, tz) !== 0) zDir = -zDir * 0.55;
  }

  if (yDir > 0.01) {
    const ty = Math.floor(y + probe);
    if (world.getBlock(Math.floor(x), ty, Math.floor(z)) !== 0) yDir = -yDir * 0.45;
  } else if (yDir < -0.01) {
    const ty = Math.floor(y - probe);
    if (world.getBlock(Math.floor(x), ty, Math.floor(z)) !== 0) yDir *= 0.25;
  }

  const len = Math.hypot(xDir, yDir, zDir);
  if (len < 0.001) return { x: 0, y: 0.08, z: 0 };
  return { x: xDir / len, y: yDir / len, z: zDir / len };
}

// How exposed a block is to open air at the moment the blast hits. Blocks still
// embedded in intact structure (lots of solid neighbours) resist the shockwave;
// blocks floating in the freshly-blown cavity (all-air neighbours) fly free. This
// is what makes sheltered blocks barely budge while exposed faces get hurled, and
// lets tightly-packed groups shove off together instead of each block flying alike.
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

function blastExposure(world: VoxelWorld, x: number, y: number, z: number): number {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  let solid = 0;
  for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
    const o = NEIGHBOR_OFFSETS[i];
    if (world.getBlock(bx + o[0], by + o[1], bz + o[2]) !== 0) solid++;
  }
  // 0 solid neighbours -> 1.0 (fully exposed); 6 solid -> 0.38 (buried/sheltered).
  return 1 - (solid / NEIGHBOR_OFFSETS.length) * 0.62;
}

// Derive a block's launch direction from the blast geometry: it flies straight out
// along the vector from the explosion origin (the hit point) through the block, so
// debris radiates outward in 3D rather than all rising on a hidden uniform force.
function shapeExplosionDirection(
  world: VoxelWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  dist: number,
  radius: number,
  proximity: number,
  exposure: number,
  scale: number,
): { x: number; y: number; z: number } {
  let radialX = dx / dist;
  let radialY = dy / dist;
  let radialZ = dz / dist;

  // Modest upward bias so debris arcs instead of skidding along the ground. It is
  // strongest for blocks at or below the blast height and fades to nothing for
  // blocks already above it, so the cloud never launches uniformly straight up.
  const heightRatio = THREE.MathUtils.clamp(dy / Math.max(1, radius), -1, 1);
  radialY += 0.16 * proximity * THREE.MathUtils.clamp(0.55 - heightRatio, 0, 1.1);

  // Per-block angular jitter so no two fragments move identically. Exposed blocks
  // scatter widely; clumped/buried blocks keep a tight cone and break off as a
  // chunk. Close-in blocks punch cleaner; distant ones spray more.
  const spread = THREE.MathUtils.lerp(0.12, 0.5, exposure) * (1.15 - proximity * 0.45);
  radialX += (Math.random() - 0.5) * spread;
  radialY += (Math.random() - 0.5) * spread * 0.8;
  radialZ += (Math.random() - 0.5) * spread;

  // Deflect along the surface if the blast would shove the block straight into rock.
  return applyBlastOcclusion(world, x, y, z, radialX, radialY, radialZ, scale);
}

function sampleExplosionBlocks<T>(blocks: T[], maxSpawn: number): T[] {
  if (blocks.length <= maxSpawn) return blocks;

  const sampled: T[] = [];
  const step = blocks.length / maxSpawn;
  let cursor = Math.random() * step;

  for (let i = 0; i < maxSpawn; i++) {
    sampled.push(blocks[Math.min(blocks.length - 1, Math.floor(cursor))]);
    cursor += step;
  }

  return sampled;
}

function configureDebrisPhysics(fb: FallingBlock, blastIntensity: number): void {
  const mat = getBlockMat(fb.blockType);
  const scaleFactor = THREE.MathUtils.clamp(fb.scale, 0.18, 1);
  const normalizedScale = (scaleFactor - 0.18) / 0.82;
  const dragTightness = THREE.MathUtils.lerp(0.92, 0.985, normalizedScale);
  const weightBias = THREE.MathUtils.clamp((mat.weight - 1) / 4, 0, 1);

  fb.airDrag = THREE.MathUtils.clamp(dragTightness + weightBias * 0.008, 0.9, 0.992);
  fb.restitution = THREE.MathUtils.clamp(
    THREE.MathUtils.lerp(0.08, 0.2, normalizedScale) * (1.05 - mat.friction * 0.35),
    0.06,
    0.2,
  );
  fb.maxBounces = fb.scale >= 0.82 ? 1 : 0;
  fb.impactCount = 0;
  fb.lifetimeMs = Math.round(THREE.MathUtils.lerp(1800, 5200, normalizedScale) * (0.9 + blastIntensity * 0.08));
}

// ── Settle Event Spawning ──

/// Spawn server-authoritative settling blocks. Each block drops straight down to
/// the `toYs[i]` cell the server has committed it to; the descent is purely
/// cosmetic (slight tumble), so the landing position is identical for everyone.
export function spawnSettleBlocks(
  params: BlockSettleParams,
  falling: FallingBlock[],
  pool: FallingBlockPool,
  audio: AudioSystem,
): void {
  const { xs, zs, fromYs, toYs, blockTypes } = params;

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  const count = Math.min(xs.length, MAX_FALLING - falling.length);

  for (let i = 0; i < count; i++) {
    const bx = xs[i];
    const fromY = fromYs[i];
    const bz = zs[i];
    const bt = blockTypes[i];

    const fb = pool.acquire(bt, bx, fromY, bz);
    fb.settling = true;
    fb.targetY = toYs[i];
    fb.scale = 1;
    fb.canSettle = false;
    fb.vx = 0;
    fb.vy = 0;
    fb.vz = 0;
    // A gentle tumble while falling — cosmetic only, never affects the landing.
    fb.rotSpeedX = (Math.random() - 0.5) * 1.6;
    fb.rotSpeedZ = (Math.random() - 0.5) * 1.6;

    falling.push(fb);

    sumX += bx;
    sumY += fromY;
    sumZ += bz;
  }

  if (count > 0) {
    audio.playCrumble({
      position: {
        x: sumX / count + 0.5,
        y: sumY / count + 0.5,
        z: sumZ / count + 0.5,
      },
    });
  }
}

// ── Explosion Debris Spawning ──

export function spawnExplosionDebris(
  blocks: { x: number; y: number; z: number; blockType: number }[],
  cx: number, cy: number, cz: number,
  radius: number,
  force: number,
  falling: FallingBlock[],
  pool: FallingBlockPool,
  world: VoxelWorld,
  audio: AudioSystem,
): void {
  const maxSpawn = Math.min(blocks.length, MAX_FALLING - falling.length, 40);
  const toSpawn = sampleExplosionBlocks(blocks, maxSpawn);
  const blastIntensity = THREE.MathUtils.clamp((force * Math.max(1, radius)) / 90, 0.25, 1.8);

  for (const b of toSpawn) {
    if (falling.length >= MAX_FALLING) break;
    const fb = pool.acquire(b.blockType, b.x, b.y, b.z);
    fb.scale = 1;
    fb.canSettle = false;
    configureDebrisPhysics(fb, blastIntensity);

    const dx = b.x + 0.5 - cx;
    const dy = b.y + 0.5 - cy;
    const dz = b.z + 0.5 - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let radialX = 0;
    let radialY = 0;
    let radialZ = 0;
    let impulse = 0;

    if (dist > 0.01) {
      const maxDist = Math.max(radius * 2.1, 2.5);
      const proximity = THREE.MathUtils.clamp(1 - dist / maxDist, 0, 1);
      // Sharper falloff (~prox^2..prox^3) with a low floor so distant blocks barely
      // move while close ones get hurled — no more uniform push across the radius.
      const falloff = proximity * proximity * (0.35 + proximity * 0.65);
      const exposure = blastExposure(world, fb.x, fb.y, fb.z);
      const mat = getBlockMat(fb.blockType);
      const resistance = Math.max(0.45, mat.pushResistance * 0.6);
      impulse = (force * (0.14 + falloff * 1.7)) / (fb.weight * resistance) * exposure;
      const dir = shapeExplosionDirection(world, fb.x, fb.y, fb.z, dx, dy, dz, dist, radius, proximity, exposure, fb.scale);
      radialX = dir.x;
      radialY = dir.y;
      radialZ = dir.z;

      fb.vx = radialX * impulse;
      fb.vy = radialY * impulse;
      fb.vz = radialZ * impulse;
    } else {
      const theta = Math.random() * Math.PI * 2;
      const mat = getBlockMat(fb.blockType);
      const resistance = Math.max(0.45, mat.pushResistance * 0.6);
      impulse = force * 1.1 / (fb.weight * resistance);
      radialX = Math.cos(theta);
      radialY = 0.1;
      radialZ = Math.sin(theta);
      const horiz = impulse * 0.88;
      fb.vx = radialX * horiz;
      fb.vy = impulse * 0.1;
      fb.vz = radialZ * horiz;
    }

    // Faster debris tumbles harder; the random sign keeps every piece spinning differently.
    const spin = THREE.MathUtils.clamp(impulse * 0.85, 6, 22);
    fb.rotSpeedX = (Math.random() - 0.5) * spin;
    fb.rotSpeedZ = (Math.random() - 0.5) * spin;

    falling.push(fb);

    const miniCount = Math.min(5, Math.floor(1 + blastIntensity * 2 + Math.random() * 2));
    for (let m = 0; m < miniCount && falling.length < MAX_FALLING; m++) {
      const mini = pool.acquire(b.blockType, b.x, b.y, b.z);
      const maxMiniScale = Math.min(0.58, 0.42 + blastIntensity * 0.1);
      const miniScale = THREE.MathUtils.lerp(0.18, maxMiniScale, Math.random());
      mini.scale = miniScale;
      mini.canSettle = true;
      mini.settleLifetimeMs = SETTLED_DEBRIS_LIFETIME_MS;
      const baseWeight = getBlockMat(mini.blockType).weight;
      mini.weight = baseWeight * (0.16 + miniScale * miniScale * miniScale * 0.9);
      configureDebrisPhysics(mini, blastIntensity);

      const jitter = 0.12 + (0.58 - miniScale) * 0.25;
      mini.x += (Math.random() - 0.5) * jitter;
      mini.y += (Math.random() - 0.5) * jitter;
      mini.z += (Math.random() - 0.5) * jitter;

      const scatter = impulse * (0.8 + Math.random() * 1.0) * (0.9 + blastIntensity * 0.25);
      mini.vx = radialX * scatter + (Math.random() - 0.5) * scatter * 0.35;
      mini.vy = radialY * scatter + (Math.random() - 0.5) * scatter * 0.06;
      mini.vz = radialZ * scatter + (Math.random() - 0.5) * scatter * 0.35;

      mini.rotSpeedX = (Math.random() - 0.5) * 18;
      mini.rotSpeedZ = (Math.random() - 0.5) * 18;
      falling.push(mini);
    }
  }

  if (toSpawn.length > 0) {
    audio.playCrumble({ position: { x: cx, y: cy, z: cz } });
  }
}

// ── Explosion Force on Existing Blocks ──

export function applyExplosionForce(
  cx: number, cy: number, cz: number,
  radius: number,
  force: number,
  falling: FallingBlock[],
  settled: SettledDebris[],
  pool: FallingBlockPool,
  world: VoxelWorld,
): void {
  const r2 = radius * radius;
  for (const fb of falling) {
    if (fb.settling) continue;
    const dx = fb.x - cx, dy = fb.y - cy, dz = fb.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2 && d2 > 0.01) {
      const dist = Math.sqrt(d2);
      const proximity = THREE.MathUtils.clamp(1 - dist / radius, 0, 1);
      const falloff = proximity * proximity * (0.35 + proximity * 0.65);
      const exposure = blastExposure(world, fb.x, fb.y, fb.z);
      const mat = getBlockMat(fb.blockType);
      const resistance = Math.max(0.45, mat.pushResistance * 0.6);
      const impulse = (force * (0.12 + falloff * 1.25)) / (fb.weight * resistance) * exposure;
      const dir = shapeExplosionDirection(world, fb.x, fb.y, fb.z, dx, dy, dz, dist, radius, proximity, exposure, fb.scale);
      const radialX = dir.x;
      const radialY = dir.y;
      const radialZ = dir.z;

      fb.vx += radialX * impulse;
      fb.vy += radialY * impulse;
      fb.vz += radialZ * impulse;
    }
  }

  // Re-activate settled mini debris when a new nearby blast happens.
  for (let i = settled.length - 1; i >= 0; i--) {
    if (falling.length >= MAX_FALLING) break;
    const s = settled[i];
    const dx = s.x - cx;
    const dy = s.y - cy;
    const dz = s.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;

    const dist = Math.sqrt(Math.max(d2, 0.0001));
    const proximity = THREE.MathUtils.clamp(1 - dist / radius, 0, 1);
    const falloff = proximity * proximity * (0.35 + proximity * 0.65);
    const exposure = blastExposure(world, s.x, s.y, s.z);
    const mat = getBlockMat(s.blockType);
    const resistance = Math.max(0.45, mat.pushResistance * 0.6);
    const baseWeight = mat.weight * (0.16 + s.scale * s.scale * s.scale * 0.9);
    const impulse = (force * (0.12 + falloff * 1.25)) / (baseWeight * resistance) * exposure;

    let radialX = 0;
    let radialY = 0;
    let radialZ = 0;
    if (dist > 0.01) {
      const dir = shapeExplosionDirection(world, s.x, s.y, s.z, dx, dy, dz, dist, radius, proximity, exposure, s.scale);
      radialX = dir.x;
      radialY = dir.y;
      radialZ = dir.z;
    } else {
      const theta = Math.random() * Math.PI * 2;
      radialX = Math.cos(theta);
      radialY = 0.12;
      radialZ = Math.sin(theta);
    }

    const fb = pool.acquire(s.blockType, 0, 0, 0);
    fb.x = s.x;
    fb.y = s.y;
    fb.z = s.z;
    fb.rotX = s.rotX;
    fb.rotZ = s.rotZ;
    fb.scale = s.scale;
    fb.weight = baseWeight;
    fb.canSettle = true;
    fb.settleLifetimeMs = SETTLED_DEBRIS_LIFETIME_MS;
    configureDebrisPhysics(fb, THREE.MathUtils.clamp(force / Math.max(6, radius * 10), 0.25, 1.8));
    fb.vx = radialX * impulse;
    fb.vy = radialY * impulse;
    fb.vz = radialZ * impulse;
    fb.rotSpeedX = (Math.random() - 0.5) * 16;
    fb.rotSpeedZ = (Math.random() - 0.5) * 16;
    fb.age = 0;

    falling.push(fb);
    settled[i] = settled[settled.length - 1];
    settled.pop();
  }
}
