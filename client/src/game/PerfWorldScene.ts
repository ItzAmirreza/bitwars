import { CHUNK, BlockType, WORLD_X, WORLD_Y, WORLD_Z } from './VoxelWorld';

const CHUNKS_X = Math.ceil(WORLD_X / CHUNK);
const CHUNKS_Y = Math.ceil(WORLD_Y / CHUNK);
const CHUNKS_Z = Math.ceil(WORLD_Z / CHUNK);

function chunkLocalIndex(lx: number, ly: number, lz: number): number {
  return lx + ly * CHUNK + lz * CHUNK * CHUNK;
}

function chunkWorldOrigin(cx: number, cy: number, cz: number): { ox: number; oy: number; oz: number } {
  return { ox: cx * CHUNK, oy: cy * CHUNK, oz: cz * CHUNK };
}

function biomeAt(worldX: number): number {
  const stripeW = Math.max(24, Math.floor(WORLD_X / 6));
  const stripe = Math.floor(worldX / stripeW) % 6;
  if (stripe === 0) return BlockType.Sand;
  if (stripe === 1) return BlockType.Grass;
  if (stripe === 2) return BlockType.Stone;
  if (stripe === 3) return BlockType.Snow;
  if (stripe === 4) return BlockType.Dirt;
  return BlockType.Asphalt;
}

function laneHeight(worldX: number, worldZ: number): number {
  const wavA = Math.sin(worldX * 0.03) * 2.4;
  const wavB = Math.cos(worldZ * 0.027) * 2.0;
  const base = 9 + wavA + wavB;
  return Math.max(4, Math.min(WORLD_Y - 6, Math.floor(base)));
}

function placeStressStructures(chunk: Uint8Array, ox: number, oy: number, oz: number): void {
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const wx = ox + lx;
      const wz = oz + lz;
      const h = laneHeight(wx, wz);
      const surface = biomeAt(wx);

      for (let ly = 0; ly < CHUNK; ly++) {
        const wy = oy + ly;
        const idx = chunkLocalIndex(lx, ly, lz);
        if (wy > h) continue;
        if (wy === h) {
          chunk[idx] = surface;
        } else if (wy >= h - 2) {
          chunk[idx] = BlockType.Dirt;
        } else {
          chunk[idx] = BlockType.Stone;
        }
      }

      // Road stripe in center band
      const roadBand = Math.abs(wz - WORLD_Z * 0.5) < 9;
      if (roadBand) {
        const y = h;
        if (y >= oy && y < oy + CHUNK) {
          chunk[chunkLocalIndex(lx, y - oy, lz)] = BlockType.Asphalt;
        }
      }

      // Building clusters in deterministic cells
      const cellX = Math.floor(wx / 28);
      const cellZ = Math.floor(wz / 28);
      const gate = ((cellX * 73856093) ^ (cellZ * 19349663)) & 7;
      const inCellX = wx % 28;
      const inCellZ = wz % 28;
      if (gate <= 2 && inCellX > 4 && inCellX < 23 && inCellZ > 4 && inCellZ < 23) {
        const y0 = h + 1;
        const height = 8 + (gate % 3) * 4;
        const wy = oy;
        const localTop = Math.min(CHUNK - 1, y0 + height - wy);
        const localBottom = Math.max(0, y0 - wy);
        for (let ly = localBottom; ly <= localTop; ly++) {
          const gy = wy + ly;
          const wall = inCellX <= 6 || inCellX >= 21 || inCellZ <= 6 || inCellZ >= 21 || gy === y0 + height - 1;
          if (!wall) continue;
          chunk[chunkLocalIndex(lx, ly, lz)] = (gate % 2 === 0) ? BlockType.Concrete : BlockType.Brick;
        }

        // Windows / cutouts
        if (inCellX > 9 && inCellX < 18 && (inCellZ === 6 || inCellZ === 21)) {
          const wyWin = y0 + 3;
          if (wyWin >= oy && wyWin < oy + CHUNK) {
            chunk[chunkLocalIndex(lx, wyWin - oy, lz)] = 0;
          }
        }

        // Lantern blocks on building rooftops and inside for light stress testing
        const roofY = y0 + height - 1;
        if (inCellX === 14 && inCellZ === 14 && roofY >= oy && roofY < oy + CHUNK) {
          chunk[chunkLocalIndex(lx, roofY - oy, lz)] = BlockType.Lantern;
        }
        // Interior lantern on wall at y0+2
        if (inCellX === 7 && inCellZ === 14) {
          const intY = y0 + 2;
          if (intY >= oy && intY < oy + CHUNK) {
            chunk[chunkLocalIndex(lx, intY - oy, lz)] = BlockType.Lantern;
          }
        }
      }

      // Street-level lanterns along the road band every ~20 blocks
      if (roadBand && wx % 20 === 0 && Math.abs(wz - WORLD_Z * 0.5) < 2) {
        const lanternY = h + 1;
        if (lanternY >= oy && lanternY < oy + CHUNK) {
          chunk[chunkLocalIndex(lx, lanternY - oy, lz)] = BlockType.Lantern;
        }
      }
    }
  }
}

export function generateDeterministicPerfChunk(cx: number, cy: number, cz: number): Uint8Array {
  if (cx < 0 || cx >= CHUNKS_X || cy < 0 || cy >= CHUNKS_Y || cz < 0 || cz >= CHUNKS_Z) {
    return new Uint8Array(CHUNK * CHUNK * CHUNK);
  }
  const chunk = new Uint8Array(CHUNK * CHUNK * CHUNK);
  const { ox, oy, oz } = chunkWorldOrigin(cx, cy, cz);
  placeStressStructures(chunk, ox, oy, oz);
  return chunk;
}

export function perfSceneSpawnPoint(index: number): { x: number; y: number; z: number } {
  const margin = 64;
  const points = [
    { x: margin, z: margin },
    { x: WORLD_X - margin, z: margin },
    { x: WORLD_X - margin, z: WORLD_Z - margin },
    { x: margin, z: WORLD_Z - margin },
    { x: WORLD_X * 0.5, z: WORLD_Z * 0.5 },
  ];
  const p = points[index % points.length]!;
  return {
    x: p.x,
    y: Math.min(WORLD_Y - 4, Math.max(4, laneHeight(p.x, p.z) + 2.6)),
    z: p.z,
  };
}
