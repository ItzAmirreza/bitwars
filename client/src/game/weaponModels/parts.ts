/**
 * Shared vocabulary for weapon models.
 *
 * Every weapon — first-person and world — is a declarative list of boxes
 * assembled through `assemble()`. Keeping the primitives here is what makes six
 * weapons read as one family instead of six separate art passes.
 *
 * Conventions all models follow:
 *   • Origin sits at the grip/receiver, i.e. roughly where the hand is.
 *   • The barrel points down **-Z**. +X is right, +Y is up.
 *   • Everything is `BoxGeometry` + `MeshLambertMaterial` (see DESIGN.md).
 *
 * Identity comes from **silhouette**, not colour. The palette is deliberately
 * near-monochrome gunmetal; the only saturated parts are tiny (a lens, a tracer
 * port, a safety marking). A weapon you can only tell apart by its accent stripe
 * is not designed, it is labelled.
 */

import * as THREE from 'three';

export interface WeaponPalette {
  /** Near-black steel — barrels, bolts, internals. */
  steel: THREE.MeshLambertMaterial;
  /** Dark gunmetal — receivers, the main mass. */
  receiver: THREE.MeshLambertMaterial;
  /** Mid grey — frames, rails, exposed machined parts. */
  frame: THREE.MeshLambertMaterial;
  /** Matte polymer — grips, handguards, stocks. */
  polymer: THREE.MeshLambertMaterial;
  /** Warm wood — shotgun furniture. */
  wood: THREE.MeshLambertMaterial;
  /** Optic housings. */
  optic: THREE.MeshLambertMaterial;
  /** Glass. Emissive, and the brightest thing on any weapon — use once. */
  lens: THREE.MeshLambertMaterial;
  /** Brass — exposed rounds, belt links. */
  brass: THREE.MeshLambertMaterial;
  /** Hazard orange — safety markings and warhead bands. Use sparingly. */
  hazard: THREE.MeshLambertMaterial;
  /** Per-character tint. Only ever a small strap//plate on world models. */
  accent: THREE.MeshLambertMaterial;
}

/**
 * Near-monochrome, but deliberately spread across a wide *value* range.
 *
 * The first pass clustered everything between 0x16 and 0x3a, which looks like a
 * sensible gunmetal ramp as hex and renders as a flat black silhouette: these
 * are sRGB values converted to linear before lighting, so the bottom of the
 * range compresses hard and adjacent parts stop separating. Read the ramp by its
 * spacing, not its hex — steel→frame spans roughly 3× in luminance.
 */
export const PALETTE_COLORS = {
  steel: 0x2b2f36,
  receiver: 0x3f454f,
  frame: 0x5f6773,
  polymer: 0x353a43,
  wood: 0x7d5530,
  optic: 0x262a30,
  lens: 0x74c4e6,
  brass: 0xbe9a48,
  hazard: 0xd4601f,
} as const;

/**
 * Build a fresh material set.
 *
 * Deliberately not cached: `WeaponModel.dispose()` and `disposeObjectMaterials()`
 * both walk a gun and dispose what they find, so sharing materials between guns
 * would let one teardown blank the others.
 */
export function createPalette(accentColor = 0x3a3f47): WeaponPalette {
  const solid = (color: number) => new THREE.MeshLambertMaterial({ color });
  return {
    steel: solid(PALETTE_COLORS.steel),
    receiver: solid(PALETTE_COLORS.receiver),
    frame: solid(PALETTE_COLORS.frame),
    polymer: solid(PALETTE_COLORS.polymer),
    wood: solid(PALETTE_COLORS.wood),
    optic: solid(PALETTE_COLORS.optic),
    lens: new THREE.MeshLambertMaterial({
      color: PALETTE_COLORS.lens,
      emissive: PALETTE_COLORS.lens,
      emissiveIntensity: 0.55,
    }),
    brass: solid(PALETTE_COLORS.brass),
    hazard: solid(PALETTE_COLORS.hazard),
    accent: solid(accentColor),
  };
}

export interface PartSpec {
  /** Box dimensions [w, h, d] in metres. */
  size: [number, number, number];
  /** Centre position [x, y, z]. */
  pos: [number, number, number];
  mat: THREE.Material;
  /** Euler rotation in radians. */
  rot?: [number, number, number];
}

/** Assemble a part list into a shadow-casting group. */
export function assemble(parts: PartSpec[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of parts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.size), p.mat);
    mesh.position.set(...p.pos);
    if (p.rot) mesh.rotation.set(...p.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/**
 * Repeat a part along an axis — cooling ribs, handguard vents, belt links.
 * Cheap way to add the density that makes a blocky model read as machined.
 */
export function repeat(
  count: number,
  step: [number, number, number],
  build: (i: number) => PartSpec,
): PartSpec[] {
  const out: PartSpec[] = [];
  for (let i = 0; i < count; i++) {
    const p = build(i);
    out.push({
      ...p,
      pos: [p.pos[0] + step[0] * i, p.pos[1] + step[1] * i, p.pos[2] + step[2] * i],
    });
  }
  return out;
}

/**
 * Iron sights: a rear aperture (two posts + a bridge) and a front post.
 * Shared so every weapon's sight picture sits at the same height and reads as
 * the same manufacturer.
 */
export function ironSights(
  p: WeaponPalette,
  opts: { rearZ: number; frontZ: number; y: number },
): PartSpec[] {
  const { rearZ, frontZ, y } = opts;
  return [
    { size: [0.008, 0.022, 0.01], pos: [-0.014, y + 0.011, rearZ], mat: p.steel },
    { size: [0.008, 0.022, 0.01], pos: [0.014, y + 0.011, rearZ], mat: p.steel },
    { size: [0.036, 0.007, 0.01], pos: [0, y + 0.025, rearZ], mat: p.steel },
    { size: [0.007, 0.026, 0.008], pos: [0, y + 0.014, frontZ], mat: p.steel },
    { size: [0.02, 0.008, 0.008], pos: [0, y + 0.027, frontZ], mat: p.steel },
  ];
}

/** Telescopic sight on rings. `len` drives how dominant it is in the silhouette. */
export function scope(
  p: WeaponPalette,
  opts: { z: number; y: number; len: number; radius: number },
): PartSpec[] {
  const { z, y, len, radius } = opts;
  const d = radius * 2;
  return [
    { size: [d, d, len], pos: [0, y, z], mat: p.optic },
    // Objective bell — steps out so the profile is not a plain tube.
    { size: [d * 1.3, d * 1.3, len * 0.22], pos: [0, y, z - len * 0.42], mat: p.optic },
    { size: [d * 1.15, d * 1.15, len * 0.18], pos: [0, y, z + len * 0.44], mat: p.optic },
    // Turrets.
    { size: [d * 0.5, d * 0.55, d * 0.7], pos: [0, y + radius * 1.3, z], mat: p.frame },
    { size: [d * 0.55, d * 0.5, d * 0.7], pos: [radius * 1.3, y, z], mat: p.frame },
    // Rings.
    { size: [d * 1.1, d * 1.25, 0.016], pos: [0, y - radius * 0.35, z - len * 0.24], mat: p.frame },
    { size: [d * 1.1, d * 1.25, 0.016], pos: [0, y - radius * 0.35, z + len * 0.24], mat: p.frame },
    // Lens.
    { size: [d * 0.95, d * 0.95, 0.008], pos: [0, y, z - len * 0.53], mat: p.lens },
  ];
}

/** Folding bipod, splayed from a common mount. */
export function bipod(
  p: WeaponPalette,
  opts: { z: number; y: number; len: number; spread: number },
): PartSpec[] {
  const { z, y, len, spread } = opts;
  return [
    { size: [0.022, 0.018, 0.05], pos: [0, y + 0.01, z], mat: p.frame },
    { size: [0.012, len, 0.012], pos: [-spread, y - len * 0.45, z], mat: p.steel, rot: [0, 0, 0.28] },
    { size: [0.012, len, 0.012], pos: [spread, y - len * 0.45, z], mat: p.steel, rot: [0, 0, -0.28] },
    { size: [0.03, 0.008, 0.014], pos: [-spread - len * 0.14, y - len * 0.9, z], mat: p.polymer },
    { size: [0.03, 0.008, 0.014], pos: [spread + len * 0.14, y - len * 0.9, z], mat: p.polymer },
  ];
}

/** Angled pistol grip with a trigger guard. */
export function pistolGrip(
  p: WeaponPalette,
  opts: { z: number; y: number; h: number },
): PartSpec[] {
  const { z, y, h } = opts;
  return [
    { size: [0.032, h, 0.05], pos: [0, y - h * 0.5, z], mat: p.polymer, rot: [0.26, 0, 0] },
    { size: [0.036, 0.014, 0.055], pos: [0, y - h * 0.95, z + h * 0.24], mat: p.polymer, rot: [0.26, 0, 0] },
    { size: [0.026, 0.03, 0.008], pos: [0, y - 0.024, z - 0.036], mat: p.frame },
    { size: [0.01, 0.018, 0.01], pos: [0, y - 0.018, z - 0.02], mat: p.steel },
  ];
}
