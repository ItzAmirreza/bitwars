import * as THREE from 'three';

// ── Constants ──

export const CHUNK = 16;

export const BlockType = {
  Air: 0,
  Concrete: 1,
  DarkConcrete: 2,
  Asphalt: 3,
  Rebar: 4,
  Brick: 5,
  Metal: 6,
  Rubble: 7,
  Dirt: 8,
  Sand: 9,
} as const;
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
  private mat: THREE.MeshPhongMaterial;

  constructor(sx: number, sy: number, sz: number) {
    this.sizeX = sx; this.sizeY = sy; this.sizeZ = sz;
    this.blocks = new Uint8Array(sx * sy * sz);
    this.cX = Math.ceil(sx / CHUNK);
    this.cY = Math.ceil(sy / CHUNK);
    this.cZ = Math.ceil(sz / CHUNK);
    const n = this.cX * this.cY * this.cZ;
    this.meshes = new Array(n).fill(null);
    this.dirty = new Array(n).fill(true);
    this.mat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      emissive: new THREE.Color(0x10182a),
      emissiveIntensity: 0.34,
      shininess: 6,
      specular: new THREE.Color(0x111418),
    });
  }

  // ── Server chunk loading ──

  /** RLE-decode a chunk data blob into a flat 16x16x16 array */
  static rleDecodeChunk(data: Uint8Array): Uint8Array {
    const output = new Uint8Array(CHUNK * CHUNK * CHUNK);
    let outIdx = 0;
    let i = 0;
    while (i + 1 < data.length && outIdx < output.length) {
      const val = data[i];
      const run = data[i + 1];
      for (let j = 0; j < run && outIdx < output.length; j++) {
        output[outIdx++] = val;
      }
      i += 2;
    }
    return output;
  }

  /** Load a 16x16x16 chunk from server data into the blocks array.
   *  cx/cy/cz are chunk coordinates (0-7, 0-2, 0-7). */
  loadChunk(cx: number, cy: number, cz: number, chunkBlocks: Uint8Array): void {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let ly = 0; ly < CHUNK; ly++) {
        for (let lx = 0; lx < CHUNK; lx++) {
          const gx = cx * CHUNK + lx;
          const gy = cy * CHUNK + ly;
          const gz = cz * CHUNK + lz;
          if (gx >= this.sizeX || gy >= this.sizeY || gz >= this.sizeZ) continue;
          const globalIdx = gx + gy * this.sizeX + gz * this.sizeX * this.sizeY;
          const localIdx = lx + ly * CHUNK + lz * CHUNK * CHUNK;
          this.blocks[globalIdx] = chunkBlocks[localIdx];
        }
      }
    }
    // Mark this chunk (and adjacent) dirty for mesh rebuild
    this.markDirty(cx, cy, cz);
    // Mark adjacent chunks dirty for boundary faces
    if (cx > 0) this.markDirty(cx - 1, cy, cz);
    if (cx < this.cX - 1) this.markDirty(cx + 1, cy, cz);
    if (cy > 0) this.markDirty(cx, cy - 1, cz);
    if (cy < this.cY - 1) this.markDirty(cx, cy + 1, cz);
    if (cz > 0) this.markDirty(cx, cy, cz - 1);
    if (cz < this.cZ - 1) this.markDirty(cx, cy, cz + 1);
  }

  /** Load all chunks from server WorldChunk rows */
  loadFromServer(chunks: Iterable<{ cx: number; cy: number; cz: number; data: Uint8Array }>): void {
    for (const chunk of chunks) {
      const decoded = VoxelWorld.rleDecodeChunk(chunk.data);
      this.loadChunk(chunk.cx, chunk.cy, chunk.cz, decoded);
    }
  }

  // ── Block access ──

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && x < this.sizeX && y >= 0 && y < this.sizeY && z >= 0 && z < this.sizeZ;
  }

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

  /** Highest solid block Y at (x,z) at or below footY. Returns -1 if none. */
  getGroundHeightBelow(x: number, footY: number, z: number): number {
    const bx = Math.floor(x), bz = Math.floor(z);
    if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) return -1;
    const startY = Math.min(Math.floor(footY), this.sizeY - 1);
    for (let y = startY; y >= 0; y--) {
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
          if (m) {
            m.castShadow = true;
            m.receiveShadow = true;
            scene.add(m);
          }
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

    // Fast getBlock closure for AO neighbor lookups
    const blocks = this.blocks;
    const sx = this.sizeX, sy = this.sizeY, sz = this.sizeZ;
    const gb = (x: number, y: number, z: number): number => {
      if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) return 0;
      return blocks[x + y * sx + z * sx * sy];
    };

    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        for (let z = z0; z < z1; z++) {
          const b = gb(x, y, z);
          if (b === 0) continue;
          c.setHex(BLOCK_COLORS[b] || 0x808080);

          // Subtle per-block color variation for gritty feel
          const variation = (hash2d(x * 7 + y, z * 13 + y) - 0.5) * 0.06;
          c.r = Math.max(0, Math.min(1, c.r + variation));
          c.g = Math.max(0, Math.min(1, c.g + variation));
          c.b = Math.max(0, Math.min(1, c.b + variation));

          if (gb(x + 1, y, z) === 0) addFace(pos, nrm, col, c, x + 1, y, z, 0, computeFaceAO(gb, x, y, z, 0));
          if (gb(x - 1, y, z) === 0) addFace(pos, nrm, col, c, x, y, z, 1, computeFaceAO(gb, x, y, z, 1));
          if (gb(x, y + 1, z) === 0) addFace(pos, nrm, col, c, x, y + 1, z, 2, computeFaceAO(gb, x, y, z, 2));
          if (gb(x, y - 1, z) === 0) addFace(pos, nrm, col, c, x, y, z, 3, computeFaceAO(gb, x, y, z, 3));
          if (gb(x, y, z + 1) === 0) addFace(pos, nrm, col, c, x, y, z + 1, 4, computeFaceAO(gb, x, y, z, 4));
          if (gb(x, y, z - 1) === 0) addFace(pos, nrm, col, c, x, y, z, 5, computeFaceAO(gb, x, y, z, 5));
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
    // Phase 1: base terrain — flat urban warzone
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        const h = this.heightAt(x, z);
        for (let y = 0; y <= h; y++) {
          let bt: number;
          if (y <= 1) bt = BlockType.DarkConcrete;
          else if (y < h - 1) bt = BlockType.Concrete;
          else bt = BlockType.Asphalt;
          this.setBlock(x, y, z, bt);
        }
      }
    }

    // Phase 2: roads
    this.buildRoads();

    // Phase 3: craters
    this.buildCraters();

    // Phase 4: structures
    this.placeStructures();

    // Phase 5: rubble piles
    this.buildRubblePiles();

    // Phase 6: barricades/cover
    this.buildBarricades();

    // Phase 7: vehicle husks
    this.buildVehicles();
  }

  heightAt(x: number, z: number): number {
    const nx = x / this.sizeX, nz = z / this.sizeZ;
    // Much flatter terrain
    let h = 4 + fbm(nx * 3 + 0.5, nz * 3 + 0.5) * 3;
    h += fbm(nx * 6 + 50, nz * 6 + 50) * 1.5;

    // Slight elevation near edges (rubble mounds)
    const edge = Math.min(x, z, this.sizeX - 1 - x, this.sizeZ - 1 - z) / 20;
    const ef = 1 - Math.min(1, edge);
    h += ef * ef * 4;

    // Flat spawn area
    const dx = x - this.sizeX / 2, dz = z - this.sizeZ / 2;
    const cd = Math.sqrt(dx * dx + dz * dz);
    if (cd < 18) h = lrp(5, h, sm(cd / 18));

    return Math.floor(Math.max(2, Math.min(h, 12)));
  }

  // ── Roads ──

  private buildRoads(): void {
    const roadPositions = [40, 64, 88]; // N-S and E-W roads
    const roadWidth = 3;

    for (const rx of roadPositions) {
      for (let z = 0; z < this.sizeZ; z++) {
        for (let w = -Math.floor(roadWidth / 2); w <= Math.floor(roadWidth / 2); w++) {
          const x = rx + w;
          if (x < 0 || x >= this.sizeX) continue;
          const h = this.heightAt(x, z);
          this.setBlock(x, h, z, BlockType.Asphalt);
          // Road markings (center line)
          if (w === 0 && z % 8 < 4) {
            this.setBlock(x, h, z, BlockType.Sand); // faded yellow marking
          }
        }
      }
    }

    for (const rz of roadPositions) {
      for (let x = 0; x < this.sizeX; x++) {
        for (let w = -Math.floor(roadWidth / 2); w <= Math.floor(roadWidth / 2); w++) {
          const z = rz + w;
          if (z < 0 || z >= this.sizeZ) continue;
          const h = this.heightAt(x, z);
          this.setBlock(x, h, z, BlockType.Asphalt);
          if (w === 0 && x % 8 < 4) {
            this.setBlock(x, h, z, BlockType.Sand);
          }
        }
      }
    }
  }

  // ── Craters ──

  private buildCraters(): void {
    const craters = [
      [25, 55, 5], [70, 30, 4], [45, 85, 6], [95, 60, 5],
      [55, 45, 3], [80, 95, 4], [30, 105, 5], [105, 40, 4],
      [60, 75, 6], [15, 80, 3], [90, 15, 4], [50, 110, 5],
    ];

    for (const [cx, cz, r] of craters) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) continue;

          const depth = Math.floor((1 - dist / r) * (r * 0.6));
          const surfaceH = this.heightAt(x, z);

          // Dig crater
          for (let y = surfaceH; y > Math.max(1, surfaceH - depth); y--) {
            this.setBlock(x, y, z, BlockType.Air);
          }

          // Crater floor
          const floorY = Math.max(1, surfaceH - depth);
          this.setBlock(x, floorY, z, dist < r * 0.6 ? BlockType.Dirt : BlockType.Rubble);

          // Rim: slight buildup
          if (dist > r * 0.7 && dist <= r) {
            this.setBlock(x, surfaceH + 1, z, BlockType.Rubble);
          }
        }
      }
    }
  }

  // ── Structures ──

  private placeStructures(): void {
    // Ruined buildings
    this.buildRuinedBuilding(20, 25, 8, 8, 3);
    this.buildRuinedBuilding(48, 55, 10, 8, 4);
    this.buildRuinedBuilding(75, 20, 7, 7, 2);
    this.buildRuinedBuilding(95, 50, 9, 6, 3);
    this.buildRuinedBuilding(35, 90, 8, 10, 4);
    this.buildRuinedBuilding(100, 85, 6, 8, 2);
    this.buildRuinedBuilding(15, 65, 7, 6, 3);
    this.buildRuinedBuilding(70, 100, 10, 10, 3);
    this.buildRuinedBuilding(55, 30, 6, 6, 2);
    this.buildRuinedBuilding(110, 110, 8, 7, 3);

    // Bombed towers
    this.buildBombedTower(28, 45, 14);
    this.buildBombedTower(85, 35, 12);
    this.buildBombedTower(42, 110, 16);
    this.buildBombedTower(105, 70, 10);
    this.buildBombedTower(18, 100, 13);

    // Central command post
    this.buildCommandPost(54, 54);
  }

  private buildRuinedBuilding(ox: number, oz: number, w: number, d: number, floors: number): void {
    const baseY = this.heightAt(ox, oz);
    const storyH = 4;
    const totalH = floors * storyH;

    for (let x = 0; x < w; x++) {
      for (let z = 0; z < d; z++) {
        for (let y = 0; y < totalH; y++) {
          const bx = ox + x, bz = oz + z, by = baseY + 1 + y;
          if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;

          const isWall = x === 0 || x === w - 1 || z === 0 || z === d - 1;
          const isFloor = y > 0 && y % storyH === 0;
          const isDoor = (x === Math.floor(w / 2) || x === Math.floor(w / 2) + 1) && z === 0 && y < 3;

          // Destruction: random holes in walls and floors
          const destructionChance = hash2d(bx * 17 + by, bz * 31 + by);

          if (isDoor) continue;

          if (isFloor && !isWall) {
            // Floor slab with holes
            if (destructionChance > 0.25) {
              this.setBlock(bx, by, bz, BlockType.Concrete);
            }
          } else if (isWall) {
            // Wall with damage holes (30% missing in upper floors)
            const dmgThreshold = y > storyH * 2 ? 0.30 : y > storyH ? 0.18 : 0.08;
            if (destructionChance > dmgThreshold) {
              this.setBlock(bx, by, bz, destructionChance > 0.85 ? BlockType.Brick : BlockType.Concrete);
            } else if (y > totalH - 3) {
              // Exposed rebar at damaged edges
              if (hash2d(bx * 3, bz * 5 + by) > 0.5) {
                this.setBlock(bx, by, bz, BlockType.Rebar);
              }
            }
          }
        }
      }
    }

    // Rubble around base
    for (let dx = -2; dx <= w + 1; dx++) {
      for (let dz = -2; dz <= d + 1; dz++) {
        const bx = ox + dx, bz = oz + dz;
        if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) continue;
        if (dx >= 0 && dx < w && dz >= 0 && dz < d) continue; // skip interior
        if (hash2d(bx * 19, bz * 23) < 0.35) {
          const by = this.heightAt(bx, bz) + 1;
          if (by < this.sizeY) {
            this.setBlock(bx, by, bz, BlockType.Rubble);
            if (hash2d(bx * 7, bz * 11) < 0.2 && by + 1 < this.sizeY) {
              this.setBlock(bx, by + 1, bz, BlockType.Rubble);
            }
          }
        }
      }
    }
  }

  private buildBombedTower(ox: number, oz: number, height: number): void {
    const baseY = this.heightAt(ox, oz);
    const tw = 5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < tw; x++) {
        for (let z = 0; z < tw; z++) {
          const bx = ox + x, bz = oz + z, by = baseY + 1 + y;
          if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;

          const isWall = x === 0 || x === tw - 1 || z === 0 || z === tw - 1;
          if (!isWall) continue;

          // Top section is jagged/destroyed
          if (y > height - 4) {
            const keep = hash2d(bx * 13 + y, bz * 7 + y);
            if (keep < 0.4) continue; // 40% destroyed at top
            this.setBlock(bx, by, bz, keep > 0.8 ? BlockType.Rebar : BlockType.Concrete);
          } else {
            // One side partially collapsed
            const collapseChance = (x === 0 && y > height / 2) ? 0.35 : 0.05;
            if (hash2d(bx * 11 + y, bz * 17) > collapseChance) {
              this.setBlock(bx, by, bz, BlockType.Concrete);
            }
          }
        }
      }
    }

    // Platform at bottom and mid
    for (let x = 0; x < tw; x++) {
      for (let z = 0; z < tw; z++) {
        const bx = ox + x, bz = oz + z;
        if (bx >= this.sizeX || bz >= this.sizeZ) continue;
        this.setBlock(bx, baseY + 1, bz, BlockType.DarkConcrete);
        if (baseY + 1 + Math.floor(height / 2) < this.sizeY) {
          this.setBlock(bx, baseY + 1 + Math.floor(height / 2), bz, BlockType.Concrete);
        }
      }
    }
  }

  private buildCommandPost(ox: number, oz: number): void {
    const baseY = this.heightAt(ox + 10, oz + 10);
    const w = 20, d = 20, h = 6;

    // Thick walls (2 blocks)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
          const bx = ox + x, bz = oz + z, by = baseY + 1 + y;
          if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;

          const outerWall = x === 0 || x === w - 1 || z === 0 || z === d - 1;
          const innerWall = x === 1 || x === w - 2 || z === 1 || z === d - 2;
          const isRoof = y === h - 1;
          const isFloor = y === 0;

          // Gates
          const isGate = (x >= 8 && x <= 11) && z === 0 && y < 4;
          const isBackGate = (x >= 8 && x <= 11) && z === d - 1 && y < 4;
          if (isGate || isBackGate) continue;

          if (isFloor) {
            this.setBlock(bx, by, bz, BlockType.DarkConcrete);
          } else if (isRoof && x > 1 && x < w - 2 && z > 1 && z < d - 2) {
            // Partially destroyed roof
            if (hash2d(bx * 11, bz * 13) > 0.3) {
              this.setBlock(bx, by, bz, BlockType.Concrete);
            }
          } else if (outerWall) {
            const dmg = hash2d(bx * 7 + y, bz * 11);
            if (dmg > 0.12) {
              this.setBlock(bx, by, bz, BlockType.Concrete);
            }
          } else if (innerWall && (x <= 1 || x >= w - 2 || z <= 1 || z >= d - 2)) {
            this.setBlock(bx, by, bz, BlockType.Concrete);
          }
        }
      }
    }

    // Corner watchtower positions
    const corners = [[0, 0], [w - 4, 0], [0, d - 4], [w - 4, d - 4]];
    for (const [cx, cz] of corners) {
      for (let y = 0; y < h + 3; y++) {
        for (let x = 0; x < 4; x++) {
          for (let z = 0; z < 4; z++) {
            const bx = ox + cx + x, bz = oz + cz + z, by = baseY + 1 + y;
            if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;
            const isEdge = x === 0 || x === 3 || z === 0 || z === 3;
            if (isEdge) {
              this.setBlock(bx, by, bz, BlockType.DarkConcrete);
            }
            // Platform at top
            if (y === h + 2) {
              this.setBlock(bx, by, bz, BlockType.Concrete);
            }
          }
        }
      }
    }

    // Sandbag perimeter outside
    for (let x = -2; x <= w + 1; x++) {
      for (let z = -2; z <= d + 1; z++) {
        if (x >= 0 && x < w && z >= 0 && z < d) continue;
        const bx = ox + x, bz = oz + z;
        if (bx < 0 || bx >= this.sizeX || bz < 0 || bz >= this.sizeZ) continue;
        if (hash2d(bx * 23, bz * 29) < 0.3) {
          const by = this.heightAt(bx, bz) + 1;
          if (by < this.sizeY) {
            this.setBlock(bx, by, bz, BlockType.Sand);
            if (hash2d(bx * 3, bz * 5) < 0.5 && by + 1 < this.sizeY) {
              this.setBlock(bx, by + 1, bz, BlockType.Sand);
            }
          }
        }
      }
    }

    // Interior dividing walls
    for (let y = 0; y < 3; y++) {
      for (let z = 3; z < d - 3; z++) {
        const bx = ox + 10, bz = oz + z, by = baseY + 2 + y;
        if (bx < this.sizeX && bz < this.sizeZ && by < this.sizeY) {
          if (z !== 9 && z !== 10) { // door gap
            this.setBlock(bx, by, bz, BlockType.Concrete);
          }
        }
      }
    }
  }

  // ── Rubble piles ──

  private buildRubblePiles(): void {
    const piles = [
      [12, 35], [38, 15], [72, 45], [55, 70], [95, 25],
      [25, 80], [80, 60], [45, 105], [110, 45], [65, 15],
      [32, 60], [90, 100], [50, 50], [15, 115], [105, 95],
      [42, 42], [78, 78], [60, 95], [20, 50],
    ];

    for (const [cx, cz] of piles) {
      if (cx >= this.sizeX || cz >= this.sizeZ) continue;
      const radius = 2 + Math.floor(hash2d(cx, cz) * 3);
      const height = 2 + Math.floor(hash2d(cx * 3, cz * 7) * 3);

      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > radius) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) continue;

          const py = Math.floor(height * (1 - dist / radius));
          const baseH = this.heightAt(x, z);

          for (let y = 1; y <= py; y++) {
            const by = baseH + y;
            if (by >= this.sizeY) break;
            const r = hash2d(x * 11 + y, z * 17);
            const bt = r < 0.4 ? BlockType.Rubble
              : r < 0.6 ? BlockType.Concrete
              : r < 0.75 ? BlockType.Rebar
              : r < 0.9 ? BlockType.Brick
              : BlockType.DarkConcrete;
            this.setBlock(x, by, z, bt);
          }
        }
      }
    }
  }

  // ── Barricades/cover ──

  private buildBarricades(): void {
    const barricades: [number, number, number, number, boolean][] = [
      // [x, z, length, height, isNS]
      [30, 35, 5, 2, false],
      [75, 55, 4, 3, true],
      [50, 25, 6, 2, false],
      [95, 75, 4, 2, true],
      [20, 90, 5, 3, false],
      [65, 65, 3, 2, true],
      [110, 55, 4, 2, false],
      [40, 75, 5, 2, true],
      [85, 105, 6, 3, false],
      [55, 15, 4, 2, true],
      [100, 30, 3, 2, false],
      [25, 55, 5, 2, true],
    ];

    for (const [ox, oz, len, h, isNS] of barricades) {
      for (let i = 0; i < len; i++) {
        const x = isNS ? ox : ox + i;
        const z = isNS ? oz + i : oz;
        if (x >= this.sizeX || z >= this.sizeZ) continue;
        const baseH = this.heightAt(x, z);

        for (let y = 1; y <= h; y++) {
          const by = baseH + y;
          if (by >= this.sizeY) break;
          const isSandbag = hash2d(x * 5 + y, z * 9) > 0.4;
          this.setBlock(x, by, z, isSandbag ? BlockType.Sand : BlockType.Concrete);
        }
      }
    }
  }

  // ── Vehicle husks ──

  private buildVehicles(): void {
    const vehicles: [number, number, number, number, number, boolean][] = [
      // [x, z, w, h, d, flipped]
      [42, 40, 4, 2, 2, false],  // car on road
      [63, 42, 4, 2, 2, false],  // car near intersection
      [88, 62, 6, 3, 3, false],  // truck
      [39, 88, 4, 2, 2, true],   // flipped car
      [86, 90, 4, 2, 2, false],  // car
      [66, 88, 6, 3, 3, false],  // truck
      [40, 63, 4, 2, 2, false],  // car at intersection
      [110, 65, 4, 2, 2, true],  // flipped
    ];

    for (const [ox, oz, vw, vh, vd, flipped] of vehicles) {
      const baseH = this.heightAt(ox, oz);

      if (flipped) {
        // Flipped on side
        for (let x = 0; x < vw; x++) {
          for (let y = 0; y < vd; y++) {
            for (let z = 0; z < vh; z++) {
              const bx = ox + x, bz = oz + z, by = baseH + 1 + y;
              if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;
              const isShell = x === 0 || x === vw - 1 || y === 0 || y === vd - 1 || z === 0 || z === vh - 1;
              if (isShell) this.setBlock(bx, by, bz, BlockType.Metal);
            }
          }
        }
      } else {
        for (let x = 0; x < vw; x++) {
          for (let y = 0; y < vh; y++) {
            for (let z = 0; z < vd; z++) {
              const bx = ox + x, bz = oz + z, by = baseH + 1 + y;
              if (bx >= this.sizeX || bz >= this.sizeZ || by >= this.sizeY) continue;
              const isShell = x === 0 || x === vw - 1 || y === 0 || y === vh - 1 || z === 0 || z === vd - 1;
              if (isShell) this.setBlock(bx, by, bz, BlockType.Metal);
            }
          }
        }
      }
    }
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

// ── Per-vertex Ambient Occlusion ──

// Tangent axes per face: [t1x, t1y, t1z, t2x, t2y, t2z]
const AO_TANGENTS: number[][] = [
  [0,1,0, 0,0,1],  // face 0 (+X)
  [0,1,0, 0,0,1],  // face 1 (-X)
  [1,0,0, 0,0,1],  // face 2 (+Y)
  [1,0,0, 0,0,1],  // face 3 (-Y)
  [1,0,0, 0,1,0],  // face 4 (+Z)
  [1,0,0, 0,1,0],  // face 5 (-Z)
];

// Corner signs per face: 4 corners × [s1 for t1, s2 for t2]
const AO_SIGNS: number[][][] = [
  [[-1,-1],[1,-1],[1,1],[-1,1]],     // face 0 (+X)
  [[-1,1],[1,1],[1,-1],[-1,-1]],     // face 1 (-X)
  [[-1,-1],[-1,1],[1,1],[1,-1]],     // face 2 (+Y)
  [[1,-1],[1,1],[-1,1],[-1,-1]],     // face 3 (-Y)
  [[-1,-1],[1,-1],[1,1],[-1,1]],     // face 4 (+Z)
  [[-1,1],[1,1],[1,-1],[-1,-1]],     // face 5 (-Z)
];

// Brightness per AO level: 0=fully occluded, 3=no occlusion
const AO_CURVE = [0.45, 0.68, 0.85, 1.0];

function vertexAO(s1: boolean, s2: boolean, c: boolean): number {
  if (s1 && s2) return 0;
  return 3 - (+s1) - (+s2) - (+c);
}

function computeFaceAO(
  gb: (x: number, y: number, z: number) => number,
  bx: number, by: number, bz: number, face: number,
): [number, number, number, number] {
  const n = FACE_NORMALS[face];
  const t = AO_TANGENTS[face];
  const signs = AO_SIGNS[face];
  const nx = bx + n[0], ny = by + n[1], nz = bz + n[2];
  const ao: [number, number, number, number] = [3, 3, 3, 3];
  for (let c = 0; c < 4; c++) {
    const s1 = signs[c][0], s2 = signs[c][1];
    const side1 = gb(nx + s1*t[0], ny + s1*t[1], nz + s1*t[2]) !== 0;
    const side2 = gb(nx + s2*t[3], ny + s2*t[4], nz + s2*t[5]) !== 0;
    const corner = gb(nx + s1*t[0] + s2*t[3], ny + s1*t[1] + s2*t[4], nz + s1*t[2] + s2*t[5]) !== 0;
    ao[c] = vertexAO(side1, side2, corner);
  }
  return ao;
}

function addFace(
  pos: number[], nrm: number[], col: number[],
  color: THREE.Color, x: number, y: number, z: number, face: number,
  ao: [number, number, number, number],
): void {
  const verts = FACE_VERTS[face];
  const n = FACE_NORMALS[face];
  const s = FACE_SHADING[face];
  const corners = [verts[0], verts[1], verts[2], verts[5]];
  const aoMul = [AO_CURVE[ao[0]] * s, AO_CURVE[ao[1]] * s, AO_CURVE[ao[2]] * s, AO_CURVE[ao[3]] * s];
  // Flip quad diagonal when ao[0]+ao[2] < ao[1]+ao[3] for correct AO interpolation
  const flip = ao[0] + ao[2] < ao[1] + ao[3];
  const idx = flip ? [0,1,3, 1,2,3] : [0,1,2, 0,2,3];
  for (let i = 0; i < 6; i++) {
    const ci = idx[i];
    const v = corners[ci];
    const m = aoMul[ci];
    pos.push(x + v[0], y + v[1], z + v[2]);
    nrm.push(n[0], n[1], n[2]);
    col.push(color.r * m, color.g * m, color.b * m);
  }
}
