/**
 * Character subject — the player rig every other client renders you as.
 *
 * Variants are the shipping presets, plus an "armed" flavour that attaches the
 * third-person weapon so weapon-hold pose can be judged alongside the body.
 */

import * as THREE from 'three';
import {
  createRemotePlayerModel,
  setRemoteWeaponModel,
  getRemoteWeaponHoldPose,
} from '../../game/RemotePlayerModel';
import { CHARACTER_PRESETS } from '../../characterPresets';
import type { PreviewSubject, PreviewVariant } from './types';

export const characterSubject: PreviewSubject = {
  id: 'character',
  description: 'Player rig per character preset',
  defaultView: 'threequarter',
  ground: true,
  listVariants(): PreviewVariant[] {
    return CHARACTER_PRESETS.map((p) => ({ id: String(p.id), label: `${p.id} · ${p.name}` }));
  },
  build(variantId) {
    const rig = createRemotePlayerModel(Number(variantId));
    rig.model.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return rig.model;
  },
};

export const characterArmedSubject: PreviewSubject = {
  id: 'character-armed',
  description: 'Player rig holding each weapon, for weapon-hold pose review',
  defaultView: 'threequarter',
  ground: true,
  listVariants(): PreviewVariant[] {
    // Weapon index drives the variant here; the preset is held constant so the
    // only thing changing between cells is the thing being judged.
    return [0, 1, 2, 3, 4, 5].map((i) => ({ id: String(i), label: `weapon ${i}` }));
  },
  build(variantId) {
    const weaponIndex = Number(variantId);
    const group = new THREE.Group();
    const rig = createRemotePlayerModel(0);
    rig.model.name = 'remote-player-model';
    group.add(rig.model);

    // Same path RemotePlayerManager takes: mount into the rig's gun mount, then
    // apply the per-weapon arm pose so the hold reads correctly.
    setRemoteWeaponModel(group, weaponIndex, 0);
    const pose = getRemoteWeaponHoldPose(weaponIndex);
    rig.gunMount.position.set(...pose.mountPosition);
    rig.gunMount.rotation.set(...pose.mountRotation);
    rig.leftArm.rotation.set(...pose.leftArmRotation);
    rig.rightArm.rotation.set(...pose.rightArmRotation);

    group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    return group;
  },
};
