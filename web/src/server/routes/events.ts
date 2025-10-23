import { type Request, type Response, Router } from 'express';
import { type ServerEvent } from '../../shared/types.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('events');

/**
 * Server-Sent Events (SSE) endpoint for real-time event streaming
 */
const DEFAULT_MAX_CONNECTIONS_PER_KEY = Number.parseInt(
  process.env.VIBETUNNEL_MAX_EVENTSTREAM_PER_KEY ?? '',
  10
);
const MAX_CONNECTIONS_PER_KEY =
  Number.isFinite(DEFAULT_MAX_CONNECTIONS_PER_KEY) && DEFAULT_MAX_CONNECTIONS_PER_KEY > 0
    ? DEFAULT_MAX_CONNECTIONS_PER_KEY
    : Infinity;

function deriveClientKey(req: Request): string {
  const explicit = req.get('x-vt-client-id');
  if (explicit) {
    return explicit;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  const userAgent = req.get('user-agent') || 'unknown-ua';
  return `${ip}|${userAgent}`;
}

export function createEventsRouter(sessionMonitor?: SessionMonitor): Router {
  const router = Router();
  type ClientConnection = {
    res: Response;
    keepAlive: NodeJS.Timeout;
    key: string;
  };
  const clients = new Set<ClientConnection>();
  const clientBuckets = new Map<string, Set<ClientConnection>>();
  let sessionMonitorAttached = false;

  const broadcastEvent = (event: ServerEvent): void => {
    if (clients.size === 0) {
      return;
    }

    logger.info(
      `📢 SessionMonitor notification: ${event.type} for session ${event.sessionId} (subscribers: ${clients.size})`
    );

    const payload = `id: ${Date.now()}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

    for (const client of Array.from(clients)) {
      try {
        client.res.write(payload);
      } catch (error) {
        logger.debug('Failed to write SSE payload to client, removing connection', error);
        cleanupClient(client);
      }
    }
  };

  const attachSessionMonitor = (): void => {
    if (!sessionMonitor || sessionMonitorAttached) {
      return;
    }
    sessionMonitor.on('notification', broadcastEvent);
    sessionMonitorAttached = true;
  };

  const detachSessionMonitorIfIdle = (): void => {
    if (!sessionMonitor || !sessionMonitorAttached) {
      return;
    }
    if (clients.size === 0) {
      sessionMonitor.off('notification', broadcastEvent);
      sessionMonitorAttached = false;
    }
  };

  const cleanupClient = (client: ClientConnection): void => {
    if (clients.has(client)) {
      clearInterval(client.keepAlive);
      if (!client.res.writableEnded) {
        try {
          client.res.end();
        } catch {
          // Ignore errors when ending the response
        }
      }
      clients.delete(client);
      const bucket = clientBuckets.get(client.key);
      if (bucket) {
        bucket.delete(client);
        if (bucket.size === 0) {
          clientBuckets.delete(client.key);
        }
      }
      detachSessionMonitorIfIdle();
    }
  };

  // SSE endpoint for event streaming
  router.get('/events', (req: Request, res: Response) => {
    logger.info('📡 SSE connection attempt received');

    const clientKey = deriveClientKey(req);
    let bucket = clientBuckets.get(clientKey);
    if (!bucket) {
      bucket = new Set<ClientConnection>();
      clientBuckets.set(clientKey, bucket);
    }

    if (MAX_CONNECTIONS_PER_KEY !== Infinity && bucket.size >= MAX_CONNECTIONS_PER_KEY) {
      const oldest = bucket.values().next().value as ClientConnection | undefined;
      if (oldest) {
        logger.warn(
          `Evicting oldest SSE connection for key ${clientKey} to honor limit (${MAX_CONNECTIONS_PER_KEY})`
        );
        cleanupClient(oldest);
      }

      bucket = clientBuckets.get(clientKey);
      if (!bucket) {
        bucket = new Set<ClientConnection>();
        clientBuckets.set(clientKey, bucket);
      }

      if (MAX_CONNECTIONS_PER_KEY !== Infinity && bucket.size >= MAX_CONNECTIONS_PER_KEY) {
        logger.warn(
          `Rejecting SSE connection for key ${clientKey} - still at capacity (${bucket.size}/${MAX_CONNECTIONS_PER_KEY})`
        );
        res.status(429).json({ error: 'Too many event-stream connections' });
        return;
      }
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

    // Send initial connection event as default message event
    try {
      res.write('event: connected\ndata: {"type": "connected"}\n\n');
    } catch (error) {
      logger.debug('Failed to send initial connection event:', error);
      return;
    }

    // Keep connection alive
    const keepAlive = setInterval(() => {
      try {
        res.write(':heartbeat\n\n'); // SSE comment to keep connection alive
      } catch (error) {
        logger.debug('Failed to send heartbeat:', error);
        cleanupClient(client);
      }
    }, 30000);

    const client: ClientConnection = { res, keepAlive, key: clientKey };
    clients.add(client);
    bucket.add(client);
    attachSessionMonitor();

    // Handle client disconnect
    req.on('close', () => {
      logger.debug('Client disconnected from event stream');
      cleanupClient(client);
    });
    req.on('error', () => {
      logger.debug('Client connection error on event stream');
      cleanupClient(client);
    });
  });

  return router;
}
