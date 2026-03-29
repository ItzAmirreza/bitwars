import * as THREE from 'three';
import { VoxelWorld, BlockType } from './VoxelWorld';
import { WEAPON_DEFINITIONS, NUM_WEAPONS } from './WeaponRegistry';
import type { ProjectileConfig } from './WeaponRegistry';
import { VEHICLE_TYPES } from '../shared-config';

export type { ProjectileConfig };

export interface Weapon {
  name: string;
  damage: number;
  radius: number;
  fireRate: number;
  maxAmmo: number;
  range: number;
  color: string;
  recoil: number;
  projectile: ProjectileConfig;
}

// Client-side weapon stats (used for prediction/VFX only — server is authority for damage/ammo)
// Sourced from WeaponRegistry (shared JSON + client-only projectile configs)
export const WEAPONS: readonly Weapon[] = WEAPON_DEFINITIONS.map((def) => ({
  name: def.name,
  damage: def.damage,
  radius: def.radius,
  fireRate: def.fireRate,
  maxAmmo: def.maxAmmo,
  range: def.maxRange,
  color: def.color,
  recoil: def.recoil,
  projectile: def.projectile,
}));

export { NUM_WEAPONS };

/** Result of a weapon fire — used by Engine to trigger VFX/audio and server sync */
export interface FireResult {
  weaponIndex: number;
  hitPos: { x: number; y: number; z: number } | null;
  destroyedBlocks: { x: number; y: number; z: number; blockType: number }[];
  tracerEnd: THREE.Vector3;
  hitPlayerIds: string[];
  hitVehicleIds: number[];
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  isProjectile: boolean;
  /** Shotgun pellet endpoints for multi-tracer VFX */
  pelletEnds?: THREE.Vector3[];
}

// Player hitbox: axis-aligned bounding box (width 0.6, height 1.9, centered at feet+0.95)
const PLAYER_HITBOX_HALF_W = 0.4;
const PLAYER_HITBOX_HEIGHT = 1.9;

// Broad-phase vehicle envelopes for candidate collection sent to the server.
// Keep these a bit generous so we don't miss true hits; server remains authoritative.
type VehicleBroadPhase = {
  centerY: number;
  halfX: number;
  halfY: number;
  halfZ: number;
};

const VEHICLE_BROADPHASE_BY_TYPE: Record<number, VehicleBroadPhase> = {
  // Composite server hitboxes extend to ~9.2u on helicopter tail/rotor sweep.
  [VEHICLE_TYPES.Helicopter]: { centerY: 2.45, halfX: 9.5, halfY: 2.3, halfZ: 9.5 },
  // Jet envelope covers wing sweep and nose/tail extents across yaw.
  [VEHICLE_TYPES.FighterJet]: { centerY: 2.2, halfX: 8.1, halfY: 2.5, halfZ: 8.1 },
  // AA includes crossed barrel sweep and raised turret/radar volume.
  [VEHICLE_TYPES.AntiAir]: { centerY: 2.2, halfX: 4.9, halfY: 2.8, halfZ: 4.9 },
};

const DEFAULT_VEHICLE_BROADPHASE: VehicleBroadPhase = { centerY: 2.4, halfX: 9.5, halfY: 2.8, halfZ: 9.5 };

export class WeaponSystem {
  private equippedWeapons: [number, number, number] = [0, 1, 2];
  private currentSlot = 0;
  private inputEnabled = true;
  private lastFireTime = 0;
  private camera: THREE.PerspectiveCamera;
  private world: VoxelWorld;
  private otherPlayers: Map<string, THREE.Group> = new Map();
  private vehicles: Map<number, THREE.Group> = new Map();
  private pendingBlockDestructions: Map<string, number> = new Map();
  private ammoState: number[];

  constructor(camera: THREE.PerspectiveCamera, world: VoxelWorld) {
    this.camera = camera;
    this.world = world;
    this.ammoState = WEAPONS.map((w) => w.maxAmmo);

    document.addEventListener('wheel', (e) => {
      if (!this.inputEnabled) return;
      if (e.deltaY > 0) this.nextWeapon();
      else this.prevWeapon();
    });

    document.addEventListener('keydown', (e) => {
      if (!this.inputEnabled) return;
      if (e.code === 'Digit1') this.switchToSlot(0);
      if (e.code === 'Digit2') this.switchToSlot(1);
      if (e.code === 'Digit3') this.switchToSlot(2);
    });
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }

  /** Set reference to other players map for hit detection */
  setOtherPlayers(players: Map<string, THREE.Group>): void {
    this.otherPlayers = players;
  }

  setVehicles(vehicles: Map<number, THREE.Group>): void {
    this.vehicles = vehicles;
  }

  get currentWeapon(): number { return this.equippedWeapons[this.currentSlot]; }

  get loadout(): [number, number, number] {
    return [this.equippedWeapons[0], this.equippedWeapons[1], this.equippedWeapons[2]];
  }

  get weapon(): Weapon { return WEAPONS[this.currentWeapon]; }

  setLoadout(loadout: [number, number, number], preferredWeapon?: number): boolean {
    const [slot1, slot2, slot3] = loadout;
    if (slot1 < 0 || slot1 >= WEAPONS.length) return false;
    if (slot2 < 0 || slot2 >= WEAPONS.length) return false;
    if (slot3 < 0 || slot3 >= WEAPONS.length) return false;

    const unique = new Set([slot1, slot2, slot3]);
    if (unique.size !== 3) return false;

    const previousWeapon = this.currentWeapon;
    this.equippedWeapons = [slot1, slot2, slot3];

    const preferred = preferredWeapon ?? previousWeapon;
    const preferredSlot = this.equippedWeapons.indexOf(preferred);
    this.currentSlot = preferredSlot >= 0 ? preferredSlot : 0;

    return true;
  }

  setCurrentWeapon(weaponIndex: number): boolean {
    const slot = this.equippedWeapons.indexOf(weaponIndex);
    if (slot < 0) return false;
    if (slot === this.currentSlot) return false;
    this.currentSlot = slot;
    return true;
  }

  switchToSlot(slotIndex: number): number {
    if (slotIndex < 0 || slotIndex >= this.equippedWeapons.length) return this.currentWeapon;
    this.currentSlot = slotIndex;
    return this.currentWeapon;
  }

  nextWeapon(): number {
    this.currentSlot = (this.currentSlot + 1) % this.equippedWeapons.length;
    return this.currentWeapon;
  }

  prevWeapon(): number {
    this.currentSlot = (this.currentSlot - 1 + this.equippedWeapons.length) % this.equippedWeapons.length;
    return this.currentWeapon;
  }

  /** Get current ammo for a weapon (or current weapon if no index given) */
  getAmmo(weaponIndex?: number): number {
    const idx = weaponIndex ?? this.currentWeapon;
    return this.ammoState[idx] ?? 0;
  }

  /** Update ammo from server state for a specific weapon */
  setAmmo(weaponIndex: number, ammo: number): void {
    if (weaponIndex >= 0 && weaponIndex < this.ammoState.length) {
      this.ammoState[weaponIndex] = ammo;
    }
  }

  /** Deduct one ammo from the current weapon (client prediction) */
  deductAmmo(): void {
    this.ammoState[this.currentWeapon]--;
  }

  /** Restore one ammo for a specific weapon (e.g. when fire is rolled back) */
  restoreAmmo(weaponIndex: number): void {
    if (weaponIndex >= 0 && weaponIndex < this.ammoState.length) {
      this.ammoState[weaponIndex]++;
    }
  }

  /**
   * Fire the current weapon. Returns a FireResult if fired,
   * or null if on cooldown / no ammo.
   * Block destruction is applied to the local world (client prediction).
   * Caller handles VFX, audio, and server sync.
   */
  fire(): FireResult | null {
    const now = performance.now();
    const cooldown = 1000 / this.weapon.fireRate;
    if (now - this.lastFireTime < cooldown) return null;
    if (this.ammoState[this.currentWeapon] <= 0) return null;

    this.lastFireTime = now;
    this.ammoState[this.currentWeapon]--; // Client prediction — server is authority

    // Raycast from camera center
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    if (this.currentWeapon === 3) {
      dir.x += (Math.random() - 0.5) * 0.05;
      dir.y += (Math.random() - 0.5) * 0.03;
      dir.z += (Math.random() - 0.5) * 0.05;
      dir.normalize();
    } else if (this.currentWeapon === 4) {
      dir.y += 0.09;
      dir.normalize();
    }
    const origin = this.camera.position.clone();

    // Recoil (camera) — use YXZ euler to match FPSControls and avoid yaw drift
    const recoilEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    recoilEuler.setFromQuaternion(this.camera.quaternion);
    recoilEuler.x += (Math.random() - 0.5) * this.weapon.recoil;
    recoilEuler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, recoilEuler.x));
    this.camera.quaternion.setFromEuler(recoilEuler);

    // Projectile weapon: skip raycast, return early with spawn data
    if (isFinite(this.weapon.projectile.speed)) {
      return {
        weaponIndex: this.currentWeapon,
        hitPos: null,
        destroyedBlocks: [],
        tracerEnd: origin.clone().add(dir.clone().multiplyScalar(this.weapon.range)),
        hitPlayerIds: [],
        hitVehicleIds: [],
        origin,
        direction: dir,
        isProjectile: true,
      };
    }

    // ── Shotgun: multi-pellet spread ──
    const isShotgun = this.currentWeapon === 1;
    if (isShotgun) {
      return this.fireShotgun(origin, dir);
    }

    // Hitscan path: instant raycast
    const hit = this.raycastVoxels(origin, dir, this.weapon.range);

    const destroyed: FireResult['destroyedBlocks'] = [];
    const tracerEnd = hit
      ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      : origin.clone().add(dir.clone().multiplyScalar(this.weapon.range));

    if (hit) {
      if (this.weapon.radius > 0) {
        // Explosive: radius destruction
        const r = this.weapon.radius;
        const r2 = r * r;
        for (let bx = Math.floor(hit.x - r); bx <= Math.ceil(hit.x + r); bx++) {
          for (let by = Math.floor(hit.y - r); by <= Math.ceil(hit.y + r); by++) {
            for (let bz = Math.floor(hit.z - r); bz <= Math.ceil(hit.z + r); bz++) {
              const dx = bx - hit.x, dy = by - hit.y, dz = bz - hit.z;
              if (dx * dx + dy * dy + dz * dz <= r2) {
                const bt = this.world.getBlock(bx, by, bz);
                if (bt !== 0 && bt !== BlockType.Bedrock) {
                  this.pendingBlockDestructions.set(`${bx},${by},${bz}`, bt);
                  this.world.setBlock(bx, by, bz, 0);
                  destroyed.push({ x: bx, y: by, z: bz, blockType: bt });
                }
              }
            }
          }
        }
      } else {
        // Single block
        const bt = this.world.getBlock(hit.x, hit.y, hit.z);
        if (bt !== BlockType.Bedrock) {
          this.pendingBlockDestructions.set(`${hit.x},${hit.y},${hit.z}`, bt);
          this.world.setBlock(hit.x, hit.y, hit.z, 0);
          destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
        }
      }
    }

    // Player hit detection: AABB raycast against other players
    const hitPlayerIds = this.raycastPlayers(origin, dir, this.weapon.range);
    const hitVehicleIds = this.raycastVehicles(origin, dir, this.weapon.range);

    return {
      weaponIndex: this.currentWeapon,
      hitPos: hit,
      destroyedBlocks: destroyed,
      tracerEnd,
      hitPlayerIds,
      hitVehicleIds,
      origin,
      direction: dir,
      isProjectile: false,
    };
  }

  /**
   * Shotgun multi-pellet fire: casts N rays in a cone spread, aggregates hits.
   * Each pellet independently raycasts against voxels, players, and vehicles.
   * Duplicate player/vehicle IDs are intentional — server applies damage per entry.
   */
  private fireShotgun(origin: THREE.Vector3, centerDir: THREE.Vector3): FireResult {
    const PELLET_COUNT = 7;
    const SPREAD = 0.1; // radians of cone half-angle
    const range = this.weapon.range;

    // Build a local coordinate frame around the center direction
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    if (Math.abs(centerDir.y) < 0.99) {
      right.crossVectors(centerDir, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      right.crossVectors(centerDir, new THREE.Vector3(1, 0, 0)).normalize();
    }
    up.crossVectors(right, centerDir).normalize();

    const allHitPlayerIds: string[] = [];
    const allHitVehicleIds: number[] = [];
    const destroyed: FireResult['destroyedBlocks'] = [];
    const pelletEnds: THREE.Vector3[] = [];
    let firstBlockHit: { x: number; y: number; z: number } | null = null;

    for (let i = 0; i < PELLET_COUNT; i++) {
      // Random point in a disc, scaled by spread
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * SPREAD;
      const offX = Math.cos(angle) * radius;
      const offY = Math.sin(angle) * radius;

      const pelletDir = centerDir.clone()
        .addScaledVector(right, offX)
        .addScaledVector(up, offY)
        .normalize();

      // Voxel raycast
      const hit = this.raycastVoxels(origin, pelletDir, range);

      // Pellet tracer endpoint
      const pelletEnd = hit
        ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
        : origin.clone().add(pelletDir.clone().multiplyScalar(range));
      pelletEnds.push(pelletEnd);

      // Block destruction: each pellet destroys the block it hits
      if (hit) {
        if (!firstBlockHit) firstBlockHit = hit;
        const bt = this.world.getBlock(hit.x, hit.y, hit.z);
        if (bt !== 0 && bt !== BlockType.Bedrock) {
          const key = `${hit.x},${hit.y},${hit.z}`;
          if (!this.pendingBlockDestructions.has(key)) {
            this.pendingBlockDestructions.set(key, bt);
            this.world.setBlock(hit.x, hit.y, hit.z, 0);
            destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
          }
        }
      }

      // Player hits — duplicates are intentional (multi-pellet damage)
      const playerHits = this.raycastPlayers(origin, pelletDir, range);
      allHitPlayerIds.push(...playerHits);

      // Vehicle hits — duplicates are intentional
      const vehicleHits = this.raycastVehicles(origin, pelletDir, range);
      allHitVehicleIds.push(...vehicleHits);
    }

    const tracerEnd = firstBlockHit
      ? new THREE.Vector3(firstBlockHit.x + 0.5, firstBlockHit.y + 0.5, firstBlockHit.z + 0.5)
      : origin.clone().add(centerDir.clone().multiplyScalar(range));

    return {
      weaponIndex: this.currentWeapon,
      hitPos: firstBlockHit,
      destroyedBlocks: destroyed,
      tracerEnd,
      hitPlayerIds: allHitPlayerIds,
      hitVehicleIds: allHitVehicleIds,
      origin,
      direction: centerDir,
      isProjectile: false,
      pelletEnds,
    };
  }

  /** Track a client-predicted block destruction */
  trackPendingDestruction(x: number, y: number, z: number, blockType: number): void {
    this.pendingBlockDestructions.set(`${x},${y},${z}`, blockType);
  }

  /** Check if a block position was already predicted-destroyed by client */
  isPendingDestruction(key: string): boolean {
    return this.pendingBlockDestructions.has(key);
  }

  /** Confirm a client-predicted block destruction (server agreed) */
  confirmDestruction(key: string): void {
    this.pendingBlockDestructions.delete(key);
  }

  /** Clear all pending block destructions (used on map reset). */
  clearPendingDestructions(): void {
    this.pendingBlockDestructions.clear();
  }

  /** Reset fire cooldown and ammo state to max (used on map reset). */
  resetFireState(): void {
    this.lastFireTime = 0;
    this.ammoState = WEAPONS.map((w) => w.maxAmmo);
  }

  reload(): void {
    // Client-side prediction only; actual reload goes through server
    this.ammoState[this.currentWeapon] = this.weapon.maxAmmo;
  }

  /** Raycast against other players' AABB hitboxes, return hit player IDs */
  raycastPlayers(origin: THREE.Vector3, direction: THREE.Vector3, maxRange: number): string[] {
    const hitIds: string[] = [];

    for (const [id, group] of this.otherPlayers) {
      // Player model position is at feet level
      const pos = group.position;
      // AABB: center at (pos.x, pos.y + height/2, pos.z)
      const minX = pos.x - PLAYER_HITBOX_HALF_W;
      const maxX = pos.x + PLAYER_HITBOX_HALF_W;
      const minY = pos.y;
      const maxY = pos.y + PLAYER_HITBOX_HEIGHT;
      const minZ = pos.z - PLAYER_HITBOX_HALF_W;
      const maxZ = pos.z + PLAYER_HITBOX_HALF_W;

      const t = this.rayAABB(origin, direction, minX, minY, minZ, maxX, maxY, maxZ);
      if (t !== null && t >= 0 && t <= maxRange) {
        hitIds.push(id);
      }
    }

    return hitIds;
  }

  raycastVehicles(origin: THREE.Vector3, direction: THREE.Vector3, maxRange: number): number[] {
    const hitIds: number[] = [];
    for (const [entityId, vehicle] of this.vehicles) {
      const pos = vehicle.position;
      const hb = this.getVehicleBroadPhase(vehicle);
      const minX = pos.x - hb.halfX;
      const maxX = pos.x + hb.halfX;
      const minY = pos.y + hb.centerY - hb.halfY;
      const maxY = pos.y + hb.centerY + hb.halfY;
      const minZ = pos.z - hb.halfZ;
      const maxZ = pos.z + hb.halfZ;
      const t = this.rayAABB(origin, direction, minX, minY, minZ, maxX, maxY, maxZ);
      if (t !== null && t >= 0 && t <= maxRange) hitIds.push(entityId);
    }
    return hitIds;
  }

  vehiclesWithinRadius(center: THREE.Vector3, radius: number): number[] {
    const hitIds: number[] = [];
    const r2 = radius * radius;
    for (const [entityId, vehicle] of this.vehicles) {
      const pos = vehicle.position;
      const hb = this.getVehicleBroadPhase(vehicle);
      const cx = center.x - pos.x;
      const cy = center.y - (pos.y + hb.centerY);
      const cz = center.z - pos.z;
      const closestX = Math.max(-hb.halfX, Math.min(hb.halfX, cx));
      const closestY = Math.max(-hb.halfY, Math.min(hb.halfY, cy));
      const closestZ = Math.max(-hb.halfZ, Math.min(hb.halfZ, cz));
      const dx = cx - closestX;
      const dy = cy - closestY;
      const dz = cz - closestZ;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r2) hitIds.push(entityId);
    }
    return hitIds;
  }

  private getVehicleBroadPhase(vehicle: THREE.Group): VehicleBroadPhase {
    const typeId = Number(vehicle.userData?.vehicleType ?? -1);
    return VEHICLE_BROADPHASE_BY_TYPE[typeId] ?? DEFAULT_VEHICLE_BROADPHASE;
  }

  /** Ray-AABB intersection test, returns t (distance along ray) or null */
  rayAABB(
    origin: THREE.Vector3, dir: THREE.Vector3,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
  ): number | null {
    const invX = dir.x !== 0 ? 1 / dir.x : (dir.x >= 0 ? Infinity : -Infinity);
    const invY = dir.y !== 0 ? 1 / dir.y : (dir.y >= 0 ? Infinity : -Infinity);
    const invZ = dir.z !== 0 ? 1 / dir.z : (dir.z >= 0 ? Infinity : -Infinity);

    const t1 = (minX - origin.x) * invX;
    const t2 = (maxX - origin.x) * invX;
    const t3 = (minY - origin.y) * invY;
    const t4 = (maxY - origin.y) * invY;
    const t5 = (minZ - origin.z) * invZ;
    const t6 = (maxZ - origin.z) * invZ;

    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));

    if (tmax < 0 || tmin > tmax) return null;
    return tmin >= 0 ? tmin : tmax;
  }

  raycastVoxels(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDist: number,
  ): { x: number; y: number; z: number } | null {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = direction.x >= 0 ? 1 : -1;
    const stepY = direction.y >= 0 ? 1 : -1;
    const stepZ = direction.z >= 0 ? 1 : -1;

    const tDeltaX = direction.x !== 0 ? Math.abs(1 / direction.x) : Infinity;
    const tDeltaY = direction.y !== 0 ? Math.abs(1 / direction.y) : Infinity;
    const tDeltaZ = direction.z !== 0 ? Math.abs(1 / direction.z) : Infinity;

    let tMaxX = direction.x !== 0 ? ((stepX > 0 ? x + 1 - origin.x : origin.x - x) / Math.abs(direction.x)) : Infinity;
    let tMaxY = direction.y !== 0 ? ((stepY > 0 ? y + 1 - origin.y : origin.y - y) / Math.abs(direction.y)) : Infinity;
    let tMaxZ = direction.z !== 0 ? ((stepZ > 0 ? z + 1 - origin.z : origin.z - z) / Math.abs(direction.z)) : Infinity;

    let dist = 0;

    while (dist < maxDist) {
      const block = this.world.getBlock(x, y, z);
      if (block !== 0) return { x, y, z };

      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; dist = tMaxX; tMaxX += tDeltaX; }
        else { z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; }
      } else {
        if (tMaxY < tMaxZ) { y += stepY; dist = tMaxY; tMaxY += tDeltaY; }
        else { z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; }
      }
    }

    return null;
  }
}
