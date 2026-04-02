import * as THREE from 'three';

// ── Block Material Properties ──

export interface BlockMaterial {
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

export function getBlockMat(bt: number): BlockMaterial {
  return BLOCK_MATERIALS[bt] || DEFAULT_MAT;
}

// ── Falling Block ──

export interface FallingBlock {
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
  airDrag: number;
  restitution: number;
  maxBounces: number;
  impactCount: number;
}

export interface SettledDebris {
  blockType: number;
  x: number; y: number; z: number;
  rotX: number; rotZ: number;
  scale: number;
  expiresAtMs: number;
}

export interface StructuralDetachParams {
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

export class SpatialHash {
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

export class FallingBlockPool {
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
    fb.airDrag = 0.988;
    fb.restitution = 0.14;
    fb.maxBounces = 0;
    fb.impactCount = 0;
    return fb;
  }

  release(fb: FallingBlock): void { this.pool.push(fb); }
}

// ── Constants ──

export const SHARED_GEO = new THREE.BoxGeometry(0.85, 0.85, 0.85);
export const MAX_FALLING = 500;
export const MAX_SETTLED = 350;
export const MAX_DEBRIS_INSTANCES = MAX_FALLING + MAX_SETTLED;
export const GRAVITY = -22;
export const SCRIPTED_TOPPLE_TIME = 0.45;
export const SCRIPTED_SHEAR_TIME = 0.25;
export const SETTLED_DEBRIS_LIFETIME_MS = 10_000;

// ── Deterministic Hash Unit ──

export function hashUnit(seed: number): number {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) & 0x00ffffff) / 0x00ffffff;
}
