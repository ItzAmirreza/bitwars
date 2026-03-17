/**
 * Procedural audio system using Web Audio API.
 * All sounds are generated in real-time — zero file dependencies.
 *
 * This facade delegates to per-category sub-modules in ./audio/.
 * It also manages the AudioRayTracer web worker for dynamic acoustic
 * environment analysis (ray-traced reverb + occlusion).
 */

import { AudioCore } from './audio/AudioCore';
import type { SpatialSoundOptions, OcclusionSampler, Vec3Like } from './audio/AudioCore';
import type { RayTraceResult } from './audio/AudioRayState';
import * as WeaponAudio from './audio/WeaponAudio';
import * as CombatAudio from './audio/CombatAudio';
import * as MovementAudio from './audio/MovementAudio';
import * as UIAudio from './audio/UIAudio';
import * as VehicleAudio from './audio/VehicleAudio';
import * as AmbientAudio from './audio/AmbientAudio';
import AudioRayTracerWorker from './audio/AudioRayTracer.worker?worker';
import { WORLD } from '../shared-config';

export type { SpatialSoundOptions, OcclusionSampler, Vec3Like };

/** Interval between ray trace requests sent to the worker (ms). */
const RAY_TRACE_INTERVAL_MS = 60;

export class AudioSystem {
  private core = new AudioCore();
  private worker: Worker | null = null;
  private lastTraceTime = 0;
  private workerReady = false;

  // ── Listener & occlusion ──

  setListenerPose(position: Vec3Like, forward?: Vec3Like, up?: Vec3Like): void {
    this.core.setListenerPose(position, forward, up);
  }

  setOcclusionSampler(sampler: OcclusionSampler | null): void {
    this.core.setOcclusionSampler(sampler);
  }

  // ── Ray tracer worker management ──

  /**
   * Initialize the ray tracer web worker. Called once after the audio
   * system is set up and the world dimensions are known.
   */
  initRayTracer(): void {
    if (this.worker) return;

    try {
      this.worker = new AudioRayTracerWorker();
      this.worker.onmessage = (e: MessageEvent) => {
        const data = e.data;
        if (data && data.type === 'result') {
          this.core.rayState.onWorkerResult(data as RayTraceResult);
        }
      };

      // Send world dimensions to the worker
      this.worker.postMessage({
        type: 'init',
        chunkSize: WORLD.chunkSize,
        worldSizeX: WORLD.sizeX,
        worldSizeY: WORLD.sizeY,
        worldSizeZ: WORLD.sizeZ,
      });

      this.workerReady = true;
    } catch {
      // Worker creation can fail in some environments (e.g. CSP restrictions).
      // Gracefully degrade — the system works without ray tracing.
      this.worker = null;
      this.workerReady = false;
    }
  }

  /**
   * Send a chunk's block data to the ray tracer worker.
   * Called whenever a chunk is loaded or updated.
   */
  sendChunkToWorker(chunkId: number, data: Uint8Array): void {
    if (!this.worker || !this.workerReady) return;
    // Transfer a copy so we don't detach the main thread's buffer
    const copy = new Uint8Array(data);
    this.worker.postMessage(
      { type: 'chunk', chunkId, data: copy },
      [copy.buffer],
    );
  }

  /**
   * Notify the worker that a chunk was removed/unloaded.
   */
  removeChunkFromWorker(chunkId: number): void {
    if (!this.worker || !this.workerReady) return;
    this.worker.postMessage({ type: 'chunkRemove', chunkId });
  }

  /**
   * Called every frame from Engine.animate().
   * Sends trace requests to the worker at a throttled interval and
   * updates the dynamic reverb from the latest ray-traced results.
   */
  updateAcoustics(delta: number): void {
    // Update reverb parameters from ray state (smoothly interpolated)
    this.core.updateReverbFromRayState(delta);

    // Throttled: send a new trace request to the worker
    if (!this.worker || !this.workerReady) return;
    const now = performance.now();
    if (now - this.lastTraceTime < RAY_TRACE_INTERVAL_MS) return;
    this.lastTraceTime = now;

    const pos = this.core.getListenerPos();
    this.worker.postMessage({
      type: 'trace',
      listenerX: pos.x,
      listenerY: pos.y,
      listenerZ: pos.z,
      worldSizeX: WORLD.sizeX,
      worldSizeY: WORLD.sizeY,
      worldSizeZ: WORLD.sizeZ,
      sources: this.core.rayState.getSourcesForWorker(),
    });
  }

  // ── Sound source propagation registration ──

  /**
   * Register a persistent sound source for ray-traced propagation.
   * The worker will compute the apparent direction and occlusion for this
   * source every trace cycle (~60ms). Used for vehicles, looping sounds, etc.
   */
  registerSoundSource(id: number, position: Vec3Like): void {
    this.core.rayState.registerSource(id, position);
  }

  /**
   * Update a registered sound source's position (call every frame for moving sources).
   */
  updateSoundSourcePosition(id: number, position: Vec3Like): void {
    this.core.rayState.updateSourcePosition(id, position);
  }

  /**
   * Unregister a sound source (vehicle destroyed, sound stopped).
   */
  unregisterSoundSource(id: number): void {
    this.core.rayState.unregisterSource(id);
  }

  /**
   * Get the smoothed apparent direction and occlusion for a sound source.
   * Returns null if the source hasn't been traced yet.
   * Used by VehicleAudio to reposition PannerNodes.
   */
  getSourcePropagation(id: number): {
    apparentDirX: number;
    apparentDirY: number;
    apparentDirZ: number;
    occlusion: number;
    directLOS: boolean;
  } | null {
    return this.core.rayState.getSourcePropagation(id);
  }

  // ── Weapons ──

  playRifle(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playRifle(this.core, spatial);
  }

  playShotgun(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playShotgun(this.core, spatial);
  }

  playRPGLaunch(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playRPGLaunch(this.core, spatial);
  }

  playMachineGun(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playMachineGun(this.core, spatial);
  }

  playGrenadeLaunch(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playGrenadeLaunch(this.core, spatial);
  }

  playVehicleMinigun(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playVehicleMinigun(this.core, spatial);
  }

  playVehicleRocket(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playVehicleRocket(this.core, spatial);
  }

  playProjectileFlyby(speed: number, spatial?: SpatialSoundOptions): void {
    WeaponAudio.playProjectileFlyby(this.core, speed, spatial);
  }

  playReload(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playReload(this.core, spatial);
  }

  playEmpty(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playEmpty(this.core, spatial);
  }

  playSwitch(spatial?: SpatialSoundOptions): void {
    WeaponAudio.playSwitch(this.core, spatial);
  }

  // ── Combat ──

  playExplosion(spatial?: SpatialSoundOptions): void {
    CombatAudio.playExplosion(this.core, spatial);
  }

  playBlockBreak(spatial?: SpatialSoundOptions): void {
    CombatAudio.playBlockBreak(this.core, spatial);
  }

  playBlockLand(intensity?: number, spatial?: SpatialSoundOptions): void {
    CombatAudio.playBlockLand(this.core, intensity, spatial);
  }

  playCrumble(spatial?: SpatialSoundOptions): void {
    CombatAudio.playCrumble(this.core, spatial);
  }

  playHitMarker(): void {
    CombatAudio.playHitMarker(this.core);
  }

  playKillConfirm(): void {
    CombatAudio.playKillConfirm(this.core);
  }

  playDeath(spatial?: SpatialSoundOptions): void {
    CombatAudio.playDeath(this.core, spatial);
  }

  playHeartbeat(spatial?: SpatialSoundOptions): void {
    CombatAudio.playHeartbeat(this.core, spatial);
  }

  playDamage(spatial?: SpatialSoundOptions): void {
    CombatAudio.playDamage(this.core, spatial);
  }

  playRespawn(spatial?: SpatialSoundOptions): void {
    CombatAudio.playRespawn(this.core, spatial);
  }

  // ── Movement ──

  playStep(sprinting?: boolean, spatial?: SpatialSoundOptions): void {
    MovementAudio.playStep(this.core, sprinting, spatial);
  }

  playJump(spatial?: SpatialSoundOptions): void {
    MovementAudio.playJump(this.core, spatial);
  }

  playLanding(intensity: number, spatial?: SpatialSoundOptions): void {
    MovementAudio.playLanding(this.core, intensity, spatial);
  }

  playSlideStart(spatial?: SpatialSoundOptions): void {
    MovementAudio.playSlideStart(this.core, spatial);
  }

  // ── UI ──

  playUIHover(): void {
    UIAudio.playUIHover(this.core);
  }

  playUIClick(): void {
    UIAudio.playUIClick(this.core);
  }

  playUIDeploy(): void {
    UIAudio.playUIDeploy(this.core);
  }

  playUINavigate(): void {
    UIAudio.playUINavigate(this.core);
  }

  playUIError(): void {
    UIAudio.playUIError(this.core);
  }

  playUIType(): void {
    UIAudio.playUIType(this.core);
  }

  // ── Vehicle (Helicopter) ──

  startHelicopterSound(id: number): void {
    VehicleAudio.startHelicopterSound(this.core, id);
    // Register as a persistent sound source for propagation tracing.
    // Position will be set on the first updateHelicopterSound call.
    this.core.rayState.registerSource(id, { x: 0, y: 0, z: 0 });
  }

  updateHelicopterSound(
    id: number,
    position: Vec3Like,
    spinRate: number,
    speed: number,
    isLocal: boolean,
  ): void {
    // Update the source position for the ray tracer
    this.core.rayState.updateSourcePosition(id, position);

    // Compute apparent position from propagation data
    const { apparentPos, occlusion } = this.computeApparentPosition(id, position);

    VehicleAudio.updateHelicopterSound(
      this.core, id, position, spinRate, speed, isLocal,
      apparentPos, occlusion,
    );
  }

  stopHelicopterSound(id: number, destroyed?: boolean): void {
    VehicleAudio.stopHelicopterSound(this.core, id, destroyed);
    this.core.rayState.unregisterSource(id);
  }

  // ── Vehicle (Fighter Jet) ──

  startJetEngineSound(id: number): void {
    VehicleAudio.startJetEngineSound(this.core, id);
    this.core.rayState.registerSource(id, { x: 0, y: 0, z: 0 });
  }

  updateJetEngineSound(
    id: number,
    position: Vec3Like,
    speed: number,
    isLocal: boolean,
  ): void {
    this.core.rayState.updateSourcePosition(id, position);

    const { apparentPos, occlusion } = this.computeApparentPosition(id, position);

    VehicleAudio.updateJetEngineSound(
      this.core, id, position, speed, isLocal,
      apparentPos, occlusion,
    );
  }

  stopJetEngineSound(id: number, destroyed?: boolean): void {
    VehicleAudio.stopJetEngineSound(this.core, id, destroyed);
    this.core.rayState.unregisterSource(id);
  }

  /**
   * Compute the apparent position for a sound source based on ray-traced
   * propagation data. If the source has direct LOS, returns the real position.
   * Otherwise, places the sound along the apparent direction at the same distance.
   */
  private computeApparentPosition(
    sourceId: number,
    realPosition: Vec3Like,
  ): { apparentPos: Vec3Like | undefined; occlusion: number } {
    const prop = this.core.rayState.getSourcePropagation(sourceId);
    if (!prop || prop.directLOS) {
      // Direct line-of-sight or no data yet — use real position
      return { apparentPos: undefined, occlusion: 0 };
    }

    // Place the sound at distance along the apparent direction from listener.
    // This preserves the distance-based volume rolloff but changes the
    // perceived direction to come from the opening/doorway.
    const listener = this.core.getListenerPos();
    const dx = realPosition.x - listener.x;
    const dy = realPosition.y - listener.y;
    const dz = realPosition.z - listener.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const apparentPos: Vec3Like = {
      x: listener.x + prop.apparentDirX * dist,
      y: listener.y + prop.apparentDirY * dist,
      z: listener.z + prop.apparentDirZ * dist,
    };

    return { apparentPos, occlusion: prop.occlusion };
  }

  // ── Ambient ──

  startMenuAmbience(): void {
    AmbientAudio.startMenuAmbience(this.core);
  }

  stopMenuAmbience(): void {
    AmbientAudio.stopMenuAmbience(this.core);
  }

  // ── Master volume & cleanup ──

  setMasterVolume(volume: number): void {
    this.core.setMasterVolume(volume);
  }

  dispose(): void {
    // Terminate the ray tracer worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerReady = false;
    }

    VehicleAudio.disposeAllHelicopterSounds();
    VehicleAudio.disposeAllJetSounds();
    this.core.dispose();
  }
}
