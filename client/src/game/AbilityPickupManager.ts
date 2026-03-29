// ── Ability Pickup Manager ──
// Renders floating, rotating ability pickups in the 3D world with labels.

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

const PICKUP_RADIUS_SQ = ABILITIES.pickupRadius * ABILITIES.pickupRadius;

interface PickupVisual {
  group: THREE.Group;
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  label: THREE.Sprite;
  type: number;
}

export { ABILITY_COLORS, ABILITY_NAMES };

export class AbilityPickupManager {
  private scene: THREE.Scene;
  private pickups: Map<bigint, PickupVisual> = new Map();
  private elapsed = 0;
  /** Cooldown timestamps to avoid spamming the reducer (cleared after 500ms). */
  private collectCooldowns: Map<bigint, number> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private createLabel(name: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx2d = canvas.getContext('2d')!;

    ctx2d.clearRect(0, 0, 256, 64);
    const hex = '#' + color.toString(16).padStart(6, '0');
    ctx2d.font = 'bold 28px monospace';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    // Shadow for readability
    ctx2d.shadowColor = 'rgba(0,0,0,0.8)';
    ctx2d.shadowBlur = 4;
    ctx2d.shadowOffsetX = 1;
    ctx2d.shadowOffsetY = 1;
    ctx2d.fillStyle = hex;
    ctx2d.fillText(name, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.5, 0.625, 1);
    sprite.position.set(0, 1.2, 0);
    return sprite;
  }

  addPickup(id: bigint, abilityType: number, x: number, y: number, z: number): void {
    if (this.pickups.has(id)) return;

    const color = ABILITY_COLORS[abilityType] ?? 0xffffff;
    const name = ABILITY_NAMES[abilityType] ?? 'Unknown';

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

    const label = this.createLabel(name, color);

    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(mesh);
    group.add(light);
    group.add(label);

    this.scene.add(group);
    this.pickups.set(id, { group, mesh, light, label, type: abilityType });
  }

  removePickup(id: bigint): void {
    const visual = this.pickups.get(id);
    if (!visual) return;

    this.scene.remove(visual.group);
    (visual.mesh.material as THREE.Material).dispose();
    visual.mesh.geometry.dispose();
    (visual.label.material as THREE.SpriteMaterial).map?.dispose();
    (visual.label.material as THREE.Material).dispose();
    this.pickups.delete(id);
    this.collectCooldowns.delete(id);
  }

  setActive(id: bigint, active: boolean): void {
    const visual = this.pickups.get(id);
    if (visual) {
      visual.group.visible = active;
      if (active) this.collectCooldowns.delete(id);
    }
  }

  /** Returns pickup IDs within collection radius of the given position. */
  getPickupsInRange(px: number, py: number, pz: number): bigint[] {
    const now = performance.now();
    const result: bigint[] = [];
    for (const [id, visual] of this.pickups) {
      if (!visual.group.visible) continue;
      const cd = this.collectCooldowns.get(id);
      if (cd !== undefined && now < cd) continue;
      const g = visual.group.position;
      const dx = g.x - px, dy = g.y - py, dz = g.z - pz;
      if (dx * dx + dy * dy + dz * dz <= PICKUP_RADIUS_SQ) {
        result.push(id);
      }
    }
    return result;
  }

  /** Set a short cooldown so we don't spam the reducer for this pickup. */
  markCollectAttempt(id: bigint): void {
    this.collectCooldowns.set(id, performance.now() + 500);
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
