import * as THREE from 'three';
import { VoxelWorld } from './VoxelWorld';

export interface Weapon {
  name: string;
  damage: number;
  radius: number;
  fireRate: number;
  ammo: number;
  maxAmmo: number;
  color: string;
  recoil: number;
}

export const WEAPONS: Weapon[] = [
  { name: 'Rifle',   damage: 1,  radius: 0,   fireRate: 5,   ammo: 30, maxAmmo: 30, color: '#4488ff', recoil: 0.02 },
  { name: 'Shotgun', damage: 3,  radius: 1.5, fireRate: 1,   ammo: 8,  maxAmmo: 8,  color: '#ff8844', recoil: 0.06 },
  { name: 'RPG',     damage: 10, radius: 3.5, fireRate: 0.5, ammo: 4,  maxAmmo: 4,  color: '#ff4444', recoil: 0.1  },
];

/** Result of a weapon fire — used by Engine to trigger VFX/audio */
export interface FireResult {
  weaponIndex: number;
  hitPos: { x: number; y: number; z: number } | null;
  destroyedBlocks: { x: number; y: number; z: number; blockType: number }[];
  tracerEnd: THREE.Vector3;
}

export class WeaponSystem {
  currentWeapon = 0;
  private lastFireTime = 0;
  private camera: THREE.PerspectiveCamera;
  private world: VoxelWorld;

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

  /**
   * Fire the current weapon. Returns a FireResult if fired,
   * or null if on cooldown / no ammo.
   * Block destruction is applied to the world — caller handles
   * VFX, audio, and server sync.
   */
  fire(): FireResult | null {
    const now = performance.now();
    const cooldown = 1000 / this.weapon.fireRate;
    if (now - this.lastFireTime < cooldown) return null;
    if (this.weapon.ammo <= 0) return null;

    this.lastFireTime = now;
    this.weapon.ammo--;

    // Raycast from camera center
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
    const origin = this.camera.position.clone();
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

    // Recoil (camera)
    this.camera.rotation.x += (Math.random() - 0.5) * this.weapon.recoil;

    return {
      weaponIndex: this.currentWeapon,
      hitPos: hit,
      destroyedBlocks: destroyed,
      tracerEnd,
    };
  }

  reload(): void {
    this.weapon.ammo = this.weapon.maxAmmo;
  }

  private raycastVoxels(
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
