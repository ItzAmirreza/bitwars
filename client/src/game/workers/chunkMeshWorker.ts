import { buildChunkMeshData } from '../chunkMeshing';
import type { ChunkMeshWorkerRequest, ChunkMeshWorkerResponse } from '../chunkMeshingWorkerTypes';

self.onmessage = (event: MessageEvent<ChunkMeshWorkerRequest>) => {
  const { requestId, input } = event.data;
  const result = buildChunkMeshData(input);

  const response: ChunkMeshWorkerResponse = {
    requestId,
    position: result.position,
    normal: result.normal,
    color: result.color,
  };

  (self as unknown as Worker).postMessage(response, [
    result.position.buffer,
    result.normal.buffer,
    result.color.buffer,
  ] as Transferable[]);
};
