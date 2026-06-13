import * as THREE from 'three';
import { invoke } from '@tauri-apps/api/core';
import gameConstants from '../../../shared/game-constants.json';

const CHUNK_SIZE = 16;

// Block colors are sourced from shared/game-constants.json (single source of truth),
// converted from hex strings into normalized 0–1 RGB triples keyed by block-type index.
const BLOCK_COLORS: Record<number, [number, number, number]> = Object.fromEntries(
  Object.entries(gameConstants.blockColors).map(([name, hex]) => {
    const n = parseInt(hex.slice(1), 16);
    const idx = (gameConstants.blockTypes as Record<string, number>)[name];
    return [idx, [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255]];
  }),
);

const FACE_SHADE = [1.0, 1.0, 1.15, 0.7, 0.95, 0.95];
const FACE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];
const FACE_VERTICES: [number, number, number][][] = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
const FACE_NORMALS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

type ChunkData = {
  cx: number;
  cy: number;
  cz: number;
  blocks: Uint8Array;
};

type LoadedChunk = {
  blocks: Uint8Array;
  mesh: THREE.Mesh | null;
};

function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx}_${cy}_${cz}`;
}

function neighborKeys(cx: number, cy: number, cz: number): string[] {
  return [
    chunkKey(cx + 1, cy, cz),
    chunkKey(cx - 1, cy, cz),
    chunkKey(cx, cy + 1, cz),
    chunkKey(cx, cy - 1, cz),
    chunkKey(cx, cy, cz + 1),
    chunkKey(cx, cy, cz - 1),
  ];
}

function chunksEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getChunkBlock(chunks: Map<string, ChunkData>, chunk: ChunkData, lx: number, ly: number, lz: number): number {
  let cx = chunk.cx;
  let cy = chunk.cy;
  let cz = chunk.cz;
  let x = lx;
  let y = ly;
  let z = lz;

  if (x < 0) { cx -= 1; x += CHUNK_SIZE; }
  else if (x >= CHUNK_SIZE) { cx += 1; x -= CHUNK_SIZE; }
  if (y < 0) { cy -= 1; y += CHUNK_SIZE; }
  else if (y >= CHUNK_SIZE) { cy += 1; y -= CHUNK_SIZE; }
  if (z < 0) { cz -= 1; z += CHUNK_SIZE; }
  else if (z >= CHUNK_SIZE) { cz += 1; z -= CHUNK_SIZE; }

  const neighbor = chunks.get(chunkKey(cx, cy, cz));
  if (!neighbor) return 0;
  return neighbor.blocks[x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE];
}

function buildChunkGeometry(chunk: ChunkData, chunks: Map<string, ChunkData>): THREE.BufferGeometry | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const wx = chunk.cx * CHUNK_SIZE;
  const wy = chunk.cy * CHUNK_SIZE;
  const wz = chunk.cz * CHUNK_SIZE;
  let vertexCount = 0;

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const block = chunk.blocks[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE];
        if (block === 0) continue;

        const baseColor = BLOCK_COLORS[block] ?? [0.5, 0.5, 0.5];
        for (let face = 0; face < 6; face++) {
          const [dx, dy, dz] = FACE_DIRS[face];
          if (getChunkBlock(chunks, chunk, lx + dx, ly + dy, lz + dz) !== 0) continue;

          const [nx, ny, nz] = FACE_NORMALS[face];
          const shade = FACE_SHADE[face];
          const verts = FACE_VERTICES[face];

          for (const [vx, vy, vz] of verts) {
            positions.push(wx + lx + vx, wy + ly + vy, wz + lz + vz);
            normals.push(nx, ny, nz);
            colors.push(baseColor[0] * shade, baseColor[1] * shade, baseColor[2] * shade);
          }

          indices.push(
            vertexCount, vertexCount + 1, vertexCount + 2,
            vertexCount, vertexCount + 2, vertexCount + 3,
          );
          vertexCount += 4;
        }
      }
    }
  }

  if (vertexCount === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildChunkMesh(
  chunk: ChunkData,
  chunks: Map<string, ChunkData>,
  material: THREE.Material,
): THREE.Mesh | null {
  const geometry = buildChunkGeometry(chunk, chunks);
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

export class ChunkRenderer {
  private scene: THREE.Scene;
  private loadedChunks = new Map<string, LoadedChunk>();
  private loadRadius: number;
  private loading = false;
  private material: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, loadRadius = 4) {
    this.scene = scene;
    this.loadRadius = loadRadius;
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: false,
    });
  }

  loadedChunkCount(): number {
    let visible = 0;
    for (const [, loaded] of this.loadedChunks) {
      if (loaded.mesh) visible += 1;
    }
    return visible;
  }

  async update(centerX: number, centerZ: number) {
    if (this.loading) return;
    this.loading = true;

    try {
      const chunkTuples = await invoke<[number, number, number, number[]][]>(
        'get_terrain_chunks',
        { centerX, centerZ, radius: this.loadRadius },
      );

      const nextChunks = new Map<string, ChunkData>();
      for (const [cx, cy, cz, blockData] of chunkTuples) {
        nextChunks.set(chunkKey(cx, cy, cz), {
          cx,
          cy,
          cz,
          blocks: new Uint8Array(blockData),
        });
      }

      const neededKeys = new Set(nextChunks.keys());
      const rebuild = new Set<string>();

      for (const [key, chunk] of nextChunks) {
        const existing = this.loadedChunks.get(key);
        if (!existing || !chunksEqual(existing.blocks, chunk.blocks)) {
          rebuild.add(key);
          for (const neighbor of neighborKeys(chunk.cx, chunk.cy, chunk.cz)) {
            if (neededKeys.has(neighbor)) rebuild.add(neighbor);
          }
        }
      }

      for (const [key, existing] of this.loadedChunks) {
        if (!neededKeys.has(key)) {
          if (existing.mesh) {
            this.scene.remove(existing.mesh);
            existing.mesh.geometry.dispose();
          }
          this.loadedChunks.delete(key);
        }
      }

      for (const key of rebuild) {
        const chunk = nextChunks.get(key);
        if (!chunk) continue;

        const existing = this.loadedChunks.get(key);
        if (existing?.mesh) {
          this.scene.remove(existing.mesh);
          existing.mesh.geometry.dispose();
        }

        const mesh = buildChunkMesh(chunk, nextChunks, this.material);
        if (mesh) {
          this.scene.add(mesh);
        }
        this.loadedChunks.set(key, {
          blocks: chunk.blocks.slice(),
          mesh,
        });
      }
    } catch {
      // Terrain not ready yet or preview bot not available.
    } finally {
      this.loading = false;
    }
  }

  dispose() {
    for (const [, loaded] of this.loadedChunks) {
      if (loaded.mesh) {
        this.scene.remove(loaded.mesh);
        loaded.mesh.geometry.dispose();
      }
    }
    this.loadedChunks.clear();
    this.material.dispose();
  }
}
