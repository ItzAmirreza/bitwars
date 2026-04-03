import * as THREE from 'three';
import { BLOCK_COLORS, BlockType } from './VoxelWorld';
import type { WeaponSystem } from './Weapons';
import type { AudioSystem } from './AudioSystem';
import type { VFX } from './VFX';
import type { PhysicsSystem } from './PhysicsSystem';
import type { ProjectileManager } from './ProjectileManager';
import type { FPSControls } from './FPSControls';
import type { DbConnection } from '../module_bindings';
import { COMBAT } from '../shared-config';
import type { ChunkApplyBudget, VoxelWorld } from './VoxelWorld';
import type VehicleManager from './vehicles/VehicleManager';
import { VEHICLE_WEAPONS } from './vehicles/VehicleManager';
import { collectCappedEllipsoidCoords } from './explosionPattern';

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
    maxApplyMs: 2.4,
  };

  constructor(ctx: VehicleFireContext) {
    this.ctx = ctx;
  }

  // ── VEHICLE RELOAD ──

  startVehicleReload(): void {
    const ctx = this.ctx;
    const slotIdx = ctx.vehicleManager.vehicleWeaponIndex;
    const resolvedIdx = ctx.vehicleManager.getResolvedVehicleWeaponIndex();
    const wep = VEHICLE_WEAPONS[resolvedIdx];
    if (!wep) return;

    // Already reloading this weapon?
    const now = performance.now();
    if (ctx.vehicleManager.vehicleReloadingUntil[slotIdx] > now) return;

    // Already full?
    if (ctx.vehicleManager.vehicleAmmo[slotIdx] >= wep.maxAmmo) return;

    // Start reload timer
    ctx.vehicleManager.vehicleReloadingUntil[slotIdx] = now + wep.reloadTime * 1000;

    // Play reload sound
    ctx.audio.playReload(ctx.localAudioSource(-0.15));

    // Tell server to reload (server applies instantly; client waits for timer)
    if (ctx.conn) ctx.conn.reducers.reloadVehicleWeapon({});
  }

  tickVehicleReload(): void {
    const ctx = this.ctx;
    const now = performance.now();
    // Iterate over all weapon slots (up to 3 for jets)
    for (let slot = 0; slot < 3; slot++) {
      if (ctx.vehicleManager.vehicleReloadingUntil[slot] > 0 && now >= ctx.vehicleManager.vehicleReloadingUntil[slot]) {
        // Resolve the actual weapon index for this slot to get correct maxAmmo
        const savedSlot = ctx.vehicleManager.vehicleWeaponIndex;
        ctx.vehicleManager.vehicleWeaponIndex = slot;
        const resolvedIdx = ctx.vehicleManager.getResolvedVehicleWeaponIndex();
        ctx.vehicleManager.vehicleWeaponIndex = savedSlot;
        const wep = VEHICLE_WEAPONS[resolvedIdx];
        // Reload timer expired — client-predict ammo refill
        ctx.vehicleManager.vehicleAmmo[slot] = wep ? wep.maxAmmo : 0;
        ctx.vehicleManager.vehicleReloadingUntil[slot] = 0;
      }
    }
  }

  // ── VEHICLE FIRE ──

  tryVehicleFire(): void {
    const ctx = this.ctx;
    if (ctx.mountedVehicleId === 0) return;
    if (ctx.health <= 0) return;
    if (!ctx.conn) return;

    // Resolve the actual weapon index (jets map slots 0/1 to indices 2/3)
    const resolvedIdx = ctx.vehicleManager.getResolvedVehicleWeaponIndex();
    const wep = VEHICLE_WEAPONS[resolvedIdx];
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

    // ── KINETIC PENETRATOR PATH (hitscan, weapon index 2) ──
    if (resolvedIdx === 2) {
      // Fire straight down from jet position
      const downDir = new THREE.Vector3(0, -1, 0);
      const fireOrigin = new THREE.Vector3(pose.x, pose.y - 1.0, pose.z);

      // Raycast downward to find ground hit
      const kpHit = ctx.weapons.raycastVoxels(fireOrigin, downDir, wep.maxRange);

      const hitBlocks: { x: number; y: number; z: number }[] = [];
      if (kpHit) {
        hitBlocks.push({ x: kpHit.x, y: kpHit.y, z: kpHit.z });

        // Client prediction: drill 3x3 column + base explosion
        this.predictKineticPenetratorStrike(kpHit.x, kpHit.y, kpHit.z, wep.radius);
      }

      // VFX: beam from jet to ground + explosion
      if (kpHit) {
        const hitCenter = new THREE.Vector3(kpHit.x + 0.5, kpHit.y + 0.5, kpHit.z + 0.5);
        ctx.vfx.emitKineticBeam(fireOrigin, hitCenter);
        ctx.vfx.emitExplosion(kpHit.x, kpHit.y, kpHit.z, 4);
      }

      ctx.audio.playKineticPenetratorFire(ctx.localAudioSource(-0.1));
      ctx.vfx.shake(1.0);

      // Sync to server
      this.syncVehicleFireToServer(downDir, [], [], hitBlocks);

      // Rebuild chunks
      ctx.world.rebuildDirtyChunks(ctx.scene, this.impactChunkApplyBudget);
      return;
    }

    if (!isHitscan) {
      // ── CARPET BOMB PATH (weapon index 3) ──
      if (resolvedIdx === 3) {
        // Match the server's side selection, which is based on the pre-fire ammo count.
        const preFireAmmo = ctx.vehicleManager.vehicleAmmo[ctx.vehicleManager.vehicleWeaponIndex] + 1;
        const side = preFireAmmo % 2 === 0 ? 1 : -1;
        ctx.vehicleManager.carpetBombSide = -side;

        // Server uses the mounted vehicle yaw, not pilot look yaw, for bomb offset/heading.
        const vehicleYaw = pose.yaw;
        const rightX = Math.cos(vehicleYaw);
        const rightZ = -Math.sin(vehicleYaw);
        const offset = side * 2.5; // Lateral offset

        const bombOrigin = new THREE.Vector3(
          pose.x + rightX * offset,
          pose.y - 1.0,
          pose.z + rightZ * offset,
        );
        const entity = ctx.vehicleManager.findEntityRow(ctx.mountedVehicleId);
        const vel = entity?.vel ?? { x: 0, y: 0, z: 0 };
        const horizontalSpeed = Math.sqrt(
          Number(vel.x) ** 2 + Number(vel.z) ** 2,
        );
        const forwardX = -Math.sin(vehicleYaw);
        const forwardZ = -Math.cos(vehicleYaw);
        // Match the server's forward-velocity inheritance for the bomb trajectory.
        const bombDir = new THREE.Vector3(
          forwardX * horizontalSpeed * 0.3,
          -1.0,
          forwardZ * horizontalSpeed * 0.3,
        );

        ctx.projectileManager.spawnLocalVehicle(
          2, bombOrigin, bombDir,
          resolvedIdx, ctx.mountedVehicleId,
        );

        this.syncVehicleFireToServer(bombDir, [], [], []);
        ctx.audio.playCarpetBombDrop(ctx.localAudioSource(-0.1));
        ctx.vfx.emitMuzzleFlashAt(bombOrigin, bombDir, 0xff6600);
        ctx.vfx.shake(0.3);
        return;
      }

      // ── AIR MISSILE PATH (weapon index 6) ──
      if (resolvedIdx === 6) {
        // Forward-firing air missile from jet nose
        const missileOrigin = new THREE.Vector3(
          pose.x + dir.x * 5.0,
          pose.y + 0.5,
          pose.z + dir.z * 5.0,
        );
        ctx.projectileManager.spawnLocalVehicle(
          2, missileOrigin, dir,
          resolvedIdx, ctx.mountedVehicleId,
        );
        this.syncVehicleFireToServer(dir, [], [], []);
        ctx.audio.playVehicleRocket(ctx.localAudioSource(-0.1));
        ctx.vfx.emitMuzzleFlashAt(missileOrigin, dir, 0x00ccff);
        ctx.vfx.shake(0.4);
        return;
      }

      // ── SAM MISSILE PATH (weapon index 5) — needs larger offset to clear AA hitbox ──
      if (resolvedIdx === 5) {
        const samOrigin = new THREE.Vector3(
          pose.x + dir.x * 6.0,
          pose.y + 2.0,
          pose.z + dir.z * 6.0,
        );
        ctx.projectileManager.spawnLocalVehicle(
          2, samOrigin, dir,
          resolvedIdx, ctx.mountedVehicleId,
        );
        this.syncVehicleFireToServer(dir, [], [], []);
        ctx.audio.playVehicleRocket(ctx.localAudioSource(-0.1));
        ctx.vfx.emitMuzzleFlashAt(samOrigin, dir, 0xff3333);
        ctx.vfx.shake(0.5);
        return;
      }

      // ── PROJECTILE PATH (Rockets) ──
      ctx.projectileManager.spawnLocalVehicle(
        2, origin, dir,
        resolvedIdx, ctx.mountedVehicleId,
      );

      // Sync to server
      this.syncVehicleFireToServer(dir, [], [], []);

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
                if (bt !== 0 && bt !== BlockType.Bedrock) {
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
        if (bt !== 0 && bt !== BlockType.Bedrock) {
          ctx.weapons.trackPendingDestruction(hit.x, hit.y, hit.z, bt);
          ctx.world.setBlock(hit.x, hit.y, hit.z, 0);
          destroyed.push({ x: hit.x, y: hit.y, z: hit.z, blockType: bt });
        }
      }
    }

    // Player hit detection
    const hitPlayerIds = ctx.weapons.raycastPlayers(origin, dir, wep.maxRange);
    const hitVehicleIds = ctx.weapons
      .raycastVehicles(origin, dir, wep.maxRange)
      .filter((id) => id !== ctx.mountedVehicleId);

    const isCram = resolvedIdx === 4;
    const tracerColor = isCram ? 0xfff4a3 : 0xffaa00;

    // VFX: tracer + muzzle flash
    ctx.vfx.emitTracer(
      origin,
      tracerEnd,
      tracerColor,
      isCram
        ? {
            opacity: 0.88,
            ttlMs: 95,
            particleCount: 7,
            particleSize: 13,
            particleJitter: 0.08,
          }
        : undefined,
    );
    ctx.vfx.emitMuzzleFlashAt(origin, dir, tracerColor);

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

    // Player / vehicle hit marker
    if (hitPlayerIds.length > 0 || hitVehicleIds.length > 0) {
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

  // ── KINETIC PENETRATOR CLIENT PREDICTION ──

  /** Predict kinetic penetrator destruction: 3x3 column down + sphere at base */
  private predictKineticPenetratorStrike(hitX: number, hitY: number, hitZ: number, radius: number): void {
    const ctx = this.ctx;
    const maxDrill = 30;
    const maxBlastCandidates = COMBAT.maxBlockDestroyPerCall;
    let finalY = hitY;

    // Phase 1: Drill 3x3 column downward
    for (let dy = 0; dy < maxDrill; dy++) {
      const y = hitY - dy;
      if (y < 0) break;
      let hitBedrock = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bt = ctx.world.getBlock(hitX + dx, y, hitZ + dz);
          if (bt === BlockType.Bedrock) { hitBedrock = true; continue; }
          if (bt !== 0) {
            ctx.weapons.trackPendingDestruction(hitX + dx, y, hitZ + dz, bt);
            ctx.world.setBlock(hitX + dx, y, hitZ + dz, 0);
          }
        }
      }
      if (hitBedrock) { finalY = y + 1; break; }
      finalY = y;
    }

    // Phase 2: Foundation explosion (sphere at bottom of shaft)
    const blastCoords = collectCappedEllipsoidCoords(
      { x: hitX, y: finalY, z: hitZ },
      radius,
      radius,
      maxBlastCandidates,
      (x, y, z) => ctx.world.inBounds(x, y, z),
    );
    for (const { x: bx, y: by, z: bz } of blastCoords) {
      const bt = ctx.world.getBlock(bx, by, bz);
      if (bt !== 0 && bt !== BlockType.Bedrock) {
        ctx.weapons.trackPendingDestruction(bx, by, bz, bt);
        ctx.world.setBlock(bx, by, bz, 0);
      }
    }

    // Underground explosion VFX
    ctx.vfx.emitExplosion(hitX, finalY, hitZ, 8);
    ctx.audio.playKineticPenetratorDetonation({ position: { x: hitX, y: finalY, z: hitZ } });
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
