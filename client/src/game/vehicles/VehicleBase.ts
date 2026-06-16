/**
 * VehicleBase.ts — Abstract interfaces for the vehicle type system.
 *
 * Every vehicle type (helicopter, tank, …) implements `VehicleType`.
 * The `VehicleManager` stores one `VehicleInstance` per spawned entity
 * and delegates type-specific behaviour via the registry.
 */

import * as THREE from 'three';
import { InterpolationBuffer } from '../InterpolationBuffer';

// ── Per-entity runtime data ──

export interface VehicleInstance {
  entityId: number;
  mesh: THREE.Group;
  buffer: InterpolationBuffer;
  /** Matches `VehicleType.typeId` — used to look up the type from the registry */
  type: number;
}

// ── Breakup debris piece ──

export type BreakupPiece = {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  angVel: THREE.Vector3;
  ttl: number;
};

// ── Camera configuration for a vehicle type ──

export interface VehicleCameraConfig {
  distance: number;
  height: number;
  pitchMin: number;
  pitchMax: number;
}

// ── The contract every vehicle type must fulfil ──

export interface VehicleType {
  /** Numeric ID that matches the server-side `vehicleType` discriminant. */
  typeId: number;

  /** Human-readable name shown in the HUD. */
  name: string;

  /** Build and return a new Three.js model group for this vehicle. */
  createModel(): THREE.Group;

  /** Maximum health (used for HUD health-bar). */
  getHealthMax(): number;

  /** Distance within which a player can mount this vehicle. */
  getMountRange(): number;

  /** Camera orbit / pitch limits for the pilot seat. */
  getCameraConfig(): VehicleCameraConfig;

  /** Y-offset for the pilot's viewpoint inside the vehicle. */
  getPilotSeatHeight(): number;

  /**
   * Local-space eye offset for a first-person passenger (gunner) seat, or null
   * if this vehicle has no rideable gunner seat. When non-null, a non-pilot
   * occupant rides first-person from this offset and can fire their infantry
   * weapon (instead of the third-person chase camera). The offset is in the
   * vehicle's local frame (forward = -Z) and is transformed by the vehicle's
   * yaw to place the camera, matching the server seat transform.
   */
  getPassengerCameraOffset?(): { x: number; y: number; z: number } | null;

  /**
   * Called every frame for each live instance of this type.
   * Handles type-specific animation (rotors, treads, hover bob, etc.).
   *
   * @param instance  The entity runtime data.
   * @param delta     Frame delta in seconds.
   * @param isLocal   True when this is the local player's mounted vehicle.
   * @param ctx       Extra per-frame context the type may need.
   */
  updatePerFrame(
    instance: VehicleInstance,
    delta: number,
    isLocal: boolean,
    ctx: VehicleTypeFrameContext,
  ): void;

  /**
   * Spawn breakup debris when this vehicle is destroyed.
   * Returns the pieces so the manager can track & physics-step them.
   */
  onDestroy(
    instance: VehicleInstance,
    ctx: VehicleTypeDestroyContext,
  ): BreakupPiece[];
}

// ── Context objects passed into VehicleType callbacks ──

/** Read-only helpers available during per-frame updates. */
export interface VehicleTypeFrameContext {
  elapsedTime: number;
  controls: {
    moveForward: boolean;
    moveBackward: boolean;
    moveLeft: boolean;
    moveRight: boolean;
    ePressed: boolean;
    qPressed: boolean;
    spacePressed: boolean;
    shiftHeld: boolean;
  };
  /** Look up the Vehicle row for this entity. */
  getVehicleRow(entityId: number): any | null;
  /** Audio system for spatial sound updates. */
  audio: {
    updateHelicopterSound(
      entityId: number,
      position: THREE.Vector3,
      spinRate: number,
      speed: number,
      isLocal: boolean,
    ): void;
    updateJetEngineSound(
      entityId: number,
      position: THREE.Vector3,
      speed: number,
      isLocal: boolean,
    ): void;
    updateHoverSound(
      entityId: number,
      position: THREE.Vector3,
      speed: number,
      isLocal: boolean,
    ): void;
  };
  /** Sky system for day/night light rigs. */
  sky: { getSunVisibility(): number };
  /** Dynamic light helpers. */
  updateDynamicLight(id: string, patch: any): void;
  mountedVehicleId: number;
  /** Get the pilot's aim direction for a vehicle (yaw/pitch). Returns null if no pilot. */
  getPilotAim(entityId: number): { yaw: number; pitch: number } | null;
}

/** Helpers available during vehicle destruction. */
export interface VehicleTypeDestroyContext {
  scene: THREE.Scene;
  addDynamicLight(options: any): string;
  vfx: {
    emitExplosion(x: number, y: number, z: number, radius: number): void;
    emitImpact(x: number, y: number, z: number): void;
  };
  physics: {
    spawnExplosionDebris(
      blocks: { x: number; y: number; z: number; blockType: number }[],
      cx: number, cy: number, cz: number,
      radius: number, power: number,
    ): void;
  };
  audio: {
    playExplosion(source: { position: { x: number; y: number; z: number } }): void;
  };
  applyExplosionCameraEffects(cx: number, cy: number, cz: number, radius: number, damage: number): void;
}
