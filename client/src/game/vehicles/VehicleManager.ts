/**
 * VehicleManager.ts — Universal vehicle entity manager.
 *
 * Replaces the old helicopter-only HelicopterManager with a type-registry
 * pattern.  Adding a new vehicle type (tank, boat, …) requires only:
 *   1. Create FooType.ts implementing VehicleType
 *   2. vehicleManager.registerVehicleType(new FooType())
 *   3. Add weapon definitions to game-constants.json
 */

import * as THREE from 'three';
import { InterpolationBuffer } from '../InterpolationBuffer';
import { ENTITY_KINDS, VEHICLE_TYPES } from '../../shared-config';
import { VEHICLE_WEAPON_DEFINITIONS } from '../WeaponRegistry';
import type { VehicleWeaponDefinition } from '../WeaponRegistry';
import type { DynamicLightOptions } from '../Engine';
import type { NetDiagnostics } from '../NetDiagnostics';
import type { DbConnection } from '../../module_bindings';
import type { AudioSystem } from '../AudioSystem';
import type { VFX } from '../VFX';
import type { FPSControls } from '../FPSControls';
import type { VoxelWorld } from '../VoxelWorld';
import type { PhysicsSystem } from '../PhysicsSystem';
import type { SkySystem } from '../SkySystem';
import type {
  VehicleType,
  VehicleInstance,
  BreakupPiece,
  VehicleTypeFrameContext,
  VehicleTypeDestroyContext,
} from './VehicleBase';
import { HelicopterType } from './HelicopterType';
import { FighterJetType } from './FighterJetType';
import { AntiAirType } from './AntiAirType';
import { VehiclePrediction } from './VehiclePhysics';
import type { PhysicsInput } from './VehiclePhysics';

// ── Constants ──
const ENTITY_KIND_VEHICLE = ENTITY_KINDS.Vehicle;

// ── Vehicle weapon info (re-exported for Engine / VehicleFireController) ──
export interface VehicleWeaponInfo {
  name: string;
  fireRate: number;
  maxAmmo: number;
  maxRange: number;
  projectileSpeed: number;
  gravity: number;
  radius: number;
  spread: { x: number; y: number };
  color: string;
  reloadTime: number;
}

export const VEHICLE_WEAPONS: VehicleWeaponInfo[] = VEHICLE_WEAPON_DEFINITIONS.map((def: VehicleWeaponDefinition) => ({
  name: def.name,
  fireRate: def.fireRate,
  maxAmmo: def.maxAmmo,
  maxRange: def.maxRange,
  projectileSpeed: def.projectileSpeed,
  gravity: def.gravity,
  radius: def.radius,
  spread: def.spread,
  color: def.color,
  reloadTime: def.reloadTime,
}));

/** Interface exposing only the Engine members VehicleManager needs. */
export interface VehicleEngineContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  conn: DbConnection | null;
  localIdentity: string | null;
  controls: FPSControls;
  audio: AudioSystem;
  vfx: VFX;
  world: VoxelWorld;
  physics: PhysicsSystem;
  sky: SkySystem;
  health: number;
  elapsedTime: number;
  mountedVehicleId: number;
  addDynamicLight(options: DynamicLightOptions): string;
  removeDynamicLight(id: string): void;
  updateDynamicLight(id: string, patch: Partial<DynamicLightOptions>): void;
  applyExplosionCameraEffects(cx: number, cy: number, cz: number, radius: number, damage: number): void;
  disposeObjectMaterials(root: THREE.Object3D): void;
  netDiag: NetDiagnostics;
}

// ══════════════════════════════════════════════════════════════

export default class VehicleManager {
  // ── Type registry ──
  private vehicleTypes = new Map<number, VehicleType>();

  // ── Vehicle entity maps (shared across all types) ──
  readonly vehicles = new Map<number, THREE.Group>();
  readonly vehicleInstances = new Map<number, VehicleInstance>();
  vehicleBreakupPieces: BreakupPiece[] = [];
  private pendingDestroyFallbacks = new Map<number, number>();
  private recentBreakups = new Map<number, number>();
  suppressDeleteFxUntil = 0;
  lastVehicleSyncAt = 0;

  // ── Client-side prediction for the local vehicle ──
  private prediction: VehiclePrediction | null = null;
  private nextVehicleInputSeq = 1;
  private lastAckedInputSeq = 0;
  private lastReconciledSimTick = 0;
  /** Current physics input assembled from keyboard state each frame. */
  private currentInput: PhysicsInput = { forward: 0, strafe: 0, lift: 0, yaw: 0 };
  /** Local tick-aligned input packets queued for server send. */
  private pendingInputPackets: Array<{ seq: number; input: PhysicsInput }> = [];
  // Legacy fields kept for mount-transition seeding in Engine.ts
  localLastServerPos = new THREE.Vector3();
  localLastServerVel = new THREE.Vector3();
  localLastServerYaw = 0;
  localLastServerPitch = 0;
  localLastServerTime = 0;

  // ── Mounted camera state ──
  private mountedCameraPosition = new THREE.Vector3();
  private readonly tmpCamDir = new THREE.Vector3();

  // ── Vehicle pilot input state ──
  vehiclePilotYaw = 0;
  vehiclePilotPitch = 0;
  vehicleWeaponIndex = 0;
  lastVehicleFireAt = 0;
  vehicleAmmo: [number, number, number] = [300, 16, 0];
  vehicleReloadingUntil: [number, number, number] = [0, 0, 0];
  vehicleCameraDistance = 14;
  jetThrottle = 0; // 0..1 persistent throttle level

  // ── Light rig scratch vectors ──
  private lightRigs = new Map<number, {
    portId: string;
    starboardId: string;
    bellyId: string;
  }>();
  private readonly tmpPort = new THREE.Vector3();
  private readonly tmpStarboard = new THREE.Vector3();
  private readonly tmpBelly = new THREE.Vector3();

  private engine: VehicleEngineContext;

  constructor(engine: VehicleEngineContext) {
    this.engine = engine;
    // Register built-in vehicle types
    this.registerVehicleType(new HelicopterType());
    this.registerVehicleType(new FighterJetType());
    this.registerVehicleType(new AntiAirType());
  }

  // ── Registry ──

  registerVehicleType(type: VehicleType): void {
    this.vehicleTypes.set(type.typeId, type);
  }

  getVehicleTypeById(typeId: number): VehicleType | undefined {
    return this.vehicleTypes.get(typeId);
  }

  // ── Pitch / camera constants for the currently-mounted vehicle ──

  getMountedVehicleType(): VehicleType | undefined {
    if (this.engine.mountedVehicleId === 0) return undefined;
    const inst = this.vehicleInstances.get(this.engine.mountedVehicleId);
    if (!inst) return undefined;
    return this.vehicleTypes.get(inst.type);
  }

  get PILOT_PITCH_MIN(): number {
    return this.getMountedVehicleType()?.getCameraConfig().pitchMin ?? -0.62;
  }

  get PILOT_PITCH_MAX(): number {
    return this.getMountedVehicleType()?.getCameraConfig().pitchMax ?? 0.42;
  }

  get CAMERA_DISTANCE(): number {
    return this.getMountedVehicleType()?.getCameraConfig().distance ?? 14;
  }

  get HEALTH_MAX(): number {
    return this.getMountedVehicleType()?.getHealthMax() ?? 1000;
  }

  /** The name of the vehicle the local player is mounted in (for HUD). */
  getMountedVehicleName(): string | null {
    const vt = this.getMountedVehicleType();
    return vt ? vt.name : null;
  }

  /**
   * Resolve the actual vehicle weapon index from the current slot.
   * Fighter jets use weapon indices 2/3 (Kinetic Penetrator/Carpet Bomb),
   * while helicopters use 0/1 (Minigun/Rockets).
   */
  getResolvedVehicleWeaponIndex(): number {
    const vt = this.getMountedVehicleType();
    if (vt && vt.typeId === VEHICLE_TYPES.FighterJet) {
      // Jet slot 0→2 (Kinetic Penetrator), 1→3 (Carpet Bomb), 2→6 (Air Missile)
      if (this.vehicleWeaponIndex === 2) return 6;
      return this.vehicleWeaponIndex + 2;
    }
    if (vt && vt.typeId === VEHICLE_TYPES.AntiAir) {
      // AA slot 0 → weapon index 4 (Autocannon), slot 1 → weapon index 5 (SAM Missile)
      return this.vehicleWeaponIndex + 4;
    }
    return this.vehicleWeaponIndex;
  }

  /**
   * Resolve the actual weapon index for a specific slot (without changing vehicleWeaponIndex).
   * Used by Engine.ts to get correct maxAmmo on mount.
   */
  getResolvedWeaponIndexForSlot(slot: number): number {
    const vt = this.getMountedVehicleType();
    if (vt && vt.typeId === VEHICLE_TYPES.FighterJet) {
      if (slot === 2) return 6; // Air Missile
      return slot + 2;
    }
    if (vt && vt.typeId === VEHICLE_TYPES.AntiAir) {
      return slot + 4;
    }
    return slot;
  }

  /** Alternating side for carpet bomb drops: +1 = right, -1 = left */
  carpetBombSide = 1;

  // ══════════════════════════════════════════════════════════════
  //  ENTITY MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  getVehicleRow(vehicleId: number): any | null {
    if (!this.engine.conn || vehicleId === 0) return null;
    const table = (this.engine.conn.db as any).vehicle;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).entityId) === vehicleId) return row;
    }
    return null;
  }

  /** Get the pilot's aim direction for a vehicle. For local vehicle uses
   *  direct pilot yaw/pitch; for remote vehicles reads the pilot's Player row. */
  getPilotAim(entityId: number): { yaw: number; pitch: number } | null {
    // Local vehicle: use the local pilot aim directly
    if (entityId === this.engine.mountedVehicleId) {
      return { yaw: this.vehiclePilotYaw, pitch: this.vehiclePilotPitch };
    }
    // Remote vehicle: look up pilot identity from Vehicle row, then Player row
    const vehicle = this.getVehicleRow(entityId);
    if (!vehicle || !vehicle.pilotIdentity) return null;
    const playerTable = (this.engine.conn?.db as any)?.player;
    if (!playerTable) return null;
    for (const p of playerTable.iter()) {
      const player = p as any;
      if (player.identity && vehicle.pilotIdentity &&
          player.identity.toHexString() === vehicle.pilotIdentity.toHexString()) {
        return {
          yaw: Number(player.rot?.yaw ?? 0),
          pitch: Number(player.rot?.pitch ?? 0),
        };
      }
    }
    return null;
  }

  findNearestVehicleOfType(typeId: number, around: THREE.Vector3): {
    entityId: number;
    position: THREE.Vector3;
    mountRange: number;
  } | null {
    let best: { entityId: number; position: THREE.Vector3; mountRange: number } | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;

    for (const [entityId, inst] of this.vehicleInstances) {
      if (inst.type !== typeId) continue;
      const mesh = this.vehicles.get(entityId);
      if (!mesh) continue;
      const vt = this.vehicleTypes.get(inst.type);
      if (!vt) continue;

      const d2 = around.distanceToSquared(mesh.position);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = {
          entityId,
          position: mesh.position.clone(),
          mountRange: vt.getMountRange(),
        };
      }
    }

    return best;
  }

  findEntityRow(entityId: number): any | null {
    if (!this.engine.conn) return null;
    const table = (this.engine.conn.db as any).entity;
    if (!table) return null;
    for (const row of table.iter()) {
      if (Number((row as any).id) === entityId) return row;
    }
    return null;
  }

  /** Check if player is near any unoccupied vehicle (for ENTER prompt). */
  isNearVehicle(): boolean {
    return this.getNearVehicleName() !== null;
  }

  /** Returns the name of the nearest mountable vehicle, or null. */
  getNearVehicleName(): string | null {
    const camPos = this.engine.camera.position;
    let bestName: string | null = null;
    let bestDist = Infinity;
    for (const [entityId, mesh] of this.vehicles) {
      const inst = this.vehicleInstances.get(entityId);
      if (!inst) continue;
      const vt = this.vehicleTypes.get(inst.type);
      if (!vt) continue;
      const range = vt.getMountRange();
      const dx = camPos.x - mesh.position.x;
      const dy = camPos.y - mesh.position.y;
      const dz = camPos.z - mesh.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= range && dist < bestDist) {
        bestDist = dist;
        bestName = vt.name;
      }
    }
    return bestName;
  }

  /** Get the VehicleType ID for a given entity, or -1 if unknown. */
  private getVehicleTypeId(entityId: number): number {
    const vehicle = this.getVehicleRow(entityId);
    if (!vehicle) return -1;
    return Number(vehicle.vehicleType);
  }

  ensureVehicleMesh(entityId: number, typeId: number): THREE.Group | null {
    let mesh = this.vehicles.get(entityId);
    if (mesh) return mesh;

    const vt = this.vehicleTypes.get(typeId);
    if (!vt) return null;

    mesh = vt.createModel();
    // YXZ order: yaw (Y) applied first in world space, then pitch (X) in the
    // helicopter's local frame.  Default XYZ would apply pitch in world space,
    // causing the nose direction to depend on compass heading instead of the
    // vehicle's own forward axis.
    mesh.rotation.order = 'YXZ';
    mesh.userData.entityId = entityId;
    mesh.userData.vehicleType = typeId;
    mesh.userData.clientSpinAngle = 0;
    mesh.userData.smoothBlurT = 0;
    mesh.userData.currentOpacity = 1.0;
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        if (!mat.userData) mat.userData = {};
        mat.userData.baseOpacity = mat.opacity;
      }
    });
    this.engine.scene.add(mesh);
    this.vehicles.set(entityId, mesh);

    const buffer = new InterpolationBuffer();
    this.vehicleInstances.set(entityId, {
      entityId,
      mesh,
      buffer,
      type: typeId,
    });

    this.ensureLightRig(entityId, mesh);
    if (typeId === VEHICLE_TYPES.Helicopter) {
      this.engine.audio.startHelicopterSound(entityId);
    } else if (typeId === VEHICLE_TYPES.FighterJet || typeId === VEHICLE_TYPES.AntiAir) {
      this.engine.audio.startJetEngineSound(entityId);
    }
    return mesh;
  }

  scheduleDestroyFallback(entityId: number): void {
    if (this.pendingDestroyFallbacks.has(entityId)) return;
    const timer = window.setTimeout(() => {
      this.pendingDestroyFallbacks.delete(entityId);
      const mesh = this.vehicles.get(entityId);
      if (!mesh) return;
      this.triggerDestroyFx(entityId, {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
      }, mesh.rotation.y);
    }, 120);
    this.pendingDestroyFallbacks.set(entityId, timer);
  }

  triggerDestroyFx(
    entityId: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    intensity = 1,
  ): void {
    const now = performance.now();
    const last = this.recentBreakups.get(entityId) ?? -Infinity;
    if (now - last < 1100) {
      this.removeVehicleMesh(entityId, true);
      return;
    }
    this.recentBreakups.set(entityId, now);

    const inst = this.vehicleInstances.get(entityId);
    const typeId = inst?.type ?? this.getVehicleTypeId(entityId);

    this.removeVehicleMesh(entityId, true);

    // Delegate breakup to the vehicle type
    const vt = this.vehicleTypes.get(typeId);
    if (vt) {
      const destroyCtx: VehicleTypeDestroyContext = {
        scene: this.engine.scene,
        addDynamicLight: (opts) => this.engine.addDynamicLight(opts),
        vfx: this.engine.vfx,
        physics: this.engine.physics,
        audio: this.engine.audio,
        applyExplosionCameraEffects: (cx, cy, cz, r, d) =>
          this.engine.applyExplosionCameraEffects(cx, cy, cz, r, d),
      };

      // Use HelicopterType's static breakup with explicit pos/yaw/intensity
      if (vt instanceof HelicopterType) {
        const pieces = HelicopterType.spawnBreakup(pos, yaw, intensity, destroyCtx);
        this.vehicleBreakupPieces.push(...pieces);
      } else {
        // Generic: construct a temporary instance for onDestroy
        const tmpMesh = new THREE.Group();
        tmpMesh.position.set(pos.x, pos.y, pos.z);
        tmpMesh.rotation.y = yaw;
        const tmpInst: VehicleInstance = {
          entityId,
          mesh: tmpMesh,
          buffer: new InterpolationBuffer(),
          type: typeId,
        };
        const pieces = vt.onDestroy(tmpInst, destroyCtx);
        this.vehicleBreakupPieces.push(...pieces);
      }
    }
  }

  removeVehicleMesh(entityId: number, destroyed = false): void {
    const timer = this.pendingDestroyFallbacks.get(entityId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingDestroyFallbacks.delete(entityId);
    }
    this.removeLightRig(entityId);
    const inst = this.vehicleInstances.get(entityId);
    const isJetOrAA = inst?.type === VEHICLE_TYPES.FighterJet || inst?.type === VEHICLE_TYPES.AntiAir;
    if (isJetOrAA) {
      this.engine.audio.stopJetEngineSound(entityId, destroyed);
    } else {
      this.engine.audio.stopHelicopterSound(entityId, destroyed);
    }
    const mesh = this.vehicles.get(entityId);
    if (!mesh) return;
    this.engine.scene.remove(mesh);
    this.engine.disposeObjectMaterials(mesh);
    this.vehicles.delete(entityId);
    this.vehicleInstances.delete(entityId);
  }

  updateVehicleEntity(entity: any, reconcileLocal = true): void {
    const id = Number(entity.id);
    if (!Number.isFinite(id) || id <= 0) return;

    const vehicle = this.getVehicleRow(id);
    if (!vehicle || !entity.active) {
      this.removeVehicleMesh(id);
      return;
    }

    const typeId = Number(vehicle.vehicleType);
    if (!this.vehicleTypes.has(typeId)) {
      this.removeVehicleMesh(id);
      return;
    }

    const mesh = this.ensureVehicleMesh(id, typeId);
    if (!mesh) return;

    const vel = entity.vel || { x: 0, y: 0, z: 0 };
    const rot = entity.rot || { yaw: 0, pitch: 0 };

    // Local pilot: rewind-and-replay reconciliation.
    // The server's Entity update is the authoritative state. We read
    // acked_input_seq from the Vehicle table, discard old inputs,
    // and replay unacknowledged ones from the server state.
    // If the physics match (they should), the replayed result is
    // identical to our prediction — zero visible correction.
    if (reconcileLocal && id === this.engine.mountedVehicleId) {
      const newPos = { x: Number(entity.pos.x), y: Number(entity.pos.y), z: Number(entity.pos.z) };
      const newVel = { x: Number(vel.x), y: Number(vel.y), z: Number(vel.z) };

      // Record diagnostics
      const predState = this.prediction?.state;
      this.engine.netDiag.recordVehicleServerUpdate(
        newPos, newVel,
        predState
          ? { x: predState.px, y: predState.py, z: predState.pz }
          : { x: 0, y: 0, z: 0 },
      );

      // Keep legacy fields in sync (used by Engine mount-transition code)
      this.localLastServerPos.set(newPos.x, newPos.y, newPos.z);
      this.localLastServerVel.set(newVel.x, newVel.y, newVel.z);
      this.localLastServerYaw = Number(rot.yaw ?? 0);
      this.localLastServerPitch = Number(rot.pitch ?? 0);
      this.localLastServerTime = performance.now();

      // Only reconcile when entity pose and vehicle ack were produced by the
      // same server simulation tick.
      const entitySimTick = Number(entity.simTick ?? 0);
      const vehicleSimTick = Number(vehicle.simTick ?? 0);
      if (entitySimTick <= 0 || vehicleSimTick <= 0 || entitySimTick !== vehicleSimTick) {
        return;
      }

      // Reconcile each server sim tick at most once. We listen on both entity
      // and vehicle streams; this guard prevents duplicate reconcile passes
      // while still allowing whichever callback arrives second to complete a
      // coherent pair.
      if (entitySimTick <= this.lastReconciledSimTick) {
        return;
      }
      this.lastReconciledSimTick = entitySimTick;

      // Read the acknowledged processed input sequence from the Vehicle table
      const ackedSeq = Number(vehicle.ackedInputSeq ?? 0);
      this.lastAckedInputSeq = ackedSeq;
      this.prediction?.discardAckedInputs(ackedSeq);

      // Rewind-and-replay reconciliation
      if (this.prediction) {
        this.prediction.reconcile({
          px: newPos.x, py: newPos.y, pz: newPos.z,
          vx: newVel.x, vy: newVel.y, vz: newVel.z,
          yaw: Number(rot.yaw ?? 0),
          pitch: Number(rot.pitch ?? 0),
        }, ackedSeq);
      }
    }

    // Remote vehicles use InterpolationBuffer
    const inst = this.vehicleInstances.get(id);
    if (inst) {
      inst.buffer.push(
        new THREE.Vector3(entity.pos.x, entity.pos.y, entity.pos.z),
        new THREE.Vector3(vel.x, vel.y, vel.z),
        { yaw: Number(rot.yaw ?? 0), pitch: Number(rot.pitch ?? 0) },
      );
    } else {
      mesh.position.set(entity.pos.x, entity.pos.y, entity.pos.z);
      mesh.rotation.set(Number(rot.pitch ?? 0), Number(rot.yaw ?? 0), 0);
    }
  }

  rebuildVehiclesFromServer(): void {
    if (!this.engine.conn) return;
    const entityTable = (this.engine.conn.db as any).entity;
    if (!entityTable) return;

    const active = new Set<number>();
    for (const entity of entityTable.iter()) {
      const e = entity as any;
      if (Number(e.kind) !== ENTITY_KIND_VEHICLE) continue;
      const id = Number(e.id);
      active.add(id);
      this.updateVehicleEntity(e);
    }

    for (const id of Array.from(this.vehicles.keys())) {
      if (!active.has(id)) this.removeVehicleMesh(id);
    }
  }

  syncVehicleInput(): void {
    if (!this.engine.conn || !this.engine.localIdentity || this.engine.mountedVehicleId === 0) return;

    if (this.lastAckedInputSeq > 0) {
      while (this.pendingInputPackets.length > 0 && this.pendingInputPackets[0]!.seq <= this.lastAckedInputSeq) {
        this.pendingInputPackets.shift();
      }
    }

    // Hard-cap queue growth to avoid runaway backlog under transient stalls.
    if (this.pendingInputPackets.length > 256) {
      this.pendingInputPackets.splice(0, this.pendingInputPackets.length - 256);
    }

    // Primary path: flush tick-aligned packets generated during local
    // prediction. This preserves 1:1 replay semantics (one seq per sim tick).
    while (this.pendingInputPackets.length > 0) {
      const packet = this.pendingInputPackets.shift()!;
      this.engine.conn.reducers.updateVehicleInput({
        forward: packet.input.forward,
        strafe: packet.input.strafe,
        lift: packet.input.lift,
        yaw: packet.input.yaw,
        boosting: false,
        inputSeq: packet.seq,
      });
      this.engine.netDiag.recordVehicleInputSent();
    }

    // No synthetic fallback packets: sequence numbers must stay tick-aligned
    // with local prediction (one seq per local vehicle sim tick).
  }

  private sampleCurrentInput(delta: number): void {
    const mountedType = this.getMountedVehicleType();
    const isJet = mountedType?.typeId === VEHICLE_TYPES.FighterJet;

    let forward = 0;
    if (isJet) {
      const throttleRate = 1.2; // per second
      if (this.engine.controls.moveForward) {
        this.jetThrottle = Math.min(1, this.jetThrottle + throttleRate * delta);
      }
      if (this.engine.controls.moveBackward) {
        this.jetThrottle = Math.max(0, this.jetThrottle - throttleRate * delta);
      }
      forward = this.jetThrottle;
    } else {
      if (this.engine.controls.moveForward) forward += 1;
      if (this.engine.controls.moveBackward) forward -= 1;
    }

    let strafe = 0;
    if (this.engine.controls.ePressed) strafe += 1;
    if (this.engine.controls.qPressed) strafe -= 1;

    let lift = 0;
    if (this.engine.controls.spacePressed) lift += 1;
    if (this.engine.controls.shiftHeld) lift -= 1;

    let yaw = 0;
    if (this.engine.controls.moveRight) yaw += 1;
    if (this.engine.controls.moveLeft) yaw -= 1;

    this.currentInput.forward = forward;
    this.currentInput.strafe = strafe;
    this.currentInput.lift = lift;
    this.currentInput.yaw = yaw;
  }

  // ══════════════════════════════════════════════════════════════
  //  SHARED UTIL
  // ══════════════════════════════════════════════════════════════

  getGroundHeight(x: number, z: number, footY?: number): number {
    if (footY !== undefined) {
      const top = this.engine.world.getGroundHeightBelow(x, footY, z);
      return top >= 0 ? top + 1 : 0;
    }
    const top = this.engine.world.getHighestBlock(x, z);
    return top >= 0 ? top + 1 : 0;
  }

  private getPredictionGroundHeight(typeId: number, x: number, z: number): number {
    const top = this.engine.world.getHighestBlock(x, z);
    // Match server TerrainSampler fallback when no surface sample is available.
    const surface = top >= 0 ? top : 3.0;
    // Server parity:
    // - helicopter_ground_rest_height: surface + 0.475
    // - fighter_jet_ground_height:    surface + 1
    // - anti-air ground snap:         surface + 1
    if (typeId === VEHICLE_TYPES.Helicopter) return surface + 0.475;
    return surface + 1;
  }

  // ══════════════════════════════════════════════════════════════
  //  VEHICLE CAMERA + OPACITY
  // ══════════════════════════════════════════════════════════════

  getMountedVehiclePose(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.engine.mountedVehicleId === 0) return null;

    const mesh = this.vehicles.get(this.engine.mountedVehicleId);
    if (mesh) {
      return {
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
        yaw: mesh.rotation.y,
        pitch: mesh.rotation.x,
      };
    }

    const entity = this.findEntityRow(this.engine.mountedVehicleId);
    if (entity) {
      return {
        x: Number(entity.pos.x),
        y: Number(entity.pos.y),
        z: Number(entity.pos.z),
        yaw: Number(entity.rot?.yaw ?? 0),
        pitch: Number(entity.rot?.pitch ?? 0),
      };
    }

    return null;
  }

  getMountedVehiclePoseRaw(): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    if (this.engine.mountedVehicleId === 0) return null;
    const entity = this.findEntityRow(this.engine.mountedVehicleId);
    if (entity) {
      return {
        x: Number(entity.pos.x),
        y: Number(entity.pos.y),
        z: Number(entity.pos.z),
        yaw: Number(entity.rot?.yaw ?? 0),
        pitch: Number(entity.rot?.pitch ?? 0),
      };
    }
    return null;
  }

  syncMountedCameraToVehicle(): void {
    const pose = this.getMountedVehiclePose();
    if (!pose) return;

    const vt = this.getMountedVehicleType();
    const camConfig = vt?.getCameraConfig() ?? { distance: 14, height: 5.2, pitchMin: -0.62, pitchMax: 0.42 };

    const lookYaw = this.vehiclePilotYaw;
    const lookPitch = this.vehiclePilotPitch;
    const cosPitch = Math.cos(lookPitch);
    const fx = -Math.sin(lookYaw) * cosPitch;
    const fy = Math.sin(lookPitch);
    const fz = -Math.cos(lookYaw) * cosPitch;

    const camDist = this.vehicleCameraDistance;
    const camHeight = camConfig.height * (camDist / camConfig.distance);

    // Important: no lerp here. The local mounted vehicle mesh is already
    // smoothly predicted/interpolated. Extra camera smoothing adds a
    // speed-dependent lag that causes visible model-vs-camera oscillation.
    this.mountedCameraPosition.set(
      pose.x - fx * camDist,
      pose.y + camHeight,
      pose.z - fz * camDist,
    );

    const minCamY = this.getGroundHeight(
      this.mountedCameraPosition.x,
      this.mountedCameraPosition.z,
      this.mountedCameraPosition.y,
    ) + 1.2;
    if (this.mountedCameraPosition.y < minCamY) {
      this.mountedCameraPosition.y = minCamY;
    }

    this.engine.camera.position.copy(this.mountedCameraPosition);
    this.engine.camera.lookAt(
      pose.x + fx * 18,
      pose.y + 2.2 + fy * 18,
      pose.z + fz * 18,
    );
    this.engine.controls.resetVelocity();

    this.updateMountedVehicleOpacity(pose, camDist);
  }

  private updateMountedVehicleOpacity(
    pose: { x: number; y: number; z: number },
    camDist: number,
  ): void {
    const mesh = this.vehicles.get(this.engine.mountedVehicleId);
    if (!mesh) return;

    const dx = pose.x - this.engine.camera.position.x;
    const dy = (pose.y + 1.5) - this.engine.camera.position.y;
    const dz = pose.z - this.engine.camera.position.z;
    const distToVehicle = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distToVehicle < 0.01) { this.setVehicleOpacity(mesh, 0.15); return; }

    this.engine.camera.getWorldDirection(this.tmpCamDir);
    const dot = (dx / distToVehicle) * this.tmpCamDir.x
      + (dy / distToVehicle) * this.tmpCamDir.y
      + (dz / distToVehicle) * this.tmpCamDir.z;

    if (dot < 0) { this.setVehicleOpacity(mesh, 1.0); return; }

    const distFactor = 1 - Math.max(0, Math.min(1, (camDist - 6) / 18));
    const angleFactor = Math.max(0, (dot - 0.5) / 0.5);
    const fadeAmount = distFactor * angleFactor;
    const targetOpacity = 1.0 - fadeAmount * 0.85;
    this.setVehicleOpacity(mesh, targetOpacity);
  }

  private setVehicleOpacity(mesh: THREE.Group, opacity: number): void {
    const prev = mesh.userData.currentOpacity ?? 1.0;
    const smoothed = prev + (opacity - prev) * 0.15;
    if (Math.abs(smoothed - prev) < 0.001 && Math.abs(smoothed - opacity) < 0.01) {
      mesh.userData.currentOpacity = opacity;
    } else {
      mesh.userData.currentOpacity = smoothed;
    }
    const op = mesh.userData.currentOpacity as number;
    const isTransparent = op < 0.99;

    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.Material;
        if (isTransparent) {
          mat.transparent = true;
          mat.opacity = op * ((mat as any).userData?.baseOpacity ?? 1.0);
          mat.depthWrite = op > 0.5;
        } else {
          mat.opacity = (mat as any).userData?.baseOpacity ?? 1.0;
          mat.transparent = ((mat as any).userData?.baseOpacity ?? 1.0) < 1.0;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  LIGHT RIG
  // ══════════════════════════════════════════════════════════════

  ensureLightRig(entityId: number, mesh: THREE.Group): void {
    if (this.lightRigs.has(entityId)) return;

    const portId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0xff3d3d,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const starboardId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0x4cff83,
      intensity: 0.85,
      distance: 14,
      decay: 1.9,
    });
    const bellyId = this.engine.addDynamicLight({
      kind: 'helicopter',
      type: 'point',
      position: mesh.position.clone(),
      color: 0xaee7ff,
      intensity: 1.1,
      distance: 18,
      decay: 1.8,
    });

    this.lightRigs.set(entityId, { portId, starboardId, bellyId });
  }

  removeLightRig(entityId: number): void {
    const rig = this.lightRigs.get(entityId);
    if (!rig) return;

    this.engine.removeDynamicLight(rig.portId);
    this.engine.removeDynamicLight(rig.starboardId);
    this.engine.removeDynamicLight(rig.bellyId);
    this.lightRigs.delete(entityId);
  }

  updateLightRig(entityId: number, mesh: THREE.Group): void {
    const rig = this.lightRigs.get(entityId);
    if (!rig) return;

    const sunVisibility = this.engine.sky.getSunVisibility();
    const nightFactor = THREE.MathUtils.clamp(1 - sunVisibility, 0, 1);
    const navPulse = 0.75 + 0.25 * Math.sin(this.engine.elapsedTime * 7.5 + entityId);

    this.tmpPort.set(-1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpStarboard.set(1.44, 2.38, -5.0).applyMatrix4(mesh.matrixWorld);
    this.tmpBelly.set(0, 1.18, 0.1).applyMatrix4(mesh.matrixWorld);

    this.engine.updateDynamicLight(rig.portId, {
      position: this.tmpPort,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.engine.updateDynamicLight(rig.starboardId, {
      position: this.tmpStarboard,
      intensity: 0.18 + nightFactor * 0.92,
      distance: 10 + nightFactor * 8,
    });
    this.engine.updateDynamicLight(rig.bellyId, {
      position: this.tmpBelly,
      intensity: (0.15 + nightFactor * 1.2) * navPulse,
      distance: 8 + nightFactor * 14,
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  RESET LOCAL PILOT SMOOTHING
  // ══════════════════════════════════════════════════════════════

  resetLocalPilotSmoothing(): void {
    this.prediction = null;
    this.nextVehicleInputSeq = 1;
    this.lastAckedInputSeq = 0;
    this.lastReconciledSimTick = 0;
    this.pendingInputPackets = [];
    this.localLastServerTime = 0;
  }

  // ══════════════════════════════════════════════════════════════
  //  PER-FRAME UPDATE
  // ══════════════════════════════════════════════════════════════

  updatePerFrame(delta: number): void {
    const rot = { yaw: 0, pitch: 0 };

    if (this.engine.mountedVehicleId !== 0) {
      this.sampleCurrentInput(delta);
    }

    // Build the frame context once (shared by all vehicle type callbacks)
    const frameCtx: VehicleTypeFrameContext = {
      elapsedTime: this.engine.elapsedTime,
      controls: {
        moveForward: this.engine.controls.moveForward,
        moveBackward: this.engine.controls.moveBackward,
        moveLeft: this.engine.controls.moveLeft,
        moveRight: this.engine.controls.moveRight,
        ePressed: this.engine.controls.ePressed,
        qPressed: this.engine.controls.qPressed,
        spacePressed: this.engine.controls.spacePressed,
        shiftHeld: this.engine.controls.shiftHeld,
      },
      getVehicleRow: (eid) => this.getVehicleRow(eid),
      audio: this.engine.audio,
      sky: this.engine.sky,
      updateDynamicLight: (id, patch) => this.engine.updateDynamicLight(id, patch),
      mountedVehicleId: this.engine.mountedVehicleId,
      getPilotAim: (eid) => this.getPilotAim(eid),
    };

    for (const [id, mesh] of this.vehicles) {
      const inst = this.vehicleInstances.get(id);
      const isLocal = id === this.engine.mountedVehicleId;

      // ── Position / rotation ──
      if (isLocal) {
        // Client-side prediction: run the same physics locally using the
        // player's current input for instant response. Reconciliation applies
        // server-authoritative corrections as render-only offsets.
        const typeId = inst?.type ?? VEHICLE_TYPES.Helicopter;

        // Lazily create the prediction on first use
        if (!this.prediction && this.localLastServerTime > 0) {
          this.prediction = new VehiclePrediction(typeId, {
            px: this.localLastServerPos.x,
            py: this.localLastServerPos.y,
            pz: this.localLastServerPos.z,
            vx: this.localLastServerVel.x,
            vy: this.localLastServerVel.y,
            vz: this.localLastServerVel.z,
            yaw: this.localLastServerYaw,
            pitch: this.localLastServerPitch,
          }, (x, z) => this.getPredictionGroundHeight(typeId, x, z));
        }

        if (this.prediction) {
          // Advance physics with current input — immediate response
          const predicted = this.prediction.advance(delta, this.currentInput, (tickInput) => {
            const seq = this.nextVehicleInputSeq++;
            this.pendingInputPackets.push({ seq, input: { ...tickInput } });
            return seq;
          });
          mesh.position.set(predicted.px, predicted.py, predicted.pz);
          mesh.rotation.set(predicted.pitch, predicted.yaw, 0);
        } else {
          // No server data yet — use raw entity table position
          const entity = this.findEntityRow(id);
          if (entity) {
            mesh.position.set(Number(entity.pos.x), Number(entity.pos.y), Number(entity.pos.z));
            mesh.rotation.set(Number(entity.rot?.pitch ?? 0), Number(entity.rot?.yaw ?? 0), 0);
          }
        }
      } else {
        // Remote vehicle: InterpolationBuffer
        if (inst && inst.buffer.hasData()) {
          inst.buffer.sample(mesh.position, rot);
          mesh.rotation.set(rot.pitch, rot.yaw, 0);
        }
      }

      // ── Restore opacity for vehicles the local player is NOT mounted in ──
      if (!isLocal && (mesh.userData.currentOpacity as number) < 0.99) {
        this.setVehicleOpacity(mesh, 1.0);
      }

      // ── Delegate type-specific animation ──
      if (inst) {
        const vt = this.vehicleTypes.get(inst.type);
        if (vt) {
          vt.updatePerFrame(inst, delta, isLocal, frameCtx);
        }
      }

      mesh.updateMatrixWorld();
      this.updateLightRig(id, mesh);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BREAKUP PIECE PHYSICS
  // ══════════════════════════════════════════════════════════════

  updateBreakupPieces(delta: number): void {
    const gravity = HelicopterType.BREAKUP_GRAVITY;
    for (let i = this.vehicleBreakupPieces.length - 1; i >= 0; i--) {
      const piece = this.vehicleBreakupPieces[i]!;
      piece.ttl -= delta;
      piece.vel.y -= gravity * delta;
      piece.mesh.position.addScaledVector(piece.vel, delta);
      piece.mesh.rotation.x += piece.angVel.x * delta;
      piece.mesh.rotation.y += piece.angVel.y * delta;
      piece.mesh.rotation.z += piece.angVel.z * delta;

      const groundY = this.getGroundHeight(piece.mesh.position.x, piece.mesh.position.z, piece.mesh.position.y);
      if (piece.mesh.position.y <= groundY + 0.25) {
        piece.mesh.position.y = groundY + 0.25;
        piece.vel.x *= 0.6;
        piece.vel.z *= 0.6;
        piece.vel.y *= -0.22;
        piece.angVel.multiplyScalar(0.65);
      }

      if (piece.ttl <= 0) {
        this.engine.scene.remove(piece.mesh);
        piece.mesh.geometry.dispose();
        if (Array.isArray(piece.mesh.material)) {
          for (const mat of piece.mesh.material) mat.dispose();
        } else {
          piece.mesh.material.dispose();
        }
        this.vehicleBreakupPieces.splice(i, 1);
      }
    }
  }
}
