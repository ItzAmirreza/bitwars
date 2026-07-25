/**
 * Weapon model registry.
 *
 * Adding a weapon's visuals = new file in this directory + one line here. Both
 * `WeaponModel` (first-person) and `createRemoteWeaponModel` (world) read from
 * this list, so the two views can never fall out of sync or drift apart in
 * style.
 */

import type * as THREE from 'three';
import { rifleModel } from './rifle';
import { shotgunModel } from './shotgun';
import { rpgModel } from './rpg';
import { machineGunModel } from './machinegun';
import { grenadeLauncherModel } from './grenadeLauncher';
import { sniperModel } from './sniper';
import type { WeaponModelDef } from './types';

/** Ordered to match `shared/game-constants.json` → `weapons`. */
export const WEAPON_MODELS: WeaponModelDef[] = [
  rifleModel,
  shotgunModel,
  rpgModel,
  machineGunModel,
  grenadeLauncherModel,
  sniperModel,
];

export function getWeaponModel(index: number): WeaponModelDef {
  return WEAPON_MODELS[index] ?? WEAPON_MODELS[0]!;
}

export function buildFirstPersonWeapon(index: number): THREE.Group {
  return getWeaponModel(index).firstPerson();
}

export function buildWorldWeapon(index: number, accentColor: number): THREE.Group {
  return getWeaponModel(index).world(accentColor);
}

export type { WeaponModelDef } from './types';
