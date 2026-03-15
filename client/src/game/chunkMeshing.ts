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
}

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
};

// ── Lantern boost offsets ──

const LANTERN_NEAR_BOOST_OFFSETS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
];

// ── Face geometry data ──

const FACE_SHADING = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];
const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_VERTS = [
  [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 1, 1], [0, 0, 1]],  // +X
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]],  // -X
  [[0, 0, 0], [0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 1], [1, 0, 0]],  // +Y
  [[1, 0, 0], [1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 1], [0, 0, 0]],  // -Y
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]],  // +Z
  [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]],  // -Z
];

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

// ── Lantern helpers ──

function lanternLocalBoost(face: number, vx: number, vy: number, vz: number): number {
  if (face === 2) return 1.28;
  if (face === 3) return 1.02;
  const centerDist = Math.abs(vx - 0.5) + Math.abs(vy - 0.5) + Math.abs(vz - 0.5);
  return centerDist < 1.2 ? 1.22 : 1.14;
}

function lanternNeighborBoost(
  gb: (x: number, y: number, z: number) => number,
  bx: number, by: number, bz: number,
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

// ── Face builder ──

function addFace(
  pos: number[], nrm: number[], col: number[],
  cr: number, cg: number, cb: number,
  x: number, y: number, z: number, face: number,
  ao: [number, number, number, number],
  blockType: number,
): void {
  const verts = FACE_VERTS[face]!;
  const n = FACE_NORMALS[face]!;
  const s = FACE_SHADING[face]!;
  const corners = [verts[0]!, verts[1]!, verts[2]!, verts[5]!];
  const aoMul = [AO_CURVE[ao[0]]! * s, AO_CURVE[ao[1]]! * s, AO_CURVE[ao[2]]! * s, AO_CURVE[ao[3]]! * s];
  const flip = ao[0] + ao[2] < ao[1] + ao[3];
  const idx = flip ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
  for (let i = 0; i < 6; i++) {
    const ci = idx[i]!;
    const v = corners[ci]!;
    const lanternBoost = blockType === BlockType.Lantern ? lanternLocalBoost(face, v[0]!, v[1]!, v[2]!) : 1;
    const m = Math.min(1.85, aoMul[ci]! * lanternBoost);
    pos.push(x + v[0]!, y + v[1]!, z + v[2]!);
    nrm.push(n[0]!, n[1]!, n[2]!);
    col.push(cr * m, cg * m, cb * m);
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

  // Build neighbor lookup
  const neighborMap = new Map<number, Uint8Array>();
  for (const n of neighbors) {
    const key = ((n.dx + 1) * 9) + ((n.dy + 1) * 3) + (n.dz + 1);
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
    if (Math.abs(ncx) > 1 || Math.abs(ncy) > 1 || Math.abs(ncz) > 1) return 0;

    const key = ((ncx + 1) * 9) + ((ncy + 1) * 3) + (ncz + 1);
    const nData = neighborMap.get(key);
    if (!nData) return 0;

    const nlx = ((gx % CHUNK) + CHUNK) % CHUNK;
    const nly = ((gy % CHUNK) + CHUNK) % CHUNK;
    const nlz = ((gz % CHUNK) + CHUNK) % CHUNK;
    return nData[nlx + nly * CHUNK + nlz * CHUNK * CHUNK]!;
  };

  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];

  for (let lz = 0; lz < CHUNK; lz++) {
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const b = chunkData[lx + ly * CHUNK + lz * CHUNK * CHUNK]!;
        if (b === 0) continue;

        const x = x0 + lx;
        const y = y0 + ly;
        const z = z0 + lz;

        const hexColor = BLOCK_COLORS[b] ?? 0x808080;
        let [cr, cg, cb] = hexToLinearRgb(hexColor);

        if (b === BlockType.Lantern) {
          cr = Math.min(1, cr * 1.45 + 0.2);
          cg = Math.min(1, cg * 1.45 + 0.12);
          cb = cb * 1.45;
        } else {
          const nearBoost = lanternNeighborBoost(gb, x, y, z);
          if (nearBoost > 1) {
            cr = Math.min(1, cr * nearBoost + 0.02 * (nearBoost - 1) * 10);
            cg = Math.min(1, cg * nearBoost + 0.015 * (nearBoost - 1) * 10);
            cb = cb * nearBoost;
          }
        }

        // Subtle per-block color variation
        const variation = (hash2d(x * 7 + y, z * 13 + y) - 0.5) * 0.06;
        cr = Math.max(0, Math.min(1, cr + variation));
        cg = Math.max(0, Math.min(1, cg + variation));
        cb = Math.max(0, Math.min(1, cb + variation));

        if (gb(x + 1, y, z) === 0) addFace(pos, nrm, col, cr, cg, cb, x + 1, y, z, 0, computeFaceAO(gb, x, y, z, 0), b);
        if (gb(x - 1, y, z) === 0) addFace(pos, nrm, col, cr, cg, cb, x, y, z, 1, computeFaceAO(gb, x, y, z, 1), b);
        if (gb(x, y + 1, z) === 0) addFace(pos, nrm, col, cr, cg, cb, x, y + 1, z, 2, computeFaceAO(gb, x, y, z, 2), b);
        if (gb(x, y - 1, z) === 0) addFace(pos, nrm, col, cr, cg, cb, x, y, z, 3, computeFaceAO(gb, x, y, z, 3), b);
        if (gb(x, y, z + 1) === 0) addFace(pos, nrm, col, cr, cg, cb, x, y, z + 1, 4, computeFaceAO(gb, x, y, z, 4), b);
        if (gb(x, y, z - 1) === 0) addFace(pos, nrm, col, cr, cg, cb, x, y, z, 5, computeFaceAO(gb, x, y, z, 5), b);
      }
    }
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nrm),
    color: new Float32Array(col),
  };
}
