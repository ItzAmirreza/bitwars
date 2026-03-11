import * as THREE from 'three';
import { VoxelWorld } from './VoxelWorld';
import { WeaponSystem, WEAPONS } from './Weapons';
import { VFX } from './VFX';

const MAX_PROJECTILES = 64;
const MAX_LIGHTS = 4;

export interface ProjectileImpact {
  weaponIndex: number;
  hitPos: { x: number; y: number; z: number };
  destroyedBlocks: { x: number; y: number; z: number; blockType: number }[];
  hitPlayerIds: string[];
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  travelTimeMs: number;
}

interface ActiveProjectile {
  weaponIndex: number;
  // Physics
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity: number;
  speed: number;
  // Origin data (for server sync)
  origin: THREE.Vector3;
  firedAt: number; // performance.now()
  // Config
  lifetime: number;
  age: number;
  radius: number;
  // Visual
  trailColor: number;
  trailTimer: number;
  trailSpacing: number;
  // State
  isLocal: boolean;
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
}

// Shared geometry/material for all projectile meshes
const _sphereGeo = new THREE.SphereGeometry(1, 8, 6);

export class ProjectileManager {
  private projectiles: ActiveProjectile[] = [];
  private scene: THREE.Scene;
  private world: VoxelWorld;
  private weapons: WeaponSystem;
  private vfx: VFX;
  private otherPlayers: Map<string, THREE.Group>;
  private onLocalImpact: (impact: ProjectileImpact) => void;
  private activeLightCount = 0;

  constructor(
    scene: THREE.Scene,
    world: VoxelWorld,
    weapons: WeaponSystem,
    vfx: VFX,
    otherPlayers: Map<string, THREE.Group>,
    onLocalImpact: (impact: ProjectileImpact) => void,
  ) {
    this.scene = scene;
    this.world = world;
    this.weapons = weapons;
    this.vfx = vfx;
    this.otherPlayers = otherPlayers;
    this.onLocalImpact = onLocalImpact;
  }

  /** Spawn a projectile from the local player's fire */
  spawnLocal(weaponIndex: number, origin: THREE.Vector3, direction: THREE.Vector3): void {
    this.spawn(weaponIndex, origin, direction, performance.now(), true);
  }

  /** Spawn a projectile from a remote player's ShotEvent */
  spawnRemote(weaponIndex: number, origin: THREE.Vector3, direction: THREE.Vector3, firedAt: number): void {
    const p = this.spawn(weaponIndex, origin, direction, firedAt, false);
    if (!p) return;

    // Advance projectile to compensate for network latency
    const latencyMs = performance.now() - firedAt;
    if (latencyMs > 0 && latencyMs < 3000) {
      const catchupDt = latencyMs / 1000;
      p.pos.addScaledVector(p.vel, catchupDt);
      p.vel.y -= p.gravity * catchupDt;
      p.age += catchupDt;
    }
  }

  private spawn(
    weaponIndex: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    firedAt: number,
    isLocal: boolean,
  ): ActiveProjectile | null {
    if (this.projectiles.length >= MAX_PROJECTILES) return null;

    const w = WEAPONS[weaponIndex];
    const cfg = w.projectile;
    if (!isFinite(cfg.speed) || cfg.speed <= 0) return null;

    const dir = direction.clone().normalize();
    const vel = dir.clone().multiplyScalar(cfg.speed);

    // Create mesh
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.trailColor || 0xff4444,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(_sphereGeo, mat);
    mesh.scale.setScalar(cfg.size);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    // Optional point light (capped)
    let light: THREE.PointLight | null = null;
    if (cfg.lightIntensity > 0 && this.activeLightCount < MAX_LIGHTS) {
      light = new THREE.PointLight(cfg.lightColor, cfg.lightIntensity, cfg.lightRange);
      light.position.copy(origin);
      this.scene.add(light);
      this.activeLightCount++;
    }

    const proj: ActiveProjectile = {
      weaponIndex,
      pos: origin.clone(),
      vel,
      gravity: cfg.gravity,
      speed: cfg.speed,
      origin: origin.clone(),
      firedAt,
      lifetime: cfg.lifetime,
      age: 0,
      radius: w.radius,
      trailColor: cfg.trailColor,
      trailTimer: 0,
      trailSpacing: cfg.trailLength,
      isLocal,
      mesh,
      light,
    };

    this.projectiles.push(proj);
    return proj;
  }

  /** Per-frame update: move projectiles, check collisions, trigger impacts */
  update(delta: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += delta;

      // Lifetime check
      if (p.age >= p.lifetime) {
        this.removeProjectile(i);
        continue;
      }

      // Apply gravity
      p.vel.y -= p.gravity * delta;

      // Compute step
      const stepDist = p.vel.length() * delta;

      // Collision detection (subdivide if step is large to prevent tunneling)
      const subSteps = Math.max(1, Math.ceil(stepDist));
      const subDist = stepDist / subSteps;
      let impacted = false;

      for (let s = 0; s < subSteps; s++) {
        const segOrigin = p.pos.clone();
        const segDir = p.vel.clone().normalize();

        // Block collision
        const blockHit = this.weapons.raycastVoxels(segOrigin, segDir, subDist);
        if (blockHit) {
          p.pos.set(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
          this.handleImpact(p, blockHit);
          this.removeProjectile(i);
          impacted = true;
          break;
        }

        // Player collision
        const hitPlayerIds = this.weapons.raycastPlayers(segOrigin, segDir, subDist);
        if (hitPlayerIds.length > 0) {
          // Impact at current position
          const hitPos = {
            x: Math.floor(p.pos.x),
            y: Math.floor(p.pos.y),
            z: Math.floor(p.pos.z),
          };
          this.handleImpactPlayers(p, hitPos, hitPlayerIds);
          this.removeProjectile(i);
          impacted = true;
          break;
        }

        // Advance position for this sub-step
        p.pos.addScaledVector(segDir, subDist);
      }

      if (impacted) continue;

      // Out of bounds check
      if (p.pos.y < -10 || p.pos.y > 100 || p.pos.x < -5 || p.pos.x > 133 || p.pos.z < -5 || p.pos.z > 133) {
        this.removeProjectile(i);
        continue;
      }

      // Update visuals
      p.mesh.position.copy(p.pos);
      if (p.light) p.light.position.copy(p.pos);

      // Stretch mesh in velocity direction for motion blur effect
      const speed = p.vel.length();
      if (speed > 1) {
        p.mesh.lookAt(p.pos.clone().add(p.vel));
        const stretch = Math.min(3, speed / p.speed * 2);
        const cfg = WEAPONS[p.weaponIndex].projectile;
        p.mesh.scale.set(cfg.size, cfg.size, cfg.size * stretch);
      }

      // Trail particles
      if (p.trailSpacing > 0) {
        p.trailTimer += delta;
        if (p.trailTimer >= p.trailSpacing / p.speed) {
          p.trailTimer = 0;
          this.vfx.emitProjectileTrail(p.pos.x, p.pos.y, p.pos.z, p.trailColor);
        }
      }
    }
  }

  private handleImpact(
    p: ActiveProjectile,
    blockHit: { x: number; y: number; z: number },
  ): void {
    if (p.isLocal) {
      // Compute destroyed blocks (radius logic)
      const destroyed: ProjectileImpact['destroyedBlocks'] = [];
      const w = WEAPONS[p.weaponIndex];

      if (w.radius > 0) {
        const r = w.radius;
        const r2 = r * r;
        for (let bx = Math.floor(blockHit.x - r); bx <= Math.ceil(blockHit.x + r); bx++) {
          for (let by = Math.floor(blockHit.y - r); by <= Math.ceil(blockHit.y + r); by++) {
            for (let bz = Math.floor(blockHit.z - r); bz <= Math.ceil(blockHit.z + r); bz++) {
              const dx = bx - blockHit.x, dy = by - blockHit.y, dz = bz - blockHit.z;
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
        const bt = this.world.getBlock(blockHit.x, blockHit.y, blockHit.z);
        if (bt !== 0) {
          this.world.setBlock(blockHit.x, blockHit.y, blockHit.z, 0);
          destroyed.push({ x: blockHit.x, y: blockHit.y, z: blockHit.z, blockType: bt });
        }
      }

      // Check for player hits near impact (for explosive projectiles)
      const hitPlayerIds: string[] = [];
      if (w.radius > 0) {
        const impactPos = new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
        for (const [id, group] of this.otherPlayers) {
          const dist = impactPos.distanceTo(group.position);
          if (dist <= w.radius + 2) {
            hitPlayerIds.push(id);
          }
        }
      }

      const travelTimeMs = performance.now() - p.firedAt;
      this.onLocalImpact({
        weaponIndex: p.weaponIndex,
        hitPos: blockHit,
        destroyedBlocks: destroyed,
        hitPlayerIds,
        origin: p.origin,
        direction: p.vel.clone().normalize(),
        travelTimeMs,
      });
    } else {
      // Remote projectile: just VFX
      const w = WEAPONS[p.weaponIndex];
      this.vfx.emitImpact(blockHit.x, blockHit.y, blockHit.z);
      if (w.radius > 0) {
        this.vfx.emitExplosion(blockHit.x, blockHit.y, blockHit.z, w.radius);
      }
    }
  }

  private handleImpactPlayers(
    p: ActiveProjectile,
    hitPos: { x: number; y: number; z: number },
    hitPlayerIds: string[],
  ): void {
    if (p.isLocal) {
      const travelTimeMs = performance.now() - p.firedAt;
      this.onLocalImpact({
        weaponIndex: p.weaponIndex,
        hitPos,
        destroyedBlocks: [],
        hitPlayerIds,
        origin: p.origin,
        direction: p.vel.clone().normalize(),
        travelTimeMs,
      });
    }

    // VFX for all (local and remote)
    const w = WEAPONS[p.weaponIndex];
    if (w.radius > 0) {
      this.vfx.emitExplosion(hitPos.x, hitPos.y, hitPos.z, w.radius);
    }
    this.vfx.emitImpact(hitPos.x, hitPos.y, hitPos.z);
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];

    this.scene.remove(p.mesh);
    (p.mesh.material as THREE.Material).dispose();

    if (p.light) {
      this.scene.remove(p.light);
      this.activeLightCount--;
    }

    this.projectiles.splice(index, 1);
  }

  dispose(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
  }
}
