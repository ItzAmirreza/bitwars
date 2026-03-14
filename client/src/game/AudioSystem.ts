/**
 * AudioSystem — thin facade that extends AudioCore and delegates
 * all play* methods to specialised sub-modules.
 *
 * Public API is identical to the original monolithic AudioSystem.
 */

import { AudioCore } from './AudioCore';
import type { SpatialSoundOptions, Vec3Like } from './AudioCore';

// Sub-modules
import * as weaponAudio from './audio/WeaponAudio';
import * as combatAudio from './audio/CombatAudio';
import * as impactAudio from './audio/ImpactAudio';
import * as mechanicalAudio from './audio/MechanicalAudio';
import * as movementAudio from './audio/MovementAudio';
import * as uiAudio from './audio/UIAudio';
import * as vehicleAudio from './audio/VehicleAudio';
import * as ambientAudio from './audio/AmbientAudio';

export { type SpatialSoundOptions, type Vec3Like };

export class AudioSystem extends AudioCore {
  // ── Weapon sounds ──
  playRifle(spatial?: SpatialSoundOptions): void { weaponAudio.playRifle(this, spatial); }
  playShotgun(spatial?: SpatialSoundOptions): void { weaponAudio.playShotgun(this, spatial); }
  playRPGLaunch(spatial?: SpatialSoundOptions): void { weaponAudio.playRPGLaunch(this, spatial); }
  playMachineGun(spatial?: SpatialSoundOptions): void { weaponAudio.playMachineGun(this, spatial); }
  playGrenadeLaunch(spatial?: SpatialSoundOptions): void { weaponAudio.playGrenadeLaunch(this, spatial); }

  // ── Combat feedback ──
  playHitMarker(): void { combatAudio.playHitMarker(this); }
  playKillConfirm(): void { combatAudio.playKillConfirm(this); }
  playDeath(spatial?: SpatialSoundOptions): void { combatAudio.playDeath(this, spatial); }
  playHeartbeat(spatial?: SpatialSoundOptions): void { combatAudio.playHeartbeat(this, spatial); }
  playRespawn(spatial?: SpatialSoundOptions): void { combatAudio.playRespawn(this, spatial); }
  playDamage(spatial?: SpatialSoundOptions): void { combatAudio.playDamage(this, spatial); }

  // ── Impact / environment ──
  playExplosion(spatial?: SpatialSoundOptions): void { impactAudio.playExplosion(this, spatial); }
  playBlockBreak(spatial?: SpatialSoundOptions): void { impactAudio.playBlockBreak(this, spatial); }
  playCrumble(spatial?: SpatialSoundOptions): void { impactAudio.playCrumble(this, spatial); }
  playBlockLand(intensity?: number, spatial?: SpatialSoundOptions): void { impactAudio.playBlockLand(this, intensity, spatial); }

  // ── Mechanical ──
  playReload(spatial?: SpatialSoundOptions): void { mechanicalAudio.playReload(this, spatial); }
  playEmpty(spatial?: SpatialSoundOptions): void { mechanicalAudio.playEmpty(this, spatial); }
  playSwitch(spatial?: SpatialSoundOptions): void { mechanicalAudio.playSwitch(this, spatial); }

  // ── Movement ──
  playStep(sprinting?: boolean, spatial?: SpatialSoundOptions): void { movementAudio.playStep(this, sprinting, spatial); }
  playJump(spatial?: SpatialSoundOptions): void { movementAudio.playJump(this, spatial); }
  playLanding(intensity: number, spatial?: SpatialSoundOptions): void { movementAudio.playLanding(this, intensity, spatial); }
  playSlideStart(spatial?: SpatialSoundOptions): void { movementAudio.playSlideStart(this, spatial); }

  // ── UI ──
  playUIHover(): void { uiAudio.playUIHover(this); }
  playUIClick(): void { uiAudio.playUIClick(this); }
  playUIDeploy(): void { uiAudio.playUIDeploy(this); }
  playUINavigate(): void { uiAudio.playUINavigate(this); }
  playUIError(): void { uiAudio.playUIError(this); }
  playUIType(): void { uiAudio.playUIType(this); }

  // ── Vehicle (helicopter) ──
  startHelicopterSound(id: number): void { vehicleAudio.startHelicopterSound(this, id); }
  updateHelicopterSound(id: number, position: Vec3Like, spinRate: number, speed: number, isLocal: boolean): void {
    vehicleAudio.updateHelicopterSound(this, id, position, spinRate, speed, isLocal);
  }
  stopHelicopterSound(id: number, destroyed?: boolean): void { vehicleAudio.stopHelicopterSound(this, id, destroyed); }

  // ── Ambient ──
  startMenuAmbience(): void { ambientAudio.startMenuAmbience(this); }
  stopMenuAmbience(): void { ambientAudio.stopMenuAmbience(this); }
}
