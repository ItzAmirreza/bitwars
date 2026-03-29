import * as THREE from 'three';
import { BLOCK_COLORS } from './VoxelWorld';
import { WeaponSystem, WEAPONS } from './Weapons';
import type { FireResult } from './Weapons';
import type { AudioSystem } from './AudioSystem';
import type { VFX } from './VFX';
import type { WeaponModel } from './WeaponModel';
import type { PhysicsSystem } from './PhysicsSystem';
import type { ProjectileManager } from './ProjectileManager';
import type { ProjectileImpact } from './ProjectileManager';
import type { FPSControls } from './FPSControls';
import type { DbConnection } from '../module_bindings';
import type { ChunkApplyBudget, VoxelWorld } from './VoxelWorld';

/** Minimal interface exposing only the Engine members InfantryFireController needs. */
export interface InfantryFireContext {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  conn: DbConnection | null;
  localIdentity: string | null;
  health: number;
  spawnProtected: boolean;
  mountedVehicleId: number;
  hitMarkerTimer: number;
  hitMarkerType: 'block' | 'player' | 'none';
  weapons: WeaponSystem;
  audio: AudioSystem;
  vfx: VFX;
  weaponModel: WeaponModel;
  physics: PhysicsSystem;
  projectileManager: ProjectileManager;
  controls: FPSControls;
  world: VoxelWorld;
  spawnPredictedGrenade(origin: THREE.Vector3, direction: THREE.Vector3): boolean;
  localAudioSource(heightOffset?: number): {
    position: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    getPosition: () => { x: number; y: number; z: number };
    getDirection: () => { x: number; y: number; z: number };
  };
}

export class InfantryFireController {
  private ctx: InfantryFireContext;
  private readonly impactChunkApplyBudget: ChunkApplyBudget = {
    maxChunks: 32,
    maxBuildChunks: 32,
    maxApplyMs: 2.4,
  };

  constructor(ctx: InfantryFireContext) {
    this.ctx = ctx;
  }

  // ── FIRE ──

  tryFire(): void {
    const ctx = this.ctx;
    if (ctx.mountedVehicleId !== 0) return;
    if (ctx.health <= 0) return; // Dead — cannot fire
    if (ctx.spawnProtected) return; // Spawn protected — cannot fire yet
    if (ctx.weapons.getAmmo() <= 0) {
      ctx.audio.playEmpty(ctx.localAudioSource(-0.1));
      return;
    }

    const result = ctx.weapons.fire();
    if (!result) return;

    const isRifle = result.weaponIndex === 0;
    const isShotgun = result.weaponIndex === 1;
    const isRPG = result.weaponIndex === 2;
    const isMachineGun = result.weaponIndex === 3;
    const isGrenade = result.weaponIndex === 4;
    const isSniper = result.weaponIndex === 5;

    // Audio (always plays on fire)
    const localShotAudio = ctx.localAudioSource(-0.1);
    if (isRifle) ctx.audio.playRifle(localShotAudio);
    else if (isShotgun) ctx.audio.playShotgun(localShotAudio);
    else if (isRPG) ctx.audio.playRPGLaunch(localShotAudio);
    else if (isMachineGun) ctx.audio.playMachineGun(localShotAudio);
    else if (isGrenade) ctx.audio.playGrenadeLaunch(localShotAudio);
    else if (isSniper) ctx.audio.playSniper(localShotAudio);

    // Muzzle flash + shake + recoil (always)
    ctx.vfx.emitMuzzleFlash();
    ctx.vfx.shake(isSniper ? 0.7 : isGrenade ? 0.55 : isRPG ? 0.5 : isShotgun ? 0.8 : isMachineGun ? 0.25 : 0.3);
    ctx.weaponModel.triggerRecoil(WEAPONS[result.weaponIndex].recoil);

    if (result.isProjectile) {
      // ── PROJECTILE PATH ──
      if (result.weaponIndex === 4) {
        // Grenade launcher: instant local ghost + server-authoritative reconciliation.
        const spawned = ctx.spawnPredictedGrenade(result.origin, result.direction);
        if (!spawned) {
          ctx.weapons.restoreAmmo(result.weaponIndex);
          return;
        }
        this.syncFireToServer(result);
        return;
      }
      // Spawn projectile, sync fire (ammo deduction only, no hits)
      const spawned = ctx.projectileManager.spawnLocal(result.weaponIndex, result.origin, result.direction);
      if (!spawned) {
        ctx.weapons.restoreAmmo(result.weaponIndex);
        return;
      }
      this.syncFireToServer(result);
      return;
    }

    // ── HITSCAN PATH (unchanged) ──

    // Tracer (hitscan primaries)
    if ((isRifle || isMachineGun) && result.tracerEnd) {
      const from = ctx.camera.position.clone()
        .add(new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion));
      ctx.vfx.emitTracer(from, result.tracerEnd, isMachineGun ? 0x99eeff : 0x88bbff);
    }

    // Shotgun pellet tracers
    if (isShotgun && result.pelletEnds) {
      const from = ctx.camera.position.clone()
        .add(new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.camera.quaternion));
      for (const pelletEnd of result.pelletEnds) {
        ctx.vfx.emitTracer(from, pelletEnd, 0xffaa44);
      }
    }

    // Block hit
    if (result.hitPos) {
      const hitAudioPos = { x: result.hitPos.x + 0.5, y: result.hitPos.y + 0.5, z: result.hitPos.z + 0.5 };
      ctx.audio.playBlockBreak({ position: hitAudioPos });
      ctx.hitMarkerTimer = 0.15;
      ctx.hitMarkerType = 'block';

      // Debris particles (cap for perf)
      const blocks = result.destroyedBlocks;
      const max = isGrenade ? 24 : isRPG ? 15 : isShotgun ? 8 : blocks.length;
      const sampled = blocks.length > max
        ? blocks.sort(() => Math.random() - 0.5).slice(0, max) : blocks;
      for (const b of sampled) {
        ctx.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
      }
      ctx.vfx.emitImpact(result.hitPos.x, result.hitPos.y, result.hitPos.z);

      // Explosion
      if (WEAPONS[result.weaponIndex].radius > 0) {
        const explosionRadius = WEAPONS[result.weaponIndex].radius;
        const explosionDamage = WEAPONS[result.weaponIndex].damage;
        ctx.vfx.emitExplosion(result.hitPos.x, result.hitPos.y, result.hitPos.z, explosionRadius);
        const explosionAudioPos = { x: result.hitPos.x + 0.5, y: result.hitPos.y + 0.5, z: result.hitPos.z + 0.5 };
        if (isRPG || isGrenade) {
          setTimeout(() => ctx.audio.playExplosion({ position: explosionAudioPos }), 80);
        } else {
          ctx.audio.playExplosion({ position: explosionAudioPos });
        }
        this.applyExplosionCameraEffects(
          result.hitPos.x,
          result.hitPos.y,
          result.hitPos.z,
          explosionRadius,
          explosionDamage,
        );
      }
    }

    // Player hit marker
    if (result.hitPlayerIds.length > 0) {
      ctx.hitMarkerTimer = 0.2;
      ctx.hitMarkerType = 'player';
      ctx.audio.playHitMarker();
    }

    // Server sync: unified fire_weapon reducer with hit players and blocks
    this.syncFireToServer(result);

    // Explosion physics: knockback + flying debris + force on existing falling blocks
    if (result.hitPos && WEAPONS[result.weaponIndex].radius > 0) {
      const w = WEAPONS[result.weaponIndex];
      const hx = result.hitPos.x, hy = result.hitPos.y, hz = result.hitPos.z;

      // Player knockback (rocket jumping etc.)
      this.applyExplosionKnockback(hx, hy, hz, w.radius, w.damage);

      // Spawn destroyed blocks as flying physics debris
      if (result.destroyedBlocks.length > 0) {
        ctx.physics.spawnExplosionDebris(result.destroyedBlocks, hx, hy, hz, w.radius, w.damage * 0.2);
      }

      // Push already-falling blocks
      ctx.physics.applyExplosionForce(hx, hy, hz, w.radius * 2, w.damage * 1.5);
    }

    // Rebuild affected chunks (capped to avoid frame spikes from large backlogs)
    ctx.world.rebuildDirtyChunks(ctx.scene, this.impactChunkApplyBudget);
  }

  // ── PROJECTILE IMPACT CALLBACK ──

  handleProjectileImpact(impact: ProjectileImpact): void {
    const ctx = this.ctx;
    const w = WEAPONS[impact.weaponIndex];
    const effectiveRadius = impact.isVehicle ? 6.0 : w.radius;

    // Audio
    ctx.audio.playBlockBreak({
      position: {
        x: impact.hitPos.x + 0.5,
        y: impact.hitPos.y + 0.5,
        z: impact.hitPos.z + 0.5,
      },
    });
    if (effectiveRadius > 0) {
      setTimeout(() => ctx.audio.playExplosion({
        position: {
          x: impact.hitPos.x + 0.5,
          y: impact.hitPos.y + 0.5,
          z: impact.hitPos.z + 0.5,
        },
      }), 80);
    }

    // Hit marker
    if (impact.hitPlayerIds.length > 0) {
      ctx.hitMarkerTimer = 0.2;
      ctx.hitMarkerType = 'player';
      ctx.audio.playHitMarker();
    } else if (impact.destroyedBlocks.length > 0) {
      ctx.hitMarkerTimer = 0.2;
      ctx.hitMarkerType = 'block';
    }

    // Block debris VFX (cap for perf)
    const blocks = impact.destroyedBlocks;
    const max = 15;
    const sampled = blocks.length > max
      ? blocks.sort(() => Math.random() - 0.5).slice(0, max) : blocks;
    for (const b of sampled) {
      ctx.vfx.emitBlockDebris(b.x, b.y, b.z, BLOCK_COLORS[b.blockType] || 0x808080);
    }

    // Impact + explosion VFX
    ctx.vfx.emitImpact(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z);
    if (effectiveRadius > 0) {
      ctx.vfx.emitExplosion(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, effectiveRadius);
      this.applyExplosionCameraEffects(impact.hitPos.x, impact.hitPos.y, impact.hitPos.z, effectiveRadius, impact.isVehicle ? 45 : w.damage);
    }

    // Explosion physics: knockback + flying debris + force on existing falling blocks
    if (effectiveRadius > 0) {
      const hx = impact.hitPos.x, hy = impact.hitPos.y, hz = impact.hitPos.z;
      const effectiveDamage = impact.isVehicle ? 45 : w.damage;

      // Player knockback (rocket jumping etc.)
      this.applyExplosionKnockback(hx, hy, hz, effectiveRadius, effectiveDamage);

      // Spawn destroyed blocks as flying physics debris
      if (impact.destroyedBlocks.length > 0) {
        ctx.physics.spawnExplosionDebris(impact.destroyedBlocks, hx, hy, hz, effectiveRadius, effectiveDamage * 0.2);
      }

      // Push already-falling blocks
      ctx.physics.applyExplosionForce(hx, hy, hz, effectiveRadius * 2, effectiveDamage * 1.5);
    }

    // Rebuild affected chunks (capped to avoid frame spikes from large backlogs)
    ctx.world.rebuildDirtyChunks(ctx.scene, this.impactChunkApplyBudget);

    // Server sync: route to correct reducer
    if (impact.isVehicle) {
      this.syncVehicleImpactToServer(impact);
    } else {
      this.syncImpactToServer(impact);
    }
  }

  // ── EXPLOSION EFFECTS ──

  /** Apply local camera feedback from explosions based on proximity and blast strength */
  applyExplosionCameraEffects(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    const dx = this.ctx.camera.position.x - cx;
    const dy = this.ctx.camera.position.y - cy;
    const dz = this.ctx.camera.position.z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const maxEffectDist = radius * 11 + 10;
    if (dist >= maxEffectDist) return;

    const proximity = 1 - dist / maxEffectDist;
    const shaped = proximity * proximity;
    const weaponPower = THREE.MathUtils.clamp(damage / 90, 0.55, 1.4);

    // Keep explosion shake readable but not overwhelming at any distance.
    const shake = (0.03 + shaped * 0.65 + proximity * 0.12) * weaponPower;
    this.ctx.vfx.shake(Math.min(0.8, shake));
  }

  /** Apply explosion knockback to the local player based on distance from blast center */
  applyExplosionKnockback(
    cx: number, cy: number, cz: number,
    radius: number, damage: number,
  ): void {
    const px = this.ctx.camera.position.x;
    const py = this.ctx.camera.position.y;
    const pz = this.ctx.camera.position.z;

    // Use body center instead of camera eye so side blasts stay mostly horizontal.
    const bodyY = py - 0.9;

    const dx = px - cx;
    const dy = bodyY - cy;
    const dz = pz - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Slightly wider than destruction radius, but not excessive.
    const maxDist = radius * 3.4;
    if (dist >= maxDist || dist < 0.01) return;

    const proximity = 1 - dist / maxDist;
    const falloff = proximity * proximity;
    const coreBoost = 1 + proximity * 0.35;

    const baseKnockback = damage * (0.2 + radius * 0.022);
    const knockback = baseKnockback * falloff * coreBoost;

    // Radial impulse away from blast center (realistic directionality).
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;

    // Small ground-coupling lift only when explosion is below the body center.
    const belowFactor = THREE.MathUtils.clamp((bodyY - cy) / (radius + 1.2), 0, 1);
    const updraft = knockback * 0.12 * belowFactor;

    this.ctx.controls.applyImpulse(
      nx * knockback,
      ny * knockback + updraft,
      nz * knockback,
    );
  }

  // ── SERVER SYNC ──

  /** Send fire event to server with hit players/vehicles and destroyed blocks */
  private syncFireToServer(result: FireResult): void {
    const conn = this.ctx.conn;
    if (!conn) return;

    // Convert hex player IDs to Identity objects
    const hitPlayerIdentities: any[] = [];
    for (const hexId of result.hitPlayerIds) {
      // Find the player in the DB by matching hex identity
      for (const p of conn.db.player.iter()) {
        if ((p as any).identity.toHexString() === hexId) {
          hitPlayerIdentities.push((p as any).identity);
          break;
        }
      }
    }

    conn.reducers.fireWeapon({
      origin: { x: result.origin.x, y: result.origin.y, z: result.origin.z },
      direction: { x: result.direction.x, y: result.direction.y, z: result.direction.z },
      weapon: result.weaponIndex,
      hitPlayers: hitPlayerIdentities,
      hitVehicles: result.hitVehicleIds.map((id) => BigInt(id)),
      hitBlocks: result.destroyedBlocks.map((b) => ({ x: b.x, y: b.y, z: b.z })),
    });
  }

  /** Send projectile impact to server for damage/block validation */
  private syncImpactToServer(impact: ProjectileImpact): void {
    const conn = this.ctx.conn;
    if (!conn) return;
    const resolvedShotEventId = impact.shotEventId ?? this.resolveShotEventIdForImpact(impact);

    conn.reducers.projectileImpact({
      shotOrigin: { x: impact.origin.x, y: impact.origin.y, z: impact.origin.z },
      impactPos: { x: impact.hitPos.x, y: impact.hitPos.y, z: impact.hitPos.z },
      direction: { x: impact.direction.x, y: impact.direction.y, z: impact.direction.z },
      weapon: impact.weaponIndex,
      travelTimeMs: Math.round(impact.travelTimeMs),
      hitPlayers: [],
      hitVehicles: [],
      hitBlocks: [],
      shotEventId: resolvedShotEventId ?? 0n,
    });
  }

  private syncVehicleImpactToServer(impact: ProjectileImpact): void {
    const conn = this.ctx.conn;
    if (!conn) return;
    const resolvedShotEventId = impact.shotEventId ?? this.resolveShotEventIdForImpact(impact);

    // Very low-altitude carpet bombs can impact before ShotEvent replication arrives.
    // Give one short grace retry to capture authoritative shot id and avoid heuristic matching.
    if (resolvedShotEventId === null && impact.isVehicle && impact.vehicleWeaponIndex === 3) {
      setTimeout(() => {
        const retryConn = this.ctx.conn;
        if (!retryConn) return;
        const retryShotEventId = this.resolveShotEventIdForImpact(impact);
        retryConn.reducers.vehicleProjectileImpact({
          shotOrigin: { x: impact.origin.x, y: impact.origin.y, z: impact.origin.z },
          impactPos: { x: impact.hitPos.x, y: impact.hitPos.y, z: impact.hitPos.z },
          direction: { x: impact.direction.x, y: impact.direction.y, z: impact.direction.z },
          vehicleWeapon: impact.vehicleWeaponIndex,
          travelTimeMs: Math.round(impact.travelTimeMs),
          hitPlayers: [],
          hitVehicles: [],
          hitBlocks: [],
          shotEventId: retryShotEventId ?? 0n,
          sourceVehicleId: BigInt(impact.sourceVehicleId),
        });
      }, 40);
      return;
    }

    conn.reducers.vehicleProjectileImpact({
      shotOrigin: { x: impact.origin.x, y: impact.origin.y, z: impact.origin.z },
      impactPos: { x: impact.hitPos.x, y: impact.hitPos.y, z: impact.hitPos.z },
      direction: { x: impact.direction.x, y: impact.direction.y, z: impact.direction.z },
      vehicleWeapon: impact.vehicleWeaponIndex,
      travelTimeMs: Math.round(impact.travelTimeMs),
      hitPlayers: [],
      hitVehicles: [],
      hitBlocks: [],
      shotEventId: resolvedShotEventId ?? 0n,
      sourceVehicleId: BigInt(impact.sourceVehicleId),
    });
  }

  private resolveShotEventIdForImpact(impact: ProjectileImpact): bigint | null {
    const conn = this.ctx.conn;
    if (!conn || !this.ctx.localIdentity) return null;

    const targetWeaponCode = impact.isVehicle ? (100 + impact.vehicleWeaponIndex) : impact.weaponIndex;
    const targetSourceVehicle = impact.isVehicle ? impact.sourceVehicleId : 0;
    const targetTravelMs = Math.max(0, impact.travelTimeMs);
    let bestId: bigint | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    const maxOriginDistSq = impact.isVehicle ? 900 : 144;

    for (const row of conn.db.shot_event.iter() as Iterable<any>) {
      const shooterHex = row.shooter?.toHexString?.();
      if (shooterHex !== this.ctx.localIdentity) continue;
      if (Number(row.weapon) !== targetWeaponCode) continue;
      if (Boolean(row.hasHit)) continue;

      const rowSourceVehicle = Number(row.sourceVehicle ?? 0);
      if (rowSourceVehicle !== targetSourceVehicle) continue;

      const ox = Number(row.origin?.x ?? 0);
      const oy = Number(row.origin?.y ?? 0);
      const oz = Number(row.origin?.z ?? 0);
      const dx = impact.origin.x - ox;
      const dy = impact.origin.y - oy;
      const dz = impact.origin.z - oz;
      const originDistSq = dx * dx + dy * dy + dz * dz;
      if (originDistSq > maxOriginDistSq) continue;

      let timingError = 2000;
      const firedAt = row.firedAt;
      if (firedAt && typeof firedAt.toMillis === 'function') {
        const firedAtMs = Number(firedAt.toMillis());
        if (Number.isFinite(firedAtMs)) {
          const observedAgeMs = Math.max(0, Date.now() - firedAtMs);
          timingError = Math.abs(observedAgeMs - targetTravelMs);
        }
      }

      const score = originDistSq * 0.4 + timingError;
      if (score >= bestScore) continue;

      const rowId = row.id;
      if (typeof rowId === 'bigint') {
        bestId = rowId;
        bestScore = score;
      } else if (typeof rowId === 'number' && Number.isFinite(rowId)) {
        bestId = BigInt(Math.trunc(rowId));
        bestScore = score;
      }
    }

    return bestId;
  }
}
