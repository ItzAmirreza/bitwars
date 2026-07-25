/**
 * Machine Gun — belt-fed LMG.
 *
 * Silhouette cue: bottom-heavy and bristling. A deep ammo box hangs under the
 * receiver, a ribbed heavy barrel runs out front, and the bipod splays below —
 * so the outline is wide at the bottom where every other weapon is narrow. The
 * exposed brass belt is the one bright detail and it reads instantly as "this is
 * the one that keeps firing".
 */

import {
  assemble, bipod, createPalette, pistolGrip, repeat,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.062, 0.072, 0.23], pos: [0, 0.004, 0.03], mat: p.receiver },
    { size: [0.066, 0.016, 0.235], pos: [0, 0.046, 0.03], mat: p.frame },
    { size: [0.032, 0.032, 0.28], pos: [0, 0.008, -0.24], mat: p.steel },
    { size: [0.038, 0.038, 0.05], pos: [0, 0.008, -0.4], mat: p.frame },
    // Ammo box.
    { size: [0.078, 0.1, 0.14], pos: [0, -0.09, 0.02], mat: p.polymer },
    { size: [0.082, 0.014, 0.145], pos: [0, -0.036, 0.02], mat: p.frame },
    // Carry handle.
    { size: [0.012, 0.03, 0.012], pos: [-0.02, 0.078, -0.05], mat: p.frame },
    { size: [0.012, 0.03, 0.012], pos: [-0.02, 0.078, 0.02], mat: p.frame },
    { size: [0.016, 0.012, 0.09], pos: [-0.02, 0.094, -0.015], mat: p.polymer },
    ...bipod(p, { z: -0.31, y: -0.012, len: 0.12, spread: 0.028 }),
    ...pistolGrip(p, { z: 0.11, y: -0.028, h: 0.09 }),
    { size: [0.044, 0.058, 0.09], pos: [0, 0.004, 0.185], mat: p.polymer },
    // Bridge to the butt pad so it does not float off the back.
    { size: [0.034, 0.04, 0.05], pos: [0, 0.0, 0.235], mat: p.frame },
    { size: [0.048, 0.07, 0.026], pos: [0, -0.006, 0.268], mat: p.receiver },
  ];
}

export const machineGunModel: WeaponModelDef = {
  index: 3,
  name: 'Machine Gun',
  fpAnchor: [0.29, -0.25, -0.44],
  adsAnchor: [0, -0.054, -0.30],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      // Feed tray cover with a hinge line.
      { size: [0.058, 0.014, 0.13], pos: [0, 0.056, 0.0], mat: p.receiver },
      { size: [0.062, 0.006, 0.13], pos: [0, 0.048, 0.0], mat: p.steel },
      // Barrel cooling ribs.
      ...repeat(6, [0, 0, -0.04], () => ({
        size: [0.042, 0.042, 0.012],
        pos: [0, 0.008, -0.14],
        mat: p.frame,
      })),
      { size: [0.044, 0.014, 0.052], pos: [0, 0.008, -0.4], mat: p.steel },
      { size: [0.084, 0.03, 0.02], pos: [0, -0.13, 0.02], mat: p.frame },
      // Exposed belt feeding up into the receiver.
      ...repeat(4, [0, 0.011, -0.006], () => ({
        size: [0.03, 0.012, 0.022],
        pos: [0.028, -0.048, -0.02],
        mat: p.brass,
      })),
      { size: [0.04, 0.016, 0.06], pos: [0, 0.042, 0.185], mat: p.frame },
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      { size: [0.03, 0.014, 0.024], pos: [0.03, -0.05, -0.02], mat: p.brass },
      { size: [0.014, 0.02, 0.03], pos: [-0.034, -0.022, 0.1], mat: p.accent },
    ]);
  },
};
