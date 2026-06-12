// ── Sun Shadows ──
// One fixed shadow-casting directional light (the sun) whose ortho frustum
// follows the player, snapped to whole shadow texels so edges never shimmer.
// The caster is configured once at startup and never added/removed, so lit
// material programs stay stable (no mid-game recompile hitches). At night the
// frustum is re-aimed along the moon direction — the sun light's intensity is
// ~0 then, so entities are unaffected while the terrain shader gets moon
// shadows from the same single depth pass.

import * as THREE from 'three';

// Keyed off the user's graphics quality setting; 'low' skips the depth pass
// entirely for potato GPUs. Radius is the half-extent of the ortho frustum
// around the player in world units.
const PRESETS = {
  low: { enabled: false, mapSize: 1024, radius: 64 },
  medium: { enabled: true, mapSize: 1536, radius: 80 },
  high: { enabled: true, mapSize: 2048, radius: 104 },
} as const;

export type ShadowQuality = keyof typeof PRESETS;

/** Distance from the focus point back toward the luminary. */
const LIGHT_DISTANCE = 140;

export class SunShadows {
  enabled = true;

  private sun: THREE.DirectionalLight;
  private radius: number = PRESETS.high.radius;

  private lookMatrix = new THREE.Matrix4();
  private origin = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(sun: THREE.DirectionalLight) {
    this.sun = sun;
    sun.castShadow = true;
    // Bias tuned for 1m axis-aligned voxels and box-built entities
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    sun.shadow.mapSize.set(PRESETS.high.mapSize, PRESETS.high.mapSize);
    this.applyExtent();
  }

  setQuality(quality: ShadowQuality): void {
    const p = PRESETS[quality];
    if (this.enabled !== p.enabled) {
      this.enabled = p.enabled;
      // Flipping the caster recompiles lit materials once — acceptable, it
      // only happens on an explicit user settings change
      this.sun.castShadow = p.enabled;
    }
    if (this.sun.shadow.mapSize.x !== p.mapSize) {
      this.sun.shadow.mapSize.set(p.mapSize, p.mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null; // re-allocated on the next shadow pass
    }
    if (this.radius !== p.radius) {
      this.radius = p.radius;
      this.applyExtent();
    }
  }

  private applyExtent(): void {
    const cam = this.sun.shadow.camera;
    cam.left = -this.radius;
    cam.right = this.radius;
    cam.top = this.radius;
    cam.bottom = -this.radius;
    cam.near = 1;
    cam.far = LIGHT_DISTANCE + this.radius * 2;
    cam.updateProjectionMatrix();
  }

  /** World size of one shadow texel — drives PCF spread + normal offset. */
  getTexelWorldSize(): number {
    return (this.radius * 2) / this.sun.shadow.mapSize.x;
  }

  getMapSize(): number {
    return this.sun.shadow.mapSize.x;
  }

  getMapTexture(): THREE.Texture | null {
    return this.sun.shadow.map ? this.sun.shadow.map.texture : null;
  }

  /** World → shadow-map UV matrix (live reference, updated by the renderer). */
  getMatrix(): THREE.Matrix4 {
    return this.sun.shadow.matrix;
  }

  /**
   * Re-aim the shadow frustum at the player along the dominant luminary
   * direction. The focus point is quantized to whole shadow texels in light
   * space (shifting light + target by the same world delta, so the light
   * direction is exactly preserved) — without this, shadow edges crawl and
   * shimmer every time the player moves.
   */
  update(focus: THREE.Vector3, dir: THREE.Vector3): void {
    if (!this.enabled) return;

    const texel = this.getTexelWorldSize();
    this.lookMatrix.lookAt(dir, this.origin.set(0, 0, 0), this.up);
    const e = this.lookMatrix.elements;

    // Focus projected onto the shadow camera's right (X) and up (Y) axes
    const fx = focus.x * e[0] + focus.y * e[1] + focus.z * e[2];
    const fy = focus.x * e[4] + focus.y * e[5] + focus.z * e[6];
    const dx = Math.round(fx / texel) * texel - fx;
    const dy = Math.round(fy / texel) * texel - fy;

    const tx = focus.x + e[0] * dx + e[4] * dy;
    const ty = focus.y + e[1] * dx + e[5] * dy;
    const tz = focus.z + e[2] * dx + e[6] * dy;

    this.sun.position.set(
      tx + dir.x * LIGHT_DISTANCE,
      ty + dir.y * LIGHT_DISTANCE,
      tz + dir.z * LIGHT_DISTANCE,
    );
    this.sun.target.position.set(tx, ty, tz);
    this.sun.target.updateMatrixWorld();
  }
}
