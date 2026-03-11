import * as THREE from 'three';

// ── Constants ──

export const CHUNK = 16;

export const BlockType = {
  Air: 0, Dirt: 1, Stone: 2, Grass: 3, Sand: 4, Wood: 5, Brick: 6, Leaves: 7,
} as const;
export type BlockType = (typeof BlockType)[keyof typeof BlockType];

export const BLOCK_COLORS: Record<number, number> = {
  [BlockType.Dirt]: 0x8b6914,
  [BlockType.Stone]: 0x808080,
  [BlockType.Grass]: 0x4a8c2a,
  [BlockType.Sand]: 0xc2b280,
  [BlockType.Wood]: 0x6b4226,
  [BlockType.Brick]: 0x8b4513,
  [BlockType.Leaves]: 0x2d6b1e,
};

// ── Noise helpers ──

function hash2d(x: number, z: number): number {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = ((h ^ (h >> 13)) * 1274126177) | 0;
  return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
}

function sm(t: number): number { return t * t * (3 - 2 * t); }
function lrp(a: number, b: number, t: number): number { return a + (b - a) * t; }

function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = sm(x - ix), fz = sm(z - iz);
  return lrp(
    lrp(hash2d(ix, iz), hash2d(ix + 1, iz), fx),
    lrp(hash2d(ix, iz + 1), hash2d(ix + 1, iz + 1), fx),
    fz,
  );
}

function fbm(x: number, z: number, oct = 4): number {
  let v = 0, a = 1, m = 0;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x, z) * a;
    m += a; a *= 0.5; x *= 2; z *= 2;
  }
  return v / m;
}

// ── VoxelWorld ──

export class VoxelWorld {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  blocks: Uint8Array;

  // Chunk bookkeeping
  private cX: number; private cY: number; private cZ: number;
  private meshes: (THREE.Mesh | null)[];
  private dirty: boolean[];
  private mat: THREE.MeshLambertMaterial;

  constructor(sx: number, sy: number, sz: number) {
    this.sizeX = sx; this.sizeY = sy; this.sizeZ = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.cX = Math.ceil(sx / CHUNK);
    this.cY = Math.ceil(sy / CHUNK);
    this.cZ = Math.ceil(sz / CHUNK);
    const n = this.cX * this.cY * this.cZ;
    this.meshes = new Array(n).fill(null);
    this.dirty = new Array(n).fill(true);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  // ── Block access ──

  getBlock(x: number, y: number, z: number): number {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return 0;
    return this.blocks[x + y * this.sizeX + z * this.sizeX * this.sizeY];
  }

  setBlock(x: number, y: number, z: number, t: number): void {
    if (x < 0 || x >= this.sizeX || y < 0 || y >= this.sizeY || z < 0 || z >= this.sizeZ) return;
    this.blocks[x + y * this.sizeX + z * this.sizeX * this.sizeY] = t;
    this.markDirtyAt(x, y, z);
  }

  /** Highest solid block Y at (x,z). Returns -1 if column is empty. */
  getHighestBlock(x: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    for (let y = this.sizeY - 1; y >= 0; y--) {
      if (this.getBlock(bx, y, bz) !== 0) return y;
    }
    return -1;
  }

  // ── Chunk system ──

  private chunkIdx(cx: number, cy: number, cz: number): number {
    return cx + cy * this.cX + cz * this.cX * this.cY;
  }

  private markDirtyAt(bx: number, by: number, bz: number): void {
    const cx = Math.floor(bx / CHUNK), cy = Math.floor(by / CHUNK), cz = Math.floor(bz / CHUNK);
    this.markDirty(cx, cy, cz);
    const lx = bx % CHUNK, ly = by % CHUNK, lz = bz % CHUNK;
    if (lx === 0 && cx > 0) this.markDirty(cx - 1, cy, cz);
    if (lx === CHUNK - 1 && cx < this.cX - 1) this.markDirty(cx + 1, cy, cz);
    if (ly === 0 && cy > 0) this.markDirty(cx, cy - 1, cz);
    if (ly === CHUNK - 1 && cy < this.cY - 1) this.markDirty(cx, cy + 1, cz);
    if (lz === 0 && cz > 0) this.markDirty(cx, cy, cz - 1);
    if (lz === CHUNK - 1 && cz < this.cZ - 1) this.markDirty(cx, cy, cz + 1);
  }

  private markDirty(cx: number, cy: number, cz: number): void {
    if (cx < 0 || cx >= this.cX || cy < 0 || cy >= this.cY || cz < 0 || cz >= this.cZ) return;
    this.dirty[this.chunkIdx(cx, cy, cz)] = true;
  }

  /** Rebuild only the chunks whose blocks changed. */
  rebuildDirtyChunks(scene: THREE.Scene): void {
    for (let cz = 0; cz < this.cZ; cz++) {
      for (let cy = 0; cy < this.cY; cy++) {
        for (let cx = 0; cx < this.cX; cx++) {
          const i = this.chunkIdx(cx, cy, cz);
          if (!this.dirty[i]) continue;
          // Remove old
          const old = this.meshes[i];
          if (old) { scene.remove(old); old.geometry.dispose(); }
          // Build new
          const m = this.buildChunkMesh(cx, cy, cz);
          this.meshes[i] = m;
          if (m) scene.add(m);
          this.dirty[i] = false;
        }
      }
    }
  }

  private buildChunkMesh(cx: number, cy: number, cz: number): THREE.Mesh | null {
    const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
    const x1 = Math.min(x0 + CHUNK, this.sizeX);
    const y1 = Math.min(y0 + CHUNK, this.sizeY);
    const z1 = Math.min(z0 + CHUNK, this.sizeZ);

    const pos: number[] = [], nrm: number[] = [], col: number[] = [];
    const c = new THREE.Color();

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const b = this.getBlock(x, y, z);
          if (b === 0) continue;
          c.setHex(BLOCK_COLORS[b] || 0xffffff);
          if (this.getBlock(x + 1, y, z) === 0) addFace(pos, nrm, col, c, x + 1, y, z, 0);
          if (this.getBlock(x - 1, y, z) === 0) addFace(pos, nrm, col, c, x, y, z, 1);
          if (this.getBlock(x, y + 1, z) === 0) {
            const tc = b === BlockType.Grass ? new THREE.Color(0x5ca03a)
                     : b === BlockType.Leaves ? new THREE.Color(0x3a8a28) : c;
            addFace(pos, nrm, col, tc, x, y + 1, z, 2);
          }
          if (this.getBlock(x, y - 1, z) === 0) addFace(pos, nrm, col, c, x, y, z, 3);
          if (this.getBlock(x, y, z + 1) === 0) addFace(pos, nrm, col, c, x, y, z + 1, 4);
          if (this.getBlock(x, y, z - 1) === 0) addFace(pos, nrm, col, c, x, y, z, 5);
        }
      }
    }

    if (pos.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(geo, this.mat);
  }

  // ── Terrain generation ──

  generateTerrain(): void {
    // Phase 1: heightmap
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        const h = this.heightAt(x, z);
        for (let y = 0; y <= h; y++) {
          let bt: number;
          if (y === 0) bt = BlockType.Stone;
          else if (y < h - 3) bt = BlockType.Stone;
          else if (y < h) bt = BlockType.Dirt;
          else bt = h <= 5 ? BlockType.Sand : BlockType.Grass;
          this.setBlock(x, y, z, bt);
        }
      }
    }
    // Phase 2: trees
    for (let x = 3; x < this.sizeX - 3; x++) {
      for (let z = 3; z < this.sizeZ - 3; z++) {
        if (this.getBlock(x, this.heightAt(x, z), z) !== BlockType.Grass) continue;
        if (hash2d(x * 31 + 17, z * 17 + 31) < 0.025) {
          this.buildTree(x, this.heightAt(x, z), z);
        }
      }
    }
    // Phase 3: structures
    this.placeStructures();
  }

  heightAt(x: number, z: number): number {
    const nx = x / this.sizeX, nz = z / this.sizeZ;
    let h = fbm(nx * 4 + 0.5, nz * 4 + 0.5) * 10;
    h += fbm(nx * 2 + 100, nz * 2 + 100) * 6;
    // Mountains near edges
    const edge = Math.min(x, z, this.sizeX - 1 - x, this.sizeZ - 1 - z) / 30;
    const ef = 1 - Math.min(1, edge);
    h += ef * ef * fbm(nx * 1.5 + 200, nz * 1.5 + 200) * 16;
    // Flat spawn area
    const dx = x - this.sizeX / 2, dz = z - this.sizeZ / 2;
    const cd = Math.sqrt(dx * dx + dz * dz);
    if (cd < 22) h = lrp(7, h, sm(cd / 22));
    return Math.floor(Math.max(2, Math.min(h + 4, this.sizeY - 10)));
  }

  // ── Structure builders ──

  private buildTree(x: number, gy: number, z: number): void {
    const th = 4 + Math.floor(hash2d(x * 13 + 7, z * 7 + 13) * 3);
    for (let y = 1; y <= th; y++) this.setBlock(x, gy + y, z, BlockType.Wood);
    const cy = gy + th;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -1; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0 && dy <= 0) continue;
          if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy) > 3) continue;
          if (hash2d((x + dx) * 7 + dy, (z + dz) * 11) < 0.15) continue;
          const bx = x + dx, by = cy + dy, bz = z + dz;
          if (this.getBlock(bx, by, bz) === 0) this.setBlock(bx, by, bz, BlockType.Leaves);
        }
      }
    }
  }

  private buildHouse(ox: number, oy: number, oz: number, w = 5, d = 5, h = 4): void {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          const wall = x === 0 || x === w - 1 || z === 0 || z === d - 1;
          const roof = y === h - 1;
          const door = x === Math.floor(w / 2) && z === 0 && y < 2;
          if (door) continue;
          if (roof) this.setBlock(ox + x, oy + y, oz + z, BlockType.Wood);
          else if (wall) this.setBlock(ox + x, oy + y, oz + z, BlockType.Brick);
        }
      }
    }
  }

  private buildTower(ox: number, oy: number, oz: number, h = 10): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 4; x++) {
        for (let z = 0; z < 4; z++) {
          const wall = x === 0 || x === 3 || z === 0 || z === 3;
          if (wall) this.setBlock(ox + x, oy + y, oz + z, BlockType.Stone);
        }
      }
    }
    // Platform top
    for (let x = -1; x <= 4; x++) {
      for (let z = -1; z <= 4; z++) {
        this.setBlock(ox + x, oy + h, oz + z, BlockType.Stone);
      }
    }
    // Battlements
    for (let x = -1; x <= 4; x++) {
      for (let z = -1; z <= 4; z++) {
        const edge = x === -1 || x === 4 || z === -1 || z === 4;
        if (edge && (x + z) % 2 === 0) this.setBlock(ox + x, oy + h + 1, oz + z, BlockType.Stone);
      }
    }
  }

  private buildFortress(ox: number, oy: number, oz: number): void {
    const w = 17, d = 17, h = 5;
    // Walls
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < h; j++) {
        this.setBlock(ox + i, oy + j, oz, BlockType.Brick);
        this.setBlock(ox + i, oy + j, oz + d - 1, BlockType.Brick);
        this.setBlock(ox, oy + j, oz + i, BlockType.Brick);
        this.setBlock(ox + w - 1, oy + j, oz + i, BlockType.Brick);
      }
    }
    // Corner towers
    const corners = [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]];
    for (const [cx, cz] of corners) {
      for (let j = 0; j < h + 3; j++) {
        this.setBlock(ox + cx, oy + j, oz + cz, BlockType.Stone);
        if (cx > 0) this.setBlock(ox + cx - 1, oy + j, oz + cz, BlockType.Stone);
        else this.setBlock(ox + cx + 1, oy + j, oz + cz, BlockType.Stone);
        if (cz > 0) this.setBlock(ox + cx, oy + j, oz + cz - 1, BlockType.Stone);
        else this.setBlock(ox + cx, oy + j, oz + cz + 1, BlockType.Stone);
      }
    }
    // Gate
    for (let j = 0; j < 3; j++) {
      this.setBlock(ox + 8, oy + j, oz, BlockType.Air);
      this.setBlock(ox + 9, oy + j, oz, BlockType.Air);
    }
    // Floor
    for (let i = 1; i < w - 1; i++) {
      for (let k = 1; k < d - 1; k++) {
        if (this.getBlock(ox + i, oy - 1, oz + k) === BlockType.Air) {
          this.setBlock(ox + i, oy - 1, oz + k, BlockType.Stone);
        }
      }
    }
  }

  private buildWall(x1: number, y: number, z1: number, x2: number, z2: number, h = 4): void {
    const dx = Math.sign(x2 - x1), dz = Math.sign(z2 - z1);
    const len = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
    for (let i = 0; i <= len; i++) {
      const bx = x1 + dx * i, bz = z1 + dz * i;
      for (let j = 0; j < h; j++) {
        this.setBlock(bx, y + j, bz, BlockType.Brick);
      }
    }
  }

  private placeStructures(): void {
    const hAt = (x: number, z: number) => this.heightAt(x, z);
    // Houses
    const houses = [[30, 40], [90, 30], [40, 100], [100, 90], [70, 50], [55, 80], [85, 70]];
    for (const [x, z] of houses) {
      if (x < this.sizeX && z < this.sizeZ) this.buildHouse(x, hAt(x, z) + 1, z);
    }
    // Towers
    const towers = [[20, 20], [110, 110], [25, 100], [105, 20], [60, 115]];
    for (const [x, z] of towers) {
      if (x + 4 < this.sizeX && z + 4 < this.sizeZ) this.buildTower(x, hAt(x, z) + 1, z, 8 + Math.floor(hash2d(x, z) * 4));
    }
    // Fortress
    this.buildFortress(78, hAt(85, 85) + 1, 78);
    // Walls
    this.buildWall(48, hAt(48, 22) + 1, 22, 68, 22, 4);
    this.buildWall(22, hAt(22, 48) + 1, 48, 22, 68, 4);
  }

  // ── Cleanup ──

  dispose(scene: THREE.Scene): void {
    for (const m of this.meshes) {
      if (m) { scene.remove(m); m.geometry.dispose(); }
    }
    this.mat.dispose();
  }
}

// ── Face geometry data ──

const FACE_SHADING = [0.85, 0.85, 1.0, 0.7, 0.9, 0.9];
const FACE_NORMALS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const FACE_VERTS = [
  [[0,0,0],[0,1,0],[0,1,1],[0,0,0],[0,1,1],[0,0,1]],  // +X
  [[0,0,1],[0,1,1],[0,1,0],[0,0,1],[0,1,0],[0,0,0]],  // -X
  [[0,0,0],[0,0,1],[1,0,1],[0,0,0],[1,0,1],[1,0,0]],  // +Y
  [[1,0,0],[1,0,1],[0,0,1],[1,0,0],[0,0,1],[0,0,0]],  // -Y
  [[0,0,0],[1,0,0],[1,1,0],[0,0,0],[1,1,0],[0,1,0]],  // +Z
  [[0,1,0],[1,1,0],[1,0,0],[0,1,0],[1,0,0],[0,0,0]],  // -Z
];

function addFace(
  pos: number[], nrm: number[], col: number[],
  color: THREE.Color, x: number, y: number, z: number, face: number,
): void {
  const verts = FACE_VERTS[face];
  const n = FACE_NORMALS[face];
  const s = FACE_SHADING[face];
  const r = color.r * s, g = color.g * s, b = color.b * s;
  for (let i = 0; i < 6; i++) {
    const v = verts[i];
    pos.push(x + v[0], y + v[1], z + v[2]);
    nrm.push(n[0], n[1], n[2]);
    col.push(r, g, b);
  }
}
