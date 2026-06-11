/**
 * Pure chunk mesh building logic — no Three.js dependency.
 * Used by both main thread (fallback) and web workers.
 */

import { WORLD as WORLD_CONFIG, BLOCK_TYPES } from '../shared-config';

const CHUNK = WORLD_CONFIG.chunkSize;

const BlockType = BLOCK_TYPES as {
  readonly Air: 0;
  readonly Lantern: 14;
  [key: string]: number;
};

// ── Types ──

export interface ChunkNeighborData {
  dx: number;
  dy: number;
  dz: number;
  data: Uint8Array;
}

export interface ChunkMeshBuildInput {
  cx: number;
  cy: number;
  cz: number;
  chunkData: Uint8Array;
  neighbors: ChunkNeighborData[];
}

export interface ChunkMeshData {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Two channels per vertex: sky light, lantern light (0..1). */
  light: Float32Array;
}

interface FaceRunBuffers {
  key: Uint32Array;
  ao: Uint8Array;
  sunPack: Uint16Array;
  torchPack: Uint16Array;
  cr: Float32Array;
  cg: Float32Array;
  cb: Float32Array;
}

const MAX_GREEDY_SPAN = 2;

// ── Block colors ──

const BLOCK_COLORS: Record<number, number> = {
  1: 0x7a7a78,   // Concrete
  2: 0x5a5a58,   // DarkConcrete
  3: 0x2a2a2e,   // Asphalt
  4: 0x8b4513,   // Rebar
  5: 0x6b3a2a,   // Brick
  6: 0x4a4e52,   // Metal
  7: 0x6a6258,   // Rubble
  8: 0x5a4e3a,   // Dirt
  9: 0x9a8e72,   // Sand
  10: 0x4a7a3a,  // Grass
  11: 0x6b4423,  // Wood
  12: 0x6a6a6a,  // Stone
  13: 0xd8d8e0,  // Snow
  14: 0xffcf78,  // Lantern
  15: 0x1a1a2e,  // Bedrock
};

// ── Voxel light volume ──
// Two-channel flood-fill lighting computed over the 3x3 chunk-column
// neighborhood (full world height): sky light from a top-down column scan +
// BFS spread, lantern light from BFS around emitters. Sampled per vertex
// like AO, so sunlight occlusion and lantern glow are baked into the mesh
// and cost nothing at render time.

const LIGHT_MAX = 15;
const WORLD_Y = WORLD_CONFIG.sizeY;
const VOL_XZ = CHUNK * 3;
const VOL_SIZE = VOL_XZ * VOL_XZ * WORLD_Y;
const VOL_SLICE = VOL_XZ * VOL_XZ;

// Module-level scratch reused across jobs (one builder runs per worker)
const volBlocks = new Uint8Array(VOL_SIZE);
const volSun = new Uint8Array(VOL_SIZE);
const volTorch = new Uint8Array(VOL_SIZE);
const bfsQueue = new Int32Array(VOL_SIZE * 4);

function volIndex(vx: number, vy: number, vz: number): number {
  return vx + vz * VOL_XZ + vy * VOL_SLICE;
}

function propagateLight(channel: Uint8Array, queueLen: number): void {
  let head = 0;
  let tail = queueLen;
  while (head < tail) {
    const idx = bfsQueue[head++]!;
    const level = channel[idx]!;
    if (level <= 1) continue;
    const next = level - 1;
    const vy = Math.floor(idx / VOL_SLICE);
    const rem = idx - vy * VOL_SLICE;
    const vz = Math.floor(rem / VOL_XZ);
    const vx = rem - vz * VOL_XZ;

    for (let n = 0; n < 6; n++) {
      const nx = vx + (n === 0 ? 1 : n === 1 ? -1 : 0);
      const ny = vy + (n === 2 ? 1 : n === 3 ? -1 : 0);
      const nz = vz + (n === 4 ? 1 : n === 5 ? -1 : 0);
      if (nx < 0 || nx >= VOL_XZ || nz < 0 || nz >= VOL_XZ || ny < 0 || ny >= WORLD_Y) continue;
      const ni = volIndex(nx, ny, nz);
      if (volBlocks[ni] !== 0) continue;
      if (channel[ni]! >= next) continue;
      channel[ni] = next;
      if (tail < bfsQueue.length) bfsQueue[tail++] = ni;
    }
  }
}

function computeLightVolume(
  gb: (x: number, y: number, z: number) => number,
  x0: number,
  z0: number,
): void {
  const baseX = x0 - CHUNK;
  const baseZ = z0 - CHUNK;

  for (let vy = 0; vy < WORLD_Y; vy++) {
    for (let vz = 0; vz < VOL_XZ; vz++) {
      for (let vx = 0; vx < VOL_XZ; vx++) {
        volBlocks[volIndex(vx, vy, vz)] = gb(baseX + vx, vy, baseZ + vz);
      }
    }
  }

  volSun.fill(0);
  volTorch.fill(0);

  // Sky light: full strength straight down until the first opaque block
  let sunQueueLen = 0;
  for (let vz = 0; vz < VOL_XZ; vz++) {
    for (let vx = 0; vx < VOL_XZ; vx++) {
      for (let vy = WORLD_Y - 1; vy >= 0; vy--) {
        const idx = volIndex(vx, vy, vz);
        if (volBlocks[idx] !== 0) break;
        volSun[idx] = LIGHT_MAX;
        if (sunQueueLen < bfsQueue.length) bfsQueue[sunQueueLen++] = idx;
      }
    }
  }
  propagateLight(volSun, sunQueueLen);

  // Lantern light: BFS out from every emitter
  let torchQueueLen = 0;
  for (let i = 0; i < VOL_SIZE; i++) {
    if (volBlocks[i] === BlockType.Lantern) {
      volTorch[i] = LIGHT_MAX;
      if (torchQueueLen < bfsQueue.length) bfsQueue[torchQueueLen++] = i;
    }
  }
  // Emitters are opaque, so seed their air neighbors directly
  propagateLightFromOpaqueSeeds(torchQueueLen);
  }

function propagateLightFromOpaqueSeeds(seedLen: number): void {
  let tail = seedLen;
  for (let s = 0; s < seedLen; s++) {
    const idx = bfsQueue[s]!;
    const vy = Math.floor(idx / VOL_SLICE);
    const rem = idx - vy * VOL_SLICE;
    const vz = Math.floor(rem / VOL_XZ);
    const vx = rem - vz * VOL_XZ;
    for (let n = 0; n < 6; n++) {
      const nx = vx + (n === 0 ? 1 : n === 1 ? -1 : 0);
      const ny = vy + (n === 2 ? 1 : n === 3 ? -1 : 0);
      const nz = vz + (n === 4 ? 1 : n === 5 ? -1 : 0);
      if (nx < 0 || nx >= VOL_XZ || nz < 0 || nz >= VOL_XZ || ny < 0 || ny >= WORLD_Y) continue;
      const ni = volIndex(nx, ny, nz);
      if (volBlocks[ni] !== 0) continue;
      if (volTorch[ni]! >= LIGHT_MAX - 1) continue;
      volTorch[ni] = LIGHT_MAX - 1;
      if (tail < bfsQueue.length) bfsQueue[tail++] = ni;
    }
  }
  // Continue standard propagation from the seeded air cells
  let head = seedLen;
  while (head < tail) {
    const idx = bfsQueue[head++]!;
    const level = volTorch[idx]!;
    if (level <= 1) continue;
    const next = level - 1;
    const vy = Math.floor(idx / VOL_SLICE);
    const rem = idx - vy * VOL_SLICE;
    const vz = Math.floor(rem / VOL_XZ);
    const vx = rem - vz * VOL_XZ;
    for (let n = 0; n < 6; n++) {
      const nx = vx + (n === 0 ? 1 : n === 1 ? -1 : 0);
      const ny = vy + (n === 2 ? 1 : n === 3 ? -1 : 0);
      const nz = vz + (n === 4 ? 1 : n === 5 ? -1 : 0);
      if (nx < 0 || nx >= VOL_XZ || nz < 0 || nz >= VOL_XZ || ny < 0 || ny >= WORLD_Y) continue;
      const ni = volIndex(nx, ny, nz);
      if (volBlocks[ni] !== 0) continue;
      if (volTorch[ni]! >= next) continue;
      volTorch[ni] = next;
      if (tail < bfsQueue.length) bfsQueue[tail++] = ni;
    }
  }
}

// ── Face geometry data ──

const FACE_SHADING = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ── Per-vertex Ambient Occlusion ──

const AO_TANGENTS: number[][] = [
  [0, 1, 0, 0, 0, 1],  // face 0 (+X)
  [0, 1, 0, 0, 0, 1],  // face 1 (-X)
  [1, 0, 0, 0, 0, 1],  // face 2 (+Y)
  [1, 0, 0, 0, 0, 1],  // face 3 (-Y)
  [1, 0, 0, 0, 1, 0],  // face 4 (+Z)
  [1, 0, 0, 0, 1, 0],  // face 5 (-Z)
];

const AO_SIGNS: number[][][] = [
  [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  [[-1, 1], [1, 1], [1, -1], [-1, -1]],
  [[-1, -1], [-1, 1], [1, 1], [1, -1]],
  [[1, -1], [1, 1], [-1, 1], [-1, -1]],
  [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  [[-1, 1], [1, 1], [1, -1], [-1, -1]],
];

const AO_CURVE = [0.45, 0.68, 0.85, 1.0];

// ── Noise helper ──

function hash2d(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

// ── AO helpers ──

function vertexAO(s1: boolean, s2: boolean, c: boolean): number {
  if (s1 && s2) return 0;
  return 3 - (+s1) - (+s2) - (+c);
}

function computeFaceAO(
  gb: (x: number, y: number, z: number) => number,
  bx: number, by: number, bz: number, face: number,
): [number, number, number, number] {
  const n = FACE_NORMALS[face]!;
  const t = AO_TANGENTS[face]!;
  const signs = AO_SIGNS[face]!;
  const nx = bx + n[0]!, ny = by + n[1]!, nz = bz + n[2]!;
  const ao: [number, number, number, number] = [3, 3, 3, 3];
  for (let c = 0; c < 4; c++) {
    const s1 = signs[c]![0]!, s2 = signs[c]![1]!;
    const side1 = gb(nx + s1 * t[0]!, ny + s1 * t[1]!, nz + s1 * t[2]!) !== 0;
    const side2 = gb(nx + s2 * t[3]!, ny + s2 * t[4]!, nz + s2 * t[5]!) !== 0;
    const corner = gb(nx + s1 * t[0]! + s2 * t[3]!, ny + s1 * t[1]! + s2 * t[4]!, nz + s1 * t[2]! + s2 * t[5]!) !== 0;
    ao[c] = vertexAO(side1, side2, corner);
  }
  return ao;
}

function packAo(ao: [number, number, number, number]): number {
  return (ao[0] & 3) | ((ao[1] & 3) << 2) | ((ao[2] & 3) << 4) | ((ao[3] & 3) << 6);
}

// ── Per-vertex light sampling ──
// Samples the same 4-cell neighborhood as AO on the air side of each face
// and averages each channel over the open cells (smooth lighting).

function sampleCornerLight(
  channel: Uint8Array,
  baseX: number,
  baseZ: number,
  cells: Array<[number, number, number]>,
): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < 4; i++) {
    const [wx, wy, wz] = cells[i]!;
    if (wy >= WORLD_Y) {
      // Above the world: open sky
      sum += channel === volSun ? LIGHT_MAX : 0;
      count++;
      continue;
    }
    const vx = wx - baseX;
    const vz = wz - baseZ;
    if (vx < 0 || vx >= VOL_XZ || vz < 0 || vz >= VOL_XZ || wy < 0) continue;
    const idx = volIndex(vx, wy, vz);
    if (volBlocks[idx] !== 0) continue;
    sum += channel[idx]!;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function computeFaceLight(
  baseX: number,
  baseZ: number,
  bx: number, by: number, bz: number, face: number,
): [number, number] {
  const n = FACE_NORMALS[face]!;
  const t = AO_TANGENTS[face]!;
  const signs = AO_SIGNS[face]!;
  const ax = bx + n[0]!, ay = by + n[1]!, az = bz + n[2]!;
  let sunPack = 0;
  let torchPack = 0;
  for (let c = 0; c < 4; c++) {
    const s1 = signs[c]![0]!, s2 = signs[c]![1]!;
    const cells: Array<[number, number, number]> = [
      [ax, ay, az],
      [ax + s1 * t[0]!, ay + s1 * t[1]!, az + s1 * t[2]!],
      [ax + s2 * t[3]!, ay + s2 * t[4]!, az + s2 * t[5]!],
      [ax + s1 * t[0]! + s2 * t[3]!, ay + s1 * t[1]! + s2 * t[4]!, az + s1 * t[2]! + s2 * t[5]!],
    ];
    const sun = Math.round(sampleCornerLight(volSun, baseX, baseZ, cells));
    const torch = Math.round(sampleCornerLight(volTorch, baseX, baseZ, cells));
    sunPack |= (sun & 0xf) << (c * 4);
    torchPack |= (torch & 0xf) << (c * 4);
  }
  return [sunPack, torchPack];
}

// ── Face builder (greedy quads) ──

function addQuad(
  pos: number[], nrm: number[], col: number[], lig: number[],
  cr: number, cg: number, cb: number,
  x: number, y: number, z: number,
  uSpan: number,
  vSpan: number,
  face: number,
  aoPacked: number,
  sunPacked: number,
  torchPacked: number,
): void {
  const n = FACE_NORMALS[face]!;
  const s = FACE_SHADING[face]!;
  const ao0 = aoPacked & 3;
  const ao1 = (aoPacked >> 2) & 3;
  const ao2 = (aoPacked >> 4) & 3;
  const ao3 = (aoPacked >> 6) & 3;
  const aoMul = [AO_CURVE[ao0]! * s, AO_CURVE[ao1]! * s, AO_CURVE[ao2]! * s, AO_CURVE[ao3]! * s];
  const flip = ao0 + ao2 < ao1 + ao3;
  const idx = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];

  let corners: Array<[number, number, number]>;
  switch (face) {
    case 0:
      corners = [
        [x, y, z],
        [x, y + uSpan, z],
        [x, y + uSpan, z + vSpan],
        [x, y, z + vSpan],
      ];
      break;
    case 1:
      corners = [
        [x, y, z + vSpan],
        [x, y + uSpan, z + vSpan],
        [x, y + uSpan, z],
        [x, y, z],
      ];
      break;
    case 2:
      corners = [
        [x, y, z],
        [x, y, z + vSpan],
        [x + uSpan, y, z + vSpan],
        [x + uSpan, y, z],
      ];
      break;
    case 3:
      corners = [
        [x + uSpan, y, z],
        [x + uSpan, y, z + vSpan],
        [x, y, z + vSpan],
        [x, y, z],
      ];
      break;
    case 4:
      corners = [
        [x, y, z],
        [x + uSpan, y, z],
        [x + uSpan, y + vSpan, z],
        [x, y + vSpan, z],
      ];
      break;
    default:
      corners = [
        [x, y + vSpan, z],
        [x + uSpan, y + vSpan, z],
        [x + uSpan, y, z],
        [x, y, z],
      ];
      break;
  }

  for (let i = 0; i < 6; i++) {
    const ci = idx[i]!;
    const v = corners[ci]!;
    const m = aoMul[ci]!;
    pos.push(v[0], v[1], v[2]);
    nrm.push(n[0]!, n[1]!, n[2]!);
    col.push(cr * m, cg * m, cb * m);
    lig.push(
      ((sunPacked >> (ci * 4)) & 0xf) / LIGHT_MAX,
      ((torchPacked >> (ci * 4)) & 0xf) / LIGHT_MAX,
    );
  }
}

// ── Color unpacking ──
// Matches THREE.Color.setHex() which converts sRGB hex → linear-sRGB working space.
// THREE.js v0.152+ has ColorManagement enabled by default, so setHex applies SRGBToLinear
// to each channel. We must replicate this exactly so vertex colors match the old inline code.

function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

function hexToLinearRgb(hex: number): [number, number, number] {
  return [
    srgbToLinear(((hex >> 16) & 0xff) / 255),
    srgbToLinear(((hex >> 8) & 0xff) / 255),
    srgbToLinear((hex & 0xff) / 255),
  ];
}

// ── Main build function ──

export function buildChunkMeshData(input: ChunkMeshBuildInput): ChunkMeshData {
  const { cx, cy, cz, chunkData, neighbors } = input;
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  const voxelCount = CHUNK * CHUNK * CHUNK;
  const faceMaskSize = CHUNK * CHUNK;
  const EMPTY_KEY = 0xffffffff;

  // Build neighbor lookup. dy spans the full world height (vertical chunk
  // columns are always sent) so sky light can be traced top to bottom.
  const neighborMap = new Map<number, Uint8Array>();
  for (const n of neighbors) {
    const key = ((n.dx + 1) * 25) + ((n.dy + 2) * 5) + (n.dz + 1);
    neighborMap.set(key, n.data);
  }

  // Block getter that handles cross-chunk lookups
  const gb = (gx: number, gy: number, gz: number): number => {
    const lx = gx - x0;
    const ly = gy - y0;
    const lz = gz - z0;

    if (lx >= 0 && lx < CHUNK && ly >= 0 && ly < CHUNK && lz >= 0 && lz < CHUNK) {
      return chunkData[lx + ly * CHUNK + lz * CHUNK * CHUNK]!;
    }

    // Cross-chunk lookup
    const ncx = Math.floor(gx / CHUNK) - cx;
    const ncy = Math.floor(gy / CHUNK) - cy;
    const ncz = Math.floor(gz / CHUNK) - cz;
    if (Math.abs(ncx) > 1 || Math.abs(ncy) > 2 || Math.abs(ncz) > 1) return 0;

    const key = ((ncx + 1) * 25) + ((ncy + 2) * 5) + (ncz + 1);
    const nData = neighborMap.get(key);
    if (!nData) return 0;

    const nlx = ((gx % CHUNK) + CHUNK) % CHUNK;
    const nly = ((gy % CHUNK) + CHUNK) % CHUNK;
    const nlz = ((gz % CHUNK) + CHUNK) % CHUNK;
    return nData[nlx + nly * CHUNK + nlz * CHUNK * CHUNK]!;
  };

  computeLightVolume(gb, x0, z0);
  const lightBaseX = x0 - CHUNK;
  const lightBaseZ = z0 - CHUNK;

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const lig: number[] = [];

  const colorReady = new Uint8Array(voxelCount);
  const colorR = new Float32Array(voxelCount);
  const colorG = new Float32Array(voxelCount);
  const colorB = new Float32Array(voxelCount);
  const colorKey = new Uint32Array(voxelCount);

  const mask: FaceRunBuffers = {
    key: new Uint32Array(faceMaskSize),
    ao: new Uint8Array(faceMaskSize),
    sunPack: new Uint16Array(faceMaskSize),
    torchPack: new Uint16Array(faceMaskSize),
    cr: new Float32Array(faceMaskSize),
    cg: new Float32Array(faceMaskSize),
    cb: new Float32Array(faceMaskSize),
  };

  const getVoxelColor = (
    localIndex: number,
    blockType: number,
    wx: number,
    wy: number,
    wz: number,
  ): [number, number, number, number] => {
    if (colorReady[localIndex] === 0) {
      const hexColor = BLOCK_COLORS[blockType] ?? 0x808080;
      let [cr, cg, cb] = hexToLinearRgb(hexColor);

      if (blockType === BlockType.Lantern) {
        cr = Math.min(1, cr * 1.45 + 0.2);
        cg = Math.min(1, cg * 1.45 + 0.12);
        cb = cb * 1.45;
      }

      // Keep the original fine-grained variation profile for visual richness.
      const variation = (hash2d(wx * 7 + wy, wz * 13 + wy) - 0.5) * 0.06;
      cr = Math.max(0, Math.min(1, cr + variation));
      cg = Math.max(0, Math.min(1, cg + variation));
      cb = Math.max(0, Math.min(1, cb + variation));

      // Quantize to 8-bit channels for deterministic merge keys while
      // keeping the visual result effectively identical to the pre-greedy path.
      const qr = Math.max(0, Math.min(255, Math.round(cr * 255)));
      const qg = Math.max(0, Math.min(255, Math.round(cg * 255)));
      const qb = Math.max(0, Math.min(255, Math.round(cb * 255)));
      cr = qr / 255;
      cg = qg / 255;
      cb = qb / 255;

      colorR[localIndex] = cr;
      colorG[localIndex] = cg;
      colorB[localIndex] = cb;

      colorKey[localIndex] = (((blockType & 0xff) << 24) | (qr << 16) | (qg << 8) | qb) >>> 0;

      colorReady[localIndex] = 1;
    }

    return [colorR[localIndex]!, colorG[localIndex]!, colorB[localIndex]!, colorKey[localIndex]!];
  };

  const emitMaskGreedy = (
    face: number,
    fixed: number,
    fixedIs: 'x' | 'y' | 'z',
  ): void => {
    const { key, ao, sunPack, torchPack, cr, cg, cb } = mask;

    for (let v = 0; v < CHUNK; v++) {
      for (let u = 0; u < CHUNK; u++) {
        const idx = u + v * CHUNK;
        const cellKey = key[idx]!;
        if (cellKey === EMPTY_KEY) continue;

        const cellAo = ao[idx]!;
        const cellSun = sunPack[idx]!;
        const cellTorch = torchPack[idx]!;

        let width = 1;
        while (u + width < CHUNK && width < MAX_GREEDY_SPAN) {
          const n = idx + width;
          if (key[n] !== cellKey || ao[n] !== cellAo || sunPack[n] !== cellSun || torchPack[n] !== cellTorch) break;
          width++;
        }

        let height = 1;
        rowLoop:
        while (v + height < CHUNK && height < MAX_GREEDY_SPAN) {
          const row = (v + height) * CHUNK + u;
          for (let k = 0; k < width; k++) {
            const n = row + k;
            if (key[n] !== cellKey || ao[n] !== cellAo || sunPack[n] !== cellSun || torchPack[n] !== cellTorch) break rowLoop;
          }
          height++;
        }

        if (fixedIs === 'x') {
          addQuad(
            pos, nrm, col, lig,
            cr[idx]!, cg[idx]!, cb[idx]!,
            x0 + fixed,
            y0 + u,
            z0 + v,
            width,
            height,
            face,
            cellAo,
            cellSun,
            cellTorch,
          );
        } else if (fixedIs === 'y') {
          addQuad(
            pos, nrm, col, lig,
            cr[idx]!, cg[idx]!, cb[idx]!,
            x0 + u,
            y0 + fixed,
            z0 + v,
            width,
            height,
            face,
            cellAo,
            cellSun,
            cellTorch,
          );
        } else {
          addQuad(
            pos, nrm, col, lig,
            cr[idx]!, cg[idx]!, cb[idx]!,
            x0 + u,
            y0 + v,
            z0 + fixed,
            width,
            height,
            face,
            cellAo,
            cellSun,
            cellTorch,
          );
        }

        for (let dv = 0; dv < height; dv++) {
          const row = (v + dv) * CHUNK + u;
          for (let du = 0; du < width; du++) {
            key[row + du] = EMPTY_KEY;
          }
        }
      }
    }
  };

  // +X and -X faces (u=Y, v=Z)
  for (let lx = 0; lx < CHUNK; lx++) {
    mask.key.fill(EMPTY_KEY);
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let ly = 0; ly < CHUNK; ly++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx + 1, wy, wz) !== 0) continue;

        const m = ly + lz * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 0));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 0);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(0, lx + 1, 'x');

    mask.key.fill(EMPTY_KEY);
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let ly = 0; ly < CHUNK; ly++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx - 1, wy, wz) !== 0) continue;

        const m = ly + lz * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 1));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 1);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(1, lx, 'x');
  }

  // +Y and -Y faces (u=X, v=Z)
  for (let ly = 0; ly < CHUNK; ly++) {
    mask.key.fill(EMPTY_KEY);
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx, wy + 1, wz) !== 0) continue;

        const m = lx + lz * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 2));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 2);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(2, ly + 1, 'y');

    mask.key.fill(EMPTY_KEY);
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx, wy - 1, wz) !== 0) continue;

        const m = lx + lz * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 3));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 3);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(3, ly, 'y');
  }

  // +Z and -Z faces (u=X, v=Y)
  for (let lz = 0; lz < CHUNK; lz++) {
    mask.key.fill(EMPTY_KEY);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx, wy, wz + 1) !== 0) continue;

        const m = lx + ly * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 4));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 4);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(4, lz + 1, 'z');

    mask.key.fill(EMPTY_KEY);
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const localIndex = lx + ly * CHUNK + lz * CHUNK * CHUNK;
        const b = chunkData[localIndex]!;
        if (b === 0) continue;
        const wx = x0 + lx;
        const wy = y0 + ly;
        const wz = z0 + lz;
        if (gb(wx, wy, wz - 1) !== 0) continue;

        const m = lx + ly * CHUNK;
        const [cr, cg, cb, k] = getVoxelColor(localIndex, b, wx, wy, wz);
        mask.key[m] = k;
        mask.ao[m] = packAo(computeFaceAO(gb, wx, wy, wz, 5));
        const [sp, tp] = computeFaceLight(lightBaseX, lightBaseZ, wx, wy, wz, 5);
        mask.sunPack[m] = sp;
        mask.torchPack[m] = tp;
        mask.cr[m] = cr;
        mask.cg[m] = cg;
        mask.cb[m] = cb;
      }
    }
    emitMaskGreedy(5, lz, 'z');
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    color: new Float32Array(col),
    light: new Float32Array(lig),
  };
}
