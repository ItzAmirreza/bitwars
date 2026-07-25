/**
 * RPG — shoulder-fired launcher.
 *
 * Silhouette cue: mass in the wrong places. A fat smooth tube with a bulbous
 * warhead sticking out the front and a flared blast cone out the back, so both
 * ends are wider than the middle — the opposite of every other weapon here. The
 * optic is offset to the left because the tube itself blocks a centred sight,
 * which also breaks the symmetry at a glance.
 */

import {
  assemble, createPalette, pistolGrip, repeat,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.072, 0.072, 0.46], pos: [0, 0.01, -0.02], mat: p.receiver },
    // Blast cone, stepped out in two stages.
    { size: [0.086, 0.086, 0.05], pos: [0, 0.01, 0.225], mat: p.frame },
    { size: [0.1, 0.1, 0.045], pos: [0, 0.01, 0.272], mat: p.receiver },
    { size: [0.088, 0.088, 0.02], pos: [0, 0.01, 0.296], mat: p.steel },
    // Warhead.
    { size: [0.052, 0.052, 0.06], pos: [0, 0.01, -0.28], mat: p.frame },
    { size: [0.086, 0.086, 0.09], pos: [0, 0.01, -0.35], mat: p.polymer },
    { size: [0.09, 0.09, 0.016], pos: [0, 0.01, -0.33], mat: p.hazard },
    { size: [0.056, 0.056, 0.05], pos: [0, 0.01, -0.42], mat: p.polymer },
    // Offset optic on a riser.
    { size: [0.018, 0.03, 0.02], pos: [-0.046, 0.042, -0.05], mat: p.frame },
    { size: [0.034, 0.036, 0.11], pos: [-0.046, 0.07, -0.06], mat: p.optic },
    ...pistolGrip(p, { z: 0.1, y: -0.03, h: 0.09 }),
    { size: [0.03, 0.075, 0.04], pos: [0, -0.058, -0.15], mat: p.polymer, rot: [-0.2, 0, 0] },
    { size: [0.05, 0.03, 0.07], pos: [0, -0.036, 0.2], mat: p.polymer, rot: [0.3, 0, 0] },
  ];
}

export const rpgModel: WeaponModelDef = {
  index: 2,
  name: 'RPG',
  fpAnchor: [0.3, -0.28, -0.36],
  adsAnchor: [0.046, -0.07, -0.26],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      ...repeat(3, [0, 0, -0.12], () => ({
        size: [0.08, 0.08, 0.016],
        pos: [0, 0.01, 0.11],
        mat: p.frame,
      })),
      { size: [0.026, 0.026, 0.03], pos: [0, 0.01, -0.455], mat: p.steel },
      { size: [0.03, 0.03, 0.008], pos: [-0.046, 0.07, -0.118], mat: p.lens },
      // Heat shield along the top.
      { size: [0.05, 0.012, 0.2], pos: [0, 0.052, -0.06], mat: p.steel },
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      { size: [0.012, 0.018, 0.028], pos: [0.04, -0.03, 0.06], mat: p.accent },
    ]);
  },
};
