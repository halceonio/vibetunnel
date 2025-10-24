import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { parse as simdjsonParse } from 'simdjson';
import type { CachedHistoryChunk } from '../../shared/history-types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('history-store');

export interface HistoryStore {
  ready: Promise<void>;
  setHistoryChunk(chunk: CachedHistoryChunk): Promise<void>;
  getHistoryChunk(sessionId: string): Promise<CachedHistoryChunk | null>;
  subscribe(sessionId: string, listener: (chunk: CachedHistoryChunk) => void): () => void;
  close(): Promise<void>;
}

const CHANNEL_NAME = 'vibetunnel:history-chunk:updates';
const KEY_PREFIX = 'vibetunnel:history-chunk:';
const DEFAULT_TTL_SECONDS = Number.parseInt(process.env.VT_HISTORY_CHUNK_TTL ?? '600', 10);

const eventName = (sessionId: string) => `chunk:${sessionId}`;

class RedisHistoryStore implements HistoryStore {
  private client: Redis;
  private subscriber: Redis;
  private emitter = new EventEmitter();
  private ttlSeconds: number;

  public ready: Promise<void>;

  constructor(url: string) {
    this.ttlSeconds = Number.isFinite(DEFAULT_TTL_SECONDS) ? DEFAULT_TTL_SECONDS : 600;
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
    });
    this.subscriber = this.client.duplicate({ enableOfflineQueue: false, lazyConnect: true });

    this.ready = this.initialize();
  }

  private async initialize(): Promise<void> {
    this.client.on('error', (error) => {
      logger.error('Redis history store error:', error);
    });

    this.subscriber.on('error', (error) => {
      logger.error('Redis history subscriber error:', error);
    });

    await this.client.connect();
    await this.subscriber.connect();

    this.subscriber.on('message', (_channel, message: string) => {
      try {
        const parsed = simdjsonParse(message) as CachedHistoryChunk;
        if (parsed?.sessionId) {
          this.emitter.emit(eventName(parsed.sessionId), parsed);
        }
      } catch (error) {
        logger.warn('Failed to parse history chunk message from Redis', error);
      }
    });

    await this.subscriber.subscribe(CHANNEL_NAME);

    logger.info('Redis history store connected');
  }

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async setHistoryChunk(chunk: CachedHistoryChunk): Promise<void> {
    await this.ready;
    const payload = JSON.stringify(chunk);
    await this.client.set(this.key(chunk.sessionId), payload, 'EX', this.ttlSeconds);
    await this.client.publish(CHANNEL_NAME, payload);
    this.emitter.emit(eventName(chunk.sessionId), chunk);
  }

  async getHistoryChunk(sessionId: string): Promise<CachedHistoryChunk | null> {
    await this.ready;
    const data = await this.client.get(this.key(sessionId));
    if (!data) return null;
    try {
      const parsed = simdjsonParse(data) as CachedHistoryChunk;
      return parsed;
    } catch (error) {
      logger.warn('Failed to parse cached history chunk from Redis', error);
      return null;
    }
  }

  subscribe(sessionId: string, listener: (chunk: CachedHistoryChunk) => void): () => void {
    this.emitter.on(eventName(sessionId), listener);
    return () => {
      this.emitter.off(eventName(sessionId), listener);
    };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    await Promise.allSettled([this.subscriber.quit(), this.client.quit()]);
  }
}

class IPCSharedHistoryStore implements HistoryStore {
  private chunks = new Map<string, CachedHistoryChunk>();
  private emitter = new EventEmitter();
  public ready = Promise.resolve();

  async setHistoryChunk(chunk: CachedHistoryChunk): Promise<void> {
    this.chunks.set(chunk.sessionId, chunk);
    this.emitter.emit(eventName(chunk.sessionId), chunk);
  }

  async getHistoryChunk(sessionId: string): Promise<CachedHistoryChunk | null> {
    return this.chunks.get(sessionId) ?? null;
  }

  subscribe(sessionId: string, listener: (chunk: CachedHistoryChunk) => void): () => void {
    this.emitter.on(eventName(sessionId), listener);
    return () => {
      this.emitter.off(eventName(sessionId), listener);
    };
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.chunks.clear();
  }
}

export async function createHistoryStore(): Promise<HistoryStore> {
  const redisUrl = process.env.VIBETUNNEL_REDIS_URL || process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const redisStore = new RedisHistoryStore(redisUrl);
      await redisStore.ready;
      return redisStore;
    } catch (error) {
      logger.warn('Failed to initialize Redis history store, falling back to IPC:', error);
    }
  } else {
    logger.info('Redis URL not provided; using IPC history store');
  }

  return new IPCSharedHistoryStore();
}
