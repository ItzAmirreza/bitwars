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
  weight: number;
  age: number;
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
    fb.weight = getBlockMat(bt).weight;
    fb.age = 0;
    return fb;
  }

  release(fb: FallingBlock): void { this.pool.push(fb); }
}

// ── Constants ──

const SHARED_GEO = new THREE.BoxGeometry(0.85, 0.85, 0.85);
const MAX_FALLING = 500;
const GRAVITY = -22;

// ── PhysicsSystem ──

export class PhysicsSystem {
  private scene: THREE.Scene;
  private world: VoxelWorld;
  private vfx: VFX;
  private audio: AudioSystem;

  private falling: FallingBlock[] = [];
  private pool = new FallingBlockPool();
  private spatialHash = new SpatialHash();

  // InstancedMesh rendering
  private instancedMesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

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
    this.instancedMesh = new THREE.InstancedMesh(SHARED_GEO, mat, MAX_FALLING);
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
  spawnFromDetachEvent(
    blocksX: ArrayLike<number>, blocksY: ArrayLike<number>,
    blocksZ: ArrayLike<number>, blockTypes: ArrayLike<number>,
  ): void {
    const count = Math.min(blocksX.length, MAX_FALLING - this.falling.length);
    for (let i = 0; i < count; i++) {
      this.spawnFalling(blocksX[i], blocksY[i], blocksZ[i], blockTypes[i]);
    }
    if (count > 0) this.audio.playCrumble();
  }

  /**
   * Spawn destroyed blocks as flying debris from an explosion center.
   * Each block gets an outward velocity based on distance from center.
   */
  spawnExplosionDebris(
    blocks: { x: number; y: number; z: number; blockType: number }[],
    cx: number, cy: number, cz: number,
    force: number,
  ): void {
    // Limit how many physics blocks we spawn to avoid performance issues
    const maxSpawn = Math.min(blocks.length, MAX_FALLING - this.falling.length, 40);
    // If there are more blocks than we can spawn, sample randomly
    const toSpawn = blocks.length > maxSpawn
      ? blocks.sort(() => Math.random() - 0.5).slice(0, maxSpawn) : blocks;

    for (const b of toSpawn) {
      if (this.falling.length >= MAX_FALLING) break;
      const fb = this.pool.acquire(b.blockType, b.x, b.y, b.z);

      // Direction from explosion center outward
      const dx = b.x + 0.5 - cx;
      const dy = b.y + 0.5 - cy;
      const dz = b.z + 0.5 - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist > 0.01) {
        const falloff = 1 - dist / (dist + 2); // softer falloff so all blocks get pushed
        const impulse = force * falloff / fb.weight;
        fb.vx = (dx / dist) * impulse;
        fb.vy = (dy / dist) * impulse + impulse * 0.4; // upward bias
        fb.vz = (dz / dist) * impulse;
      } else {
        // Dead center — launch straight up
        fb.vy = force / fb.weight;
      }

      // Dramatic spin for explosion debris
      fb.rotSpeedX = (Math.random() - 0.5) * 14;
      fb.rotSpeedZ = (Math.random() - 0.5) * 14;

      this.falling.push(fb);
    }

    if (toSpawn.length > 0) this.audio.playCrumble();
  }

  /** Apply explosion force to nearby falling blocks */
  applyExplosionForce(cx: number, cy: number, cz: number, radius: number, force: number): void {
    const r2 = radius * radius;
    for (const fb of this.falling) {
      const dx = fb.x - cx, dy = fb.y - cy, dz = fb.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r2 && d2 > 0.01) {
        const dist = Math.sqrt(d2);
        const falloff = 1 - dist / radius;
        const impulse = force * falloff / fb.weight;
        fb.vx += (dx / dist) * impulse;
        fb.vy += (dy / dist) * impulse + impulse * 0.5;
        fb.vz += (dz / dist) * impulse;
      }
    }
  }

  // ── Main Update Loop ──

  update(delta: number): void {
    const dt = Math.min(delta, 0.033); // Cap to prevent tunneling
    if (this.falling.length === 0) return;

    let landedCount = 0;

    // Phase 1: Apply forces
    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
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

      const bx = Math.floor(fb.x);
      const by = Math.floor(fb.y - 0.4);
      const bz = Math.floor(fb.z);

      // Floor collision
      const hitFloor = by < 0 || this.world.getBlock(bx, by, bz) !== 0;

      // Side collision — bounce off walls
      const sideMargin = 0.35;
      const hitPosX = this.world.getBlock(Math.floor(fb.x + sideMargin), Math.floor(fb.y), Math.floor(fb.z)) !== 0;
      const hitNegX = this.world.getBlock(Math.floor(fb.x - sideMargin), Math.floor(fb.y), Math.floor(fb.z)) !== 0;
      const hitPosZ = this.world.getBlock(Math.floor(fb.x), Math.floor(fb.y), Math.floor(fb.z + sideMargin)) !== 0;
      const hitNegZ = this.world.getBlock(Math.floor(fb.x), Math.floor(fb.y), Math.floor(fb.z - sideMargin)) !== 0;

      if (hitPosX) { fb.vx = Math.min(fb.vx, -Math.abs(fb.vx) * 0.3); fb.x -= 0.05; }
      if (hitNegX) { fb.vx = Math.max(fb.vx, Math.abs(fb.vx) * 0.3); fb.x += 0.05; }
      if (hitPosZ) { fb.vz = Math.min(fb.vz, -Math.abs(fb.vz) * 0.3); fb.z -= 0.05; }
      if (hitNegZ) { fb.vz = Math.max(fb.vz, Math.abs(fb.vz) * 0.3); fb.z += 0.05; }

      if (hitFloor) {
        this.handleLanding(fb);
        this.pool.release(fb);
        this.falling[i] = this.falling[this.falling.length - 1];
        this.falling.pop();
        landedCount++;
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
      this.audio.playBlockLand(Math.min(landedCount / 8, 1));
      this.vfx.shake(Math.min(landedCount * 0.04, 0.35));
    }
  }

  // ── Falling Block Spawning ──

  private spawnFalling(x: number, y: number, z: number, bt: number): void {
    if (this.falling.length >= MAX_FALLING) return;
    this.falling.push(this.pool.acquire(bt, x, y, z));
  }

  // ── Block-to-Block Collision ──

  private resolveCollisions(): void {
    const hash = this.spatialHash;
    hash.clear();

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
      hash.insert(fb.x, fb.y, fb.z, i);
    }

    for (let i = 0; i < this.falling.length; i++) {
      const fb = this.falling[i];
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
          if (dy > 0 && dy < 1.1 && fb.vy < other.vy) {
            // Momentum transfer
            const totalW = fb.weight + other.weight;
            const combinedVy = (fb.vy * fb.weight + other.vy * other.weight) / totalW;
            fb.vy = combinedVy;
            other.vy = combinedVy;
            fb.y = other.y + 1.0;
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
          if (dist < 0.85 && dist > 0.01) {
            const nx = ddx / dist, nz = ddz / dist;
            const push = (0.85 - dist) * 0.5;
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
    const color = BLOCK_COLORS[fb.blockType] || 0x808080;
    // Always shatter — server owns the world, no client re-placement
    this.vfx.emitBlockDebris(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5, color);
    this.vfx.emitImpact(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5);
  }

  // ── InstancedMesh Rendering ──

  private updateInstancedMesh(): void {
    const count = this.falling.length;
    this.instancedMesh.count = count;

    if (count === 0) return;

    // Ensure we have instance color attribute
    if (!this.instancedMesh.instanceColor) {
      const colorArray = new Float32Array(MAX_FALLING * 3);
      this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
    }

    for (let i = 0; i < count; i++) {
      const fb = this.falling[i];

      this.dummy.position.set(fb.x, fb.y, fb.z);
      this.dummy.rotation.set(fb.rotX, 0, fb.rotZ);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);

      this.tmpColor.setHex(BLOCK_COLORS[fb.blockType] || 0x808080);
      this.instancedMesh.setColorAt(i, this.tmpColor);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
  }

  // ── Cleanup ──

  dispose(): void {
    this.falling = [];
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
  }
}
