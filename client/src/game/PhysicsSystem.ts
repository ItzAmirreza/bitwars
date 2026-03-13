import * as THREE from 'three';
import { VoxelWorld, BLOCK_COLORS } from './VoxelWorld';
import { VFX } from './VFX';
import { AudioSystem } from './AudioSystem';

// ── Block Material Properties ──

interface BlockMaterial {
  weight: number;
  strength: number;
  friction: number;
  shatterSpeed: number;
  pushResistance: number;
}

const BLOCK_MATERIALS: Record<number, BlockMaterial> = {
  1: { weight: 3.0, strength: 12, friction: 0.7, shatterSpeed: 18, pushResistance: 3.0 },  // Concrete
  2: { weight: 3.5, strength: 14, friction: 0.7, shatterSpeed: 20, pushResistance: 3.5 },  // DarkConcrete
  3: { weight: 2.5, strength: 10, friction: 0.5, shatterSpeed: 15, pushResistance: 2.5 },  // Asphalt
  4: { weight: 4.0, strength: 20, friction: 0.6, shatterSpeed: 25, pushResistance: 4.0 },  // Rebar
  5: { weight: 2.0, strength: 6,  friction: 0.8, shatterSpeed: 12, pushResistance: 2.0 },  // Brick
  6: { weight: 5.0, strength: 18, friction: 0.3, shatterSpeed: 22, pushResistance: 5.0 },  // Metal
  7: { weight: 1.5, strength: 3,  friction: 0.9, shatterSpeed: 8,  pushResistance: 1.0 },  // Rubble
  8: { weight: 1.2, strength: 2,  friction: 1.0, shatterSpeed: 6,  pushResistance: 0.8 },  // Dirt
  9: { weight: 1.0, strength: 1,  friction: 1.0, shatterSpeed: 5,  pushResistance: 0.5 },  // Sand
};

const DEFAULT_MAT: BlockMaterial = { weight: 2.0, strength: 8, friction: 0.7, shatterSpeed: 14, pushResistance: 2.0 };

function getBlockMat(bt: number): BlockMaterial {
  return BLOCK_MATERIALS[bt] || DEFAULT_MAT;
}

// ── Falling Block ──

interface FallingBlock {
  id: number;
  blockType: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rotX: number; rotZ: number;
  rotSpeedX: number; rotSpeedZ: number;
  scale: number;
  weight: number;
  age: number;
  activated: boolean;
  canSettle: boolean;
  settleLifetimeMs: number;
  motionMode: number; // -1 dynamic, 0 shear, 1 topple
  bornAtMs: number;
  delaySec: number;
  startX: number; startY: number; startZ: number;
  pivotX: number; pivotY: number; pivotZ: number;
  axisX: number; axisY: number; axisZ: number;
  driftX: number; driftY: number; driftZ: number;
  angAccel: number;
  initialAngVel: number;
  gravityScale: number;
  lifetimeMs: number;
}

interface SettledDebris {
  blockType: number;
  x: number; y: number; z: number;
  rotX: number; rotZ: number;
  scale: number;
  expiresAtMs: number;
}

interface StructuralDetachParams {
  eventId: number;
  blocksX: ArrayLike<number>;
  blocksY: ArrayLike<number>;
  blocksZ: ArrayLike<number>;
  blockTypes: ArrayLike<number>;
  motionMode: number;
  pivot: { x: number; y: number; z: number };
  axis: { x: number; y: number; z: number };
  drift: { x: number; y: number; z: number };
  fractureOrigin: { x: number; y: number; z: number };
  fractureDir: { x: number; y: number; z: number };
  angAccel: number;
  initialAngVel: number;
  gravityScale: number;
  fractureSpeed: number;
  lifetimeMs: number;
  createdAtMs: number;
}

// ── Spatial Hash ──

class SpatialHash {
  private map = new Map<number, number[]>();

  private hash(x: number, y: number, z: number): number {
    return (Math.floor(x) & 0x7F) | ((Math.floor(y) & 0x3F) << 7) | ((Math.floor(z) & 0x7F) << 13);
  }

  clear(): void { this.map.clear(); }

  insert(x: number, y: number, z: number, idx: number): void {
    const h = this.hash(x, y, z);
    const list = this.map.get(h);
    if (list) list.push(idx);
    else this.map.set(h, [idx]);
  }

  query(x: number, y: number, z: number): number[] | undefined {
    return this.map.get(this.hash(x, y, z));
  }
}

// ── Object Pool ──

class FallingBlockPool {
  private pool: FallingBlock[] = [];
  private nextId = 0;

  acquire(bt: number, x: number, y: number, z: number): FallingBlock {
    let fb = this.pool.pop();
    if (!fb) fb = {} as FallingBlock;
    fb.id = this.nextId++;
    fb.blockType = bt;
    fb.x = x + 0.5; fb.y = y + 0.5; fb.z = z + 0.5;
    fb.vx = 0; fb.vy = 0; fb.vz = 0;
    fb.rotX = 0; fb.rotZ = 0;
    fb.rotSpeedX = (Math.random() - 0.5) * 4;
    fb.rotSpeedZ = (Math.random() - 0.5) * 4;
    fb.scale = 1;
    fb.weight = getBlockMat(bt).weight;
    fb.age = 0;
    fb.activated = true;
    fb.canSettle = false;
    fb.settleLifetimeMs = 0;
    fb.motionMode = -1;
    fb.bornAtMs = 0;
    fb.delaySec = 0;
    fb.startX = fb.x; fb.startY = fb.y; fb.startZ = fb.z;
    fb.pivotX = fb.x; fb.pivotY = fb.y; fb.pivotZ = fb.z;
    fb.axisX = 0; fb.axisY = 1; fb.axisZ = 0;
    fb.driftX = 0; fb.driftY = 0; fb.driftZ = 0;
    fb.angAccel = 0;
    fb.initialAngVel = 0;
    fb.gravityScale = 1;
    fb.lifetimeMs = 0;
    return fb;
  }

  release(fb: FallingBlock): void { this.pool.push(fb); }
}

// ── Constants ──

const SHARED_GEO = new THREE.BoxGeometry(0.85, 0.85, 0.85);
const MAX_FALLING = 500;
const MAX_SETTLED = 350;
const MAX_DEBRIS_INSTANCES = MAX_FALLING + MAX_SETTLED;
const GRAVITY = -22;
const SCRIPTED_TOPPLE_TIME = 0.45;
const SCRIPTED_SHEAR_TIME = 0.25;
const SETTLED_DEBRIS_LIFETIME_MS = 10_000;

// ── PhysicsSystem ──

export class PhysicsSystem {
  private scene: THREE.Scene;
  private world: VoxelWorld;
  private vfx: VFX;
  private audio: AudioSystem;

  private falling: FallingBlock[] = [];
  private settled: SettledDebris[] = [];
  private pool = new FallingBlockPool();
  private spatialHash = new SpatialHash();

  // InstancedMesh rendering
  private instancedMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  private static hashUnit(seed: number): number {
    let x = seed | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) & 0x00ffffff) / 0x00ffffff;
  }

  // (Deferred checks removed — server handles structural integrity)

  constructor(scene: THREE.Scene, world: VoxelWorld, vfx: VFX, audio: AudioSystem) {
    this.scene = scene;
    this.world = world;
    this.vfx = vfx;
    this.audio = audio;

    // Single instanced mesh for all falling blocks
    const mat = new THREE.MeshPhongMaterial({
      emissive: new THREE.Color(0x10182a),
      emissiveIntensity: 0.26,
      shininess: 5,
      specular: new THREE.Color(0x111418),
    });
    this.instancedMesh = new THREE.InstancedMesh(SHARED_GEO, mat, MAX_DEBRIS_INSTANCES);
    this.instancedMesh.count = 0;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = false;
    this.instancedMesh.frustumCulled = false;
    this.scene.add(this.instancedMesh);
  }

  // ── Public API ──

  /**
   * Spawn falling blocks from a server DetachEvent.
   * Server has already removed these blocks from the world chunks.
   */
  spawnFromDetachEvent(params: StructuralDetachParams): void {
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
    const count = Math.min(blocksX.length, MAX_FALLING - this.falling.length);

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

      const fb = this.pool.acquire(bt, bx, by, bz);
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
      const r1 = PhysicsSystem.hashUnit(seedBase ^ 0x9e3779b9);
      const r2 = PhysicsSystem.hashUnit(seedBase ^ 0x85ebca6b);
      const spinScale = fb.motionMode === 1 ? 2.2 : 1.4;
      fb.rotSpeedX = (r1 * 2 - 1) * spinScale;
      fb.rotSpeedZ = (r2 * 2 - 1) * spinScale;

      this.falling.push(fb);

      sumX += bx;
      sumY += by;
      sumZ += bz;
    }
    if (count > 0) {
      this.audio.playCrumble({
        position: {
          x: sumX / count + 0.5,
          y: sumY / count + 0.5,
          z: sumZ / count + 0.5,
        },
      });
    }
  }

  /**
   * Spawn destroyed blocks as flying debris from an explosion center.
   * Each block gets an outward velocity based on distance from center.
   */
  spawnExplosionDebris(
    blocks: { x: number; y: number; z: number; blockType: number }[],
    cx: number, cy: number, cz: number,
    radius: number,
    force: number,
  ): void {
    // Limit how many physics blocks we spawn to avoid performance issues
    const maxSpawn = Math.min(blocks.length, MAX_FALLING - this.falling.length, 40);
    // If there are more blocks than we can spawn, sample randomly
    const toSpawn = blocks.length > maxSpawn
      ? blocks.sort(() => Math.random() - 0.5).slice(0, maxSpawn) : blocks;
    const blastIntensity = THREE.MathUtils.clamp((force * Math.max(1, radius)) / 90, 0.25, 1.8);

    for (const b of toSpawn) {
      if (this.falling.length >= MAX_FALLING) break;
      const fb = this.pool.acquire(b.blockType, b.x, b.y, b.z);
      fb.scale = 1;
      fb.canSettle = false;

      // Direction from explosion center outward
      const dx = b.x + 0.5 - cx;
      const dy = b.y + 0.5 - cy;
      const dz = b.z + 0.5 - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let radialX = 0;
      let radialY = 0;
      let radialZ = 0;
      let impulse = 0;
      let updraft = 0;

      if (dist > 0.01) {
        const maxDist = Math.max(radius * 2.1, 2.5);
        const proximity = Math.max(0, 1 - dist / maxDist);
        const shaped = proximity * proximity;
        const mat = getBlockMat(fb.blockType);
        const resistance = Math.max(0.45, mat.pushResistance * 0.6);
        impulse = (force * (0.32 + shaped * 1.45)) / (fb.weight * resistance);
        radialX = dx / dist;
        radialY = dy / dist;
        radialZ = dz / dist;
        const belowFactor = THREE.MathUtils.clamp(((b.y + 0.5) - cy) / (radius + 0.75), 0, 1);
        radialY *= (0.2 + belowFactor * 0.8);
        updraft = impulse * 0.03 * belowFactor;

        const dir = this.applyBlastOcclusion(fb.x, fb.y, fb.z, radialX, radialY, radialZ, fb.scale);
        radialX = dir.x;
        radialY = dir.y;
        radialZ = dir.z;

        fb.vx = radialX * impulse;
        fb.vy = radialY * impulse + updraft;
        fb.vz = radialZ * impulse;
      } else {
        // Dead center: random radial burst with slight lift.
        const theta = Math.random() * Math.PI * 2;
        const mat = getBlockMat(fb.blockType);
        const resistance = Math.max(0.45, mat.pushResistance * 0.6);
        impulse = force * 1.1 / (fb.weight * resistance);
        radialX = Math.cos(theta);
        radialY = 0.16;
        radialZ = Math.sin(theta);
        const horiz = impulse * 0.82;
        fb.vx = radialX * horiz;
        fb.vy = impulse * 0.14;
        fb.vz = radialZ * horiz;
      }

      // Keep spin energetic but less exaggerated.
      fb.rotSpeedX = (Math.random() - 0.5) * 11;
      fb.rotSpeedZ = (Math.random() - 0.5) * 11;

      this.falling.push(fb);

      // Spawn smaller shatter fragments based on blast intensity.
      const miniCount = Math.min(5, Math.floor(1 + blastIntensity * 2 + Math.random() * 2));
      for (let m = 0; m < miniCount && this.falling.length < MAX_FALLING; m++) {
        const mini = this.pool.acquire(b.blockType, b.x, b.y, b.z);
        const maxMiniScale = Math.min(0.58, 0.42 + blastIntensity * 0.1);
        const miniScale = THREE.MathUtils.lerp(0.18, maxMiniScale, Math.random());
        mini.scale = miniScale;
        mini.canSettle = true;
        mini.settleLifetimeMs = SETTLED_DEBRIS_LIFETIME_MS;
        const baseWeight = getBlockMat(mini.blockType).weight;
        mini.weight = baseWeight * (0.16 + miniScale * miniScale * miniScale * 0.9);

        const jitter = 0.12 + (0.58 - miniScale) * 0.25;
        mini.x += (Math.random() - 0.5) * jitter;
        mini.y += (Math.random() - 0.5) * jitter;
        mini.z += (Math.random() - 0.5) * jitter;

        const scatter = impulse * (0.8 + Math.random() * 1.0) * (0.9 + blastIntensity * 0.25);
        mini.vx = radialX * scatter + (Math.random() - 0.5) * scatter * 0.35;
        mini.vy = radialY * scatter + updraft * 0.3 + Math.random() * scatter * 0.08;
        mini.vz = radialZ * scatter + (Math.random() - 0.5) * scatter * 0.35;

        mini.rotSpeedX = (Math.random() - 0.5) * 18;
        mini.rotSpeedZ = (Math.random() - 0.5) * 18;
        this.falling.push(mini);
      }
    }

    if (toSpawn.length > 0) {
      this.audio.playCrumble({ position: { x: cx, y: cy, z: cz } });
    }
  }

  /** Apply explosion force to nearby falling blocks */
  applyExplosionForce(cx: number, cy: number, cz: number, radius: number, force: number): void {
    const nowMs = Date.now();
    const r2 = radius * radius;
    for (const fb of this.falling) {
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
        let radialX = dx / dist;
        let radialY = dy / dist;
        let radialZ = dz / dist;
        const belowFactor = THREE.MathUtils.clamp((fb.y - cy) / (radius + 0.75), 0, 1);
        radialY *= (0.2 + belowFactor * 0.8);
        const updraft = impulse * 0.025 * belowFactor;

        const dir = this.applyBlastOcclusion(fb.x, fb.y, fb.z, radialX, radialY, radialZ, fb.scale);
        radialX = dir.x;
        radialY = dir.y;
        radialZ = dir.z;

        fb.vx += radialX * impulse;
        fb.vy += radialY * impulse + updraft;
        fb.vz += radialZ * impulse;
      }
    }

    // Re-activate settled mini debris when a new nearby blast happens.
    for (let i = this.settled.length - 1; i >= 0; i--) {
      if (this.falling.length >= MAX_FALLING) break;
      const s = this.settled[i];
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
        radialX = dx / dist;
        radialY = dy / dist;
        radialZ = dz / dist;
      } else {
        const theta = Math.random() * Math.PI * 2;
        radialX = Math.cos(theta);
        radialY = 0.2;
        radialZ = Math.sin(theta);
      }

      const belowFactor = THREE.MathUtils.clamp((s.y - cy) / (radius + 0.75), 0, 1);
      radialY *= (0.2 + belowFactor * 0.8);
      const updraft = impulse * 0.02 * belowFactor;
      const dir = this.applyBlastOcclusion(s.x, s.y, s.z, radialX, radialY, radialZ, s.scale);
      radialX = dir.x;
      radialY = dir.y;
      radialZ = dir.z;

      const fb = this.pool.acquire(s.blockType, 0, 0, 0);
      fb.x = s.x;
      fb.y = s.y;
      fb.z = s.z;
      fb.rotX = s.rotX;
      fb.rotZ = s.rotZ;
      fb.scale = s.scale;
      fb.weight = baseWeight;
      fb.canSettle = true;
      fb.settleLifetimeMs = SETTLED_DEBRIS_LIFETIME_MS;
      fb.vx = radialX * impulse;
      fb.vy = radialY * impulse + updraft;
      fb.vz = radialZ * impulse;
      fb.rotSpeedX = (Math.random() - 0.5) * 16;
      fb.rotSpeedZ = (Math.random() - 0.5) * 16;
      fb.age = 0;
      fb.bornAtMs = nowMs;

      this.falling.push(fb);
      this.settled[i] = this.settled[this.settled.length - 1];
      this.settled.pop();
    }
  }

  private applyBlastOcclusion(
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
      if (this.world.getBlock(tx, cellY, Math.floor(z)) !== 0) xDir = -xDir * 0.55;
    }
    if (Math.abs(zDir) > 0.01) {
      const tz = Math.floor(z + Math.sign(zDir) * probe);
      if (this.world.getBlock(Math.floor(x), cellY, tz) !== 0) zDir = -zDir * 0.55;
    }

    if (yDir > 0.01) {
      const ty = Math.floor(y + probe);
      if (this.world.getBlock(Math.floor(x), ty, Math.floor(z)) !== 0) yDir = -yDir * 0.45;
    } else if (yDir < -0.01) {
      const ty = Math.floor(y - probe);
      if (this.world.getBlock(Math.floor(x), ty, Math.floor(z)) !== 0) yDir *= 0.25;
    }

    const len = Math.hypot(xDir, yDir, zDir);
    if (len < 0.001) return { x: 0, y: 0.08, z: 0 };
    return { x: xDir / len, y: yDir / len, z: zDir / len };
  }

  // ── Main Update Loop ──

  update(delta: number): void {
    const dt = Math.min(delta, 0.033); // Cap to prevent tunneling
    const nowMs = Date.now();
    this.pruneSettledDebris(nowMs);
    if (this.falling.length === 0 && this.settled.length === 0) {
      this.instancedMesh.count = 0;
      return;
    }

    let landedCount = 0;
    let landedX = 0;
    let landedY = 0;
    let landedZ = 0;

    // Phase 1: Apply forces
    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];

      if (fb.motionMode >= 0 && !fb.activated) {
        this.updateStructuralBlock(fb, nowMs, dt);
        continue;
      }

      fb.age += dt;

      // Gravity with weight-based air resistance
      const drag = 1.0 - (0.02 / fb.weight);
      fb.vy += GRAVITY * dt;
      fb.vx *= drag;
      fb.vz *= drag;

      // Apply velocity
      fb.x += fb.vx * dt;
      fb.y += fb.vy * dt;
      fb.z += fb.vz * dt;

      // Visual tumble
      fb.rotX += fb.rotSpeedX * dt;
      fb.rotZ += fb.rotSpeedZ * dt;
    }

    // Phase 2: Block-to-block collision
    if (this.falling.length > 1) this.resolveCollisions();

    // Phase 3: World collision (landing / side walls)
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const fb = this.falling[i];

      if (fb.motionMode >= 0 && !fb.activated) {
        if ((nowMs - fb.bornAtMs) > fb.lifetimeMs || fb.y < -20) {
          this.pool.release(fb);
          this.falling[i] = this.falling[this.falling.length - 1];
          this.falling.pop();
        }
        continue;
      }

      const bx = Math.floor(fb.x);
      const halfHeight = 0.425 * fb.scale;
      const by = Math.floor(fb.y - halfHeight);
      const bz = Math.floor(fb.z);

      // Floor collision
      const hitFloor = by < 0 || this.world.getBlock(bx, by, bz) !== 0;

      // Side collision — bounce off walls
      const sideMargin = Math.max(0.12, 0.35 * fb.scale);
      const hitPosX = this.world.getBlock(Math.floor(fb.x + sideMargin), Math.floor(fb.y), Math.floor(fb.z)) !== 0;
      const hitNegX = this.world.getBlock(Math.floor(fb.x - sideMargin), Math.floor(fb.y), Math.floor(fb.z)) !== 0;
      const hitPosZ = this.world.getBlock(Math.floor(fb.x), Math.floor(fb.y), Math.floor(fb.z + sideMargin)) !== 0;
      const hitNegZ = this.world.getBlock(Math.floor(fb.x), Math.floor(fb.y), Math.floor(fb.z - sideMargin)) !== 0;

      if (hitPosX) { fb.vx = Math.min(fb.vx, -Math.abs(fb.vx) * 0.3); fb.x -= 0.05; }
      if (hitNegX) { fb.vx = Math.max(fb.vx, Math.abs(fb.vx) * 0.3); fb.x += 0.05; }
      if (hitPosZ) { fb.vz = Math.min(fb.vz, -Math.abs(fb.vz) * 0.3); fb.z -= 0.05; }
      if (hitNegZ) { fb.vz = Math.max(fb.vz, Math.abs(fb.vz) * 0.3); fb.z += 0.05; }

      if (hitFloor) {
        landedX += fb.x;
        landedY += fb.y;
        landedZ += fb.z;
        const settled = this.trySettleDebris(fb, by, nowMs);
        if (!settled) {
          this.handleLanding(fb);
          landedCount++;
        }
        this.pool.release(fb);
        this.falling[i] = this.falling[this.falling.length - 1];
        this.falling.pop();
        continue;
      }

      // Despawn if fell below world or aged out
      if (fb.y < -20 || fb.age > 10) {
        this.pool.release(fb);
        this.falling[i] = this.falling[this.falling.length - 1];
        this.falling.pop();
      }
    }

    // Phase 4: Update InstancedMesh
    this.updateInstancedMesh();

    // Audio/VFX
    if (landedCount > 0) {
      const avgX = landedX / landedCount;
      const avgY = landedY / landedCount;
      const avgZ = landedZ / landedCount;
      this.audio.playBlockLand(Math.min(landedCount / 8, 1), {
        position: { x: avgX, y: avgY, z: avgZ },
      });
      this.vfx.shake(Math.min(landedCount * 0.04, 0.35));
    }
  }

  private updateStructuralBlock(fb: FallingBlock, nowMs: number, dt: number): void {
    const elapsed = (nowMs - fb.bornAtMs) / 1000;
    const t = Math.max(0, elapsed - fb.delaySec);
    const g = 9.8 * fb.gravityScale;
    const prevT = Math.max(0, t - Math.max(0.001, dt));

    if (fb.motionMode === 1) {
      const angle = Math.min(1.45, fb.initialAngVel * t + 0.5 * fb.angAccel * t * t);
      const prevAngle = Math.min(1.45, fb.initialAngVel * prevT + 0.5 * fb.angAccel * prevT * prevT);

      const rotated = this.rotateAroundAxis(
        fb.startX,
        fb.startY,
        fb.startZ,
        fb.pivotX,
        fb.pivotY,
        fb.pivotZ,
        fb.axisX,
        fb.axisY,
        fb.axisZ,
        angle,
      );
      const prevRotated = this.rotateAroundAxis(
        fb.startX,
        fb.startY,
        fb.startZ,
        fb.pivotX,
        fb.pivotY,
        fb.pivotZ,
        fb.axisX,
        fb.axisY,
        fb.axisZ,
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

  private rotateAroundAxis(
    x: number,
    y: number,
    z: number,
    ox: number,
    oy: number,
    oz: number,
    ax: number,
    ay: number,
    az: number,
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

  // ── Block-to-Block Collision ──

  private resolveCollisions(): void {
    const hash = this.spatialHash;
    hash.clear();

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
      if (fb.motionMode >= 0) continue;
      hash.insert(fb.x, fb.y, fb.z, i);
    }

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
      if (fb.motionMode >= 0) continue;
      const cx = Math.floor(fb.x);
      const cy = Math.floor(fb.y);
      const cz = Math.floor(fb.z);

      // Check cell below for vertical collision
      const below = hash.query(cx, cy - 1, cz);
      if (below) {
        for (const j of below) {
          if (j === i) continue;
          const other = this.falling[j];
          const dy = fb.y - other.y;
          const stackLimit = 0.5 * (fb.scale + other.scale) + 0.2;
          if (dy > 0 && dy < stackLimit && fb.vy < other.vy) {
            // Momentum transfer
            const totalW = fb.weight + other.weight;
            const combinedVy = (fb.vy * fb.weight + other.vy * other.weight) / totalW;
            fb.vy = combinedVy;
            other.vy = combinedVy;
            fb.y = other.y + 0.5 * (fb.scale + other.scale);
          }
        }
      }

      // Check same cell for lateral overlap
      const same = hash.query(cx, cy, cz);
      if (same && same.length > 1) {
        for (const j of same) {
          if (j <= i) continue;
          const other = this.falling[j];
          const ddx = fb.x - other.x;
          const ddz = fb.z - other.z;
          const dist = Math.sqrt(ddx * ddx + ddz * ddz);
          const overlapRadius = 0.425 * (fb.scale + other.scale);
          if (dist < overlapRadius && dist > 0.01) {
            const nx = ddx / dist, nz = ddz / dist;
            const push = (overlapRadius - dist) * 0.5;
            const wRatio = other.weight / (fb.weight + other.weight);
            fb.vx += nx * push * wRatio * 8;
            fb.vz += nz * push * wRatio * 8;
            other.vx -= nx * push * (1 - wRatio) * 8;
            other.vz -= nz * push * (1 - wRatio) * 8;
          }
        }
      }
    }
  }

  // ── Landing ──

  private handleLanding(fb: FallingBlock): void {
    this.spawnImpactFragments(fb);
    const color = BLOCK_COLORS[fb.blockType] || 0x808080;
    // Always shatter — server owns the world, no client re-placement
    this.vfx.emitBlockDebris(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5, color);
    this.vfx.emitImpact(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5);
  }

  private spawnImpactFragments(fb: FallingBlock): void {
    if (fb.scale < 0.72) return;
    if (this.falling.length >= MAX_FALLING) return;

    const impactSpeed = Math.sqrt(fb.vx * fb.vx + fb.vy * fb.vy + fb.vz * fb.vz);
    if (impactSpeed < 4.5) return;

    const shatterIntensity = THREE.MathUtils.clamp((impactSpeed - 4.5) / 10, 0, 1.2);
    const count = Math.min(4, Math.floor(1 + shatterIntensity * 3 + Math.random() * 1.5));

    for (let i = 0; i < count && this.falling.length < MAX_FALLING; i++) {
      const mini = this.pool.acquire(fb.blockType, 0, 0, 0);
      const miniScale = THREE.MathUtils.lerp(0.2, 0.5, Math.random());
      mini.scale = miniScale;
      mini.canSettle = true;
      mini.settleLifetimeMs = SETTLED_DEBRIS_LIFETIME_MS;
      const baseWeight = getBlockMat(mini.blockType).weight;
      mini.weight = baseWeight * (0.16 + miniScale * miniScale * miniScale * 0.9);

      mini.x = fb.x + (Math.random() - 0.5) * 0.22;
      mini.y = fb.y - 0.35 + Math.random() * 0.08;
      mini.z = fb.z + (Math.random() - 0.5) * 0.22;

      const theta = Math.random() * Math.PI * 2;
      const scatter = (1.5 + Math.random() * 1.6) * (0.55 + shatterIntensity * 0.9);
      mini.vx = Math.cos(theta) * scatter + fb.vx * 0.25;
      mini.vy = Math.random() * scatter * 0.45 + Math.max(0, -fb.vy) * 0.12;
      mini.vz = Math.sin(theta) * scatter + fb.vz * 0.25;
      mini.rotSpeedX = (Math.random() - 0.5) * 16;
      mini.rotSpeedZ = (Math.random() - 0.5) * 16;
      this.falling.push(mini);
    }
  }

  private trySettleDebris(fb: FallingBlock, floorY: number, nowMs: number): boolean {
    if (!fb.canSettle || fb.scale >= 0.72) return false;
    if (this.settled.length >= MAX_SETTLED) {
      this.settled.shift();
    }

    const topY = Math.max(0, floorY + 1);
    const halfHeight = 0.425 * fb.scale;
    const clampedX = THREE.MathUtils.clamp(fb.x, 0.45, this.world.sizeX - 0.45);
    const clampedZ = THREE.MathUtils.clamp(fb.z, 0.45, this.world.sizeZ - 0.45);

    this.settled.push({
      blockType: fb.blockType,
      x: clampedX,
      y: topY + halfHeight,
      z: clampedZ,
      rotX: fb.rotX,
      rotZ: fb.rotZ,
      scale: fb.scale,
      expiresAtMs: nowMs + fb.settleLifetimeMs,
    });
    return true;
  }

  private pruneSettledDebris(nowMs: number): void {
    for (let i = this.settled.length - 1; i >= 0; i--) {
      if (this.settled[i].expiresAtMs <= nowMs) {
        this.settled[i] = this.settled[this.settled.length - 1];
        this.settled.pop();
      }
    }
  }

  // ── InstancedMesh Rendering ──

  private updateInstancedMesh(): void {
    const count = this.falling.length + this.settled.length;
    this.instancedMesh.count = count;

    if (count === 0) return;

    // Ensure we have instance color attribute
    if (!this.instancedMesh.instanceColor) {
      const colorArray = new Float32Array(MAX_DEBRIS_INSTANCES * 3);
      this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    }

    let i = 0;
    for (; i < this.falling.length; i++) {
      const fb = this.falling[i];

      this.dummy.position.set(fb.x, fb.y, fb.z);
      this.dummy.rotation.set(fb.rotX, 0, fb.rotZ);
      this.dummy.scale.setScalar(fb.scale);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

      this.tmpColor.setHex(BLOCK_COLORS[fb.blockType] || 0x808080);
      this.instancedMesh.setColorAt(i, this.tmpColor);
    }

    for (let s = 0; s < this.settled.length; s++, i++) {
      const debris = this.settled[s];
      this.dummy.position.set(debris.x, debris.y, debris.z);
      this.dummy.rotation.set(debris.rotX, 0, debris.rotZ);
      this.dummy.scale.setScalar(debris.scale);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

      this.tmpColor.setHex(BLOCK_COLORS[debris.blockType] || 0x808080);
      this.instancedMesh.setColorAt(i, this.tmpColor);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
  }

  // ── Cleanup ──

  dispose(): void {
    this.falling = [];
    this.settled = [];
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
  }
}
