import * as THREE from 'three';
import { VoxelWorld, BLOCK_COLORS } from './VoxelWorld';
import { VFX } from './VFX';
import { AudioSystem } from './AudioSystem';

/**
 * Falling block physics.
 * After destruction, unsupported blocks above fall with gravity,
 * tumble, and shatter into debris on impact.
 */

interface FallingBlock {
  mesh: THREE.Mesh;
  blockType: number;
  vy: number;
  rotX: number;
  rotZ: number;
}

const SHARED_GEO = new THREE.BoxGeometry(0.85, 0.85, 0.85);
const MAX_FALLING = 300;
const GRAVITY = -22;

export class PhysicsSystem {
  private scene: THREE.Scene;
  private world: VoxelWorld;
  private vfx: VFX;
  private audio: AudioSystem;
  private falling: FallingBlock[] = [];
  private materials = new Map<number, THREE.MeshLambertMaterial>();

  constructor(scene: THREE.Scene, world: VoxelWorld, vfx: VFX, audio: AudioSystem) {
    this.scene = scene;
    this.world = world;
    this.vfx = vfx;
    this.audio = audio;
  }

  private getMat(bt: number): THREE.MeshLambertMaterial {
    let m = this.materials.get(bt);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: BLOCK_COLORS[bt] || 0x808080 });
      this.materials.set(bt, m);
    }
    return m;
  }

  /**
   * Scan columns above destroyed positions. Unsupported blocks become
   * falling entities (removed from grid). Returns their positions
   * so the caller can sync them to the server.
   */
  checkFalling(positions: { x: number; y: number; z: number }[]): { x: number; y: number; z: number }[] {
    const fallen: { x: number; y: number; z: number }[] = [];
    const checked = new Set<string>();

    for (const p of positions) {
      for (let y = p.y + 1; y < this.world.sizeY; y++) {
        const key = `${p.x},${y},${p.z}`;
        if (checked.has(key)) continue;
        checked.add(key);

        const bt = this.world.getBlock(p.x, y, p.z);
        if (bt === 0) break; // Air — nothing above to fall

        // Check if unsupported (air directly below)
        if (this.world.getBlock(p.x, y - 1, p.z) === 0) {
          this.spawnFalling(p.x, y, p.z, bt);
          this.world.setBlock(p.x, y, p.z, 0);
          fallen.push({ x: p.x, y, z: p.z });
          // Don't break — keep scanning upward (cascade)
        }
      }
    }

    if (fallen.length > 0) {
      this.audio.playCrumble();
    }

    return fallen;
  }

  private spawnFalling(x: number, y: number, z: number, bt: number): void {
    if (this.falling.length >= MAX_FALLING) return;

    const mesh = new THREE.Mesh(SHARED_GEO, this.getMat(bt));
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(mesh);

    this.falling.push({
      mesh,
      blockType: bt,
      vy: 0,
      rotX: (Math.random() - 0.5) * 4,
      rotZ: (Math.random() - 0.5) * 4,
    });
  }

  update(delta: number): void {
    let landedCount = 0;

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const fb = this.falling[i];

      // Gravity
      fb.vy += GRAVITY * delta;
      fb.mesh.position.y += fb.vy * delta;

      // Tumble
      fb.mesh.rotation.x += fb.rotX * delta;
      fb.mesh.rotation.z += fb.rotZ * delta;

      // Landing check
      const bx = Math.floor(fb.mesh.position.x);
      const by = Math.floor(fb.mesh.position.y - 0.4);
      const bz = Math.floor(fb.mesh.position.z);

      const landed = by < 0 || this.world.getBlock(bx, by, bz) !== 0;

      if (landed) {
        // Debris VFX
        const color = BLOCK_COLORS[fb.blockType] || 0x808080;
        this.vfx.emitBlockDebris(
          fb.mesh.position.x - 0.5,
          Math.max(0, fb.mesh.position.y - 0.5),
          fb.mesh.position.z - 0.5,
          color,
        );
        this.vfx.emitImpact(
          fb.mesh.position.x - 0.5,
          Math.max(0, fb.mesh.position.y - 0.5),
          fb.mesh.position.z - 0.5,
        );

        // Remove
        this.scene.remove(fb.mesh);
        this.falling.splice(i, 1);
        landedCount++;
      }

      // Despawn if fell way below world
      if (fb.mesh.position.y < -20) {
        this.scene.remove(fb.mesh);
        this.falling.splice(i, 1);
      }
    }

    if (landedCount > 0) {
      this.audio.playBlockLand(Math.min(landedCount / 8, 1));
      this.vfx.shake(Math.min(landedCount * 0.05, 0.4));
    }
  }

  dispose(): void {
    for (const fb of this.falling) this.scene.remove(fb.mesh);
    this.falling = [];
    for (const m of this.materials.values()) m.dispose();
  }
}
