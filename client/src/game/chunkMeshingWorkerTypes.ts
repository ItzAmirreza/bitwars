import type { ChunkMeshBuildInput, ChunkMeshData } from './chunkMeshing';

export interface ChunkMeshWorkerRequest {
  requestId: number;
  input: ChunkMeshBuildInput;
}

export interface ChunkMeshWorkerResponse {
  requestId: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  light: Float32Array;
}

export interface PendingMeshJob {
  chunkId: number;
  revision: number;
}

export interface CompletedMeshJob {
  chunkId: number;
  revision: number;
  mesh: ChunkMeshData;
}
