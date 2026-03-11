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
const MAX_BFS_NODES = 200;
const MAX_BFS_RADIUS = 12;
const MAX_CHECKS_PER_FRAME = 12;
const MAX_DEFERRED_QUEUE = 120;

// ── Neighbor offsets (6-connected) ──
const N6: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

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

  // Deferred structural checks
  private deferredChecks: { x: number; y: number; z: number }[] = [];
  private pendingSync: { x: number; y: number; z: number }[] = [];

  constructor(scene: THREE.Scene, world: VoxelWorld, vfx: VFX, audio: AudioSystem) {
    this.scene = scene;
    this.world = world;
    this.vfx = vfx;
    this.audio = audio;

    // Single instanced mesh for all falling blocks
    const mat = new THREE.MeshLambertMaterial();
    this.instancedMesh = new THREE.InstancedMesh(SHARED_GEO, mat, MAX_FALLING);
    this.instancedMesh.count = 0;
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = false;
    this.instancedMesh.frustumCulled = false;
    this.scene.add(this.instancedMesh);
  }

  // ── Public API ──

  /**
   * Check structural support after block destruction.
   * Returns positions of blocks that started falling (for server sync).
   */
  checkFalling(positions: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
    const fallen = this.checkStructuralSupport(positions);
    if (fallen.length > 0) this.audio.playCrumble();
    return fallen;
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

  /** Drain pending server sync queue */
  getPendingSync(): { x: number; y: number; z: number }[] {
    if (this.pendingSync.length === 0) return this.pendingSync;
    const result = this.pendingSync;
    this.pendingSync = [];
    return result;
  }

  // ── Main Update Loop ──

  update(delta: number): void {
    const dt = Math.min(delta, 0.033); // Cap to prevent tunneling
    if (this.falling.length === 0 && this.deferredChecks.length === 0) return;

    let landedCount = 0;
    const cascadePositions: { x: number; y: number; z: number }[] = [];

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
        this.handleLanding(fb, cascadePositions);
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

    // Phase 5: Queue cascade checks from landings
    if (cascadePositions.length > 0) {
      for (const p of cascadePositions) this.deferredChecks.push(p);
      if (this.deferredChecks.length > MAX_DEFERRED_QUEUE) {
        this.deferredChecks.splice(0, this.deferredChecks.length - MAX_DEFERRED_QUEUE);
      }
    }

    // Phase 6: Process deferred structural checks
    this.processDeferredChecks();

    // Audio/VFX
    if (landedCount > 0) {
      this.audio.playBlockLand(Math.min(landedCount / 8, 1));
      this.vfx.shake(Math.min(landedCount * 0.04, 0.35));
    }
  }

  // ── Structural Support (Bounded BFS) ──

  private checkStructuralSupport(positions: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
    const fallen: { x: number; y: number; z: number }[] = [];
    const globalVisited = new Set<number>();

    for (const p of positions) {
      // Check all 6 neighbors of the destroyed block
      for (const [dx, dy, dz] of N6) {
        const nx = p.x + dx, ny = p.y + dy, nz = p.z + dz;
        const bt = this.world.getBlock(nx, ny, nz);
        if (bt === 0) continue;

        const key = this.packCoord(nx, ny, nz);
        if (globalVisited.has(key)) continue;

        // BFS to find connected component and check if supported
        const result = this.boundedBFS(nx, ny, nz, globalVisited);

        // Mark all visited nodes as globally visited
        for (const k of result.visited) globalVisited.add(k);

        if (!result.isSupported) {
          // Entire component falls
          for (const block of result.blocks) {
            if (this.falling.length >= MAX_FALLING) break;
            this.spawnFalling(block.x, block.y, block.z, block.bt);
            this.world.setBlock(block.x, block.y, block.z, 0);
            fallen.push({ x: block.x, y: block.y, z: block.z });
          }
        }
      }
    }

    return fallen;
  }

  private boundedBFS(
    startX: number, startY: number, startZ: number,
    globalVisited: Set<number>,
  ): { blocks: { x: number; y: number; z: number; bt: number }[]; visited: number[]; isSupported: boolean } {
    const queue: number[] = [startX, startY, startZ]; // flat queue: x,y,z triples
    const visited: number[] = [];
    const blocks: { x: number; y: number; z: number; bt: number }[] = [];
    const localVisited = new Set<number>();
    let isSupported = false;
    let qHead = 0;

    const startKey = this.packCoord(startX, startY, startZ);
    localVisited.add(startKey);
    visited.push(startKey);

    const r2 = MAX_BFS_RADIUS * MAX_BFS_RADIUS;

    while (qHead < queue.length && blocks.length < MAX_BFS_NODES) {
      const x = queue[qHead++];
      const y = queue[qHead++];
      const z = queue[qHead++];

      // Distance check
      const dx = x - startX, dy = y - startY, dz = z - startZ;
      if (dx * dx + dy * dy + dz * dz > r2) continue;

      const bt = this.world.getBlock(x, y, z);
      if (bt === 0) continue;

      blocks.push({ x, y, z, bt });

      // Ground support check: at y=0 or block below exists and is NOT part of this component
      if (y === 0) { isSupported = true; break; }

      const belowKey = this.packCoord(x, y - 1, z);
      const belowBt = this.world.getBlock(x, y - 1, z);
      if (belowBt !== 0 && !localVisited.has(belowKey) && !globalVisited.has(belowKey)) {
        // Block below exists and is not part of any floating component we found
        isSupported = true;
        break;
      }

      // Expand to 6 neighbors
      for (const [ox, oy, oz] of N6) {
        const nx = x + ox, ny = y + oy, nz = z + oz;
        if (ny < 0 || ny >= this.world.sizeY) continue;
        if (nx < 0 || nx >= this.world.sizeX || nz < 0 || nz >= this.world.sizeZ) continue;

        const nkey = this.packCoord(nx, ny, nz);
        if (localVisited.has(nkey) || globalVisited.has(nkey)) continue;
        if (this.world.getBlock(nx, ny, nz) === 0) continue;

        localVisited.add(nkey);
        visited.push(nkey);
        queue.push(nx, ny, nz);
      }
    }

    return { blocks, visited, isSupported };
  }

  private packCoord(x: number, y: number, z: number): number {
    return (x & 0xFF) | ((y & 0xFF) << 8) | ((z & 0xFF) << 16);
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

  private handleLanding(fb: FallingBlock, cascadePositions: { x: number; y: number; z: number }[]): void {
    const impactSpeed = Math.abs(fb.vy);
    const mat = getBlockMat(fb.blockType);
    const color = BLOCK_COLORS[fb.blockType] || 0x808080;

    const placeX = Math.floor(fb.x);
    const placeY = Math.max(0, Math.floor(fb.y - 0.4) + 1);
    const placeZ = Math.floor(fb.z);

    if (impactSpeed > mat.shatterSpeed) {
      // HIGH IMPACT — shatter into debris
      this.vfx.emitBlockDebris(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5, color);
      this.vfx.emitImpact(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5);
    } else {
      // LOW IMPACT — re-place into world grid
      if (
        placeX >= 0 && placeX < this.world.sizeX &&
        placeY >= 0 && placeY < this.world.sizeY &&
        placeZ >= 0 && placeZ < this.world.sizeZ &&
        this.world.getBlock(placeX, placeY, placeZ) === 0
      ) {
        this.world.setBlock(placeX, placeY, placeZ, fb.blockType);
        // This landing might cause cascading effects
        cascadePositions.push({ x: placeX, y: placeY, z: placeZ });
        // Small dust on gentle landing
        this.vfx.emitImpact(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5);
      } else {
        // Can't place — shatter instead
        this.vfx.emitBlockDebris(fb.x - 0.5, Math.max(0, fb.y - 0.5), fb.z - 0.5, color);
      }
    }
  }

  // ── Deferred Structural Checks ──

  private processDeferredChecks(): void {
    if (this.deferredChecks.length === 0) return;
    const batch = this.deferredChecks.splice(0, MAX_CHECKS_PER_FRAME);
    const fallen = this.checkStructuralSupport(batch);
    if (fallen.length > 0) {
      this.audio.playCrumble();
      for (const f of fallen) this.pendingSync.push(f);
    }
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
