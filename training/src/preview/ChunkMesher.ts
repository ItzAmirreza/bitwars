import * as THREE from 'three';

const CHUNK_SIZE = 16;

// Block colors matching game-constants.json + DESIGN.md
const BLOCK_COLORS: Record<number, [number, number, number]> = {
  1:  [0.53, 0.53, 0.53], // Concrete
  2:  [0.40, 0.40, 0.40], // DarkConcrete
  3:  [0.27, 0.27, 0.27], // Asphalt
  4:  [0.60, 0.33, 0.20], // Rebar
  5:  [0.67, 0.40, 0.27], // Brick
  6:  [0.47, 0.60, 0.67], // Metal
  7:  [0.47, 0.40, 0.33], // Rubble
  8:  [0.53, 0.40, 0.27], // Dirt
  9:  [0.80, 0.73, 0.53], // Sand
  10: [0.33, 0.53, 0.20], // Grass
  11: [0.60, 0.47, 0.27], // Wood
  12: [0.60, 0.60, 0.60], // Stone
  13: [0.87, 0.87, 0.93], // Snow
  14: [1.00, 0.80, 0.27], // Lantern
  15: [0.20, 0.20, 0.20], // Bedrock
};

// Top face is slightly lighter, bottom darker (simple ambient occlusion)
const FACE_SHADE = [
  1.0,  // +X
  1.0,  // -X
  1.15, // +Y (top - brighter)
  0.7,  // -Y (bottom - darker)
  0.95, // +Z
  0.95, // -Z
];

// Face directions: [dx, dy, dz] for the 6 faces
const FACE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// Vertices for each face (4 corners), indexed by face direction
const FACE_VERTICES: [number, number, number][][] = [
  // +X
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  // -X
  [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  // +Y
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  // -Y
  [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  // +Z
  [[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
  // -Z
  [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
];

// Normal for each face
const FACE_NORMALS: [number, number, number][] = [
  [1,0,0], [-1,0,0],
  [0,1,0], [0,-1,0],
  [0,0,1], [0,0,-1],
];

type ChunkData = {
  cx: number;
  cy: number;
  cz: number;
  blocks: Uint8Array;
};

/** Get block at local coordinates within a chunk, or check neighbors */
function getBlock(chunk: Uint8Array, lx: number, ly: number, lz: number): number {
  if (lx < 0 || lx >= CHUNK_SIZE || ly < 0 || ly >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) {
    return 0; // Treat out-of-chunk as AIR (simplified — no cross-chunk face culling)
  }
  return chunk[lx + ly * CHUNK_SIZE + lz * CHUNK_SIZE * CHUNK_SIZE];
}

/** Build a mesh for a single chunk using simple face culling */
export function buildChunkMesh(chunk: ChunkData): THREE.Mesh | null {
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
        if (block === 0) continue; // AIR

        const baseColor = BLOCK_COLORS[block] || [0.5, 0.5, 0.5];

        // Check each face
        for (let face = 0; face < 6; face++) {
          const [dx, dy, dz] = FACE_DIRS[face];
          const neighbor = getBlock(chunk.blocks, lx + dx, ly + dy, lz + dz);

          if (neighbor !== 0) continue; // Neighbor is solid, skip this face

          const shade = FACE_SHADE[face];
          const [nx, ny, nz] = FACE_NORMALS[face];
          const verts = FACE_VERTICES[face];

          // 4 vertices per face
          for (const [vx, vy, vz] of verts) {
            positions.push(wx + lx + vx, wy + ly + vy, wz + lz + vz);
            normals.push(nx, ny, nz);
            colors.push(
              baseColor[0] * shade,
              baseColor[1] * shade,
              baseColor[2] * shade,
            );
          }

          // 2 triangles per face (6 indices)
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

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Manages chunk meshes in the scene — loads/unloads around a center position */
export class ChunkRenderer {
  private scene: THREE.Scene;
  private loadedChunks: Map<string, THREE.Mesh> = new Map();
  private loadRadius: number;
  private loading = false;

  constructor(scene: THREE.Scene, loadRadius = 3) {
    this.scene = scene;
    this.loadRadius = loadRadius;
  }

  /** Update which chunks are loaded based on camera center position */
  async update(centerX: number, centerZ: number) {
    if (this.loading) return; // Prevent overlapping loads
    this.loading = true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const chunks = await invoke<[number, number, number, number[]][]>(
        'get_terrain_chunks',
        { centerX, centerZ, radius: this.loadRadius },
      );

      const neededKeys = new Set<string>();

      for (const [cx, cy, cz, blockData] of chunks) {
        const key = `${cx}_${cy}_${cz}`;
        neededKeys.add(key);

        const chunkData: ChunkData = {
          cx, cy, cz,
          blocks: new Uint8Array(blockData),
        };

        const mesh = buildChunkMesh(chunkData);

        // Remove old mesh if it exists (terrain may have been modified by explosions)
        const oldMesh = this.loadedChunks.get(key);
        if (oldMesh) {
          this.scene.remove(oldMesh);
          oldMesh.geometry.dispose();
          (oldMesh.material as THREE.Material).dispose();
          this.loadedChunks.delete(key);
        }

        if (mesh) {
          this.scene.add(mesh);
          this.loadedChunks.set(key, mesh);
        }
      }

      // Unload chunks that are too far
      for (const [key, mesh] of this.loadedChunks.entries()) {
        if (!neededKeys.has(key)) {
          this.scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
          this.loadedChunks.delete(key);
        }
      }
    } catch {
      // Terrain not ready yet
    } finally {
      this.loading = false;
    }
  }

  /** Dispose all loaded chunks */
  dispose() {
    for (const [, mesh] of this.loadedChunks) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.loadedChunks.clear();
  }
}
