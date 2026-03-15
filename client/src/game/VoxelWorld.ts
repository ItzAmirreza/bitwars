import * as THREE from 'three';
import { WORLD as WORLD_CONFIG, BLOCK_TYPES } from '../shared-config';

// ── Constants (sourced from shared config) ──

export const CHUNK = WORLD_CONFIG.chunkSize;
export const WORLD_X = WORLD_CONFIG.sizeX;
export const WORLD_Y = WORLD_CONFIG.sizeY;
export const WORLD_Z = WORLD_CONFIG.sizeZ;

// BlockType object — sourced from shared config, kept for backward compatibility
export const BlockType = BLOCK_TYPES as {
  readonly Air: 0;
  readonly Concrete: 1;
  readonly DarkConcrete: 2;
  readonly Asphalt: 3;
  readonly Rebar: 4;
  readonly Brick: 5;
  readonly Metal: 6;
  readonly Rubble: 7;
  readonly Dirt: 8;
  readonly Sand: 9;
  readonly Grass: 10;
  readonly Wood: 11;
  readonly Stone: 12;
  readonly Snow: 13;
  readonly Lantern: 14;
};
export type BlockType = (typeof BlockType)[keyof typeof BlockType];

export const BLOCK_COLORS: Record<number, number> = {
  [BlockType.Concrete]: 0x7a7a78,
  [BlockType.DarkConcrete]: 0x5a5a58,
  [BlockType.Asphalt]: 0x2a2a2e,
  [BlockType.Rebar]: 0x8b4513,
  [BlockType.Brick]: 0x6b3a2a,
  [BlockType.Metal]: 0x4a4e52,
  [BlockType.Rubble]: 0x6a6258,
  [BlockType.Dirt]: 0x5a4e3a,
  [BlockType.Sand]: 0x9a8e72,
  [BlockType.Grass]: 0x4a7a3a,
  [BlockType.Wood]: 0x6b4423,
  [BlockType.Stone]: 0x6a6a6a,
  [BlockType.Snow]: 0xd8d8e0,
  [BlockType.Lantern]: 0xffcf78,
};

const LANTERN_NEAR_BOOST_OFFSETS: Array<[number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [1, -1, 0],
  [-1, 1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [1, 0, -1],
  [-1, 0, 1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, 1, -1],
  [0, -1, 1],
  [0, -1, -1],
];

// ── Noise helpers ──

function hash2d(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

// ── Chunk ID helpers ──

export function packChunkId(cx: number, cy: number, cz: number): number {
  return (cx & 0xFF) | ((cy & 0xFF) << 8) | ((cz & 0xFF) << 16);
}

export function unpackChunkId(id: number): [number, number, number] {
  return [id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF];
}

// ── VoxelWorld (Sparse Chunk Storage) ──

export class VoxelWorld {
  sizeX: number;
  sizeY: number;
  sizeZ: number;

  // Sparse chunk storage: chunk_id -> 4096-byte block data
  private chunks: Map<number, Uint8Array> = new Map();
  private chunkMeshes: Map<number, THREE.Mesh> = new Map();
  private dirtyChunks: Set<number> = new Set();
  private mat: THREE.MeshPhongMaterial;

  constructor(sx: number, sy: number, sz: number) {
    this.sizeX = sx; this.sizeY = sy; this.sizeZ = sz;
    this.mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x10182a),
      emissiveIntensity: 0.34,
      shininess: 6,
      specular: new THREE.Color(0x111418),
    });
  }

  // ── Server chunk loading ──

  /** RLE-decode a chunk data blob into a flat 16x16x16 array */
  static rleDecodeChunk(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(CHUNK * CHUNK * CHUNK);
    let outIdx = 0;
    let i = 0;
    while (i + 1 < data.length && outIdx < output.length) {
      const val = data[i];
      const run = data[i + 1];
      for (let j = 0; j < run && outIdx < output.length; j++) {
        output[outIdx++] = val;
      }
      i += 2;
    }
    return output;
  }

  /** Load a 16x16x16 chunk from decoded data into sparse storage. */
  loadChunk(cx: number, cy: number, cz: number, chunkBlocks: Uint8Array): void {
    const id = packChunkId(cx, cy, cz);
    this.chunks.set(id, chunkBlocks);
    this.markDirty(cx, cy, cz);
    // Mark adjacent chunks dirty for boundary faces
    if (cx > 0) this.markDirty(cx - 1, cy, cz);
    this.markDirty(cx + 1, cy, cz);
    if (cy > 0) this.markDirty(cx, cy - 1, cz);
    this.markDirty(cx, cy + 1, cz);
    if (cz > 0) this.markDirty(cx, cy, cz - 1);
    this.markDirty(cx, cy, cz + 1);
  }

  /** Unload a chunk and remove its mesh from the scene. */
  unloadChunk(cx: number, cy: number, cz: number, scene: THREE.Scene): void {
    const id = packChunkId(cx, cy, cz);
    this.chunks.delete(id);
    this.dirtyChunks.delete(id);
    const mesh = this.chunkMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      this.chunkMeshes.delete(id);
    }
  }

  /** Clear all chunks and meshes (for map reset). */
  clearAll(scene: THREE.Scene): void {
    for (const mesh of this.chunkMeshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.chunkMeshes.clear();
    this.dirtyChunks.clear();
  }

  /** Check if a chunk is loaded. */
  isChunkLoaded(cx: number, cy: number, cz: number): boolean {
    return this.chunks.has(packChunkId(cx, cy, cz));
  }

  /** Check if a chunk already has a built mesh in the scene. */
  hasChunkMesh(cx: number, cy: number, cz: number): boolean {
    return this.chunkMeshes.has(packChunkId(cx, cy, cz));
  }

  /** Mark a loaded chunk dirty so it gets rebuilt. */
  markChunkDirty(cx: number, cy: number, cz: number): void {
    this.markDirty(cx, cy, cz);
  }

  /** Startup readiness check for a chunk column around spawn/camera. */
  isStartupColumnReady(cx: number, cz: number, numChunksY: number): boolean {
    let loadedCount = 0;
    for (let cy = 0; cy < numChunksY; cy++) {
      const id = packChunkId(cx, cy, cz);
      if (this.chunkMeshes.has(id)) return true;
      if (this.chunks.has(id)) loadedCount++;
    }
    return loadedCount === numChunksY;
  }

  /** Iterate loaded chunk IDs without allocating a copy. */
  getLoadedChunkIds(): Iterable<number> {
    return this.chunks.keys();
  }

  // ── Block access ──

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return 0;
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(packChunkId(cx, cy, cz));
    if (!chunk) return 0; // Unloaded chunk = air
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    return chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK];
  }

  setBlock(x: number, y: number, z: number, t: number): void {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return;
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK), cz = Math.floor(z / CHUNK);
    const id = packChunkId(cx, cy, cz);
    let chunk = this.chunks.get(id);
    if (!chunk) return; // Can't set block in unloaded chunk
    const lx = x - cx * CHUNK, ly = y - cy * CHUNK, lz = z - cz * CHUNK;
    chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK] = t;
    this.markDirtyAt(x, y, z);
  }

  /** Highest solid block Y at (x,z). Returns -1 if column is empty or unloaded. */
  getHighestBlock(x: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (this.getBlock(bx, y, bz) !== 0) return y;
    }
    return -1;
  }

  /** Highest solid block Y at (x,z) at or below footY. Returns -1 if none. */
  getGroundHeightBelow(x: number, footY: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    const startY = Math.min(Math.floor(footY), this.sizeY - 1);
    for (let y = startY; y >= 0; y--) {
      if (this.getBlock(bx, y, bz) !== 0) return y;
    }
    return -1;
  }

  // ── Chunk system ──

  private markDirtyAt(bx: number, by: number, bz: number): void {
    const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK), cz = Math.floor(bz / CHUNK);
    this.markDirty(cx, cy, cz);
    const lx = bx % CHUNK, ly = by % CHUNK, lz = bz % CHUNK;
    if (lx === 0) this.markDirty(cx - 1, cy, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cy, cz);
    if (ly === 0) this.markDirty(cx, cy - 1, cz);
    if (ly === CHUNK - 1) this.markDirty(cx, cy + 1, cz);
    if (lz === 0) this.markDirty(cx, cy, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cy, cz + 1);
  }

  private markDirty(cx: number, cy: number, cz: number): void {
    const id = packChunkId(cx, cy, cz);
    if (this.chunks.has(id)) {
      this.dirtyChunks.add(id);
    }
  }

  /** Set the camera position used for distance-prioritized rebuilds. */
  setRebuildAnchor(x: number, y: number, z: number): void {
    this.anchorX = x;
    this.anchorY = y;
    this.anchorZ = z;
  }

  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;

  /** Rebuild only the chunks whose blocks changed, prioritized by distance to anchor. */
  rebuildDirtyChunks(scene: THREE.Scene, maxChunks = Number.POSITIVE_INFINITY): number {
    if (maxChunks <= 0 || this.dirtyChunks.size === 0) return 0;

    // Build sorted list by distance to anchor (closest first)
    const anchorCx = Math.floor(this.anchorX / CHUNK);
    const anchorCy = Math.floor(this.anchorY / CHUNK);
    const anchorCz = Math.floor(this.anchorZ / CHUNK);

    const dirtyIds = Array.from(this.dirtyChunks);

    // Sort by squared distance to player chunk (ascending = closest first)
    dirtyIds.sort((a, b) => {
      const [ax, ay, az] = unpackChunkId(a);
      const [bx, by, bz] = unpackChunkId(b);
      const da = (ax - anchorCx) ** 2 + (ay - anchorCy) ** 2 + (az - anchorCz) ** 2;
      const db = (bx - anchorCx) ** 2 + (by - anchorCy) ** 2 + (bz - anchorCz) ** 2;
      return da - db;
    });

    let rebuilt = 0;
    for (let i = 0; i < dirtyIds.length; i++) {
      const id = dirtyIds[i];
      this.dirtyChunks.delete(id);
      if (!this.chunks.has(id)) continue;
      const [cx, cy, cz] = unpackChunkId(id);

      // Remove old mesh
      const old = this.chunkMeshes.get(id);
      if (old) { scene.remove(old); old.geometry.dispose(); }

      // Build new mesh
      const m = this.buildChunkMesh(cx, cy, cz);
      if (m) {
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
        this.chunkMeshes.set(id, m);
      } else {
        this.chunkMeshes.delete(id);
      }

      rebuilt++;
      if (rebuilt >= maxChunks) break;
    }
    return rebuilt;
  }

  private buildChunkMesh(cx: number, cy: number, cz: number): THREE.Mesh | null {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const x1 = Math.min(x0 + CHUNK, this.sizeX);
    const y1 = Math.min(y0 + CHUNK, this.sizeY);
    const z1 = Math.min(z0 + CHUNK, this.sizeZ);

    const pos: number[] = [], nrm: number[] = [], col: number[] = [];
    const c = new THREE.Color();

    // Use getBlock which handles sparse chunks
    const gb = (x: number, y: number, z: number): number => this.getBlock(x, y, z);

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const b = gb(x, y, z);
          if (b === 0) continue;
          c.setHex(BLOCK_COLORS[b] || 0x808080);

          if (b === BlockType.Lantern) {
            c.multiplyScalar(1.45);
            c.r = Math.min(1, c.r + 0.2);
            c.g = Math.min(1, c.g + 0.12);
          } else {
            const nearBoost = lanternNeighborBoost(gb, x, y, z);
            if (nearBoost > 1) {
              c.multiplyScalar(nearBoost);
              c.r = Math.min(1, c.r + 0.02 * (nearBoost - 1) * 10);
              c.g = Math.min(1, c.g + 0.015 * (nearBoost - 1) * 10);
            }
          }

          // Subtle per-block color variation for gritty feel
          const variation = (hash2d(x * 7 + y, z * 13 + y) - 0.5) * 0.06;
          c.r = Math.max(0, Math.min(1, c.r + variation));
          c.g = Math.max(0, Math.min(1, c.g + variation));
          c.b = Math.max(0, Math.min(1, c.b + variation));

          if (gb(x + 1, y, z) === 0) addFace(pos, nrm, col, c, x + 1, y, z, 0, computeFaceAO(gb, x, y, z, 0), b);
          if (gb(x - 1, y, z) === 0) addFace(pos, nrm, col, c, x, y, z, 1, computeFaceAO(gb, x, y, z, 1), b);
          if (gb(x, y + 1, z) === 0) addFace(pos, nrm, col, c, x, y + 1, z, 2, computeFaceAO(gb, x, y, z, 2), b);
          if (gb(x, y - 1, z) === 0) addFace(pos, nrm, col, c, x, y, z, 3, computeFaceAO(gb, x, y, z, 3), b);
          if (gb(x, y, z + 1) === 0) addFace(pos, nrm, col, c, x, y, z + 1, 4, computeFaceAO(gb, x, y, z, 4), b);
          if (gb(x, y, z - 1) === 0) addFace(pos, nrm, col, c, x, y, z, 5, computeFaceAO(gb, x, y, z, 5), b);
        }
      }
    }

    if (pos.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(geo, this.mat);
  }

  // ── Cleanup ──

  dispose(scene: THREE.Scene): void {
    this.clearAll(scene);
    this.mat.dispose();
  }
}

// ── Face geometry data ──

const FACE_SHADING = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];
const FACE_NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const FACE_VERTS = [
  [[0,0,0],[0,1,0],[0,1,1],[0,0,0],[0,1,1],[0,0,1]],  // +X
  [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]],  // -X
  [[0,0,0],[0,0,1],[1,0,1],[0,0,0],[1,0,1],[1,0,0]],  // +Y
  [[1,0,0],[1,0,1],[0,0,1],[1,0,0],[0,0,1],[0,0,0]],  // -Y
  [[0,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]],  // +Z
  [[0,1,0],[1,1,0],[1,0,0],[0,1,0],[1,0,0],[0,0,0]],  // -Z
];

// ── Per-vertex Ambient Occlusion ──

const AO_TANGENTS: number[][] = [
  [0,1,0, 0,0,1],  // face 0 (+X)
  [0,1,0, 0,0,1],  // face 1 (-X)
  [1,0,0, 0,0,1],  // face 2 (+Y)
  [1,0,0, 0,0,1],  // face 3 (-Y)
  [1,0,0, 0,1,0],  // face 4 (+Z)
  [1,0,0, 0,1,0],  // face 5 (-Z)
];

const AO_SIGNS: number[][][] = [
  [[-1,-1],[1,-1],[1,1],[-1,1]],
  [[-1,1],[1,1],[1,-1],[-1,-1]],
  [[-1,-1],[-1,1],[1,1],[1,-1]],
  [[1,-1],[1,1],[-1,1],[-1,-1]],
  [[-1,-1],[1,-1],[1,1],[-1,1]],
  [[-1,1],[1,1],[1,-1],[-1,-1]],
];

const AO_CURVE = [0.45, 0.68, 0.85, 1.0];

function vertexAO(s1: boolean, s2: boolean, c: boolean): number {
  if (s1 && s2) return 0;
  return 3 - (+s1) - (+s2) - (+c);
}

function computeFaceAO(
  gb: (x: number, y: number, z: number) => number,
  bx: number, by: number, bz: number, face: number,
): [number, number, number, number] {
  const n = FACE_NORMALS[face];
  const t = AO_TANGENTS[face];
  const signs = AO_SIGNS[face];
  const nx = bx + n[0], ny = by + n[1], nz = bz + n[2];
  const ao: [number, number, number, number] = [3, 3, 3, 3];
  for (let c = 0; c < 4; c++) {
    const s1 = signs[c][0], s2 = signs[c][1];
    const side1 = gb(nx + s1*t[0], ny + s1*t[1], nz + s1*t[2]) !== 0;
    const side2 = gb(nx + s2*t[3], ny + s2*t[4], nz + s2*t[5]) !== 0;
    const corner = gb(nx + s1*t[0] + s2*t[3], ny + s1*t[1] + s2*t[4], nz + s1*t[2] + s2*t[5]) !== 0;
    ao[c] = vertexAO(side1, side2, corner);
  }
  return ao;
}

function lanternLocalBoost(face: number, vx: number, vy: number, vz: number): number {
  if (face === 2) return 1.28;
  if (face === 3) return 1.02;
  const centerDist = Math.abs(vx - 0.5) + Math.abs(vy - 0.5) + Math.abs(vz - 0.5);
  return centerDist < 1.2 ? 1.22 : 1.14;
}

function lanternNeighborBoost(
  gb: (x: number, y: number, z: number) => number,
  bx: number,
  by: number,
  bz: number,
): number {
  let score = 0;
  for (let i = 0; i < LANTERN_NEAR_BOOST_OFFSETS.length; i++) {
    const o = LANTERN_NEAR_BOOST_OFFSETS[i]!;
    if (gb(bx + o[0], by + o[1], bz + o[2]) === BlockType.Lantern) score++;
    if (score >= 2) break;
  }
  if (score === 0) return 1;
  if (score === 1) return 1.14;
  return 1.24;
}

function addFace(
  pos: number[], nrm: number[], col: number[],
  color: THREE.Color, x: number, y: number, z: number, face: number,
  ao: [number, number, number, number],
  blockType?: number,
): void {
  const verts = FACE_VERTS[face];
  const n = FACE_NORMALS[face];
  const s = FACE_SHADING[face];
  const corners = [verts[0], verts[1], verts[2], verts[5]];
  const aoMul = [AO_CURVE[ao[0]] * s, AO_CURVE[ao[1]] * s, AO_CURVE[ao[2]] * s, AO_CURVE[ao[3]] * s];
  const flip = ao[0] + ao[2] < ao[1] + ao[3];
  const idx = flip ? [0,1,3, 1,2,3] : [0,1,2, 0,2,3];
  for (let i = 0; i < 6; i++) {
    const ci = idx[i];
    const v = corners[ci];
    const lanternBoost = blockType === BlockType.Lantern ? lanternLocalBoost(face, v[0], v[1], v[2]) : 1;
    const m = Math.min(1.85, aoMul[ci] * lanternBoost);
    pos.push(x + v[0], y + v[1], z + v[2]);
    nrm.push(n[0], n[1], n[2]);
    col.push(color.r * m, color.g * m, color.b * m);
  }
}
