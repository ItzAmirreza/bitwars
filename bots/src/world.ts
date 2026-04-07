import { WORLD } from '../../client/src/shared-config.ts';

const CHUNK = WORLD.chunkSize;
const WORLD_X = WORLD.sizeX;
const WORLD_Y = WORLD.sizeY;
const WORLD_Z = WORLD.sizeZ;

function packChunkId(cx: number, cy: number, cz: number): number {
  return (cx & 0xff) | ((cy & 0xff) << 8) | ((cz & 0xff) << 16);
}

function asUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array();
}

export type BotVec3 = {
  x: number;
  y: number;
  z: number;
};

export class WorldSnapshot {
  private chunks = new Map<number, Uint8Array>();

  static rleDecodeChunk(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(CHUNK * CHUNK * CHUNK);
    let outIdx = 0;
    let i = 0;
    while (i + 1 < data.length && outIdx < output.length) {
      const value = data[i] ?? 0;
      const run = data[i + 1] ?? 0;
      for (let j = 0; j < run && outIdx < output.length; j++) {
        output[outIdx++] = value;
      }
      i += 2;
    }
    return output;
  }

  upsertChunk(chunk: {
    chunkId?: number | bigint;
    cx: number;
    cy: number;
    cz: number;
    data: unknown;
  }): void {
    const cx = Number(chunk.cx);
    const cy = Number(chunk.cy);
    const cz = Number(chunk.cz);
    const id = Number(chunk.chunkId ?? packChunkId(cx, cy, cz));
    this.chunks.set(id, WorldSnapshot.rleDecodeChunk(asUint8Array(chunk.data)));
  }

  removeChunk(chunk: { chunkId?: number | bigint; cx: number; cy: number; cz: number }): void {
    const cx = Number(chunk.cx);
    const cy = Number(chunk.cy);
    const cz = Number(chunk.cz);
    const id = Number(chunk.chunkId ?? packChunkId(cx, cy, cz));
    this.chunks.delete(id);
  }

  getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= WORLD_X || y < 0 || y >= WORLD_Y || z < 0 || z >= WORLD_Z) {
      return 0;
    }
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    const cx = Math.floor(bx / CHUNK);
    const cy = Math.floor(by / CHUNK);
    const cz = Math.floor(bz / CHUNK);
    const chunk = this.chunks.get(packChunkId(cx, cy, cz));
    if (!chunk) return 0;
    const lx = bx - cx * CHUNK;
    const ly = by - cy * CHUNK;
    const lz = bz - cz * CHUNK;
    return chunk[lx + ly * CHUNK + lz * CHUNK * CHUNK] ?? 0;
  }

  getGroundHeightBelow(x: number, footY: number, z: number): number {
    const startY = Math.max(0, Math.min(WORLD_Y - 1, Math.floor(footY)));
    for (let y = startY; y >= 0; y--) {
      if (this.getBlock(x, y, z) !== 0) return y;
    }
    return -1;
  }

  isColumnLoaded(x: number, z: number): boolean {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    if (bx < 0 || bx >= WORLD_X || bz < 0 || bz >= WORLD_Z) return false;
    const cx = Math.floor(bx / CHUNK);
    const cz = Math.floor(bz / CHUNK);
    for (let cy = 0; cy < Math.ceil(WORLD_Y / CHUNK); cy++) {
      if (this.chunks.has(packChunkId(cx, cy, cz))) return true;
    }
    return false;
  }

  hasLineOfSight(start: BotVec3, end: BotVec3): boolean {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance <= 0.001) return true;

    const step = 0.4;
    const steps = Math.max(1, Math.ceil(distance / step));
    const invSteps = 1 / steps;
    for (let i = 1; i < steps; i++) {
      const t = i * invSteps;
      const x = start.x + dx * t;
      const y = start.y + dy * t;
      const z = start.z + dz * t;
      if (this.getBlock(x, y, z) !== 0) {
        return false;
      }
    }
    return true;
  }
}
