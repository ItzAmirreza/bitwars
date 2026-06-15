import * as THREE from 'three';
import { VoxelWorld, BLOCK_COLORS } from './VoxelWorld';
import { VFX } from './VFX';
import { AudioSystem } from './AudioSystem';
import {
  type FallingBlock,
  type SettledDebris,
  type BlockSettleParams,
  getBlockMat,
  FallingBlockPool,
  SpatialHash,
  SHARED_GEO,
  MAX_FALLING,
  MAX_SETTLED,
  MAX_DEBRIS_INSTANCES,
  GRAVITY,
  SETTLED_DEBRIS_LIFETIME_MS,
} from './PhysicsTypes';
import {
  spawnSettleBlocks as doSpawnSettle,
  spawnExplosionDebris as doSpawnExplosion,
  applyExplosionForce as doApplyExplosionForce,
} from './PhysicsSpawning';

// Re-export for consumers that import the interface from here
export type { BlockSettleParams } from './PhysicsTypes';

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

  // ── Public API (delegates to PhysicsSpawning) ──

  spawnSettleBlocks(params: BlockSettleParams): void {
    doSpawnSettle(params, this.falling, this.pool, this.audio);
  }

  spawnExplosionDebris(
    blocks: { x: number; y: number; z: number; blockType: number }[],
    cx: number, cy: number, cz: number,
    radius: number,
    force: number,
  ): void {
    doSpawnExplosion(blocks, cx, cy, cz, radius, force, this.falling, this.pool, this.world, this.audio);
  }

  applyExplosionForce(cx: number, cy: number, cz: number, radius: number, force: number): void {
    doApplyExplosionForce(cx, cy, cz, radius, force, this.falling, this.settled, this.pool, this.world);
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

      // Server-authoritative settle: fall straight down toward the committed
      // target cell. No drag/lateral forces — the landing must match the server.
      if (fb.settling) {
        fb.vy += GRAVITY * dt;
        fb.y += fb.vy * dt;
        fb.rotX += fb.rotSpeedX * dt;
        fb.rotZ += fb.rotSpeedZ * dt;
        continue;
      }

      fb.age += dt;

      // Use time-scaled drag on every axis so debris arcs stay ballistic across frame rates.
      const dragPer60Hz = THREE.MathUtils.clamp(fb.airDrag, 0.84, 0.995);
      const drag = Math.pow(dragPer60Hz, dt * 60);
      fb.vx *= drag;
      fb.vy *= drag;
      fb.vz *= drag;
      fb.vy += GRAVITY * dt;

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

      // Settling blocks land exactly on their server-committed target cell and
      // become solid again (predicted; the server confirms via chunk update).
      if (fb.settling) {
        const restY = fb.targetY + 0.5;
        if (fb.y <= restY) {
          fb.y = restY;
          this.world.setBlock(Math.floor(fb.x), fb.targetY, Math.floor(fb.z), fb.blockType);
          landedX += fb.x;
          landedY += fb.y;
          landedZ += fb.z;
          landedCount++;
          this.vfx.emitImpact(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5);
          this.pool.release(fb);
          this.falling[i] = this.falling[this.falling.length - 1];
          this.falling.pop();
        } else if (fb.y < -20) {
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
        if (this.tryBounceDebris(fb, by)) continue;
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
      const maxAgeSec = fb.lifetimeMs > 0 ? fb.lifetimeMs / 1000 : 10;
      if (fb.y < -20 || fb.age > maxAgeSec) {
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

  // ── Block-to-Block Collision ──

  private resolveCollisions(): void {
    const hash = this.spatialHash;
    hash.clear();

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
      if (fb.settling) continue;
      hash.insert(fb.x, fb.y, fb.z, i);
    }

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
      if (fb.settling) continue;
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
      mini.airDrag = THREE.MathUtils.lerp(0.91, 0.95, miniScale);
      mini.restitution = 0.06;
      mini.maxBounces = 0;
      mini.impactCount = 0;
      mini.lifetimeMs = Math.round(THREE.MathUtils.lerp(1200, 2600, miniScale));

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

  private tryBounceDebris(fb: FallingBlock, floorY: number): boolean {
    if (fb.impactCount >= fb.maxBounces) return false;

    const downwardSpeed = -fb.vy;
    const lateralSpeed = Math.hypot(fb.vx, fb.vz);
    const impactSpeed = Math.hypot(lateralSpeed, downwardSpeed);
    if (downwardSpeed < 3.6 || impactSpeed < 5.5) return false;

    const topY = Math.max(0, floorY + 1);
    const halfHeight = 0.425 * fb.scale;
    const mat = getBlockMat(fb.blockType);
    const tangentialDamping = THREE.MathUtils.clamp(0.58 - mat.friction * 0.18, 0.34, 0.7);

    fb.y = topY + halfHeight;
    fb.vy = downwardSpeed * fb.restitution;
    fb.vx *= tangentialDamping;
    fb.vz *= tangentialDamping;
    fb.rotSpeedX *= 0.72;
    fb.rotSpeedZ *= 0.72;
    fb.impactCount++;

    if (fb.vy < 1.2 && Math.hypot(fb.vx, fb.vz) < 1.1) return false;
    return true;
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

  /** Remove all falling blocks and settled debris (used on map reset). */
  clearAll(): void {
    for (const fb of this.falling) this.pool.release(fb);
    this.falling.length = 0;
    this.settled.length = 0;
    this.instancedMesh.count = 0;
  }

  dispose(): void {
    this.falling = [];
    this.settled = [];
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
  }
}
