import * as THREE from 'three';
import { BLOCK_COLORS } from './VoxelWorld';
import type { WeaponSystem } from './Weapons';
import type { AudioSystem } from './AudioSystem';
import type { VFX } from './VFX';
import type { PhysicsSystem } from './PhysicsSystem';
import type { ProjectileManager } from './ProjectileManager';
import type { FPSControls } from './FPSControls';
import type { DbConnection } from '../module_bindings';
import type { ChunkApplyBudget, VoxelWorld } from './VoxelWorld';
import type VehicleManager from './vehicles/VehicleManager';
import { VEHICLE_WEAPONS } from './vehicles/VehicleManager';

/** Minimal interface exposing only the Engine members VehicleFireController needs. */
export interface VehicleFireContext {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  conn: DbConnection | null;
  health: number;
  mountedVehicleId: number;
  hitMarkerTimer: number;
  hitMarkerType: 'block' | 'player' | 'none';
  weapons: WeaponSystem;
  audio: AudioSystem;
  vfx: VFX;
  physics: PhysicsSystem;
  projectileManager: ProjectileManager;
  controls: FPSControls;
  world: VoxelWorld;
  vehicleManager: VehicleManager;
  localAudioSource(heightOffset?: number): {
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    getPosition: () => { x: number; y: number; z: number };
    getDirection: () => { x: number; y: number; z: number };
  };
}

export class VehicleFireController {
  private ctx: VehicleFireContext;
  private readonly impactChunkApplyBudget: ChunkApplyBudget = {
    maxChunks: 32,
    maxBuildChunks: 32,
    maxApplyMs: 2.0,
  };

  constructor(ctx: VehicleFireContext) {
    this.ctx = ctx;
  }

  // ── VEHICLE RELOAD ──

  startVehicleReload(): void {
    const ctx = this.ctx;
    const idx = ctx.vehicleManager.vehicleWeaponIndex;
    const wep = VEHICLE_WEAPONS[idx];
    if (!wep) return;

    // Already reloading this weapon?
    const now = performance.now();
    if (ctx.vehicleManager.vehicleReloadingUntil[idx] > now) return;

    // Already full?
    if (ctx.vehicleManager.vehicleAmmo[idx] >= wep.maxAmmo) return;

    // Start reload timer
    ctx.vehicleManager.vehicleReloadingUntil[idx] = now + wep.reloadTime * 1000;

    // Play reload sound
    ctx.audio.playReload(ctx.localAudioSource(-0.15));

    // Tell server to reload (server applies instantly; client waits for timer)
    if (ctx.conn) ctx.conn.reducers.reloadVehicleWeapon({});
  }

  tickVehicleReload(): void {
    const ctx = this.ctx;
    const now = performance.now();
    for (let i = 0; i < VEHICLE_WEAPONS.length; i++) {
      if (ctx.vehicleManager.vehicleReloadingUntil[i] > 0 && now >= ctx.vehicleManager.vehicleReloadingUntil[i]) {
        // Reload timer expired — client-predict ammo refill
        ctx.vehicleManager.vehicleAmmo[i] = VEHICLE_WEAPONS[i].maxAmmo;
        ctx.vehicleManager.vehicleReloadingUntil[i] = 0;
      }
    }
  }

  // ── VEHICLE FIRE ──

  tryVehicleFire(): void {
    const ctx = this.ctx;
    if (ctx.mountedVehicleId === 0) return;
    if (ctx.health <= 0) return;
    if (!ctx.conn) return;

    const wep = VEHICLE_WEAPONS[ctx.vehicleManager.vehicleWeaponIndex];
    if (!wep) return;

    // Fire rate cooldown
    const now = performance.now();
    const cooldown = 1000 / wep.fireRate;
    if (now - ctx.vehicleManager.lastVehicleFireAt < cooldown) return;

    // Block firing while reloading
    if (ctx.vehicleManager.vehicleReloadingUntil[ctx.vehicleManager.vehicleWeaponIndex] > now) return;

    // Ammo check (client prediction) — auto-reload when empty
    if (ctx.vehicleManager.vehicleAmmo[ctx.vehicleManager.vehicleWeaponIndex] <= 0) {
      this.startVehicleReload();
      return;
    }

    ctx.vehicleManager.lastVehicleFireAt = now;
    ctx.vehicleManager.vehicleAmmo[ctx.vehicleManager.vehicleWeaponIndex]--; // Client prediction

    // Compute fire origin and direction from pilot aim (camera look direction)
    const lookYaw = ctx.vehicleManager.vehiclePilotYaw;
    const lookPitch = ctx.vehicleManager.vehiclePilotPitch;
    const cosPitch = Math.cos(lookPitch);
    const dir = new THREE.Vector3(
      -Math.sin(lookYaw) * cosPitch,
      Math.sin(lookPitch),
      -Math.cos(lookYaw) * cosPitch,
    ).normalize();

    // Apply spread for minigun
    if (wep.spread.x > 0 || wep.spread.y > 0) {
      dir.x += (Math.random() - 0.5) * wep.spread.x * 2;
      dir.y += (Math.random() - 0.5) * wep.spread.y * 2;
      dir.z += (Math.random() - 0.5) * wep.spread.x * 2;
      dir.normalize();
    }

    // Use the locally-rendered mounted pose for instant muzzle/projectile
    // feedback. Server fire remains authoritative and derives its own origin.
    const pose = ctx.vehicleManager.getMountedVehiclePose();
    if (!pose) return;
    const origin = new THREE.Vector3(
      pose.x + dir.x * 3.5,
      pose.y + 1.0,
      pose.z + dir.z * 3.5,
    );

    const isHitscan = wep.projectileSpeed === 0;

    if (!isHitscan) {
      // ── PROJECTILE PATH (Rockets) ──
      // Spawn client-side vehicle projectile using RPG config for visuals
      const spawned = ctx.projectileManager.spawnLocalVehicle(
        2, origin, dir,
        ctx.vehicleManager.vehicleWeaponIndex, ctx.mountedVehicleId,
      );
      if (spawned) {
        // Visual uses RPG projectile config; destruction shape handled by vehicle oblate spheroid
      }

      // Sync to server
      this.syncVehicleFireToServer(dir, [], [], []);

      // Audio + VFX
      ctx.audio.playVehicleRocket(ctx.localAudioSource(-0.1));
      ctx.vfx.emitMuzzleFlashAt(origin, dir, 0xff4400);
      ctx.vfx.shake(0.6);
      return;
    }

    // ── HITSCAN PATH (Minigun) ──
    const hit = ctx.weapons.raycastVoxels(origin, dir, wep.maxRange);

    const destroyed: { x: number; y: number; z: number; blockType: number }[] = [];
    const tracerEnd = hit
      ? new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5)
      : origin.clone().add(dir.clone().multiplyScalar(wep.maxRange));

    if (hit) {
      if (wep.radius > 0) {
        // Explosive hitscan (shouldn't happen for minigun, but handle it)
        const r = wep.radius;
        const r2 = r * r;
        for (let bx = Math.floor(hit.x - r); bx <= Math.ceil(hit.x + r); bx++) {
          for (let by = Math.floor(hit.y - r); by <= Math.ceil(hit.y + r); by++) {
            for (let bz = Math.floor(hit.z - r); bz <= Math.ceil(hit.z + r); bz++) {
              const ddx = bx - hit.x, ddy = by - hit.y, ddz = bz - hit.z;
              if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) {
                const bt = ctx.world.getBlock(bx, by, bz);
                if (bt !== 0) {
                  ctx.weapons.trackPendingDestruction(bx, by, bz, bt);
                  ctx.world.setBlock(bx, by, bz, 0);
                  destroyed.push({ x: bx, y: by, z: bz, blockType: bt });
            }
          }
            }
          }
        }
      } else {
        // Single block destruction (minigun)
        const bt = ctx.world.getBlock(hit.x, hit.y, hit.z);
        if (bt !== 0) {
          ctx.weapons.trackPendingDestruction(hit.x, hit.y, hit.z, bt);
          ctx.world.setBlock(hit.x, hit.y, hit.z, 0);
          destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
        }
      }
    }

    // Player hit detection
    const hitPlayerIds = ctx.weapons.raycastPlayers(origin, dir, wep.maxRange);
    const hitVehicleIds = ctx.weapons.raycastVehicles(origin, dir, wep.maxRange);

    // VFX: tracer + muzzle flash
    ctx.vfx.emitTracer(origin, tracerEnd, 0xffaa00);
    ctx.vfx.emitMuzzleFlashAt(origin, dir, 0xffaa00);

    // VFX: impact
    if (hit) {
      ctx.vfx.emitImpact(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      ctx.hitMarkerTimer = 0.12;
      ctx.hitMarkerType = 'block';

      // Debris particles
      const max = 4;
      const sampled = destroyed.length > max
        ? destroyed.sort(() => Math.random() - 0.5).slice(0, max) : destroyed;
      for (const b of sampled) {
        ctx.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
      }
    }

    // Player hit marker
    if (hitPlayerIds.length > 0) {
      ctx.hitMarkerTimer = 0.2;
      ctx.hitMarkerType = 'player';
      ctx.audio.playHitMarker();
    }

    // Audio: minigun burst
    ctx.audio.playVehicleMinigun(ctx.localAudioSource(-0.1));
    ctx.vfx.shake(0.15);

    // Sync to server
    this.syncVehicleFireToServer(
      dir,
      hitPlayerIds,
      hitVehicleIds,
      destroyed.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    );

    // Rebuild affected chunks (capped to avoid frame spikes from large backlogs)
    ctx.world.rebuildDirtyChunks(ctx.scene, this.impactChunkApplyBudget);
  }

  // ── SERVER SYNC ──

  /** Sync vehicle weapon fire to server */
  private syncVehicleFireToServer(
    direction: THREE.Vector3,
    hitPlayerIds: string[],
    hitVehicleIds: number[],
    hitBlocks: { x: number; y: number; z: number }[],
  ): void {
    const conn = this.ctx.conn;
    if (!conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of hitPlayerIds) {
      for (const p of conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    conn.reducers.fireVehicleWeapon({
      direction: { x: direction.x, y: direction.y, z: direction.z },
      hitPlayers: hitPlayerIdentities,
      hitVehicles: hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: hitBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    });
  }
}
