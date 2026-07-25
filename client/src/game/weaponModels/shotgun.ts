/**
 * Shotgun — pump action.
 *
 * Silhouette cue: the double-barrel stack. A tube magazine runs the full length
 * under the barrel with a ribbed wooden pump sitting on it, so the profile is
 * two parallel lines instead of the rifle's one. Wood furniture makes it the
 * only warm-toned weapon in the set, readable even in shadow.
 */

import {
  assemble, createPalette, repeat,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.056, 0.07, 0.16], pos: [0, 0, 0.03], mat: p.receiver },
    { size: [0.06, 0.018, 0.165], pos: [0, 0.042, 0.03], mat: p.frame },
    // Barrel and tube both run back into the receiver so the profile is continuous.
    { size: [0.032, 0.032, 0.38], pos: [0, 0.019, -0.225], mat: p.steel },
    { size: [0.026, 0.026, 0.33], pos: [0, -0.016, -0.205], mat: p.frame },
    { size: [0.04, 0.07, 0.018], pos: [0, 0.001, -0.36], mat: p.steel },
    { size: [0.046, 0.042, 0.12], pos: [0, -0.014, -0.17], mat: p.wood },
    { size: [0.028, 0.026, 0.05], pos: [0, -0.042, 0.055], mat: p.frame },
    { size: [0.05, 0.062, 0.1], pos: [0, -0.01, 0.15], mat: p.wood },
    { size: [0.044, 0.05, 0.11], pos: [0, -0.032, 0.24], mat: p.wood, rot: [-0.14, 0, 0] },
    { size: [0.05, 0.07, 0.024], pos: [0, -0.05, 0.3], mat: p.receiver, rot: [-0.14, 0, 0] },
  ];
}

export const shotgunModel: WeaponModelDef = {
  index: 1,
  name: 'Shotgun',
  fpAnchor: [0.28, -0.26, -0.4],
  adsAnchor: [0, -0.039, -0.34],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      // Loading port with a shell part-way in, and the ejection port opposite.
      { size: [0.008, 0.03, 0.055], pos: [0.03, -0.012, 0.02], mat: p.steel },
      { size: [0.014, 0.022, 0.03], pos: [0.028, -0.012, 0.03], mat: p.hazard },
      { size: [0.008, 0.024, 0.045], pos: [-0.03, 0.008, 0.02], mat: p.steel },
      { size: [0.008, 0.012, 0.008], pos: [0, 0.039, -0.4], mat: p.brass },
      // Pump ribs.
      ...repeat(5, [0, 0, -0.022], () => ({
        size: [0.05, 0.03, 0.008],
        pos: [0, -0.014, -0.126],
        mat: p.steel,
      })),
      { size: [0.01, 0.018, 0.01], pos: [0, -0.036, 0.05], mat: p.steel },
      // Shell holder on the stock comb.
      ...repeat(4, [0, 0, 0.024], () => ({
        size: [0.014, 0.016, 0.016],
        pos: [0.03, 0.008, 0.12],
        mat: p.hazard,
      })),
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      { size: [0.014, 0.02, 0.03], pos: [-0.032, -0.02, 0.1], mat: p.accent },
    ]);
  },
};
