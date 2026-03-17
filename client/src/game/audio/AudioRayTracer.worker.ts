/**
 * AudioRayTracer — Web Worker that performs DDA voxel raycasting for
 * acoustic environment analysis and sound propagation.
 *
 * Runs on a background thread so it never blocks the game loop. Receives
 * chunk data, listener position, and persistent sound source positions
 * from the main thread. Computes:
 *   - Room size / reverb parameters (from bounce distances)
 *   - Indoor/outdoor ratio (from escaped rays)
 *   - Return ratio (for echo volume — the "garage effect")
 *   - Per-source apparent direction (sound propagation through openings)
 *   - Per-source occlusion factor
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

interface SourceInfo {
  id: number;
  x: number;
  y: number;
  z: number;
}

interface TraceRequest {
  type: 'trace';
  listenerX: number;
  listenerY: number;
  listenerZ: number;
  worldSizeX: number;
  worldSizeY: number;
  worldSizeZ: number;
  /** Persistent sound sources to compute propagation for. */
  sources: SourceInfo[];
}

interface WorldInit {
  type: 'init';
  chunkSize: number;
  worldSizeX: number;
  worldSizeY: number;
  worldSizeZ: number;
}

type InboundMessage = ChunkTransfer | ChunkRemove | TraceRequest | WorldInit;

/** Propagation result for a single sound source. */
interface SourcePropagation {
  id: number;
  /** Apparent direction FROM the listener TO the perceived sound origin (unit vector). */
  apparentDirX: number;
  apparentDirY: number;
  apparentDirZ: number;
  /** How much of the sound is occluded (0 = clear, 1 = fully blocked). */
  occlusion: number;
  /** Whether direct line-of-sight exists. */
  directLOS: boolean;
}

interface TraceResult {
  type: 'result';
  avgBounceDistance: number;
  returnRatio: number;
  outdoorRatio: number;
  listenerPos: { x: number; y: number; z: number };
  timestamp: number;
  /** Per-source propagation results. */
  sources: SourcePropagation[];
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

// ── Per-ray path storage for source propagation ──

/**
 * For sound propagation, we need to know the *initial direction* of each
 * environment ray AND the positions it reaches after bounces. Then for each
 * source, we find which rays' bounce endpoints can "see" the source, and
 * use those rays' initial directions as the apparent sound direction.
 */
interface RayPath {
  /** Initial direction from the listener. */
  initDirX: number;
  initDirY: number;
  initDirZ: number;
  /** Endpoints after each bounce (position just off the surface). */
  bouncePoints: { x: number; y: number; z: number }[];
  /** Whether this ray escaped to open air. */
  escaped: boolean;
  /** Final position of the ray (last bounce point or escaped position). */
  finalX: number;
  finalY: number;
  finalZ: number;
}

// ── Main trace function ──

function performTrace(
  lx: number, ly: number, lz: number,
  sources: SourceInfo[],
): TraceResult {
  let totalBounceDistance = 0;
  let returningRays = 0;
  let escapedRays = 0;
  let validRays = 0;

  // Store paths for propagation analysis
  const rayPaths: RayPath[] = [];

  for (let r = 0; r < RAY_COUNT; r++) {
    const dir = RAY_DIRS[r];
    let ox = lx, oy = ly, oz = lz;
    let dx = dir.x, dy = dir.y, dz = dir.z;
    let totalDist = 0;
    let bounced = false;
    let escaped = false;

    const path: RayPath = {
      initDirX: dir.x, initDirY: dir.y, initDirZ: dir.z,
      bouncePoints: [],
      escaped: false,
      finalX: lx, finalY: ly, finalZ: lz,
    };

    for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      const remainingDist = MAX_RAY_DISTANCE - totalDist;
      if (remainingDist <= 0) break;

      const hit = raycastDDA(ox, oy, oz, dx, dy, dz, remainingDist);

      if (!hit) {
        // Ray escaped the world or ran out of distance
        escaped = true;
        // Estimate final position along the ray
        path.finalX = ox + dx * remainingDist;
        path.finalY = oy + dy * remainingDist;
        path.finalZ = oz + dz * remainingDist;
        break;
      }

      totalDist += hit.distance;
      bounced = true;

      // Store the bounce point (slightly off the surface)
      const bpx = hit.hx + 0.5 + hit.nx * 0.15;
      const bpy = hit.hy + 0.5 + hit.ny * 0.15;
      const bpz = hit.hz + 0.5 + hit.nz * 0.15;
      path.bouncePoints.push({ x: bpx, y: bpy, z: bpz });
      path.finalX = bpx;
      path.finalY = bpy;
      path.finalZ = bpz;

      // Check if the bounced ray can see back to the listener (echo analysis)
      if (bounce > 0) {
        const toLx = lx - bpx;
        const toLy = ly - bpy;
        const toLz = lz - bpz;
        const toListenerDist = Math.sqrt(toLx * toLx + toLy * toLy + toLz * toLz);
        if (toListenerDist > 0.5) {
          const invDist = 1 / toListenerDist;
          const losHit = raycastDDA(
            bpx, bpy, bpz,
            toLx * invDist, toLy * invDist, toLz * invDist,
            toListenerDist,
          );
          if (!losHit) {
            returningRays++;
            totalBounceDistance += totalDist + toListenerDist;
            validRays++;
          }
        }
      } else {
        returningRays++;
        totalBounceDistance += hit.distance * 2;
        validRays++;
      }

      // Set up the reflected ray for next bounce
      ox = bpx;
      oy = bpy;
      oz = bpz;
      const refl = reflect(dx, dy, dz, hit.nx, hit.ny, hit.nz);
      dx = refl.x;
      dy = refl.y;
      dz = refl.z;
    }

    path.escaped = escaped;
    if (escaped) escapedRays++;

    if (!bounced && !escaped) {
      totalBounceDistance += 1;
      returningRays++;
      validRays++;
    }

    rayPaths.push(path);
  }

  // ── Per-source propagation ──
  const sourcePropagations = computeSourcePropagations(lx, ly, lz, sources, rayPaths);

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
    sources: sourcePropagations,
  };
}

/**
 * For each sound source, compute the apparent direction the listener should
 * hear it from, and the occlusion amount.
 *
 * Algorithm:
 * 1. Check direct line-of-sight from listener to source.
 *    - If clear: apparent direction = real direction, occlusion = 0.
 * 2. If blocked: find environment rays whose bounce points can "see" the source.
 *    - For each ray, at each bounce point, check LOS to the source.
 *    - If a bounce point has LOS to the source, this ray "carries" the sound.
 *    - The apparent direction = weighted average of the initial directions
 *      of all rays that can reach the source (weighted by inverse distance).
 * 3. Occlusion = fraction of rays that CANNOT reach the source.
 *    If some rays reach via bounces, occlusion is partial (the sound is
 *    muffled but the direction is correct for the opening).
 */
function computeSourcePropagations(
  lx: number, ly: number, lz: number,
  sources: SourceInfo[],
  rayPaths: RayPath[],
): SourcePropagation[] {
  const results: SourcePropagation[] = [];

  for (const src of sources) {
    // ── 1. Direct LOS check ──
    const toSrcX = src.x - lx;
    const toSrcY = src.y - ly;
    const toSrcZ = src.z - lz;
    const directDist = Math.sqrt(toSrcX * toSrcX + toSrcY * toSrcY + toSrcZ * toSrcZ);

    if (directDist < 0.5) {
      // Source is at the listener — no propagation needed
      results.push({
        id: src.id,
        apparentDirX: 0, apparentDirY: 0, apparentDirZ: 1,
        occlusion: 0,
        directLOS: true,
      });
      continue;
    }

    const invDirectDist = 1 / directDist;
    const dirToSrcX = toSrcX * invDirectDist;
    const dirToSrcY = toSrcY * invDirectDist;
    const dirToSrcZ = toSrcZ * invDirectDist;

    const directHit = raycastDDA(lx, ly, lz, dirToSrcX, dirToSrcY, dirToSrcZ, directDist);

    if (!directHit) {
      // Direct LOS — sound comes from real direction
      results.push({
        id: src.id,
        apparentDirX: dirToSrcX,
        apparentDirY: dirToSrcY,
        apparentDirZ: dirToSrcZ,
        occlusion: 0,
        directLOS: true,
      });
      continue;
    }

    // ── 2. No direct LOS — find bounced rays that can reach the source ──
    let weightedDirX = 0, weightedDirY = 0, weightedDirZ = 0;
    let totalWeight = 0;
    let reachingRays = 0;

    // Also check: can any ray's final position or bounce points see the source?
    for (let r = 0; r < rayPaths.length; r++) {
      const path = rayPaths[r];
      let reached = false;

      // Check each bounce point for LOS to the source
      for (let b = 0; b < path.bouncePoints.length; b++) {
        const bp = path.bouncePoints[b];
        const bToSrcX = src.x - bp.x;
        const bToSrcY = src.y - bp.y;
        const bToSrcZ = src.z - bp.z;
        const bDist = Math.sqrt(bToSrcX * bToSrcX + bToSrcY * bToSrcY + bToSrcZ * bToSrcZ);

        if (bDist < 0.5) { reached = true; break; }

        const bInvDist = 1 / bDist;
        const losHit = raycastDDA(
          bp.x, bp.y, bp.z,
          bToSrcX * bInvDist, bToSrcY * bInvDist, bToSrcZ * bInvDist,
          bDist,
        );

        if (!losHit) {
          reached = true;
          break;
        }
      }

      // If the ray escaped, its final position might also "see" the source
      // (e.g., ray goes out a window, source is outside)
      if (!reached && path.escaped) {
        const fToSrcX = src.x - path.finalX;
        const fToSrcY = src.y - path.finalY;
        const fToSrcZ = src.z - path.finalZ;
        const fDist = Math.sqrt(fToSrcX * fToSrcX + fToSrcY * fToSrcY + fToSrcZ * fToSrcZ);

        if (fDist < 1.0) {
          reached = true;
        } else if (fDist < MAX_RAY_DISTANCE) {
          const fInvDist = 1 / fDist;
          const losHit = raycastDDA(
            path.finalX, path.finalY, path.finalZ,
            fToSrcX * fInvDist, fToSrcY * fInvDist, fToSrcZ * fInvDist,
            fDist,
          );
          if (!losHit) reached = true;
        }
      }

      if (reached) {
        reachingRays++;
        // Weight by how directly this ray points toward the source.
        // Rays whose initial direction is closer to the source direction
        // get slightly more weight, but all reaching rays contribute.
        const dot = path.initDirX * dirToSrcX + path.initDirY * dirToSrcY + path.initDirZ * dirToSrcZ;
        const weight = 1.0 + Math.max(0, dot) * 0.5;
        weightedDirX += path.initDirX * weight;
        weightedDirY += path.initDirY * weight;
        weightedDirZ += path.initDirZ * weight;
        totalWeight += weight;
      }
    }

    if (reachingRays > 0 && totalWeight > 0) {
      // Normalize the weighted direction
      const invWeight = 1 / totalWeight;
      let adx = weightedDirX * invWeight;
      let ady = weightedDirY * invWeight;
      let adz = weightedDirZ * invWeight;
      const len = Math.sqrt(adx * adx + ady * ady + adz * adz);
      if (len > 0.001) {
        adx /= len;
        ady /= len;
        adz /= len;
      } else {
        // Fallback to real direction
        adx = dirToSrcX;
        ady = dirToSrcY;
        adz = dirToSrcZ;
      }

      // Occlusion: partial — some sound gets through via bounces but it's reduced.
      // More reaching rays = less occlusion.
      const reachRatio = reachingRays / RAY_COUNT;
      const occlusion = Math.max(0, Math.min(1, 1 - reachRatio * 2.5));

      results.push({
        id: src.id,
        apparentDirX: adx,
        apparentDirY: ady,
        apparentDirZ: adz,
        occlusion,
        directLOS: false,
      });
    } else {
      // No rays reach the source — fully occluded.
      // Keep the real direction but mark as fully blocked.
      results.push({
        id: src.id,
        apparentDirX: dirToSrcX,
        apparentDirY: dirToSrcY,
        apparentDirZ: dirToSrcZ,
        occlusion: 1,
        directLOS: false,
      });
    }
  }

  return results;
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
      const result = performTrace(
        msg.listenerX, msg.listenerY, msg.listenerZ,
        msg.sources,
      );
      (self as unknown as Worker).postMessage(result);
      break;
    }
  }
};
