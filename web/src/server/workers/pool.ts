import { cpus } from 'os';
import { resolve } from 'path';
import { Worker } from 'worker_threads';
import { createLogger } from '../utils/logger.js';
import type {
  WorkerTaskMessage,
  WorkerTaskResponse,
  WorkerTaskType,
  EncodeSnapshotTaskPayload,
  HistoryChunkTaskPayload,
} from './types.js';

const logger = createLogger('worker-pool');

interface PendingTask {
  id: number;
  type: WorkerTaskType;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface WorkerWrapper {
  worker: Worker;
  busy: boolean;
  pending: PendingTask | null;
}

export class WorkerPool {
  private workers: WorkerWrapper[] = [];
  private queue: PendingTask[] = [];
  private nextTaskId = 0;
  private readonly size: number;

  constructor(size?: number) {
    const cpuCount = cpus().length;
    this.size = size ?? Math.max(1, Math.min(cpuCount - 1, 4));

    for (let i = 0; i < this.size; i++) {
      this.workers.push(this.createWorker());
    }
  }

  async runTask<T>(type: WorkerTaskType, payload: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextTaskId++,
        type,
        payload,
        resolve: (value) => resolve(value as T),
        reject,
      };

      this.queue.push(task);
      this.processQueue();
    });
  }

  async destroy(): Promise<void> {
    await Promise.allSettled(this.workers.map((wrapper) => wrapper.worker.terminate()));
    this.workers = [];
    this.queue = [];
  }

  private createWorker(): WorkerWrapper {
    const workerScript = resolve(__dirname, 'task-runner.js');
    const worker = new Worker(workerScript, {
      env: process.env,
    });

    const wrapper: WorkerWrapper = {
      worker,
      busy: false,
      pending: null,
    };

    worker.on('message', (message: WorkerTaskResponse) => {
      this.handleWorkerMessage(wrapper, message);
    });

    worker.on('error', (error) => {
      logger.error('Worker thread error:', error);
      this.handleWorkerFailure(wrapper, error);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        logger.warn(`Worker exited with code ${code}, respawning`);
        this.handleWorkerFailure(wrapper, new Error(`Worker exited with code ${code}`));
      }
    });

    return wrapper;
  }

  private handleWorkerMessage(wrapper: WorkerWrapper, message: WorkerTaskResponse) {
    const pending = wrapper.pending;
    wrapper.pending = null;
    wrapper.busy = false;

    if (!pending) {
      logger.warn('Received worker message with no pending task');
      return;
    }

    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result);
    }

    this.processQueue();
  }

  private handleWorkerFailure(wrapper: WorkerWrapper, error: unknown) {
    const pending = wrapper.pending;
    if (pending) {
      pending.reject(error);
    }

    const index = this.workers.indexOf(wrapper);
    if (index !== -1) {
      this.workers.splice(index, 1);
    }

    this.workers.push(this.createWorker());
    this.processQueue();
  }

  private processQueue() {
    if (this.queue.length === 0) return;

    const freeWorker = this.workers.find((wrapper) => !wrapper.busy);
    if (!freeWorker) {
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    freeWorker.busy = true;
    freeWorker.pending = task;

    const message: WorkerTaskMessage = {
      id: task.id,
      type: task.type,
      payload: task.payload as EncodeSnapshotTaskPayload | HistoryChunkTaskPayload,
    };

    freeWorker.worker.postMessage(message);
  }
}

let sharedPool: WorkerPool | null = null;

export function getWorkerPool(): WorkerPool {
  if (!sharedPool) {
    sharedPool = new WorkerPool();
  }
  return sharedPool;
}
