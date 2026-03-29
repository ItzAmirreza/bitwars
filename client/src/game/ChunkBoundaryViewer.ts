import * as THREE from 'three';
import { CHUNK } from './VoxelWorld';
import type { VoxelWorld } from './VoxelWorld';

/**
 * Renders wireframe boxes around chunk boundaries for debugging.
 * Only draws boundaries around chunks near the camera to stay cheap.
 */
export class ChunkBoundaryViewer {
  private scene: THREE.Scene;
  private group = new THREE.Group();
  private material = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.35,
    depthTest: true,
    depthWrite: false,
  });
  private enabled = false;
  private lastAnchorCx = -9999;
  private lastAnchorCz = -9999;
  private readonly VIEW_RADIUS = 4; // chunks around camera

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.renderOrder = 999;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.scene.add(this.group);
    } else {
      this.scene.remove(this.group);
      this.clear();
      this.lastAnchorCx = -9999;
      this.lastAnchorCz = -9999;
    }
    return this.enabled;
  }

  update(camera: THREE.Camera, world: VoxelWorld): void {
    if (!this.enabled) return;

    const cx = Math.floor(camera.position.x / CHUNK);
    const cz = Math.floor(camera.position.z / CHUNK);

    // Only rebuild when the camera crosses a chunk boundary
    if (cx === this.lastAnchorCx && cz === this.lastAnchorCz) return;
    this.lastAnchorCx = cx;
    this.lastAnchorCz = cz;

    this.clear();

    const loaded = new Set<number>();
    for (const id of world.getLoadedChunkIds()) loaded.add(id);

    const r = this.VIEW_RADIUS;
    const verts: number[] = [];

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const ccx = cx + dx;
        const ccz = cz + dz;
        // Draw vertical columns for every loaded Y-layer in this column
        const minY = 0;
        const maxY = 3; // 48 blocks / 16 = 3 chunk layers
        for (let ccy = minY; ccy < maxY; ccy++) {
          this.addBoxEdges(verts, ccx * CHUNK, ccy * CHUNK, ccz * CHUNK, CHUNK);
        }
      }
    }

    if (verts.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const lines = new THREE.LineSegments(geometry, this.material);
    lines.frustumCulled = false;
    this.group.add(lines);
  }

  private addBoxEdges(verts: number[], x: number, y: number, z: number, s: number): void {
    const x1 = x, y1 = y, z1 = z;
    const x2 = x + s, y2 = y + s, z2 = z + s;

    // Bottom face edges
    verts.push(x1, y1, z1, x2, y1, z1);
    verts.push(x2, y1, z1, x2, y1, z2);
    verts.push(x2, y1, z2, x1, y1, z2);
    verts.push(x1, y1, z2, x1, y1, z1);

    // Top face edges
    verts.push(x1, y2, z1, x2, y2, z1);
    verts.push(x2, y2, z1, x2, y2, z2);
    verts.push(x2, y2, z2, x1, y2, z2);
    verts.push(x1, y2, z2, x1, y2, z1);

    // Vertical edges
    verts.push(x1, y1, z1, x1, y2, z1);
    verts.push(x2, y1, z1, x2, y2, z1);
    verts.push(x2, y1, z2, x2, y2, z2);
    verts.push(x1, y1, z2, x1, y2, z2);
  }

  private clear(): void {
    for (const child of this.group.children) {
      (child as THREE.LineSegments).geometry.dispose();
    }
    this.group.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
    this.material.dispose();
  }
}
