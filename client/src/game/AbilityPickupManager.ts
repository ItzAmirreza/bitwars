// ── Ability Pickup Manager ──
// Renders floating, rotating ability pickups in the 3D world.

import * as THREE from 'three';
import { ABILITIES } from '../shared-config';

const ABILITY_COLORS: Record<number, number> = {
  [ABILITIES.types.HealthRegen]: 0x44ff44,
  [ABILITIES.types.DoubleDamage]: 0xff4444,
  [ABILITIES.types.SpeedBoost]: 0x44ddff,
  [ABILITIES.types.Shield]: 0xffcc00,
};

const ABILITY_NAMES: Record<number, string> = {
  [ABILITIES.types.HealthRegen]: 'Health',
  [ABILITIES.types.DoubleDamage]: 'Double Damage',
  [ABILITIES.types.SpeedBoost]: 'Speed Boost',
  [ABILITIES.types.Shield]: 'Shield',
};

interface PickupVisual {
  group: THREE.Group;
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  type: number;
}

export { ABILITY_COLORS, ABILITY_NAMES };

export class AbilityPickupManager {
  private scene: THREE.Scene;
  private pickups: Map<bigint, PickupVisual> = new Map();
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  addPickup(id: bigint, abilityType: number, x: number, y: number, z: number): void {
    if (this.pickups.has(id)) return;

    const color = ABILITY_COLORS[abilityType] ?? 0xffffff;

    // Voxel-style cube pickup
    const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.7,
    });
    const mesh = new THREE.Mesh(geometry, material);

    const light = new THREE.PointLight(color, 2, 8);
    light.position.set(0, 0, 0);

    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(mesh);
    group.add(light);

    this.scene.add(group);
    this.pickups.set(id, { group, mesh, light, type: abilityType });
  }

  removePickup(id: bigint): void {
    const visual = this.pickups.get(id);
    if (!visual) return;

    this.scene.remove(visual.group);
    (visual.mesh.material as THREE.Material).dispose();
    visual.mesh.geometry.dispose();
    this.pickups.delete(id);
  }

  setActive(id: bigint, active: boolean): void {
    const visual = this.pickups.get(id);
    if (visual) {
      visual.group.visible = active;
    }
  }

  update(delta: number): void {
    this.elapsed += delta;

    for (const visual of this.pickups.values()) {
      if (!visual.group.visible) continue;
      // Gentle bob
      visual.mesh.position.y = Math.sin(this.elapsed * 2) * 0.15;
      // Slow rotation
      visual.mesh.rotation.y += delta * 1.5;
      visual.mesh.rotation.x = Math.sin(this.elapsed * 0.8) * 0.2;
      // Pulse light
      visual.light.intensity = 1.5 + Math.sin(this.elapsed * 3) * 0.5;
    }
  }

  dispose(): void {
    for (const [id] of this.pickups) {
      this.removePickup(id);
    }
  }
}
