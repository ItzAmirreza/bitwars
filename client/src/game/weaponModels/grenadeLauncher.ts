/**
 * Grenade Launcher — revolver type.
 *
 * Silhouette cue: the drum. A fat eight-chamber cylinder sits mid-body and is by
 * far the widest thing on any weapon here, with a stubby wide-bore barrel and a
 * folding ladder sight standing proud of the top line. Short and round where the
 * rifle is long and flat.
 */

import {
  assemble, createPalette, pistolGrip, repeat,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

/**
 * Eight chambers ringed around the drum axis.
 *
 * Each is a slab rotated tangent to the circle, so the outer profile steps
 * around like a revolver cylinder instead of reading as one square block. The
 * ring must sit *proud* of the drum core — inset chambers just disappear.
 */
function drumChambers(p: WeaponPalette, z: number, y: number): PartSpec[] {
  const out: PartSpec[] = [];
  const r = 0.052;
  const count = 8;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({
      size: [0.044, 0.034, 0.11],
      pos: [Math.cos(a) * r, y + Math.sin(a) * r, z],
      mat: p.receiver,
      rot: [0, 0, a + Math.PI / 2],
    });
  }
  return out;
}

function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.048, 0.06, 0.34], pos: [0, 0.006, 0.02], mat: p.receiver },
    { size: [0.052, 0.014, 0.34], pos: [0, 0.04, 0.02], mat: p.frame },
    // Core is the lightest part: side-on a revolver cylinder reads as a machined
    // body with darker chamber bumps ringing it. Inverting that makes the middle
    // look like a hole punched through the weapon.
    { size: [0.07, 0.07, 0.1], pos: [0, 0.006, -0.05], mat: p.frame },
    ...drumChambers(p, -0.05, 0.006),
    // Plates inset from the chamber ring so the stepped ring defines the outline.
    { size: [0.094, 0.094, 0.014], pos: [0, 0.006, -0.108], mat: p.frame },
    { size: [0.094, 0.094, 0.014], pos: [0, 0.006, 0.008], mat: p.frame },
    { size: [0.022, 0.022, 0.14], pos: [0, 0.006, -0.05], mat: p.frame },
    { size: [0.05, 0.05, 0.17], pos: [0, 0.006, -0.2], mat: p.steel },
    { size: [0.058, 0.058, 0.026], pos: [0, 0.006, -0.29], mat: p.frame },
    { size: [0.032, 0.07, 0.04], pos: [0, -0.046, -0.19], mat: p.polymer },
    ...pistolGrip(p, { z: 0.13, y: -0.026, h: 0.088 }),
    { size: [0.03, 0.03, 0.08], pos: [0, 0.006, 0.22], mat: p.frame },
    { size: [0.044, 0.066, 0.024], pos: [0, -0.004, 0.27], mat: p.polymer },
    // One loaded round showing in the top chamber.
    { size: [0.026, 0.026, 0.03], pos: [0, 0.058, -0.108], mat: p.hazard },
  ];
}

export const grenadeLauncherModel: WeaponModelDef = {
  index: 4,
  name: 'Grenade Launcher',
  fpAnchor: [0.29, -0.27, -0.38],
  adsAnchor: [0, -0.09, -0.29],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      { size: [0.036, 0.036, 0.012], pos: [0, 0.006, -0.3], mat: p.optic },
      { size: [0.038, 0.014, 0.046], pos: [0, -0.078, -0.19], mat: p.frame },
      // Folding ladder sight.
      { size: [0.01, 0.07, 0.008], pos: [-0.014, 0.08, 0.09], mat: p.steel },
      { size: [0.01, 0.07, 0.008], pos: [0.014, 0.08, 0.09], mat: p.steel },
      ...repeat(4, [0, 0.016, 0], () => ({
        size: [0.038, 0.005, 0.008],
        pos: [0, 0.058, 0.09],
        mat: p.steel,
      })),
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      { size: [0.014, 0.02, 0.03], pos: [-0.03, -0.02, 0.12], mat: p.accent },
    ]);
  },
};
