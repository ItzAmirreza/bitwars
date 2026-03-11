import * as THREE from 'three';
import { VoxelWorld } from './VoxelWorld';

export interface ProjectileConfig {
  speed: number;           // units/sec (Infinity = hitscan)
  gravity: number;         // downward acceleration (0 = no drop)
  size: number;            // visual radius of projectile mesh
  trailLength: number;     // trail particle spacing (0 = no trail)
  trailColor: number;      // trail color hex
  lightIntensity: number;  // point light intensity (0 = none)
  lightColor: number;      // point light color hex
  lightRange: number;      // point light range
  lifetime: number;        // max seconds before despawn
}

export interface Weapon {
  name: string;
  damage: number;
  radius: number;
  fireRate: number;
  ammo: number;
  maxAmmo: number;
  color: string;
  recoil: number;
  projectile: ProjectileConfig;
}

// Client-side weapon stats (used for prediction/VFX only — server is authority for damage/ammo)
export const WEAPONS: Weapon[] = [
  {
    name: 'Rifle', damage: 25, radius: 0, fireRate: 5, ammo: 30, maxAmmo: 30,
    color: '#4488ff', recoil: 0.02,
    projectile: { speed: Infinity, gravity: 0, size: 0, trailLength: 0, trailColor: 0, lightIntensity: 0, lightColor: 0, lightRange: 0, lifetime: 0 },
  },
  {
    name: 'Shotgun', damage: 12, radius: 1.5, fireRate: 1, ammo: 8, maxAmmo: 8,
    color: '#ff8844', recoil: 0.06,
    projectile: { speed: Infinity, gravity: 0, size: 0, trailLength: 0, trailColor: 0, lightIntensity: 0, lightColor: 0, lightRange: 0, lifetime: 0 },
  },
  {
    name: 'RPG', damage: 80, radius: 3.5, fireRate: 0.5, ammo: 4, maxAmmo: 4,
    color: '#ff4444', recoil: 0.1,
    projectile: { speed: 40, gravity: 2, size: 0.15, trailLength: 0.5, trailColor: 0xff6600, lightIntensity: 3, lightColor: 0xff4400, lightRange: 8, lifetime: 5 },
  },
];

/** Result of a weapon fire — used by Engine to trigger VFX/audio and server sync */
export interface FireResult {
  weaponIndex: number;
  hitPos: { x: number; y: number; z: number } | null;
  destroyedBlocks: { x: number; y: number; z: number; blockType: number }[];
  tracerEnd: THREE.Vector3;
  hitPlayerIds: string[];
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  isProjectile: boolean;
}

// Player hitbox: axis-aligned bounding box (width 0.6, height 1.9, centered at feet+0.95)
const PLAYER_HITBOX_HALF_W = 0.4;
const PLAYER_HITBOX_HEIGHT = 1.9;

export class WeaponSystem {
  currentWeapon = 0;
  private lastFireTime = 0;
  private camera: THREE.PerspectiveCamera;
  private world: VoxelWorld;
  private otherPlayers: Map<string, THREE.Group> = new Map();

  constructor(camera: THREE.PerspectiveCamera, world: VoxelWorld) {
    this.camera = camera;
    this.world = world;

    document.addEventListener('wheel', (e) => {
      if (e.deltaY > 0) this.nextWeapon();
      else this.prevWeapon();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') this.switchTo(0);
      if (e.code === 'Digit2') this.switchTo(1);
      if (e.code === 'Digit3') this.switchTo(2);
    });
  }

  /** Set reference to other players map for hit detection */
  setOtherPlayers(players: Map<string, THREE.Group>): void {
    this.otherPlayers = players;
  }

  get weapon(): Weapon { return WEAPONS[this.currentWeapon]; }

  private switchTo(index: number): void {
    this.currentWeapon = index;
  }

  nextWeapon(): number {
    this.currentWeapon = (this.currentWeapon + 1) % WEAPONS.length;
    return this.currentWeapon;
  }

  prevWeapon(): number {
    this.currentWeapon = (this.currentWeapon - 1 + WEAPONS.length) % WEAPONS.length;
    return this.currentWeapon;
  }

  /** Update ammo from server state */
  setAmmo(ammo: number): void {
    this.weapon.ammo = ammo;
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
    if (this.weapon.ammo <= 0) return null;

    this.lastFireTime = now;
    this.weapon.ammo--; // Client prediction — server is authority

    // Raycast from camera center
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
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
        tracerEnd: origin.clone().add(dir.clone().multiplyScalar(80)),
        hitPlayerIds: [],
        origin,
        direction: dir,
        isProjectile: true,
      };
    }

    // Hitscan path: instant raycast
    const hit = this.raycastVoxels(origin, dir, 80);

    const destroyed: FireResult['destroyedBlocks'] = [];
    const tracerEnd = hit
      ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      : origin.clone().add(dir.clone().multiplyScalar(80));

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
                if (bt !== 0) {
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
        this.world.setBlock(hit.x, hit.y, hit.z, 0);
        destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
      }
    }

    // Player hit detection: AABB raycast against other players
    const hitPlayerIds = this.raycastPlayers(origin, dir, 80);

    return {
      weaponIndex: this.currentWeapon,
      hitPos: hit,
      destroyedBlocks: destroyed,
      tracerEnd,
      hitPlayerIds,
      origin,
      direction: dir,
      isProjectile: false,
    };
  }

  reload(): void {
    // Client-side prediction only; actual reload goes through server
    this.weapon.ammo = this.weapon.maxAmmo;
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
