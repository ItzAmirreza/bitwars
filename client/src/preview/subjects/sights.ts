/**
 * Sight-alignment subject.
 *
 * Renders each first-person weapon through the real overlay camera, positioned
 * at its `adsAnchor` — i.e. exactly what the player sees at full aim — with a
 * reticle marking screen centre.
 *
 * This exists because sight alignment is the one part of aim-down-sights that is
 * both trivially wrong and impossible to eyeball anywhere else: if the rear
 * aperture and front post don't sit on the centre mark, aiming looks broken no
 * matter how good the transition feels. Hip pose is included for comparison.
 */

import * as THREE from 'three';
import { WEAPON_MODELS } from '../../game/weaponModels';
import type { PreviewSubject, PreviewVariant } from './types';

function posed(index: number, anchor: [number, number, number]): THREE.Object3D {
  const def = WEAPON_MODELS[index]!;
  const g = def.firstPerson();
  g.position.set(...anchor);
  // The overlay scene is lit independently of the world; approximate it so the
  // model is readable rather than a black silhouette against the backdrop.
  const holder = new THREE.Group();
  holder.add(g);
  holder.add(new THREE.AmbientLight(0x8899bb, 1.0));
  const dir = new THREE.DirectionalLight(0xfff0d0, 1.8);
  dir.position.set(1, 2, 1);
  holder.add(dir);
  return holder;
}

export const sightsSubject: PreviewSubject = {
  id: 'sights',
  description: 'Full-aim sight picture through the first-person camera',
  defaultView: 'front',
  listVariants(): PreviewVariant[] {
    return WEAPON_MODELS.map((d) => ({ id: String(d.index), label: `${d.index} · ${d.name} — aimed` }));
  },
  build(variantId) {
    const i = Number(variantId);
    return posed(i, WEAPON_MODELS[i]!.adsAnchor);
  },
};

export const hipSubject: PreviewSubject = {
  id: 'hip',
  description: 'Resting hip-fire pose through the first-person camera',
  defaultView: 'front',
  listVariants(): PreviewVariant[] {
    return WEAPON_MODELS.map((d) => ({ id: String(d.index), label: `${d.index} · ${d.name} — hip` }));
  },
  build(variantId) {
    const i = Number(variantId);
    return posed(i, WEAPON_MODELS[i]!.fpAnchor);
  },
};
