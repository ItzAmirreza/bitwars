import type * as THREE from 'three';

/**
 * One weapon's visual presentation, both views plus where it sits in the hand.
 *
 * Keeping all three in one file per weapon means a design change lands in a
 * single place — the first-person model, the model everyone else sees, and the
 * hold offset can't drift apart.
 */
export interface WeaponModelDef {
  /** Index into `shared/game-constants.json` → `weapons`. */
  index: number;
  name: string;
  /**
   * Close-range model. Fills a third of the screen, so it carries the detail —
   * budget roughly 20–30 boxes.
   */
  firstPerson(): THREE.Group;
  /**
   * The model other players see, at distance and in motion. Silhouette is
   * everything and detail is wasted — budget roughly 8–14 boxes.
   *
   * `accentColor` is the observed player's character tint. Use it on at most one
   * small part so players stay identifiable without the weapon losing its own
   * identity.
   */
  world(accentColor: number): THREE.Group;
  /** Rest position of the first-person model, in view space. */
  fpAnchor: [number, number, number];
  /**
   * Position at full aim-down-sights.
   *
   * X must be 0 and Y must be the negative of the weapon's sight-line height, so
   * the rear aperture and front post land dead centre on the camera axis — that
   * alignment is the whole point of aiming and is instantly obvious when wrong.
   * Z pulls the weapon toward the eye.
   */
  adsAnchor: [number, number, number];
}
