import * as THREE from 'three';
import { WORLD as WORLD_CONFIG, BLOCK_TYPES } from '../shared-config';
import { buildChunkMeshData } from './chunkMeshing';
import type { ChunkMeshBuildInput, ChunkMeshData, ChunkNeighborData } from './chunkMeshing';
import type { ChunkMeshWorkerRequest, ChunkMeshWorkerResponse, PendingMeshJob, CompletedMeshJob } from './chunkMeshingWorkerTypes';

export interface ChunkApplyBudget {
  maxChunks: number;
  maxBuildChunks?: number;
  maxApplyMs?: number;
}

export const CHUNK = WORLD_CONFIG.chunkSize;
export const WORLD_X = WORLD_CONFIG.sizeX;
export const WORLD_Y = WORLD_CONFIG.sizeY;
export const WORLD_Z = WORLD_CONFIG.sizeZ;

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

export function packChunkId(cx: number, cy: number, cz: number): number {
  return (cx & 0xFF) | ((cy & 0xFF) << 8) | ((cz & 0xFF) << 16);
}

export function unpackChunkId(id: number): [number, number, number] {
  return [id & 0xFF, (id >> 8) & 0xFF, (id >> 16) & 0xFF];
}

export class VoxelWorld {
  sizeX: number;
  sizeY: number;
  sizeZ: number;

  private chunks: Map<number, Uint8Array> = new Map();
  private chunkMeshes: Map<number, THREE.Mesh> = new Map();
  private dirtyChunks: Set<number> = new Set();
  private chunkRevision: Map<number, number> = new Map();
  private mat: THREE.MeshPhongMaterial;

  private workers: Worker[] = [];
  private workersEnabled = false;
  private nextWorkerIndex = 0;
  private nextRequestId = 1;
  private maxWorkerJobs = 0;
  private activeWorkerJobs = 0;
  private pendingRequests = new Map<number, PendingMeshJob>();
  private pendingChunkJobs = new Set<number>();
  private completedJobs: CompletedMeshJob[] = [];

  constructor(sx: number, sy: number, sz: number) {
    this.sizeX = sx;
    this.sizeY = sy;
    this.sizeZ = sz;
    this.mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x10182a),
      emissiveIntensity: 0.34,
      shininess: 6,
      specular: new THREE.Color(0x111418),
    });
    this.initWorkers();
  }

  private initWorkers(): void {
    if (typeof Worker === 'undefined' || typeof navigator === 'undefined') return;

    const hw = Number(navigator.hardwareConcurrency ?? 4);
    const workerCount = Math.max(1, Math.min(4, hw - 1));

    try {
      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(new URL('./workers/chunkMeshWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<ChunkMeshWorkerResponse>) => {
          this.onWorkerResult(event.data);
        };
        worker.onerror = () => {
          this.workersEnabled = false;
        };
        this.workers.push(worker);
      }
      this.workersEnabled = this.workers.length > 0;
      this.maxWorkerJobs = this.workers.length * 2;
    } catch {
      this.workersEnabled = false;
      for (const worker of this.workers) worker.terminate();
      this.workers.length = 0;
      this.maxWorkerJobs = 0;
    }
  }

  private onWorkerResult(result: ChunkMeshWorkerResponse): void {
    const meta = this.pendingRequests.get(result.requestId);
    if (!meta) return;

    this.pendingRequests.delete(result.requestId);
    this.pendingChunkJobs.delete(meta.chunkId);
    this.activeWorkerJobs = Math.max(0, this.activeWorkerJobs - 1);

    if (!this.chunks.has(meta.chunkId)) return;
    const currentRevision = this.chunkRevision.get(meta.chunkId) ?? 0;
    if (currentRevision !== meta.revision) {
      this.dirtyChunks.add(meta.chunkId);
      return;
    }

    this.completedJobs.push({
      chunkId: meta.chunkId,
      revision: meta.revision,
      mesh: {
        position: result.position,
        normal: result.normal,
        color: result.color,
      },
    });
  }

  static rleDecodeChunk(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(CHUNK * CHUNK * CHUNK);
    let outIdx = 0;
    let i = 0;
    while (i + 1 < data.length && outIdx < output.length) {
      const val = data[i]!;
      const run = data[i + 1]!;
      for (let j = 0; j < run && outIdx < output.length; j++) {
        output[outIdx++] = val;
      }
      i += 2;
    }
    return output;
  }

  loadChunk(cx: number, cy: number, cz: number, chunkBlocks: Uint8Array): void {
    const id = packChunkId(cx, cy, cz);
    this.chunks.set(id, chunkBlocks);
    this.markDirty(cx, cy, cz);
    if (cx > 0) this.markDirty(cx - 1, cy, cz);
    this.markDirty(cx + 1, cy, cz);
    if (cy > 0) this.markDirty(cx, cy - 1, cz);
    this.markDirty(cx, cy + 1, cz);
    if (cz > 0) this.markDirty(cx, cy, cz - 1);
    this.markDirty(cx, cy, cz + 1);
  }

  unloadChunk(cx: number, cy: number, cz: number, scene: THREE.Scene): void {
    const id = packChunkId(cx, cy, cz);
    this.chunks.delete(id);
    this.dirtyChunks.delete(id);
    this.chunkRevision.delete(id);
    this.pendingChunkJobs.delete(id);

    const mesh = this.chunkMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      this.chunkMeshes.delete(id);
    }

    if (cx > 0) this.markDirty(cx - 1, cy, cz);
    this.markDirty(cx + 1, cy, cz);
    if (cy > 0) this.markDirty(cx, cy - 1, cz);
    this.markDirty(cx, cy + 1, cz);
    if (cz > 0) this.markDirty(cx, cy, cz - 1);
    this.markDirty(cx, cy, cz + 1);
  }

  clearAll(scene: THREE.Scene): void {
    for (const mesh of this.chunkMeshes.values()) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.chunkMeshes.clear();
    this.dirtyChunks.clear();
    this.chunkRevision.clear();
    this.pendingChunkJobs.clear();
    this.pendingRequests.clear();
    this.completedJobs.length = 0;
    this.activeWorkerJobs = 0;
  }

  isChunkLoaded(cx: number, cy: number, cz: number): boolean {
    return this.chunks.has(packChunkId(cx, cy, cz));
  }

  hasChunkMesh(cx: number, cy: number, cz: number): boolean {
    return this.chunkMeshes.has(packChunkId(cx, cy, cz));
  }

  markChunkDirty(cx: number, cy: number, cz: number): void {
    this.markDirty(cx, cy, cz);
  }

  isStartupColumnReady(cx: number, cz: number, numChunksY: number): boolean {
    let loadedCount = 0;
    for (let cy = 0; cy < numChunksY; cy++) {
      const id = packChunkId(cx, cy, cz);
      if (this.chunkMeshes.has(id)) return true;
      if (this.chunks.has(id)) loadedCount++;
    }
    return loadedCount === numChunksY;
  }

  getLoadedChunkIds(): Iterable<number> {
    return this.chunks.keys();
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

  getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return 0;
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const chunk = this.chunks.get(packChunkId(cx, cy, cz));
    if (!chunk) return 0;
    const lx = x - cx * CHUNK;
    const ly = y - cy * CHUNK;
    const lz = z - cz * CHUNK;
    return chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK]!;
  }

  setBlock(x: number, y: number, z: number, t: number): void {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return;
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const id = packChunkId(cx, cy, cz);
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    const lx = x - cx * CHUNK;
    const ly = y - cy * CHUNK;
    const lz = z - cz * CHUNK;
    chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK] = t;
    this.markDirtyAt(x, y, z);
  }

  getHighestBlock(x: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (this.getBlock(bx, y, bz) !== 0) return y;
    }
    return -1;
  }

  getGroundHeightBelow(x: number, footY: number, z: number): number {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    const startY = Math.min(Math.floor(footY), this.sizeY - 1);
    for (let y = startY; y >= 0; y--) {
      if (this.getBlock(bx, y, bz) !== 0) return y;
    }
    return -1;
  }

  private markDirtyAt(bx: number, by: number, bz: number): void {
    const cx = Math.floor(bx / CHUNK);
    const cy = Math.floor(by / CHUNK);
    const cz = Math.floor(bz / CHUNK);
    this.markDirty(cx, cy, cz);
    const lx = bx % CHUNK;
    const ly = by % CHUNK;
    const lz = bz % CHUNK;
    if (lx === 0) this.markDirty(cx - 1, cy, cz);
    if (lx === CHUNK - 1) this.markDirty(cx + 1, cy, cz);
    if (ly === 0) this.markDirty(cx, cy - 1, cz);
    if (ly === CHUNK - 1) this.markDirty(cx, cy + 1, cz);
    if (lz === 0) this.markDirty(cx, cy, cz - 1);
    if (lz === CHUNK - 1) this.markDirty(cx, cy, cz + 1);
  }

  private markDirty(cx: number, cy: number, cz: number): void {
    const id = packChunkId(cx, cy, cz);
    if (!this.chunks.has(id)) return;
    this.dirtyChunks.add(id);
    this.chunkRevision.set(id, (this.chunkRevision.get(id) ?? 0) + 1);
  }

  setRebuildAnchor(x: number, y: number, z: number): void {
    this.anchorX = x;
    this.anchorY = y;
    this.anchorZ = z;
  }

  private anchorX = 0;
  private anchorY = 0;
  private anchorZ = 0;

  rebuildDirtyChunks(scene: THREE.Scene, budget: number | ChunkApplyBudget = Number.POSITIVE_INFINITY): number {
    const maxChunks = typeof budget === 'number' ? budget : budget.maxChunks;
    const maxBuildChunks = typeof budget === 'number' ? maxChunks : Math.max(0, budget.maxBuildChunks ?? maxChunks);
    const maxApplyMs = typeof budget === 'number' ? Number.POSITIVE_INFINITY : Math.max(0, budget.maxApplyMs ?? Number.POSITIVE_INFINITY);

    if (maxChunks <= 0) return 0;

    let rebuilt = this.flushCompletedJobs(scene, maxChunks, maxApplyMs);
    if (rebuilt >= maxChunks || this.dirtyChunks.size === 0) return rebuilt;

    const anchorCx = Math.floor(this.anchorX / CHUNK);
    const anchorCy = Math.floor(this.anchorY / CHUNK);
    const anchorCz = Math.floor(this.anchorZ / CHUNK);

    const dirtyIds = Array.from(this.dirtyChunks);
    dirtyIds.sort((a, b) => {
      const [ax, ay, az] = unpackChunkId(a);
      const [bx, by, bz] = unpackChunkId(b);
      const da = (ax - anchorCx) ** 2 + (ay - anchorCy) ** 2 + (az - anchorCz) ** 2;
      const db = (bx - anchorCx) ** 2 + (by - anchorCy) ** 2 + (bz - anchorCz) ** 2;
      return da - db;
    });

    let built = 0;
    for (const id of dirtyIds) {
      if (rebuilt >= maxChunks) break;
      if (built >= maxBuildChunks) break;
      if (!this.chunks.has(id)) {
        this.dirtyChunks.delete(id);
        continue;
      }
      if (this.pendingChunkJobs.has(id)) continue;

      const [cx, cy, cz] = unpackChunkId(id);
      const revision = this.chunkRevision.get(id) ?? 0;
      this.dirtyChunks.delete(id);

      if (this.workersEnabled && this.activeWorkerJobs < this.maxWorkerJobs) {
        this.dispatchMeshJobToWorker(id, revision, cx, cy, cz);
        continue;
      }

      const mesh = this.buildMeshDataLocally(cx, cy, cz);
      this.applyMesh(scene, id, mesh);
      rebuilt++;
      built++;
    }

    return rebuilt;
  }

  private dispatchMeshJobToWorker(id: number, revision: number, cx: number, cy: number, cz: number): void {
    if (this.workers.length === 0) return;
    const source = this.chunks.get(id);
    if (!source) return;

    const worker = this.workers[this.nextWorkerIndex % this.workers.length]!;
    this.nextWorkerIndex++;

    const neighbors = this.collectNeighborData(cx, cy, cz, true);
    const input: ChunkMeshBuildInput = {
      cx,
      cy,
      cz,
      chunkData: new Uint8Array(source),
      neighbors,
    };
    const requestId = this.nextRequestId++;
    const req: ChunkMeshWorkerRequest = { requestId, input };
    const transfers: Transferable[] = [input.chunkData.buffer];
    for (const n of input.neighbors) transfers.push(n.data.buffer);

    this.pendingRequests.set(requestId, { chunkId: id, revision });
    this.pendingChunkJobs.add(id);
    this.activeWorkerJobs++;
    worker.postMessage(req, transfers);
  }

  private buildMeshDataLocally(cx: number, cy: number, cz: number): ChunkMeshData {
    const chunk = this.chunks.get(packChunkId(cx, cy, cz));
    if (!chunk) {
      return { position: new Float32Array(0), normal: new Float32Array(0), color: new Float32Array(0) };
    }

    return buildChunkMeshData({
      cx,
      cy,
      cz,
      chunkData: chunk,
      neighbors: this.collectNeighborData(cx, cy, cz, false),
    });
  }

  private collectNeighborData(cx: number, cy: number, cz: number, clone: boolean): ChunkNeighborData[] {
    const neighbors: ChunkNeighborData[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const chunk = this.chunks.get(packChunkId(cx + dx, cy + dy, cz + dz));
          if (!chunk) continue;
          neighbors.push({ dx, dy, dz, data: clone ? new Uint8Array(chunk) : chunk });
        }
      }
    }
    return neighbors;
  }

  private flushCompletedJobs(scene: THREE.Scene, maxToApply: number, maxApplyMs = Number.POSITIVE_INFINITY): number {
    if (maxToApply <= 0 || this.completedJobs.length === 0) return 0;

    const start = maxApplyMs === Number.POSITIVE_INFINITY ? 0 : performance.now();

    let applied = 0;
    while (applied < maxToApply && this.completedJobs.length > 0) {
      if (maxApplyMs !== Number.POSITIVE_INFINITY && (performance.now() - start) >= maxApplyMs) {
        break;
      }

      const job = this.completedJobs.pop()!;
      if (!this.chunks.has(job.chunkId)) continue;
      const currentRevision = this.chunkRevision.get(job.chunkId) ?? 0;
      if (currentRevision !== job.revision) {
        this.dirtyChunks.add(job.chunkId);
        continue;
      }

      this.applyMesh(scene, job.chunkId, job.mesh);
      applied++;
    }
    return applied;
  }

  private getReusableAttribute(
    geometry: THREE.BufferGeometry,
    name: 'position' | 'normal' | 'color',
    requiredComponents: number,
    itemSize: number,
  ): THREE.BufferAttribute {
    const existing = geometry.getAttribute(name);
    if (
      existing instanceof THREE.BufferAttribute
      && existing.itemSize === itemSize
      && existing.array instanceof Float32Array
      && existing.array.length >= requiredComponents
    ) {
      return existing;
    }

    const existingLength =
      existing instanceof THREE.BufferAttribute && existing.array instanceof Float32Array
        ? existing.array.length
        : 0;
    const rawCapacity = Math.max(
      requiredComponents,
      existingLength > 0 ? Math.floor(existingLength * 1.5) : itemSize * 256,
    );
    const capacity = Math.ceil(rawCapacity / itemSize) * itemSize;
    const attr = new THREE.BufferAttribute(new Float32Array(capacity), itemSize);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    return attr;
  }

  private writeAttributeData(attribute: THREE.BufferAttribute, data: Float32Array): void {
    const target = attribute.array as Float32Array;
    target.set(data, 0);
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, data.length);
    attribute.needsUpdate = true;
  }

  private applyMesh(scene: THREE.Scene, id: number, meshData: ChunkMeshData): void {
    const vertexCount = meshData.position.length / 3;
    const existing = this.chunkMeshes.get(id);

    if (vertexCount === 0) {
      if (existing) {
        scene.remove(existing);
        existing.geometry.dispose();
        this.chunkMeshes.delete(id);
      }
      return;
    }

    if (!existing) {
      const geo = new THREE.BufferGeometry();
      const positionAttr = this.getReusableAttribute(geo, 'position', meshData.position.length, 3);
      const normalAttr = this.getReusableAttribute(geo, 'normal', meshData.normal.length, 3);
      const colorAttr = this.getReusableAttribute(geo, 'color', meshData.color.length, 3);
      this.writeAttributeData(positionAttr, meshData.position);
      this.writeAttributeData(normalAttr, meshData.normal);
      this.writeAttributeData(colorAttr, meshData.color);
      geo.setDrawRange(0, vertexCount);

      const mesh = new THREE.Mesh(geo, this.mat);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.chunkMeshes.set(id, mesh);
      return;
    }

    const geometry = existing.geometry as THREE.BufferGeometry;
    const positionAttr = this.getReusableAttribute(geometry, 'position', meshData.position.length, 3);
    const normalAttr = this.getReusableAttribute(geometry, 'normal', meshData.normal.length, 3);
    const colorAttr = this.getReusableAttribute(geometry, 'color', meshData.color.length, 3);

    this.writeAttributeData(positionAttr, meshData.position);
    this.writeAttributeData(normalAttr, meshData.normal);
    this.writeAttributeData(colorAttr, meshData.color);
    geometry.setDrawRange(0, vertexCount);
    geometry.boundingSphere = null;
    geometry.boundingBox = null;
    existing.visible = true;
  }

  updateChunkShadowCasting(anchorX: number, anchorZ: number, castRadiusChunks: number): void {
    const anchorCx = Math.floor(anchorX / CHUNK);
    const anchorCz = Math.floor(anchorZ / CHUNK);
    const castRadiusSq = castRadiusChunks * castRadiusChunks;

    for (const [id, mesh] of this.chunkMeshes) {
      const [cx, , cz] = unpackChunkId(id);
      const dx = cx - anchorCx;
      const dz = cz - anchorCz;
      const shouldCast = castRadiusChunks > 0 && (dx * dx + dz * dz) <= castRadiusSq;
      if (mesh.castShadow !== shouldCast) mesh.castShadow = shouldCast;
      if (!mesh.receiveShadow) mesh.receiveShadow = true;
    }
  }

  dispose(scene: THREE.Scene): void {
    this.clearAll(scene);
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.workersEnabled = false;
    this.mat.dispose();
  }
}
