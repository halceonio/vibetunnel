import { type Request, type Response, Router } from 'express';
import { type ServerEvent } from '../../shared/types.js';
import type { SessionMonitor } from '../services/session-monitor.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('events');

/**
 * Server-Sent Events (SSE) endpoint for real-time event streaming
 */
export function createEventsRouter(sessionMonitor?: SessionMonitor): Router {
  const router = Router();
  type ClientConnection = {
    res: Response;
    keepAlive: NodeJS.Timeout;
  };
  const clients = new Set<ClientConnection>();
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
      detachSessionMonitorIfIdle();
    }
  };

  // SSE endpoint for event streaming
  router.get('/events', (req: Request, res: Response) => {
    logger.info('📡 SSE connection attempt received');

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

    const client: ClientConnection = { res, keepAlive };
    clients.add(client);
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
