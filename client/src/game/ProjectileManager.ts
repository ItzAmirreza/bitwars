import * as THREE from 'three';
import { VoxelWorld, BlockType } from './VoxelWorld';
import { WeaponSystem, WEAPONS } from './Weapons';
import { VEHICLE_WEAPONS } from './vehicles/VehicleManager';
import { COMBAT } from '../shared-config';
import { VFX } from './VFX';
import type { AudioSystem } from './AudioSystem';
import { collectCappedEllipsoidCoords } from './explosionPattern';

const MAX_PROJECTILES = 64;
const MAX_LIGHTS = 4;
const FLYBY_TRIGGER_DIST = 25;    // Start whiz when projectile enters this radius
const FLYBY_MIN_SPEED = 20;       // Min speed to trigger flyby sound

// ── Vehicle weapon visual configs (keyed by vehicle weapon index) ──
interface VehicleProjectileVisual {
  speed: number;
  gravity: number;
  size: number;
  trailLength: number;
  trailColor: number;
  lightIntensity: number;
  lightColor: number;
  lightRange: number;
  lifetime: number;
}

const VEHICLE_PROJECTILE_VISUALS: Record<number, VehicleProjectileVisual> = {
  // Rockets (index 1): same as existing RPG-style
  1: {
    speed: 80, gravity: 3, size: 0.15, trailLength: 0.5,
    trailColor: 0xff6600, lightIntensity: 3, lightColor: 0xff4400, lightRange: 8, lifetime: 5,
  },
  // Carpet Bomb (index 3): medium, orange trail
  3: {
    speed: 5, gravity: 20, size: 0.3, trailLength: 0.3,
    trailColor: 0xff6600, lightIntensity: 2.5, lightColor: 0xff4400, lightRange: 6, lifetime: 10,
  },
  // SAM Missile (index 5): red trail
  5: {
    speed: 90, gravity: 2, size: 0.15, trailLength: 0.5,
    trailColor: 0xff3333, lightIntensity: 3, lightColor: 0xff3333, lightRange: 8, lifetime: 5,
  },
  // Air Missile (index 6): cyan trail
  6: {
    speed: 120, gravity: 2, size: 0.15, trailLength: 0.6,
    trailColor: 0x00ccff, lightIntensity: 3.5, lightColor: 0x00ccff, lightRange: 10, lifetime: 5,
  },
};

export interface ProjectileImpact {
  weaponIndex: number;
  hitPos: { x: number; y: number; z: number };
  destroyedBlocks: { x: number; y: number; z: number; blockType: number }[];
  hitPlayerIds: string[];
  hitVehicleIds: number[];
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  travelTimeMs: number;
  isVehicle: boolean;
  vehicleWeaponIndex: number;
  sourceVehicleId: number;
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
  shooterId: string | null;
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  // Vehicle metadata
  isVehicle: boolean;
  vehicleWeaponIndex: number;
  sourceVehicleId: number;
  // Flyby audio
  flybyPlayed: boolean;
  prevDistToListener: number;
}

// Shared geometry/material for all projectile meshes
const _sphereGeo = new THREE.SphereGeometry(1, 8, 6);

export class ProjectileManager {
  private projectiles: ActiveProjectile[] = [];
  private scene: THREE.Scene;
  private world: VoxelWorld;
  private weapons: WeaponSystem;
  private vfx: VFX;
  private audio: AudioSystem;
  private camera: THREE.Camera;
  private otherPlayers: Map<string, THREE.Group>;
  private onLocalImpact: (impact: ProjectileImpact) => void;
  private activeLightCount = 0;

  constructor(
    scene: THREE.Scene,
    world: VoxelWorld,
    weapons: WeaponSystem,
    vfx: VFX,
    audio: AudioSystem,
    camera: THREE.Camera,
    otherPlayers: Map<string, THREE.Group>,
    onLocalImpact: (impact: ProjectileImpact) => void,
  ) {
    this.scene = scene;
    this.world = world;
    this.weapons = weapons;
    this.vfx = vfx;
    this.audio = audio;
    this.camera = camera;
    this.otherPlayers = otherPlayers;
    this.onLocalImpact = onLocalImpact;
  }

  /** Spawn a projectile from the local player's fire */
  spawnLocal(weaponIndex: number, origin: THREE.Vector3, direction: THREE.Vector3): boolean {
    return this.spawn(weaponIndex, origin, direction, performance.now(), true) !== null;
  }

  /** Spawn a projectile from the local player's vehicle weapon */
  spawnLocalVehicle(
    weaponIndex: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    vehicleWeaponIndex: number,
    sourceVehicleId: number,
  ): boolean {
    return this.spawn(weaponIndex, origin, direction, performance.now(), true, null, {
      vehicleWeaponIndex,
      sourceVehicleId,
    }) !== null;
  }

  /** Spawn a projectile from a remote player's ShotEvent */
  spawnRemote(
    weaponIndex: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    firedAt: number,
    shooterId: string,
  ): void {
    const p = this.spawn(weaponIndex, origin, direction, firedAt, false, shooterId);
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

  /** Spawn a remote vehicle projectile with correct visual config */
  spawnRemoteVehicle(
    weaponIndex: number,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    firedAt: number,
    shooterId: string,
    vehicleWeaponIndex: number,
    sourceVehicleId: number,
  ): void {
    const p = this.spawn(weaponIndex, origin, direction, firedAt, false, shooterId, {
      vehicleWeaponIndex,
      sourceVehicleId,
    });
    if (!p) return;

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
    shooterId: string | null = null,
    vehicleOpts?: { vehicleWeaponIndex: number; sourceVehicleId: number },
  ): ActiveProjectile | null {
    if (this.projectiles.length >= MAX_PROJECTILES) {
      if (!isLocal) {
        // Keep local projectiles reliable; recycle oldest remote projectile first.
        let oldestIdx = -1;
        let oldestAge = -1;
        for (let i = 0; i < this.projectiles.length; i++) {
          const p = this.projectiles[i];
          if (p.isLocal) continue;
          if (p.age > oldestAge) {
            oldestAge = p.age;
            oldestIdx = i;
          }
        }
        if (oldestIdx >= 0) this.removeProjectile(oldestIdx);
      }

      if (this.projectiles.length >= MAX_PROJECTILES) return null;
    }

    const w = WEAPONS[weaponIndex];
    const isVehicle = !!vehicleOpts;
    const vehWepIdx = vehicleOpts?.vehicleWeaponIndex ?? 0;

    // Use vehicle-specific visual config when available, otherwise infantry projectile config
    const vehVisual = isVehicle ? VEHICLE_PROJECTILE_VISUALS[vehWepIdx] : null;
    const cfg = vehVisual ?? w.projectile;
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

    // Vehicle projectiles use their own radius from VEHICLE_WEAPONS
    const radius = isVehicle ? (VEHICLE_WEAPONS[vehWepIdx]?.radius ?? w.radius) : w.radius;

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
      radius,
      trailColor: cfg.trailColor,
      trailTimer: 0,
      trailSpacing: cfg.trailLength,
      isLocal,
      shooterId,
      mesh,
      light,
      isVehicle,
      vehicleWeaponIndex: vehWepIdx,
      sourceVehicleId: vehicleOpts?.sourceVehicleId ?? 0,
      flybyPlayed: isLocal, // Local projectiles never play flyby on yourself
      prevDistToListener: Infinity,
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

      let impacted = false;
      if (p.isLocal) {
        // Collision detection (subdivide if step is large to prevent tunneling)
        const subSteps = Math.max(1, Math.ceil(stepDist));
        const subDist = stepDist / subSteps;

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

          // Vehicle collision
          const hitVehicleIds = this.filterSourceVehicleId(
            p,
            this.weapons.raycastVehicles(segOrigin, segDir, subDist),
          );
          if (hitVehicleIds.length > 0) {
            // Impact at current position
            const hitPos = {
              x: Math.floor(p.pos.x),
              y: Math.floor(p.pos.y),
              z: Math.floor(p.pos.z),
            };
            this.handleImpactVehicles(p, hitPos, hitVehicleIds);
            this.removeProjectile(i);
            impacted = true;
            break;
          }

          // Advance position for this sub-step
          p.pos.addScaledVector(segDir, subDist);
        }
      } else {
        // Remote projectiles are visual only. Server explosion events determine true impacts.
        const dir = p.vel.clone().normalize();
        p.pos.addScaledVector(dir, stepDist);
      }

      if (impacted) continue;

      // Out of bounds check (match actual world dimensions)
      const margin = 5;
      const maxY = Math.max(100, this.world.sizeY + 52);
      if (
        p.pos.y < -10
        || p.pos.y > maxY
        || p.pos.x < -margin
        || p.pos.x > this.world.sizeX + margin
        || p.pos.z < -margin
        || p.pos.z > this.world.sizeZ + margin
      ) {
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
        const vehVis = p.isVehicle ? VEHICLE_PROJECTILE_VISUALS[p.vehicleWeaponIndex] : null;
        const projSize = vehVis?.size ?? WEAPONS[p.weaponIndex].projectile.size;
        p.mesh.scale.set(projSize, projSize, projSize * stretch);
      }

      // Trail particles
      if (p.trailSpacing > 0) {
        p.trailTimer += delta;
        if (p.trailTimer >= p.trailSpacing / p.speed) {
          p.trailTimer = 0;
          this.vfx.emitProjectileTrail(p.pos.x, p.pos.y, p.pos.z, p.trailColor);
        }
      }

      // Flyby / whiz sound: triggers once when a non-local projectile
      // passes near the listener, giving a clear directional audio cue.
      if (!p.flybyPlayed) {
        const dx = p.pos.x - this.camera.position.x;
        const dy = p.pos.y - this.camera.position.y;
        const dz = p.pos.z - this.camera.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const projSpeed = p.vel.length();

        if (dist < FLYBY_TRIGGER_DIST && projSpeed > FLYBY_MIN_SPEED) {
          // Play on closest approach (distance started increasing) or on entry
          if (dist > p.prevDistToListener) {
            // Just passed closest point — play the whiz at closest position
            p.flybyPlayed = true;
            this.audio.playProjectileFlyby(projSpeed, {
              position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
            });
          }
        }
        p.prevDistToListener = dist;
      }
    }

  }

  /**
   * Predict block destruction matching server's destroy_spherical_blocks ellipsoid.
   * Server uses oblate spheroid: hr = radius, vr = radius * 0.5 for vehicle weapons,
   * hr = vr = radius for infantry weapons.
   * Bunker buster (vehicleWeaponIndex 2) uses a separate drill-and-detonate path
   * on the server, so we skip prediction here (the block-hit path handles it).
   */
  private predictBlockDestruction(
    p: ActiveProjectile,
    center: { x: number; y: number; z: number },
  ): ProjectileImpact['destroyedBlocks'] {
    const destroyed: ProjectileImpact['destroyedBlocks'] = [];

    // Bunker buster uses server-authoritative drill logic, not ellipsoid destruction.
    // Block-hit impacts are handled by the drilling simulation in update().
    if (p.isVehicle && p.vehicleWeaponIndex === 2) return destroyed;

    const w = WEAPONS[p.weaponIndex];

    // Determine radii to match server's destroy_spherical_blocks
    let hr: number, vr: number;
    if (p.isVehicle) {
      const vw = VEHICLE_WEAPONS[p.vehicleWeaponIndex];
      const r = vw?.radius ?? 6.0;
      hr = r;
      vr = Math.max(r * 0.5, 0.1); // Server: (def.radius * 0.5).max(0.1)
    } else {
      hr = w.radius;
      vr = w.radius; // Server: def.radius, def.radius (sphere)
    }

    if (hr <= 0) {
      // No radius — single block
      const bt = this.world.getBlock(center.x, center.y, center.z);
      if (bt !== 0 && bt !== BlockType.Bedrock) {
        this.weapons.trackPendingDestruction(center.x, center.y, center.z, bt);
        this.world.setBlock(center.x, center.y, center.z, 0);
        destroyed.push({ x: center.x, y: center.y, z: center.z, blockType: bt });
      }
      return destroyed;
    }

    const maxCandidates = COMBAT.maxBlockDestroyPerCall;
    const coords = collectCappedEllipsoidCoords(
      center,
      hr,
      vr,
      maxCandidates,
      (x, y, z) => this.world.inBounds(x, y, z),
    );
    for (const { x: bx, y: by, z: bz } of coords) {
      const bt = this.world.getBlock(bx, by, bz);
      if (bt !== 0 && bt !== BlockType.Bedrock) {
        this.weapons.trackPendingDestruction(bx, by, bz, bt);
        this.world.setBlock(bx, by, bz, 0);
        destroyed.push({ x: bx, y: by, z: bz, blockType: bt });
      }
    }
    return destroyed;
  }

  private handleImpact(
    p: ActiveProjectile,
    blockHit: { x: number; y: number; z: number },
  ): void {
    if (p.isLocal) {
      const destroyed = this.predictBlockDestruction(p, blockHit);

      // Check for player hits near impact (for explosive projectiles)
      const w = WEAPONS[p.weaponIndex];
      const hitPlayerIds: string[] = [];
      const splashRadius = p.isVehicle
        ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
        : w.radius;
      if (splashRadius > 0) {
        const impactPos = new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
        for (const [id, group] of this.otherPlayers) {
          const dist = impactPos.distanceTo(group.position);
          if (dist <= splashRadius + 2) {
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
        hitVehicleIds: this.filterSourceVehicleId(
          p,
          this.weapons.vehiclesWithinRadius(
            new THREE.Vector3(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5),
            splashRadius + 0.5,
          ),
        ),
        origin: p.origin,
        direction: p.vel.clone().normalize(),
        travelTimeMs,
        isVehicle: p.isVehicle,
        vehicleWeaponIndex: p.vehicleWeaponIndex,
        sourceVehicleId: p.sourceVehicleId,
      });
    } else {
      // Remote projectile: just VFX
      const w = WEAPONS[p.weaponIndex];
      this.vfx.emitImpact(blockHit.x, blockHit.y, blockHit.z);
      const vfxRadius = p.isVehicle
        ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
        : w.radius;
      if (vfxRadius > 0) {
        this.vfx.emitExplosion(blockHit.x, blockHit.y, blockHit.z, vfxRadius);
      }
    }
  }

  private handleImpactPlayers(
    p: ActiveProjectile,
    hitPos: { x: number; y: number; z: number },
    hitPlayerIds: string[],
  ): void {
    if (p.isLocal) {
      // Predict block destruction so server chunk updates don't cause pop-in
      const destroyed = this.predictBlockDestruction(p, hitPos);

      const travelTimeMs = performance.now() - p.firedAt;
      const splashRadius = p.isVehicle
        ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
        : WEAPONS[p.weaponIndex].radius;
      this.onLocalImpact({
        weaponIndex: p.weaponIndex,
        hitPos,
        destroyedBlocks: destroyed,
        hitPlayerIds,
        hitVehicleIds: this.filterSourceVehicleId(
          p,
          this.weapons.vehiclesWithinRadius(
            new THREE.Vector3(hitPos.x + 0.5, hitPos.y + 0.5, hitPos.z + 0.5),
            splashRadius + 0.5,
          ),
        ),
        origin: p.origin,
        direction: p.vel.clone().normalize(),
        travelTimeMs,
        isVehicle: p.isVehicle,
        vehicleWeaponIndex: p.vehicleWeaponIndex,
        sourceVehicleId: p.sourceVehicleId,
      });
    }

    // VFX for all (local and remote)
    const w = WEAPONS[p.weaponIndex];
    const vfxRadius = p.isVehicle
      ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
      : w.radius;
    if (vfxRadius > 0) {
      this.vfx.emitExplosion(hitPos.x, hitPos.y, hitPos.z, vfxRadius);
    }
    this.vfx.emitImpact(hitPos.x, hitPos.y, hitPos.z);
  }

  private handleImpactVehicles(
    p: ActiveProjectile,
    hitPos: { x: number; y: number; z: number },
    directHitVehicleIds: number[],
  ): void {
    if (p.isLocal) {
      // Predict block destruction so server chunk updates don't cause pop-in
      const destroyed = this.predictBlockDestruction(p, hitPos);

      const w = WEAPONS[p.weaponIndex];
      const impactCenter = new THREE.Vector3(hitPos.x + 0.5, hitPos.y + 0.5, hitPos.z + 0.5);
      const splashRadius = p.isVehicle
        ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
        : w.radius;

      const hitPlayerIds: string[] = [];
      if (splashRadius > 0) {
        for (const [id, group] of this.otherPlayers) {
          const dist = impactCenter.distanceTo(group.position);
          if (dist <= splashRadius + 2) {
            hitPlayerIds.push(id);
          }
        }
      }

      const splashVehicleIds = this.weapons.vehiclesWithinRadius(
        impactCenter,
        splashRadius + 0.5,
      );
      const directFiltered = this.filterSourceVehicleId(p, directHitVehicleIds);
      const splashFiltered = this.filterSourceVehicleId(p, splashVehicleIds);
      const hitVehicleIds = Array.from(new Set<number>([
        ...directFiltered,
        ...splashFiltered,
      ]));

      const travelTimeMs = performance.now() - p.firedAt;
      this.onLocalImpact({
        weaponIndex: p.weaponIndex,
        hitPos,
        destroyedBlocks: destroyed,
        hitPlayerIds,
        hitVehicleIds,
        origin: p.origin,
        direction: p.vel.clone().normalize(),
        travelTimeMs,
        isVehicle: p.isVehicle,
        vehicleWeaponIndex: p.vehicleWeaponIndex,
        sourceVehicleId: p.sourceVehicleId,
      });
    }

    // VFX for all (local and remote)
    const w = WEAPONS[p.weaponIndex];
    const vfxRadius = p.isVehicle
      ? (VEHICLE_WEAPONS[p.vehicleWeaponIndex]?.radius ?? 6.0)
      : w.radius;
    if (vfxRadius > 0) {
      this.vfx.emitExplosion(hitPos.x, hitPos.y, hitPos.z, vfxRadius);
    }
    this.vfx.emitImpact(hitPos.x, hitPos.y, hitPos.z);
  }

  private filterSourceVehicleId(p: ActiveProjectile, vehicleIds: number[]): number[] {
    if (!p.isVehicle || p.sourceVehicleId === 0) return vehicleIds;
    return vehicleIds.filter((id) => id !== p.sourceVehicleId);
  }

  /**
   * Remove a remote projectile when the authoritative server explosion arrives.
   * Uses shooter + weapon + nearest-to-impact matching with a generous radius.
   */
  resolveRemoteImpact(
    shooterId: string,
    weaponIndex: number,
    impactPos: { x: number; y: number; z: number },
    radius: number,
  ): void {
    const maxDistSq = Math.max(25, (radius + 6) * (radius + 6));
    let bestIdx = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i];
      if (p.isLocal) continue;
      if (p.weaponIndex !== weaponIndex) continue;
      if (p.shooterId !== shooterId) continue;

      const dx = p.pos.x - impactPos.x;
      const dy = p.pos.y - impactPos.y;
      const dz = p.pos.z - impactPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= maxDistSq && d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) this.removeProjectile(bestIdx);
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

  /** Remove all active projectiles (used on map reset). */
  clearAll(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
  }

  dispose(): void {
    this.clearAll();
  }
}
