/**
 * AudioRayTracer — Web Worker that performs DDA voxel raycasting for
 * acoustic environment analysis.
 *
 * Runs on a background thread so it never blocks the game loop. Receives
 * chunk data and listener position from the main thread, casts rays to
 * compute:
 *   - Room size / reverb parameters (from bounce distances)
 *   - Indoor/outdoor ratio (from escaped rays)
 *   - Return ratio (for echo volume — the "garage effect")
 *
 * Communicates via postMessage with the main thread AudioRayState.
 */

// ── Types for worker messages ──

interface ChunkTransfer {
  type: 'chunk';
  chunkId: number;
  data: Uint8Array;
}

interface ChunkRemove {
  type: 'chunkRemove';
  chunkId: number;
}

interface TraceRequest {
  type: 'trace';
  listenerX: number;
  listenerY: number;
  listenerZ: number;
  worldSizeX: number;
  worldSizeY: number;
  worldSizeZ: number;
}

interface WorldInit {
  type: 'init';
  chunkSize: number;
  worldSizeX: number;
  worldSizeY: number;
  worldSizeZ: number;
}

type InboundMessage = ChunkTransfer | ChunkRemove | TraceRequest | WorldInit;

interface TraceResult {
  type: 'result';
  avgBounceDistance: number;
  returnRatio: number;
  outdoorRatio: number;
  listenerPos: { x: number; y: number; z: number };
  timestamp: number;
}

// ── World data (mirrors VoxelWorld's chunk map) ──

let CHUNK = 16;
let WORLD_X = 750;
let WORLD_Y = 48;
let WORLD_Z = 750;
const chunks = new Map<number, Uint8Array>();

function packChunkId(cx: number, cy: number, cz: number): number {
  return (cx & 0xFF) | ((cy & 0xFF) << 8) | ((cz & 0xFF) << 16);
}

/**
 * Fast block lookup with chunk caching.
 * Returns the block type at (x, y, z), or 0 if out of bounds / unloaded.
 */
let cachedChunkId = -1;
let cachedChunkData: Uint8Array | null = null;

function getBlock(x: number, y: number, z: number): number {
  if (x < 0 || x >= WORLD_X || y < 0 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) return 0;

  const cx = (x >> 4);  // Math.floor(x / 16) for non-negative
  const cy = (y >> 4);
  const cz = (z >> 4);
  const id = packChunkId(cx, cy, cz);

  // Chunk caching: avoid Map.get() for consecutive voxels in the same chunk.
  if (id !== cachedChunkId) {
    cachedChunkId = id;
    cachedChunkData = chunks.get(id) ?? null;
  }
  if (!cachedChunkData) return 0;

  const lx = x - (cx << 4);
  const ly = y - (cy << 4);
  const lz = z - (cz << 4);
  return cachedChunkData[lx + ly * CHUNK + lz * CHUNK * CHUNK];
}

// ── Ray directions (48 uniformly distributed on a sphere via Fibonacci spiral) ──

const RAY_COUNT = 48;
const MAX_RAY_DISTANCE = 80;
const MAX_BOUNCES = 3;

interface RayDir { x: number; y: number; z: number }

function generateRayDirections(count: number): RayDir[] {
  const dirs: RayDir[] = [];
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < count; i++) {
    const theta = Math.acos(1 - 2 * (i + 0.5) / count);
    const phi = 2 * Math.PI * i / goldenRatio;
    dirs.push({
      x: Math.sin(theta) * Math.cos(phi),
      y: Math.cos(theta),
      z: Math.sin(theta) * Math.sin(phi),
    });
  }
  return dirs;
}

const RAY_DIRS = generateRayDirections(RAY_COUNT);

// ── DDA Voxel Raycast (Amanatides-Woo algorithm) ──

interface RayHit {
  /** Distance from origin to the hit surface. */
  distance: number;
  /** Hit voxel coordinates. */
  hx: number;
  hy: number;
  hz: number;
  /** Normal of the face that was hit (axis-aligned). */
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Cast a ray through the voxel grid using DDA traversal.
 * Returns the first solid block hit or null if maxDist is exceeded.
 */
function raycastDDA(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): RayHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  let tMaxX = dx !== 0
    ? ((stepX > 0 ? x + 1 - ox : ox - x) / Math.abs(dx)) : Infinity;
  let tMaxY = dy !== 0
    ? ((stepY > 0 ? y + 1 - oy : oy - y) / Math.abs(dy)) : Infinity;
  let tMaxZ = dz !== 0
    ? ((stepZ > 0 ? z + 1 - oz : oz - z) / Math.abs(dz)) : Infinity;

  let dist = 0;
  // Track which axis we last stepped along (for normal calculation)
  let lastAxis = 0; // 0=x, 1=y, 2=z

  while (dist < maxDist) {
    // Check if out of world bounds entirely — treat as escaped
    if (x < 0 || x >= WORLD_X || y < 0 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) {
      return null;
    }

    const block = getBlock(x, y, z);
    if (block !== 0) {
      let nx = 0, ny = 0, nz = 0;
      if (lastAxis === 0) nx = -stepX;
      else if (lastAxis === 1) ny = -stepY;
      else nz = -stepZ;
      return { distance: dist, hx: x, hy: y, hz: z, nx, ny, nz };
    }

    // Step to the next voxel boundary
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX; dist = tMaxX; tMaxX += tDeltaX; lastAxis = 0;
      } else {
        z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; lastAxis = 2;
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY; dist = tMaxY; tMaxY += tDeltaY; lastAxis = 1;
      } else {
        z += stepZ; dist = tMaxZ; tMaxZ += tDeltaZ; lastAxis = 2;
      }
    }
  }

  return null;
}

/**
 * Reflect a direction vector off a surface normal.
 * Both dir and normal should be unit vectors.
 */
function reflect(dx: number, dy: number, dz: number, nx: number, ny: number, nz: number): RayDir {
  const dot2 = 2 * (dx * nx + dy * ny + dz * nz);
  return {
    x: dx - dot2 * nx,
    y: dy - dot2 * ny,
    z: dz - dot2 * nz,
  };
}

// ── Main trace function ──

function performTrace(lx: number, ly: number, lz: number): TraceResult {
  let totalBounceDistance = 0;
  let returningRays = 0;
  let escapedRays = 0;
  let validRays = 0;

  for (let r = 0; r < RAY_COUNT; r++) {
    const dir = RAY_DIRS[r];
    let ox = lx, oy = ly, oz = lz;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    let totalDist = 0;
    let bounced = false;
    let escaped = false;

    for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      const remainingDist = MAX_RAY_DISTANCE - totalDist;
      if (remainingDist <= 0) break;

      const hit = raycastDDA(ox, oy, oz, dx, dy, dz, remainingDist);

      if (!hit) {
        // Ray escaped the world or ran out of distance
        escaped = true;
        break;
      }

      totalDist += hit.distance;
      bounced = true;

      // Check if the bounced ray can see back to the listener.
      // This determines if this is a "returning" ray (contributes to echo).
      if (bounce > 0) {
        const toLx = lx - (hit.hx + 0.5);
        const toLy = ly - (hit.hy + 0.5);
        const toLz = lz - (hit.hz + 0.5);
        const toListenerDist = Math.sqrt(toLx * toLx + toLy * toLy + toLz * toLz);
        if (toListenerDist > 0.5) {
          const invDist = 1 / toListenerDist;
          const losHit = raycastDDA(
            hit.hx + 0.5 + hit.nx * 0.1,
            hit.hy + 0.5 + hit.ny * 0.1,
            hit.hz + 0.5 + hit.nz * 0.1,
            toLx * invDist, toLy * invDist, toLz * invDist,
            toListenerDist,
          );
          if (!losHit) {
            // Line of sight back to listener — this ray returns!
            returningRays++;
            totalBounceDistance += totalDist + toListenerDist;
            validRays++;
          }
        }
      } else {
        // First bounce always "returns" (direct reflection)
        returningRays++;
        totalBounceDistance += hit.distance * 2; // approximate round trip
        validRays++;
      }

      // Set up the reflected ray for next bounce
      // Offset origin slightly off the surface to avoid self-intersection
      ox = hit.hx + 0.5 + hit.nx * 0.15;
      oy = hit.hy + 0.5 + hit.ny * 0.15;
      oz = hit.hz + 0.5 + hit.nz * 0.15;
      const refl = reflect(dx, dy, dz, hit.nx, hit.ny, hit.nz);
      dx = refl.x;
      dy = refl.y;
      dz = refl.z;
    }

    if (escaped) {
      escapedRays++;
    }

    // If no bounces at all and didn't escape, the ray started inside a block
    // (edge case — shouldn't happen with proper listener position)
    if (!bounced && !escaped) {
      // Treat as fully enclosed — contributes to small-room reverb
      totalBounceDistance += 1;
      returningRays++;
      validRays++;
    }
  }

  const avgBounce = validRays > 0 ? totalBounceDistance / validRays : 5;
  const returnRatio = returningRays / RAY_COUNT;
  const outdoorRatio = escapedRays / RAY_COUNT;

  return {
    type: 'result',
    avgBounceDistance: avgBounce,
    returnRatio,
    outdoorRatio,
    listenerPos: { x: lx, y: ly, z: lz },
    timestamp: performance.now(),
  };
}

// ── Worker message handler ──

self.onmessage = (e: MessageEvent<InboundMessage>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      CHUNK = msg.chunkSize;
      WORLD_X = msg.worldSizeX;
      WORLD_Y = msg.worldSizeY;
      WORLD_Z = msg.worldSizeZ;
      break;

    case 'chunk':
      chunks.set(msg.chunkId, msg.data);
      // Invalidate chunk cache if the updated chunk was cached
      if (msg.chunkId === cachedChunkId) {
        cachedChunkId = -1;
        cachedChunkData = null;
      }
      break;

    case 'chunkRemove':
      chunks.delete(msg.chunkId);
      if (msg.chunkId === cachedChunkId) {
        cachedChunkId = -1;
        cachedChunkData = null;
      }
      break;

    case 'trace': {
      const result = performTrace(msg.listenerX, msg.listenerY, msg.listenerZ);
      (self as unknown as Worker).postMessage(result);
      break;
    }
  }
};
