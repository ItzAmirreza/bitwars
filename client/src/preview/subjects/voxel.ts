/**
 * Voxel subject — synthetic 16³ chunks pushed through the real mesher and the
 * real chunk material.
 *
 * The point of the fixtures is to isolate what each rendering feature does:
 * `flat` has no concave corners at all, so per-vertex AO contributes nothing and
 * whatever legibility you see comes purely from the shader's seam pass. `pit`
 * and `steps` are the opposite — heavy occlusion, so they show AO doing its job.
 * Judge a lighting change against both before believing it.
 */

import * as THREE from 'three';
import { buildChunkMeshData } from '../../game/chunkMeshing';
import { createChunkMaterial, CHUNK, BlockType } from '../../game/VoxelWorld';
import type { PreviewSubject, PreviewVariant } from './types';

type Fill = (x: number, y: number, z: number) => number;

const FIXTURES: Record<string, { label: string; fill: Fill }> = {
  flat: {
    label: 'flat plane · seams only, zero AO',
    fill: (_x, y) => (y < 2 ? BlockType.Asphalt : BlockType.Air),
  },
  pit: {
    label: 'pit · concave corners, heavy AO',
    fill: (x, y, z) => {
      if (y >= 6) return BlockType.Air;
      const inHole = x > 4 && x < 11 && z > 4 && z < 11 && y > 1;
      return inHole ? BlockType.Air : BlockType.Concrete;
    },
  },
  steps: {
    label: 'steps · stacked edges',
    fill: (_x, y, z) => {
      if (z < 2) return y < 2 ? BlockType.DarkConcrete : BlockType.Air;
      const stepHeight = Math.floor((z - 2) / 2) + 1;
      return y < stepHeight ? BlockType.Concrete : BlockType.Air;
    },
  },
  tower: {
    label: 'tower · silhouette + material mix',
    fill: (x, y, z) => {
      const dx = x - 8, dz = z - 8;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) return y < 1 ? BlockType.Grass : BlockType.Air;
      const shell = Math.abs(dx) === 4 || Math.abs(dz) === 4;
      if (!shell) return y < 1 ? BlockType.Concrete : BlockType.Air;
      // Punch windows so the silhouette is not a solid slab.
      if (y > 3 && y < 7 && (x % 3 === 0 || z % 3 === 0)) return BlockType.Air;
      return y % 5 === 4 ? BlockType.Brick : BlockType.Concrete;
    },
  },
  palette: {
    label: 'palette · every block type',
    fill: (x, y, z) => {
      if (y >= 4) return BlockType.Air;
      // One 4×4 pad per block type, laid out across the chunk floor.
      const cell = Math.floor(x / 4) + Math.floor(z / 4) * 4;
      const types = [
        BlockType.Concrete, BlockType.DarkConcrete, BlockType.Asphalt, BlockType.Rebar,
        BlockType.Brick, BlockType.Metal, BlockType.Rubble, BlockType.Dirt,
        BlockType.Sand, BlockType.Grass, BlockType.Wood, BlockType.Stone,
        BlockType.Snow, BlockType.Lantern, BlockType.Bedrock, BlockType.Concrete,
      ];
      return y < 3 ? (types[cell] ?? BlockType.Concrete) : BlockType.Air;
    },
  },
};

function buildFixture(fill: Fill): THREE.Mesh {
  const data = new Uint8Array(CHUNK * CHUNK * CHUNK);
  for (let z = 0; z < CHUNK; z++) {
    for (let y = 0; y < CHUNK; y++) {
      for (let x = 0; x < CHUNK; x++) {
        data[x + y * CHUNK + z * CHUNK * CHUNK] = fill(x, y, z);
      }
    }
  }

  const mesh = buildChunkMeshData({ cx: 0, cy: 0, cz: 0, chunkData: data, neighbors: [] });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(mesh.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(mesh.normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(mesh.color, 3));
  geo.computeBoundingSphere();

  const obj = new THREE.Mesh(geo, createChunkMaterial());
  obj.castShadow = true;
  obj.receiveShadow = true;
  return obj;
}

export const voxelSubject: PreviewSubject = {
  id: 'voxel',
  description: 'Synthetic voxel fixtures through the real mesher and chunk shader',
  defaultView: 'threequarter',
  ground: false,
  listVariants(): PreviewVariant[] {
    return Object.entries(FIXTURES).map(([id, f]) => ({ id, label: f.label }));
  },
  build(variantId) {
    const fixture = FIXTURES[variantId];
    if (!fixture) throw new Error(`unknown voxel fixture "${variantId}"`);
    return buildFixture(fixture.fill);
  },
};
