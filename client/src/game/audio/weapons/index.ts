/**
 * Weapon audio registry — procedural firing, reload, empty-click, switch, and
 * flyby sounds.
 *
 * One file per weapon under this folder, mirroring the server's
 * one-file-per-weapon layout (`server/spacetimedb/src/weapons/`). Adding a
 * weapon means dropping a new file here and adding one line to
 * `WEAPON_FIRE_SOUNDS` below — symmetric with adding `weapons/<name>.rs` on
 * the server.
 *
 * Weapon indices match the loadout/registry order:
 *   - Infantry: 0 rifle, 1 shotgun, 2 RPG, 3 machine gun, 4 grenade launcher, 5 sniper
 *   - Vehicle (100 + slot): 100 minigun, 101 rockets, 102 kinetic penetrator,
 *     103 carpet bomb, 104 autocannon, 105 SAM missile, 106 air missile
 */

import type { AudioCore, SpatialSoundOptions } from '../AudioCore';
import { playRifle } from './rifle';
import { playShotgun } from './shotgun';
import { playRPGLaunch } from './rpg';
import { playMachineGun } from './machineGun';
import { playGrenadeLaunch } from './grenadeLauncher';
import { playSniper } from './sniper';
import { playVehicleMinigun } from './vehicleMinigun';
import { playVehicleRocket } from './vehicleRockets';
import { playKineticPenetratorFire } from './kineticPenetrator';
import { playCarpetBombDrop } from './carpetBomb';

export type WeaponFireSound = (core: AudioCore, spatial?: SpatialSoundOptions) => void;

/** Weapon index → procedural fire sound. */
export const WEAPON_FIRE_SOUNDS: Record<number, WeaponFireSound> = {
  // Infantry weapons (loadout order)
  0: playRifle,
  1: playShotgun,
  2: playRPGLaunch,
  3: playMachineGun,
  4: playGrenadeLaunch,
  5: playSniper,
  // Vehicle weapons (100 + vehicle weapon slot)
  100: playVehicleMinigun, // Minigun
  101: playVehicleRocket, // Rockets
  102: playKineticPenetratorFire, // Kinetic Penetrator
  103: playCarpetBombDrop, // Carpet Bomb
  104: playVehicleMinigun, // Autocannon
  105: playVehicleRocket, // SAM Missile
  106: playVehicleRocket, // Air Missile
};

/** Play the procedural fire sound for a weapon index, if one is registered. */
export function playWeaponFire(
  core: AudioCore,
  weaponIndex: number,
  spatial?: SpatialSoundOptions,
): void {
  WEAPON_FIRE_SOUNDS[weaponIndex]?.(core, spatial);
}

// Re-export every play function so callers can pull the whole weapon-audio
// surface from this single module (e.g. `import * as WeaponAudio`).
export { playRifle } from './rifle';
export { playShotgun } from './shotgun';
export { playRPGLaunch } from './rpg';
export { playMachineGun } from './machineGun';
export { playGrenadeLaunch } from './grenadeLauncher';
export { playSniper } from './sniper';
export { playVehicleMinigun } from './vehicleMinigun';
export { playVehicleRocket } from './vehicleRockets';
export { playKineticPenetratorFire, playKineticPenetratorDetonation } from './kineticPenetrator';
export { playCarpetBombDrop } from './carpetBomb';
export { playReload, playEmpty, playSwitch, playLowAmmo, playReloadComplete } from './actions';
export { playProjectileFlyby } from './flyby';
