import type {
  HistoryChunkTaskPayload,
  HistoryChunkTaskResult,
} from '../types.js';
import type { HistoryChunkPayload } from '../../../shared/history-types.js';

type AsciinemaOutputEvent = [number, 'o', string];
type AsciinemaResizeEvent = [number, 'r', string];
type AsciinemaExitEvent = ['exit', number, string];
type AsciinemaEvent =
  | AsciinemaOutputEvent
  | AsciinemaResizeEvent
  | AsciinemaExitEvent
  | [number, 'i', string];

const isOutputEvent = (event: AsciinemaEvent): event is AsciinemaOutputEvent =>
  Array.isArray(event) && event.length === 3 && event[1] === 'o';

const isResizeEvent = (event: AsciinemaEvent): event is AsciinemaResizeEvent =>
  Array.isArray(event) && event.length === 3 && event[1] === 'r';

const isExitEvent = (event: AsciinemaEvent): event is AsciinemaExitEvent =>
  Array.isArray(event) && event[0] === 'exit';

export async function buildHistoryChunk(
  payload: HistoryChunkTaskPayload
): Promise<HistoryChunkTaskResult> {
  const {
    sessionId,
    events,
    eventOffsets,
    baseStartIndex,
    sendStartIndex,
    startOffset,
    fileOffset,
    initialTailLines,
    hasMoreHistory,
    totalEvents,
    totalOutputEvents,
  } = payload;

  const chunkEvents: AsciinemaEvent[] = [];
  let chunkOutputEvents = 0;
  let exitEvent: AsciinemaExitEvent | null = null;

  for (let i = sendStartIndex; i < events.length; i++) {
    const event = events[i] as AsciinemaEvent;

    if (isExitEvent(event)) {
      exitEvent = event;
      continue;
    }

    if (isOutputEvent(event) || isResizeEvent(event)) {
      if (isOutputEvent(event)) {
        chunkOutputEvents++;
      }

      const normalizedEvent: AsciinemaEvent = [0, event[1], event[2]] as AsciinemaEvent;
      chunkEvents.push(normalizedEvent);
    }
  }

  let chunkPayload: HistoryChunkPayload | null = null;

  if (chunkEvents.length > 0) {
    chunkPayload = {
      type: 'history-chunk',
      sessionId,
      mode: 'tail',
      hasMore: hasMoreHistory,
      totalEvents: Math.max(totalEvents - baseStartIndex, 0),
      totalOutputEvents,
      chunkEventCount: chunkEvents.length,
      chunkOutputEvents,
      chunkStartOffset: eventOffsets[sendStartIndex] ?? startOffset,
      previousOffset:
        hasMoreHistory && sendStartIndex > 0 ? eventOffsets[sendStartIndex - 1] ?? null : null,
      nextOffset: fileOffset,
      initialTailLines,
      events: chunkEvents,
    };
  }

  return {
    payload: chunkPayload,
    chunkOutputEvents,
    exitEvent,
  };
}
