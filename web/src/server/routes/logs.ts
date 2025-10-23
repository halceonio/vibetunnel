import { type Request, type Response, Router } from 'express';
import * as fs from 'fs';
import { createLogger, flushLogger, logFromModule } from '../utils/logger.js';
import { getLogFilePath } from '../utils/vt-paths.js';

const logger = createLogger('logs');

type LogRoutesConfig = Record<string, never>;

interface ClientLogRequest {
  level: 'log' | 'warn' | 'error' | 'debug';
  module: string;
  args: unknown[];
}

export function createLogRoutes(_config?: LogRoutesConfig): Router {
  const router = Router();

  // Client-side logging endpoint
  router.post('/logs/client', (req: Request, res: Response) => {
    try {
      const { level, module, args } = req.body as ClientLogRequest;

      // Validate input
      if (!level || !module || !Array.isArray(args)) {
        return res.status(400).json({
          error: 'Invalid log request. Required: level, module, args[]',
        });
      }

      // Validate level
      if (!['log', 'warn', 'error', 'debug'].includes(level)) {
        return res.status(400).json({
          error: 'Invalid log level. Must be: log, warn, error, or debug',
        });
      }

      // Add [FE] prefix to module name to distinguish frontend logs from server logs
      const clientModule = `[FE] ${module}`;

      // Map client levels to server levels (uppercase)
      const serverLevel = level.toUpperCase();

      // Log to server log file via logFromModule
      logFromModule(serverLevel === 'LOG' ? 'LOG' : serverLevel, clientModule, args);

      res.status(204).send();
    } catch (error) {
      logger.error('Failed to process client log:', error);
      res.status(500).json({ error: 'Failed to process log' });
    }
  });

  // Get raw log file
  router.get('/logs/raw', (_req: Request, res: Response) => {
    try {
      const logPath = getLogFilePath();

      // Check if log file exists - if not, return empty content
      if (!fs.existsSync(logPath)) {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.send('');
      }

      // Stream the log file
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const stream = fs.createReadStream(logPath);
      stream.pipe(res);
    } catch (error) {
      logger.error('Failed to read log file:', error);
      res.status(500).json({ error: 'Failed to read log file' });
    }
  });

  // Get log stats/info
  router.get('/logs/info', (_req: Request, res: Response) => {
    try {
      const logPath = getLogFilePath();

      if (!fs.existsSync(logPath)) {
        return res.json({
          exists: false,
          size: 0,
          lastModified: null,
          path: logPath,
        });
      }

      const stats = fs.statSync(logPath);

      res.json({
        exists: true,
        size: stats.size,
        sizeHuman: formatBytes(stats.size),
        lastModified: stats.mtime,
        path: logPath,
      });
    } catch (error) {
      logger.error('Failed to get log info:', error);
      res.status(500).json({ error: 'Failed to get log info' });
    }
  });

  // Clear log file (for development/debugging)
  router.delete('/logs/clear', (_req: Request, res: Response) => {
    try {
      const logPath = getLogFilePath();

      if (fs.existsSync(logPath)) {
        fs.truncateSync(logPath, 0);
        logger.log('Log file cleared');
      }

      res.status(204).send();
    } catch (error) {
      logger.error('Failed to clear log file:', error);
      res.status(500).json({ error: 'Failed to clear log file' });
    }
  });

  // Flush log buffer (for testing)
  router.post('/logs/flush', async (_req: Request, res: Response) => {
    try {
      await flushLogger();
      res.status(204).send();
    } catch (error) {
      logger.error('Failed to flush log buffer:', error);
      res.status(500).json({ error: 'Failed to flush log buffer' });
    }
  });

  return router;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}
