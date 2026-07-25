/**
 * Sniper — bolt-action marksman rifle.
 *
 * Silhouette cue: length and the optic. Easily the longest weapon in the set,
 * with a heavy fluted barrel, a large scope riding high on tall rings, and a
 * skeletonised stock whose cut-out thumbhole is visible against the sky. The
 * exposed bolt handle sticking out to the right says single-shot at a glance.
 */

import {
  assemble, bipod, createPalette, pistolGrip, repeat, scope,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.046, 0.056, 0.24], pos: [0, 0.004, 0.04], mat: p.receiver },
    { size: [0.052, 0.016, 0.25], pos: [0, 0.034, 0.04], mat: p.frame },
    { size: [0.03, 0.03, 0.36], pos: [0, 0.004, -0.26], mat: p.steel },
    { size: [0.038, 0.038, 0.06], pos: [0, 0.004, -0.46], mat: p.frame },
    // Bolt handle out to the right with a knob.
    { size: [0.05, 0.014, 0.014], pos: [0.05, 0.012, 0.105], mat: p.steel, rot: [0, 0, -0.25] },
    { size: [0.02, 0.02, 0.02], pos: [0.072, 0.005, 0.105], mat: p.frame },
    { size: [0.03, 0.07, 0.05], pos: [0, -0.052, 0.02], mat: p.frame },
    // Scope rings.
    { size: [0.02, 0.03, 0.018], pos: [0, 0.05, -0.06], mat: p.frame },
    { size: [0.02, 0.03, 0.018], pos: [0, 0.05, 0.06], mat: p.frame },
    ...bipod(p, { z: -0.33, y: -0.014, len: 0.13, spread: 0.026 }),
    ...pistolGrip(p, { z: 0.12, y: -0.024, h: 0.085 }),
    { size: [0.04, 0.05, 0.1], pos: [0, 0.006, 0.2], mat: p.polymer },
    // Thumbhole: an upper and a lower strut with a gap between them.
    { size: [0.036, 0.018, 0.11], pos: [0, 0.03, 0.29], mat: p.polymer },
    { size: [0.036, 0.016, 0.07], pos: [0, -0.026, 0.27], mat: p.polymer },
    { size: [0.042, 0.024, 0.09], pos: [0, 0.052, 0.28], mat: p.polymer },
    { size: [0.046, 0.078, 0.024], pos: [0, 0.012, 0.35], mat: p.receiver },
  ];
}

export const sniperModel: WeaponModelDef = {
  index: 5,
  name: 'Sniper',
  fpAnchor: [0.27, -0.25, -0.46],
  adsAnchor: [0, -0.084, -0.24],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      ...scope(p, { z: 0.0, y: 0.084, len: 0.24, radius: 0.024 }),
      { size: [0.02, 0.02, 0.11], pos: [0.026, 0.016, 0.075], mat: p.steel },
      // Barrel flutes.
      ...repeat(5, [0, 0, -0.06], () => ({
        size: [0.034, 0.012, 0.03],
        pos: [0, 0.004, -0.14],
        mat: p.frame,
      })),
      { size: [0.044, 0.012, 0.03], pos: [0, 0.004, -0.455], mat: p.steel },
      { size: [0.02, 0.02, 0.014], pos: [0, 0.004, -0.494], mat: p.optic },
      { size: [0.034, 0.012, 0.052], pos: [0, -0.086, 0.02], mat: p.steel },
      { size: [0.048, 0.02, 0.026], pos: [0, -0.024, 0.35], mat: p.frame },
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      // Simplified optic: the bell and body only, no turrets or lens.
      { size: [0.048, 0.048, 0.24], pos: [0, 0.084, 0.0], mat: p.optic },
      { size: [0.062, 0.062, 0.05], pos: [0, 0.084, -0.1], mat: p.optic },
      { size: [0.014, 0.02, 0.03], pos: [-0.03, -0.02, 0.11], mat: p.accent },
    ]);
  },
};
