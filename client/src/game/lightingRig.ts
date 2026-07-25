/**
 * The scene's light rig and renderer colour profile.
 *
 * Extracted from Engine so the offline preview harness (`src/preview/`) renders
 * subjects under exactly the lighting the game ships, rather than a lookalike
 * that drifts. Anything tuning how the world is lit belongs here, not inlined
 * at a call site.
 *
 * These are the *seed* values. At runtime SkySystem overwrites the intensity and
 * colour of all four lights every frame from its time-of-day keyframes — see
 * `SkyColors.ts`. The preview harness leaves them alone, so what it shows is the
 * neutral daylight case.
 */

import * as THREE from 'three';

export interface LightRig {
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
}

/** Background/fog colour. Shared so preview backdrops match the game's horizon. */
export const CLEAR_COLOR = 0x5a5856;

export const FOG_NEAR = 200;
export const FOG_FAR = 500;

/**
 * Tone mapping, shadow filtering and pixel ratio.
 *
 * PCFSoftShadowMap was removed in three r183 — setting it logs a deprecation
 * warning and silently falls back to PCFShadowMap. Named explicitly so the
 * shadow quality we actually get is the one written down here.
 */
export function applyRendererProfile(renderer: THREE.WebGLRenderer): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(CLEAR_COLOR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
}

/**
 * Build the four lights and add them (plus the directional targets) to `scene`.
 *
 * `shadowExtent` sizes the sun's orthographic shadow box. The game uses a box
 * wide enough for the streaming radius; the preview shrinks it hard so a single
 * subject gets the full shadow-map resolution instead of a few blurry texels.
 */
export function createLightRig(scene: THREE.Scene, shadowExtent = 80): LightRig {
  const hemi = new THREE.HemisphereLight(0x8a8a95, 0x2a2218, 0.8);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0x505058, 0.5);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe0b0, 2.5);
  sun.position.set(50, 80, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  // A near-zero normal bias let voxel faces self-shadow into a crawling acne
  // pattern that shifted with the sun. Offsetting samples along the surface
  // normal (~⅓ of a block) kills it without visible peter-panning.
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  scene.add(sun);
  scene.add(sun.target);

  const moon = new THREE.DirectionalLight(0x9bb4ff, 0.35);
  moon.position.set(-40, 60, -25);
  moon.castShadow = false;
  scene.add(moon);
  scene.add(moon.target);

  return { sun, moon, hemi, ambient };
}
