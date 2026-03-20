import * as THREE from 'three';
import { VoxelWorld, WORLD_X, WORLD_Y, WORLD_Z, CHUNK, packChunkId, unpackChunkId } from './VoxelWorld';
import type { ChunkApplyBudget } from './VoxelWorld';
import type { DbConnection } from '../module_bindings';
import { updateWorldChunkSubscriptionAoi } from '../db';

// ── Chunk streaming config ──
const VIEW_DISTANCE = 10; // chunks (160 blocks)
const UNLOAD_BUFFER = 3; // extra chunks before unloading
const CHUNKS_PER_REQUEST = 4; // smoother server load under fast movement
const MAX_QUEUE_PROCESS_PER_TICK = 64; // hard cap to avoid long frame stalls
const MAX_PENDING_CHUNK_REQUESTS = 12; // backpressure: avoid reducer floods
export const ACTIVE_CHUNK_RADIUS = VIEW_DISTANCE + UNLOAD_BUFFER;
export const CHUNK_STREAM_INTERVAL_FRAMES = 2;
export const CHUNK_REBUILD_BUDGET_MOVING = 10;
export const CHUNK_REBUILD_BUDGET_IDLE = 20;
export const CHUNK_REBUILD_BUDGET_BOOTSTRAP = 40;
const CHUNK_REQUEST_TIMEOUT_MS = 2000;
const NUM_CHUNKS_Y = Math.ceil(WORLD_Y / CHUNK);
const STARTUP_READY_RADIUS = 2;
const WORLD_CHUNK_AOI_RADIUS = VIEW_DISTANCE + UNLOAD_BUFFER + 5;
const BOOTSTRAP_APPLY_BUDGET: ChunkApplyBudget = {
  maxChunks: CHUNK_REBUILD_BUDGET_BOOTSTRAP,
  maxBuildChunks: CHUNK_REBUILD_BUDGET_BOOTSTRAP,
  maxApplyMs: 2.8,
};

type ChunkOffset = { dx: number; dz: number; d2: number };

const STREAM_OFFSETS: ChunkOffset[] = (() => {
  const offsets: ChunkOffset[] = [];
  for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > VIEW_DISTANCE * VIEW_DISTANCE) continue;
      offsets.push({ dx, dz, d2 });
    }
  }
  offsets.sort((a, b) => a.d2 - b.d2);
  return offsets;
})();

const STARTUP_OFFSETS: ChunkOffset[] = (() => {
  const offsets: ChunkOffset[] = [];
  for (let dz = -STARTUP_READY_RADIUS; dz <= STARTUP_READY_RADIUS; dz++) {
    for (let dx = -STARTUP_READY_RADIUS; dx <= STARTUP_READY_RADIUS; dx++) {
      offsets.push({ dx, dz, d2: dx * dx + dz * dz });
    }
  }
  offsets.sort((a, b) => a.d2 - b.d2);
  return offsets;
})();

/** Dependencies injected from the Engine */
export interface ChunkStreamerContext {
  conn: DbConnection | null;
  camera: THREE.PerspectiveCamera;
  world: VoxelWorld;
  localIdentity: string | null;
  scene: THREE.Scene;
  /** Callback invoked for every chunk that is loaded/decoded so the Engine can sync lantern lights etc. */
  onChunkLoaded: (cx: number, cy: number, cz: number, decoded: Uint8Array) => void;
  /** Callback invoked before a chunk is unloaded so the Engine can clean up related state (lantern lights, etc.) */
  onChunkUnloading: (chunkId: number) => void;
  perfSceneEnabled: () => boolean;
  getPerfSceneChunkData: (cx: number, cy: number, cz: number) => Uint8Array;
}

export class ChunkStreamer {
  // Chunk streaming state
  lastPlayerCx = -1;
  lastPlayerCz = -1;
  pendingChunkRequests = new Map<number, number>();
  queuedChunkRequests = new Set<number>();
  chunkRequestQueue: number[] = [];
  bootstrapRequestQueue: number[] = [];
  bootstrapQueued = new Set<number>();
  bootstrapActive = true;
  startupWorldReady = false;
  startupProgressPrev = 0;
  startupProgressStallTime = 0;
  chunkLoadFrame = 0;
  requestBackoffUntilMs = 0;

  private ctx: ChunkStreamerContext;

  constructor(ctx: ChunkStreamerContext) {
    this.ctx = ctx;
  }

  /** Load already-subscribed world chunks from server */
  loadWorldFromServer(): void {
    if (!this.ctx.conn) return;
    const count = this.rehydrateSubscribedChunks();
    if (count > 0) {
      console.log(`[BitWars] Loaded ${count} world chunks from server`);
    }
  }

  rehydrateSubscribedChunks(maxNewChunks = Number.POSITIVE_INFINITY): number {
    if (maxNewChunks <= 0) return 0;

    if (this.ctx.perfSceneEnabled()) {
      return this.rehydratePerfSceneChunks(maxNewChunks);
    }

    if (!this.ctx.conn) return 0;

    const [anchorCx, anchorCz] = this.getLoadAnchorChunk();
    const viewDistSq = (VIEW_DISTANCE + UNLOAD_BUFFER) * (VIEW_DISTANCE + UNLOAD_BUFFER);

    let loaded = 0;
    for (const chunk of this.ctx.conn.db.world_chunk.iter() as Iterable<any>) {
      const cx = chunk.cx as number;
      const cy = chunk.cy as number;
      const cz = chunk.cz as number;
      if (this.ctx.world.isChunkLoaded(cx, cy, cz)) continue;

      // Only load chunks within view distance
      const dx = cx - anchorCx;
      const dz = cz - anchorCz;
      if (dx * dx + dz * dz > viewDistSq) continue;

      const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
      const decoded = VoxelWorld.rleDecodeChunk(data);
      this.ctx.world.loadChunk(cx, cy, cz, decoded);
      this.ctx.onChunkLoaded(cx, cy, cz, decoded);
      this.pendingChunkRequests.delete(packChunkId(cx, cy, cz));
      loaded++;
      if (loaded >= maxNewChunks) break;
    }
    return loaded;
  }

  private rehydratePerfSceneChunks(maxNewChunks: number): number {
    const [anchorCx, anchorCz] = this.getLoadAnchorChunk();
    const viewDistSq = (VIEW_DISTANCE + UNLOAD_BUFFER) * (VIEW_DISTANCE + UNLOAD_BUFFER);
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    let loaded = 0;
    for (let cz = Math.max(0, anchorCz - (VIEW_DISTANCE + UNLOAD_BUFFER)); cz <= Math.min(maxCz - 1, anchorCz + (VIEW_DISTANCE + UNLOAD_BUFFER)); cz++) {
      for (let cx = Math.max(0, anchorCx - (VIEW_DISTANCE + UNLOAD_BUFFER)); cx <= Math.min(maxCx - 1, anchorCx + (VIEW_DISTANCE + UNLOAD_BUFFER)); cx++) {
        const dx = cx - anchorCx;
        const dz = cz - anchorCz;
        if (dx * dx + dz * dz > viewDistSq) continue;

        for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
          if (this.ctx.world.isChunkLoaded(cx, cy, cz)) continue;
          const data = this.ctx.getPerfSceneChunkData(cx, cy, cz);
          this.ctx.world.loadChunk(cx, cy, cz, data);
          this.ctx.onChunkLoaded(cx, cy, cz, data);
          this.pendingChunkRequests.delete(packChunkId(cx, cy, cz));
          loaded++;
          if (loaded >= maxNewChunks) return loaded;
        }
      }
    }

    return loaded;
  }

  /** Request chunks near the player that aren't loaded yet */
  updateChunkLoading(): void {
    if (!this.ctx.conn && !this.ctx.perfSceneEnabled()) return;

    this.reapPendingChunkRequests();

    const [cx, cz] = this.getLoadAnchorChunk();
    updateWorldChunkSubscriptionAoi(cx, cz, WORLD_CHUNK_AOI_RADIUS);

    const playerMoved = cx !== this.lastPlayerCx || cz !== this.lastPlayerCz;
    if (playerMoved) {
      this.lastPlayerCx = cx;
      this.lastPlayerCz = cz;
      this.rebuildChunkRequestQueue(cx, cz);
    }

    if (!this.startupWorldReady) {
      this.prioritizeStartupArea(cx, cz);
    }

    if (this.bootstrapActive) {
      this.fillBootstrapQueue(cx, cz);
      if (this.bootstrapRequestQueue.length === 0) {
        this.bootstrapActive = false;
      }
    }

    if (!playerMoved
      && this.chunkRequestQueue.length === 0
      && this.bootstrapRequestQueue.length === 0
      && this.pendingChunkRequests.size === 0
    ) {
      this.rebuildChunkRequestQueue(cx, cz);
    }

    // Request missing chunks in small batches to spread decode/meshing cost across frames
    const now = performance.now();
    const canSendRequests = now >= this.requestBackoffUntilMs;

    const batch: number[] = [];
    const remainingPendingBudget = Math.max(0, MAX_PENDING_CHUNK_REQUESTS - this.pendingChunkRequests.size);
    let processed = 0;
    while (
      canSendRequests
      &&
      batch.length < CHUNKS_PER_REQUEST
      && batch.length < remainingPendingBudget
      && processed < MAX_QUEUE_PROCESS_PER_TICK
      && (this.bootstrapRequestQueue.length > 0 || this.chunkRequestQueue.length > 0)
    ) {
      processed++;
      const fromBootstrap = this.bootstrapRequestQueue.length > 0;
      const id = fromBootstrap ? this.bootstrapRequestQueue.shift()! : this.chunkRequestQueue.shift()!;
      if (fromBootstrap) this.bootstrapQueued.delete(id);
      else this.queuedChunkRequests.delete(id);
      if (this.pendingChunkRequests.has(id)) continue;
      const [rcx, rcy, rcz] = unpackChunkId(id);
      if (this.ctx.world.isChunkLoaded(rcx, rcy, rcz)) continue;
      if (this.hydrateChunkFromSubscription(id)) continue;
      this.pendingChunkRequests.set(id, performance.now());
      batch.push(id);
    }
    if (batch.length > 0) {
      const requestedIds = [...batch];
      if (this.ctx.perfSceneEnabled()) {
        for (let i = 0; i < requestedIds.length; i++) {
          const id = requestedIds[i]!;
          const [pcx, pcy, pcz] = unpackChunkId(id);
          const decoded = this.ctx.getPerfSceneChunkData(pcx, pcy, pcz);
          this.ctx.world.loadChunk(pcx, pcy, pcz, decoded);
          this.ctx.onChunkLoaded(pcx, pcy, pcz, decoded);
          this.pendingChunkRequests.delete(id);
        }
      } else {
        void this.ctx.conn!.reducers.requestChunks({ chunkIds: requestedIds }).catch((error: unknown) => {
          for (let i = requestedIds.length - 1; i >= 0; i--) {
            const id = requestedIds[i]!;
            this.pendingChunkRequests.delete(id);
            if (!this.queuedChunkRequests.has(id) && !this.bootstrapQueued.has(id)) {
              this.chunkRequestQueue.unshift(id);
            this.queuedChunkRequests.add(id);
          }
        }

        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Not registered')) {
          this.requestBackoffUntilMs = performance.now() + 1000;
          return;
        }
          console.warn('[BitWars] request_chunks failed:', message);
        });
      }
    }

    // Unload chunks that are too far away (only check when player moved)
    if (playerMoved) {
      const unloadDist = VIEW_DISTANCE + UNLOAD_BUFFER;
      for (const chunkId of this.ctx.world.getLoadedChunkIds()) {
        const [lcx, , lcz] = unpackChunkId(chunkId);
        const dx = lcx - cx;
        const dz = lcz - cz;
        if (dx * dx + dz * dz > unloadDist * unloadDist) {
          const [ucx, ucy, ucz] = unpackChunkId(chunkId);
          this.ctx.onChunkUnloading(chunkId);
          this.ctx.world.unloadChunk(ucx, ucy, ucz, this.ctx.scene);
        }
      }
    }
  }

  prioritizeStartupArea(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    for (let i = STARTUP_OFFSETS.length - 1; i >= 0; i--) {
      const { dx, dz } = STARTUP_OFFSETS[i];
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;
      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.ctx.world.isChunkLoaded(ncx, cy, ncz)) continue;
        if (this.bootstrapQueued.has(id)) continue;
        this.bootstrapRequestQueue.unshift(id);
        this.bootstrapQueued.add(id);
      }
    }
  }

  reapPendingChunkRequests(): void {
    if (this.pendingChunkRequests.size === 0) return;
    const now = performance.now();
    const retry: number[] = [];

    for (const [id, requestedAt] of this.pendingChunkRequests) {
      const [cx, cy, cz] = unpackChunkId(id);
      if (this.ctx.world.isChunkLoaded(cx, cy, cz)) {
        this.pendingChunkRequests.delete(id);
        continue;
      }

      if (now - requestedAt > CHUNK_REQUEST_TIMEOUT_MS) {
        this.pendingChunkRequests.delete(id);
        if (!this.bootstrapQueued.has(id) && !this.queuedChunkRequests.has(id)) {
          retry.push(id);
        }
      }
    }

    if (retry.length === 0) return;

    if (!this.startupWorldReady) {
      for (let i = retry.length - 1; i >= 0; i--) {
        const id = retry[i]!;
        this.bootstrapRequestQueue.unshift(id);
        this.bootstrapQueued.add(id);
      }
      return;
    }

    this.chunkRequestQueue.push(...retry);
    for (const id of retry) this.queuedChunkRequests.add(id);
  }

  getStartupLoadProgress(): number {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);
    const [cx, cz] = this.getLoadAnchorChunk();

    let total = 0;
    let ready = 0;

    for (const { dx, dz } of STARTUP_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;
      total++;
      if (this.ctx.world.isStartupColumnReady(ncx, ncz, NUM_CHUNKS_Y)) ready++;
    }

    if (total === 0) return 1;
    return ready / total;
  }

  rebuildChunkRequestQueue(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    this.chunkRequestQueue.length = 0;
    this.queuedChunkRequests.clear();

    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.ctx.camera.quaternion);
    const lookLen = Math.hypot(look.x, look.z);
    const lookX = lookLen > 0.0001 ? look.x / lookLen : 0;
    const lookZ = lookLen > 0.0001 ? look.z / lookLen : -1;

    const forward: number[] = [];
    const side: number[] = [];
    const behind: number[] = [];

    for (const { dx, dz } of STREAM_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;

      const ringLen = Math.hypot(dx, dz);
      const dot = ringLen > 0.0001 ? (dx / ringLen) * lookX + (dz / ringLen) * lookZ : 1;

      const bucket = dot > 0.25 ? forward : dot > -0.35 ? side : behind;
      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.ctx.world.isChunkLoaded(ncx, cy, ncz)) continue;
        bucket.push(id);
      }
    }

    this.chunkRequestQueue.push(...forward, ...side, ...behind);
    for (const id of this.chunkRequestQueue) this.queuedChunkRequests.add(id);
  }

  fillBootstrapQueue(cx: number, cz: number): void {
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);

    let added = 0;
    for (const { dx, dz } of STREAM_OFFSETS) {
      const ncx = cx + dx;
      const ncz = cz + dz;
      if (ncx < 0 || ncx >= maxCx || ncz < 0 || ncz >= maxCz) continue;

      for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
        const id = packChunkId(ncx, cy, ncz);
        if (this.pendingChunkRequests.has(id)) continue;
        if (this.ctx.world.isChunkLoaded(ncx, cy, ncz)) continue;
        if (this.bootstrapQueued.has(id)) continue;
        this.bootstrapRequestQueue.push(id);
        this.bootstrapQueued.add(id);
        added++;
      }

      if (added >= CHUNKS_PER_REQUEST * 4) break;
    }
  }

  private hydrateChunkFromSubscription(id: number): boolean {
    if (this.ctx.perfSceneEnabled()) {
      const [cx, cy, cz] = unpackChunkId(id);
      if (this.ctx.world.isChunkLoaded(cx, cy, cz)) return true;
      const decoded = this.ctx.getPerfSceneChunkData(cx, cy, cz);
      this.ctx.world.loadChunk(cx, cy, cz, decoded);
      this.ctx.onChunkLoaded(cx, cy, cz, decoded);
      this.pendingChunkRequests.delete(id);
      this.queuedChunkRequests.delete(id);
      this.bootstrapQueued.delete(id);
      return true;
    }

    if (!this.ctx.conn) return false;

    const table = this.ctx.conn.db.world_chunk as any;
    const accessor = table?.chunk_id ?? table?.chunkId;
    let chunk: any = null;
    if (accessor && typeof accessor.find === 'function') {
      chunk = accessor.find(id);
    }
    if (!chunk && typeof table?.iter === 'function') {
      for (const row of table.iter() as Iterable<any>) {
        const rowId = Number((row as any).chunkId ?? (row as any).chunk_id ?? -1);
        if (rowId === id) {
          chunk = row;
          break;
        }
      }
    }
    if (!chunk) return false;

    const cx = Number(chunk.cx);
    const cy = Number(chunk.cy);
    const cz = Number(chunk.cz);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return false;
    if (this.ctx.world.isChunkLoaded(cx, cy, cz)) return true;

    const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
    const decoded = VoxelWorld.rleDecodeChunk(data);
    this.ctx.world.loadChunk(cx, cy, cz, decoded);
    this.ctx.onChunkLoaded(cx, cy, cz, decoded);
    this.pendingChunkRequests.delete(id);
    this.queuedChunkRequests.delete(id);
    this.bootstrapQueued.delete(id);
    return true;
  }

  getLoadAnchorChunk(): [number, number] {
    // Always anchor chunk streaming to local rendered position. Using
    // server-replicated player rows while mounted can make streaming trail
    // behind the local predicted vehicle under jitter.
    let x = this.ctx.camera.position.x;
    let z = this.ctx.camera.position.z;

    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      x = WORLD_X * 0.5;
      z = WORLD_Z * 0.5;
    }

    const clampedX = Math.max(0, Math.min(WORLD_X - 1, x));
    const clampedZ = Math.max(0, Math.min(WORLD_Z - 1, z));
    return [Math.floor(clampedX / CHUNK), Math.floor(clampedZ / CHUNK)];
  }

  ensureSpawnGroundReady(): void {
    const [cx, cz] = this.getLoadAnchorChunk();
    const maxCx = Math.ceil(WORLD_X / CHUNK);
    const maxCz = Math.ceil(WORLD_Z / CHUNK);
    if (cx < 0 || cx >= maxCx || cz < 0 || cz >= maxCz) return;

    let hasGroundMesh = false;
    for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
      if (this.ctx.world.hasChunkMesh(cx, cy, cz)) {
        hasGroundMesh = true;
        break;
      }
    }
    if (hasGroundMesh) return;

    for (let cy = 0; cy < NUM_CHUNKS_Y; cy++) {
      if (this.ctx.world.isChunkLoaded(cx, cy, cz)) {
        this.ctx.world.markChunkDirty(cx, cy, cz);
      }
    }
    this.ctx.world.rebuildDirtyChunks(this.ctx.scene, BOOTSTRAP_APPLY_BUDGET);
  }

  /** Reset all chunk streaming state (e.g. on map reset) */
  resetAll(): void {
    this.pendingChunkRequests.clear();
    this.queuedChunkRequests.clear();
    this.chunkRequestQueue.length = 0;
    this.bootstrapRequestQueue.length = 0;
    this.bootstrapQueued.clear();
    this.bootstrapActive = true;
    this.startupWorldReady = false;
    this.startupProgressPrev = 0;
    this.startupProgressStallTime = 0;
    this.requestBackoffUntilMs = 0;
    this.lastPlayerCx = -1;
    this.lastPlayerCz = -1;
  }

  setStartupReadyForPerfScene(): void {
    this.pendingChunkRequests.clear();
    this.queuedChunkRequests.clear();
    this.chunkRequestQueue.length = 0;
    this.bootstrapRequestQueue.length = 0;
    this.bootstrapQueued.clear();
    this.bootstrapActive = false;
    this.startupWorldReady = true;
    this.startupProgressPrev = 1;
    this.startupProgressStallTime = 0;
    this.requestBackoffUntilMs = 0;
    this.lastPlayerCx = -1;
    this.lastPlayerCz = -1;
  }
}
