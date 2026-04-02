import * as THREE from 'three';
import type { VoxelWorld } from './VoxelWorld';
import type { AudioSystem } from './AudioSystem';
import {
  type FallingBlock,
  type SettledDebris,
  type StructuralDetachParams,
  getBlockMat,
  hashUnit,
  type FallingBlockPool,
  MAX_FALLING,
  SETTLED_DEBRIS_LIFETIME_MS,
  SCRIPTED_TOPPLE_TIME,
  SCRIPTED_SHEAR_TIME,
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
  shaped: number,
  scale: number,
): { x: number; y: number; z: number } {
  let radialX = dx / dist;
  let radialY = dy / dist;
  let radialZ = dz / dist;

  const heightRatio = THREE.MathUtils.clamp(dy / Math.max(1, radius), -1, 1);
  const lift = THREE.MathUtils.lerp(0.08, 0.22, shaped) * (1 - Math.max(0, heightRatio) * 0.7);
  radialY = THREE.MathUtils.clamp(radialY * 0.65 + lift, -0.32, 0.5);

  const dir = applyBlastOcclusion(world, x, y, z, radialX, radialY, radialZ, scale);
  const cappedY = THREE.MathUtils.clamp(dir.y, -0.35, 0.5);
  const len = Math.hypot(dir.x, cappedY, dir.z);

  if (len < 0.001) return { x: 0, y: 0.12, z: 0 };
  return { x: dir.x / len, y: cappedY / len, z: dir.z / len };
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

// ── Detach Event Spawning ──

export function spawnFromDetachEvent(
  params: StructuralDetachParams,
  falling: FallingBlock[],
  pool: FallingBlockPool,
  audio: AudioSystem,
): void {
  const {
    eventId,
    blocksX,
    blocksY,
    blocksZ,
    blockTypes,
    motionMode,
    pivot,
    axis,
    drift,
    fractureOrigin,
    fractureDir,
    angAccel,
    initialAngVel,
    gravityScale,
    fractureSpeed,
    lifetimeMs,
    createdAtMs,
  } = params;

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  const count = Math.min(blocksX.length, MAX_FALLING - falling.length);

  const axisLen = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const nx = axis.x / axisLen;
  const ny = axis.y / axisLen;
  const nz = axis.z / axisLen;
  const fracLen = Math.hypot(fractureDir.x, fractureDir.y, fractureDir.z) || 1;
  const fx = fractureDir.x / fracLen;
  const fy = fractureDir.y / fracLen;
  const fz = fractureDir.z / fracLen;
  const nowMs = Date.now();
  const inferredAge = Number.isFinite(createdAtMs) ? nowMs - createdAtMs : 0;
  const ageAtReceiveMs = Math.max(0, Math.min(5000, inferredAge));
  const bornAtMs = nowMs - ageAtReceiveMs;
  const speed = Math.max(0.25, fractureSpeed);

  for (let i = 0; i < count; i++) {
    const bx = blocksX[i];
    const by = blocksY[i];
    const bz = blocksZ[i];
    const bt = blockTypes[i];

    const fb = pool.acquire(bt, bx, by, bz);
    fb.motionMode = motionMode === 1 ? 1 : 0;
    fb.bornAtMs = bornAtMs;
    fb.activated = false;
    fb.startX = fb.x;
    fb.startY = fb.y;
    fb.startZ = fb.z;
    fb.pivotX = pivot.x;
    fb.pivotY = pivot.y;
    fb.pivotZ = pivot.z;
    fb.axisX = nx;
    fb.axisY = ny;
    fb.axisZ = nz;
    fb.driftX = drift.x;
    fb.driftY = drift.y;
    fb.driftZ = drift.z;
    fb.angAccel = angAccel;
    fb.initialAngVel = initialAngVel;
    fb.gravityScale = Math.max(0.2, gravityScale);
    fb.lifetimeMs = Math.max(1500, lifetimeMs);

    const relX = fb.startX - fractureOrigin.x;
    const relY = fb.startY - fractureOrigin.y;
    const relZ = fb.startZ - fractureOrigin.z;
    const planeDist = relX * fx + relY * fy + relZ * fz;
    fb.delaySec = Math.max(0, Math.min(2.2, (planeDist / speed) * 0.35));

    const seedBase = ((eventId * 73856093) ^ ((bx | 0) * 19349663) ^ ((by | 0) * 83492791) ^ ((bz | 0) * 2654435761)) >>> 0;
    const r1 = hashUnit(seedBase ^ 0x9e3779b9);
    const r2 = hashUnit(seedBase ^ 0x85ebca6b);
    const spinScale = fb.motionMode === 1 ? 2.2 : 1.4;
    fb.rotSpeedX = (r1 * 2 - 1) * spinScale;
    fb.rotSpeedZ = (r2 * 2 - 1) * spinScale;

    falling.push(fb);

    sumX += bx;
    sumY += by;
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
      const proximity = Math.max(0, 1 - dist / maxDist);
      const shaped = proximity * proximity;
      const mat = getBlockMat(fb.blockType);
      const resistance = Math.max(0.45, mat.pushResistance * 0.6);
      impulse = (force * (0.32 + shaped * 1.45)) / (fb.weight * resistance);
      const dir = shapeExplosionDirection(world, fb.x, fb.y, fb.z, dx, dy, dz, dist, radius, shaped, fb.scale);
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

    fb.rotSpeedX = (Math.random() - 0.5) * 11;
    fb.rotSpeedZ = (Math.random() - 0.5) * 11;

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
  const nowMs = Date.now();
  const r2 = radius * radius;
  for (const fb of falling) {
    if (fb.motionMode >= 0) continue;
    const dx = fb.x - cx, dy = fb.y - cy, dz = fb.z - cz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < r2 && d2 > 0.01) {
      const dist = Math.sqrt(d2);
      const proximity = 1 - dist / radius;
      const shaped = proximity * proximity;
      const mat = getBlockMat(fb.blockType);
      const resistance = Math.max(0.45, mat.pushResistance * 0.6);
      const impulse = (force * (0.25 + shaped * 1.05)) / (fb.weight * resistance);
      const dir = shapeExplosionDirection(world, fb.x, fb.y, fb.z, dx, dy, dz, dist, radius, shaped, fb.scale);
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
    const proximity = 1 - dist / radius;
    const shaped = proximity * proximity;
    const mat = getBlockMat(s.blockType);
    const resistance = Math.max(0.45, mat.pushResistance * 0.6);
    const baseWeight = mat.weight * (0.16 + s.scale * s.scale * s.scale * 0.9);
    const impulse = (force * (0.25 + shaped * 1.05)) / (baseWeight * resistance);

    let radialX = 0;
    let radialY = 0;
    let radialZ = 0;
    if (dist > 0.01) {
      const dir = shapeExplosionDirection(world, s.x, s.y, s.z, dx, dy, dz, dist, radius, shaped, s.scale);
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
    fb.bornAtMs = nowMs;

    falling.push(fb);
    settled[i] = settled[settled.length - 1];
    settled.pop();
  }
}

// ── Structural Block Motion ──

function rotateAroundAxis(
  x: number, y: number, z: number,
  ox: number, oy: number, oz: number,
  ax: number, ay: number, az: number,
  angle: number,
): { x: number; y: number; z: number } {
  const px = x - ox;
  const py = y - oy;
  const pz = z - oz;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dot = ax * px + ay * py + az * pz;

  const rx = px * c + (ay * pz - az * py) * s + ax * dot * (1 - c);
  const ry = py * c + (az * px - ax * pz) * s + ay * dot * (1 - c);
  const rz = pz * c + (ax * py - ay * px) * s + az * dot * (1 - c);

  return { x: ox + rx, y: oy + ry, z: oz + rz };
}

export function updateStructuralBlock(fb: FallingBlock, nowMs: number, dt: number): void {
  const elapsed = (nowMs - fb.bornAtMs) / 1000;
  const t = Math.max(0, elapsed - fb.delaySec);
  const g = 9.8 * fb.gravityScale;
  const prevT = Math.max(0, t - Math.max(0.001, dt));

  if (fb.motionMode === 1) {
    const angle = Math.min(1.45, fb.initialAngVel * t + 0.5 * fb.angAccel * t * t);
    const prevAngle = Math.min(1.45, fb.initialAngVel * prevT + 0.5 * fb.angAccel * prevT * prevT);

    const rotated = rotateAroundAxis(
      fb.startX, fb.startY, fb.startZ,
      fb.pivotX, fb.pivotY, fb.pivotZ,
      fb.axisX, fb.axisY, fb.axisZ,
      angle,
    );
    const prevRotated = rotateAroundAxis(
      fb.startX, fb.startY, fb.startZ,
      fb.pivotX, fb.pivotY, fb.pivotZ,
      fb.axisX, fb.axisY, fb.axisZ,
      prevAngle,
    );

    fb.x = rotated.x + fb.driftX * t;
    fb.z = rotated.z + fb.driftZ * t;
    fb.y = rotated.y + fb.driftY * t - 0.5 * g * t * t;

    const prevX = prevRotated.x + fb.driftX * prevT;
    const prevZ = prevRotated.z + fb.driftZ * prevT;
    const prevY = prevRotated.y + fb.driftY * prevT - 0.5 * g * prevT * prevT;

    if (t > SCRIPTED_TOPPLE_TIME || angle > 0.55) {
      const invDt = 1 / Math.max(0.001, dt);
      fb.vx = (fb.x - prevX) * invDt;
      fb.vy = (fb.y - prevY) * invDt;
      fb.vz = (fb.z - prevZ) * invDt;
      fb.motionMode = -1;
      fb.activated = true;
    }
  } else {
    fb.x = fb.startX + fb.driftX * t;
    fb.z = fb.startZ + fb.driftZ * t;
    fb.y = fb.startY + fb.driftY * t - 0.5 * g * t * t;

    if (t > SCRIPTED_SHEAR_TIME) {
      fb.vx = fb.driftX;
      fb.vy = fb.driftY - g * t;
      fb.vz = fb.driftZ;
      fb.motionMode = -1;
      fb.activated = true;
    }
  }

  fb.rotX = fb.rotSpeedX * (t + fb.delaySec * 0.3);
  fb.rotZ = fb.rotSpeedZ * (t + fb.delaySec * 0.3);
}
