/**
 * Procedural audio system using Web Audio API.
 * All sounds are generated in real-time — zero file dependencies.
 *
 * This file is a thin facade that delegates to per-category sub-modules
 * in ./audio/. The public API surface is unchanged.
 */

import { AudioCore } from './audio/AudioCore';
import type { SpatialSoundOptions, OcclusionSampler, Vec3Like } from './audio/AudioCore';
import * as WeaponAudio from './audio/WeaponAudio';
import * as CombatAudio from './audio/CombatAudio';
import * as MovementAudio from './audio/MovementAudio';
import * as UIAudio from './audio/UIAudio';
import * as VehicleAudio from './audio/VehicleAudio';
import * as AmbientAudio from './audio/AmbientAudio';

export type { SpatialSoundOptions, OcclusionSampler, Vec3Like };

export class AudioSystem {
  private core = new AudioCore();

  // ── Listener & occlusion ──

  setListenerPose(position: Vec3Like, forward?: Vec3Like, up?: Vec3Like): void {
    this.core.setListenerPose(position, forward, up);
  }

  setOcclusionSampler(sampler: OcclusionSampler | null): void {
    this.core.setOcclusionSampler(sampler);
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
  }

  updateHelicopterSound(
    id: number,
    position: Vec3Like,
    spinRate: number,
    speed: number,
    isLocal: boolean,
  ): void {
    VehicleAudio.updateHelicopterSound(this.core, id, position, spinRate, speed, isLocal);
  }

  stopHelicopterSound(id: number, destroyed?: boolean): void {
    VehicleAudio.stopHelicopterSound(this.core, id, destroyed);
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
    VehicleAudio.disposeAllHelicopterSounds();
    this.core.dispose();
  }
}
