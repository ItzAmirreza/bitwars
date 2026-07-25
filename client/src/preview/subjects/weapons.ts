/**
 * Weapon subjects — both the first-person models the local player sees and the
 * third-person models everyone else sees.
 *
 * Both pull from the shipping builders (`WeaponModel`, `createRemoteWeaponModel`)
 * rather than rebuilding geometry, so a shot here is the real thing.
 */

import * as THREE from 'three';
import { WeaponModel } from '../../game/WeaponModel';
import { createRemoteWeaponModel } from '../../game/RemotePlayerModel';
import { WEAPONS_CONFIG } from '../../shared-config';
import type { PreviewSubject, PreviewVariant } from './types';

/**
 * `WeaponModel` builds its six groups in shared-config order (Rifle, Shotgun,
 * RPG, Machine Gun, Grenade Launcher, Sniper) and adds them to its own overlay
 * scene, so the names line up index-for-index.
 */
function weaponVariants(): PreviewVariant[] {
  return WEAPONS_CONFIG.map((w: { name: string }, i: number) => ({
    id: String(i),
    label: `${i} · ${w.name}`,
  }));
}

/** Pull the weapon groups out of a throwaway WeaponModel's private overlay scene. */
function firstPersonGroups(): THREE.Group[] {
  const model = new WeaponModel(1);
  return model.scene.children.filter((c): c is THREE.Group => c instanceof THREE.Group);
}

export const firstPersonWeaponSubject: PreviewSubject = {
  id: 'fpweapon',
  description: 'First-person weapon models as held by the local player',
  defaultView: 'threequarter',
  ground: false,
  listVariants: weaponVariants,
  build(variantId) {
    const groups = firstPersonGroups();
    const g = groups[Number(variantId)];
    if (!g) throw new Error(`no first-person weapon at index ${variantId}`);
    // The models sit at their in-hand offset; recentre so auto-framing works.
    g.position.set(0, 0, 0);
    g.visible = true;
    g.traverse((o) => { o.visible = true; });
    return g;
  },
};

export const worldWeaponSubject: PreviewSubject = {
  id: 'worldweapon',
  description: 'Third-person weapon models as seen on other players',
  defaultView: 'threequarter',
  ground: false,
  listVariants: weaponVariants,
  build(variantId) {
    return createRemoteWeaponModel(Number(variantId), 0);
  },
};
