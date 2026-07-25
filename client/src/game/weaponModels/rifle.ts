/**
 * Rifle — the baseline carbine.
 *
 * Silhouette cue: a long unbroken top line from the stock to the muzzle, broken
 * only by the low-profile sights, with a straight magazine raking forward. It is
 * the plainest weapon in the set on purpose — everything else reads as a
 * departure from this shape.
 */

import {
  assemble, createPalette, ironSights, pistolGrip, repeat,
  type PartSpec, type WeaponPalette,
} from './parts';
import type { WeaponModelDef } from './types';

/**
 * Silhouette masses, shared by both views so they can never drift apart.
 *
 * Proportioned like a modern competitive-shooter carbine: one dead-straight
 * line from butt pad to muzzle with a full-length top rail running the whole
 * way, a slim handguard, and the receiver as the only real mass. Nothing rises
 * above the rail except the sights — that flatness is what separates a modern
 * rifle from the humpbacked WW2 profile, and it reads at any distance.
 */
function core(p: WeaponPalette): PartSpec[] {
  return [
    { size: [0.048, 0.058, 0.21], pos: [0, 0, 0.025], mat: p.receiver },
    // Full-length rail: receiver deck through to the gas block, unbroken.
    { size: [0.026, 0.014, 0.5], pos: [0, 0.036, -0.11], mat: p.frame },
    // Slim handguard, overlapping the receiver — butted flush leaves a hairline
    // gap that reads as two floating halves in a side silhouette.
    // Height is set so the handguard's top face meets the rail's underside at
    // y=0.029 — the receiver deck height. A rail floating over a gap is the
    // single most obvious tell that a blocky gun was assembled, not designed.
    { size: [0.038, 0.056, 0.26], pos: [0, 0.001, -0.21], mat: p.polymer },
    { size: [0.02, 0.02, 0.15], pos: [0, 0.002, -0.4], mat: p.steel },
    { size: [0.028, 0.028, 0.05], pos: [0, 0.002, -0.49], mat: p.frame },
    { size: [0.028, 0.108, 0.046], pos: [0, -0.074, 0.016], mat: p.polymer, rot: [-0.1, 0, 0] },
    ...pistolGrip(p, { z: 0.09, y: -0.024, h: 0.086 }),
    // Slim tube stock rather than a solid block — keeps the rear light so the
    // weapon's visual weight sits over the grip where the hand is.
    { size: [0.028, 0.03, 0.14], pos: [0, 0.008, 0.2], mat: p.frame },
    { size: [0.036, 0.046, 0.07], pos: [0, 0.004, 0.235], mat: p.polymer },
    { size: [0.04, 0.058, 0.024], pos: [0, 0.002, 0.282], mat: p.receiver },
  ];
}

export const rifleModel: WeaponModelDef = {
  index: 0,
  name: 'Rifle',
  fpAnchor: [0.26, -0.24, -0.42],
  adsAnchor: [0, -0.058, -0.30],
  firstPerson() {
    const p = createPalette();
    return assemble([
      ...core(p),
      // Ejection port with brass showing through it.
      { size: [0.006, 0.024, 0.048], pos: [0.026, 0.006, -0.01], mat: p.steel },
      { size: [0.004, 0.012, 0.028], pos: [0.029, 0.006, -0.01], mat: p.brass },
      { size: [0.028, 0.012, 0.02], pos: [-0.028, 0.024, 0.1], mat: p.steel },
      // Rail slots along the top deck.
      ...repeat(9, [0, 0, -0.05], () => ({
        size: [0.03, 0.016, 0.012],
        pos: [0, 0.038, 0.09],
        mat: p.steel,
      })),
      // M-LOK style cut-outs in the handguard flank.
      ...repeat(4, [0, 0, -0.05], () => ({
        size: [0.042, 0.014, 0.026],
        pos: [0, -0.006, -0.12],
        mat: p.steel,
      })),
      // Muzzle brake ports.
      ...repeat(3, [0, 0, -0.014], () => ({
        size: [0.032, 0.012, 0.006],
        pos: [0, 0.002, -0.478],
        mat: p.steel,
      })),
      { size: [0.026, 0.026, 0.026], pos: [0, 0.014, -0.33], mat: p.steel },
      { size: [0.031, 0.014, 0.048], pos: [0, -0.126, 0.022], mat: p.frame, rot: [-0.1, 0, 0] },
      ...ironSights(p, { rearZ: 0.1, frontZ: -0.33, y: 0.045 }),
    ]);
  },

  world(accentColor) {
    const p = createPalette(accentColor);
    return assemble([
      ...core(p),
      // Sole per-character part: a sling tab on the receiver.
      { size: [0.012, 0.02, 0.03], pos: [-0.03, -0.024, 0.09], mat: p.accent },
    ]);
  },
};
