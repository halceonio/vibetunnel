import type { HistoryChunkPayload } from '../../shared/history-types.js';
import type { BufferSnapshot } from '../services/terminal-manager.js';

export type WorkerTaskType = 'encodeSnapshot' | 'buildHistoryChunk';

export interface EncodeSnapshotTaskPayload {
  snapshot: BufferSnapshot;
  previousSnapshot: BufferSnapshot | null;
}

export interface EncodeSnapshotTaskResult {
  buffer: ArrayBufferLike;
  byteOffset: number;
  byteLength: number;
  usedDiff: boolean;
}

export interface HistoryChunkTaskPayload {
  sessionId: string;
  events: unknown[]; // AsciinemaEvent[]
  eventOffsets: number[];
  baseStartIndex: number;
  sendStartIndex: number;
  startOffset: number;
  fileOffset: number;
  initialTailLines: number;
  hasMoreHistory: boolean;
  totalEvents: number;
  totalOutputEvents: number;
}

export interface HistoryChunkTaskResult {
  payload: HistoryChunkPayload | null;
  chunkOutputEvents: number;
  exitEvent: unknown | null; // AsciinemaExitEvent
}

export interface WorkerTaskMessage {
  id: number;
  type: WorkerTaskType;
  payload: EncodeSnapshotTaskPayload | HistoryChunkTaskPayload;
}

export interface WorkerTaskResponse {
  id: number;
  result?: EncodeSnapshotTaskResult | HistoryChunkTaskResult;
  error?: string;
}
