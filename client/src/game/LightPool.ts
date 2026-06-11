import * as THREE from 'three';

/**
 * Fixed pool of point lights that live in the scene for the app's lifetime.
 *
 * three.js compiles a separate shader program for every distinct scene light
 * count, so adding/removing/hiding lights at runtime forces every lit
 * material to recompile — a multi-hundred-ms freeze on first RPG shot,
 * grenade throw, etc. The pool keeps the light count constant: unused slots
 * sit at intensity 0 (still counted by the renderer, contributing nothing),
 * and all programs compile once behind the loading screen.
 *
 * Rules for pooled lights:
 *  - NEVER toggle `.visible` (that changes the counted light set)
 *  - NEVER remove them from the scene
 *  - "Off" means `intensity = 0`
 */
export class LightPool {
  private lights: THREE.PointLight[] = [];
  private free: THREE.PointLight[] = [];

  constructor(scene: THREE.Scene, size: number) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 1, 2);
      light.position.set(0, -1000, 0);
      scene.add(light);
      this.lights.push(light);
      this.free.push(light);
    }
  }

  /** Returns a zeroed light, or null when the pool is exhausted. */
  acquire(): THREE.PointLight | null {
    return this.free.pop() ?? null;
  }

  release(light: THREE.PointLight | null): void {
    if (!light) return;
    if (!this.lights.includes(light) || this.free.includes(light)) return;
    light.intensity = 0;
    light.distance = 1;
    light.decay = 2;
    light.position.set(0, -1000, 0);
    this.free.push(light);
  }

  size(): number {
    return this.lights.length;
  }
}
