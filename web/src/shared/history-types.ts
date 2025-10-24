/**
 * Shared types for terminal history bootstrap payloads.
 *
 * These payloads are emitted by the server for both SSE and WebSocket clients
 * to provide a reversed chronological slice of recent terminal output.
 */
export interface HistoryChunkPayload {
  type: 'history-chunk';
  sessionId?: string;
  hasMore?: boolean;
  totalEvents?: number;
  totalOutputEvents?: number;
  chunkEventCount?: number;
  chunkOutputEvents?: number;
  chunkStartOffset?: number | null;
  previousOffset?: number | null;
  nextOffset?: number | null;
  initialTailLines?: number | null;
  mode?: string;
  events?: unknown[];
}

export interface CachedHistoryChunk {
  sessionId: string;
  payload: HistoryChunkPayload;
  updatedAt: number;
}
