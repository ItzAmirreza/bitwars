/**
 * Preview subject registry.
 *
 * Adding something inspectable = new file in this directory + one line here.
 */

import { firstPersonWeaponSubject, worldWeaponSubject } from './weapons';
import { characterSubject, characterArmedSubject } from './character';
import { voxelSubject } from './voxel';
import { sightsSubject, hipSubject } from './sights';
import type { PreviewSubject } from './types';

export const SUBJECTS: PreviewSubject[] = [
  firstPersonWeaponSubject,
  worldWeaponSubject,
  sightsSubject,
  hipSubject,
  characterSubject,
  characterArmedSubject,
  voxelSubject,
];

export function getSubject(id: string): PreviewSubject | undefined {
  return SUBJECTS.find((s) => s.id === id);
}

export type { PreviewSubject, PreviewVariant } from './types';
