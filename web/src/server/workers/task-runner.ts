import { parentPort } from 'worker_threads';
import { buildHistoryChunk } from './tasks/history-chunk.js';
import { encodeSnapshotTask } from './tasks/encode-snapshot.js';
import type { WorkerTaskMessage, WorkerTaskResponse } from './types.js';

const port = parentPort;
if (!port) {
  throw new Error('Worker started without parent port');
}

const handlers = {
  encodeSnapshot: encodeSnapshotTask,
  buildHistoryChunk,
};

port.on('message', async (message: WorkerTaskMessage) => {
  const handler = handlers[message.type];

  let response: WorkerTaskResponse;
  if (!handler) {
    response = {
      id: message.id,
      error: `No handler registered for task type "${message.type}"`,
    };
    port.postMessage(response);
    return;
  }

  try {
    const result = await handler(message.payload as never);
    response = {
      id: message.id,
      result,
    };
    if (message.type === 'encodeSnapshot') {
      const { buffer } = result as { buffer: ArrayBuffer };
      port.postMessage(response, [buffer]);
    } else {
      port.postMessage(response);
    }
  } catch (error) {
    response = {
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(response);
  }
});
