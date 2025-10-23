import chalk from 'chalk';
import type { Response } from 'express';
import * as fs from 'fs';
import type { SessionManager } from '../pty/session-manager.js';
import type { AsciinemaHeader } from '../pty/types.js';
import { createLogger } from '../utils/logger.js';
import {
  calculatePruningPositionInFile,
  containsPruningSequence,
  findLastPrunePoint,
  logPruningDetection,
} from '../utils/pruning-detector.js';
import { gitWatcher } from './git-watcher.js';

const logger = createLogger('stream-watcher');

// Constants
const HEADER_READ_BUFFER_SIZE = 4096;
const MAX_INITIAL_TAIL_LINES = 5000;

interface StreamClientOptions {
  initialTailLines?: number;
}

interface StreamClient {
  response: Response;
  startTime: number;
  options: StreamClientOptions;
}

// Type for asciinema event array format
type AsciinemaOutputEvent = [number, 'o', string];
type AsciinemaInputEvent = [number, 'i', string];
type AsciinemaResizeEvent = [number, 'r', string];
type AsciinemaExitEvent = ['exit', number, string];
type AsciinemaEvent =
  | AsciinemaOutputEvent
  | AsciinemaInputEvent
  | AsciinemaResizeEvent
  | AsciinemaExitEvent;

// Type guard functions
function isOutputEvent(event: AsciinemaEvent): event is AsciinemaOutputEvent {
  return (
    Array.isArray(event) && event.length === 3 && event[1] === 'o' && typeof event[0] === 'number'
  );
}

function isResizeEvent(event: AsciinemaEvent): event is AsciinemaResizeEvent {
  return (
    Array.isArray(event) && event.length === 3 && event[1] === 'r' && typeof event[0] === 'number'
  );
}

function isExitEvent(event: AsciinemaEvent): event is AsciinemaExitEvent {
  return Array.isArray(event) && event[0] === 'exit';
}

interface WatcherInfo {
  clients: Set<StreamClient>;
  watcher?: fs.FSWatcher;
  lastOffset: number;
  lastSize: number;
  lastMtime: number;
  lineBuffer: string;
}

export class StreamWatcher {
  private activeWatchers: Map<string, WatcherInfo> = new Map();
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    // Clean up notification listeners on exit
    process.on('beforeExit', () => {
      this.cleanup();
    });
    logger.debug('stream watcher initialized');
  }

  /**
   * Process a clear sequence event and update tracking variables
   */
  private processClearSequence(
    event: AsciinemaOutputEvent,
    eventIndex: number,
    fileOffset: number,
    currentResize: AsciinemaResizeEvent | null,
    eventLine: string
  ): {
    lastClearIndex: number;
    lastClearOffset: number;
    lastResizeBeforeClear: AsciinemaResizeEvent | null;
  } | null {
    const prunePoint = findLastPrunePoint(event[2]);
    if (!prunePoint) return null;

    // Calculate precise offset using shared utility
    const lastClearOffset = calculatePruningPositionInFile(
      fileOffset,
      eventLine,
      prunePoint.position
    );

    // Use shared logging function
    logPruningDetection(prunePoint.sequence, lastClearOffset, '(retroactive scan)');

    logger.debug(
      `found at event index ${eventIndex}, ` +
        `current resize: ${currentResize ? currentResize[2] : 'none'}`
    );

    return {
      lastClearIndex: eventIndex,
      lastClearOffset,
      lastResizeBeforeClear: currentResize,
    };
  }

  /**
   * Parse a line of asciinema data and return the parsed event
   */
  private parseAsciinemaLine(line: string): AsciinemaEvent | AsciinemaHeader | null {
    if (!line.trim()) return null;

    try {
      const parsed = JSON.parse(line);

      // Check if it's a header
      if (parsed.version && parsed.width && parsed.height) {
        return parsed as AsciinemaHeader;
      }

      // Check if it's an event
      if (Array.isArray(parsed)) {
        if (parsed[0] === 'exit') {
          return parsed as AsciinemaExitEvent;
        } else if (parsed.length >= 3 && typeof parsed[0] === 'number') {
          return parsed as AsciinemaEvent;
        }
      }

      return null;
    } catch (e) {
      logger.debug(`skipping invalid JSON line: ${e}`);
      return null;
    }
  }

  /**
   * Send an event to the client with proper formatting
   */
  private sendEventToClient(
    client: StreamClient,
    event: AsciinemaEvent | AsciinemaHeader,
    makeInstant: boolean = false
  ): void {
    try {
      let dataToSend: AsciinemaEvent | AsciinemaHeader = event;

      // For existing content, set timestamp to 0
      if (
        makeInstant &&
        Array.isArray(event) &&
        event.length >= 3 &&
        typeof event[0] === 'number'
      ) {
        dataToSend = [0, event[1], event[2]];
      }

      client.response.write(`data: ${JSON.stringify(dataToSend)}\n\n`);

      // Handle exit events
      if (Array.isArray(event) && isExitEvent(event)) {
        logger.log(
          chalk.yellow(
            `session ${client.response.locals?.sessionId || 'unknown'} already ended, closing stream`
          )
        );
        client.response.end();
      }
    } catch (error) {
      logger.debug(
        `client write failed (likely disconnected): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Add a client to watch a stream file
   */
  addClient(
    sessionId: string,
    streamPath: string,
    response: Response,
    options: StreamClientOptions = {}
  ): void {
    logger.debug(`adding client to session ${sessionId}`);
    const startTime = Date.now() / 1000;
    const client: StreamClient = { response, startTime, options };

    let watcherInfo = this.activeWatchers.get(sessionId);

    if (!watcherInfo) {
      // Create new watcher for this session
      logger.log(chalk.green(`creating new stream watcher for session ${sessionId}`));
      watcherInfo = {
        clients: new Set(),
        lastOffset: 0,
        lastSize: 0,
        lastMtime: 0,
        lineBuffer: '',
      };
      this.activeWatchers.set(sessionId, watcherInfo);

      // Send existing content first
      this.sendExistingContent(sessionId, streamPath, client, options);

      // Get current file size and stats
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        watcherInfo.lastOffset = stats.size;
        watcherInfo.lastSize = stats.size;
        watcherInfo.lastMtime = stats.mtimeMs;
        logger.debug(`initial file size: ${stats.size} bytes`);
      } else {
        logger.debug(`stream file does not exist yet: ${streamPath}`);
      }

      // Start watching for new content
      this.startWatching(sessionId, streamPath, watcherInfo);

      // Start git watching if this is a git repository
      this.startGitWatching(sessionId, response);
    } else {
      // Send existing content to new client
      this.sendExistingContent(sessionId, streamPath, client, options);

      // Add this client to git watcher
      gitWatcher.addClient(sessionId, response);
    }

    // Add client to set
    watcherInfo.clients.add(client);
    logger.log(
      chalk.blue(`client connected to stream ${sessionId} (${watcherInfo.clients.size} total)`)
    );
  }

  /**
   * Remove a client
   */
  removeClient(sessionId: string, response: Response): void {
    const watcherInfo = this.activeWatchers.get(sessionId);
    if (!watcherInfo) {
      logger.debug(`no watcher found for session ${sessionId}`);
      return;
    }

    // Find and remove client
    let clientToRemove: StreamClient | undefined;
    for (const client of watcherInfo.clients) {
      if (client.response === response) {
        clientToRemove = client;
        break;
      }
    }

    if (clientToRemove) {
      watcherInfo.clients.delete(clientToRemove);
      logger.log(
        chalk.yellow(
          `client disconnected from stream ${sessionId} (${watcherInfo.clients.size} remaining)`
        )
      );

      // Remove client from git watcher
      gitWatcher.removeClient(sessionId, response);

      // If no more clients, stop watching
      if (watcherInfo.clients.size === 0) {
        logger.log(chalk.yellow(`stopping watcher for session ${sessionId} (no clients)`));
        if (watcherInfo.watcher) {
          watcherInfo.watcher.close();
        }
        this.activeWatchers.delete(sessionId);

        // Stop git watching when no clients remain
        gitWatcher.stopWatching(sessionId);
      }
    }
  }

  /**
   * Send existing content to a client
   */
  private sendExistingContent(
    sessionId: string,
    streamPath: string,
    client: StreamClient,
    options: StreamClientOptions
  ): void {
    try {
      const tailLinesRequested = options?.initialTailLines ?? 0;
      const initialTailLines = Number.isFinite(tailLinesRequested)
        ? Math.max(0, Math.min(Math.floor(tailLinesRequested), MAX_INITIAL_TAIL_LINES))
        : 0;

      // Load existing session info or use defaults, but don't save incomplete session data
      const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);

      // Validate offset to ensure we don't read beyond file size
      let startOffset = sessionInfo?.lastClearOffset ?? 0;
      if (fs.existsSync(streamPath)) {
        const stats = fs.statSync(streamPath);
        startOffset = Math.min(startOffset, stats.size);
      }

      // Read header line separately (first line of file)
      // We need to track byte position separately from string length due to UTF-8 encoding
      let header: AsciinemaHeader | null = null;
      let fd: number | null = null;
      try {
        fd = fs.openSync(streamPath, 'r');
        const buf = Buffer.alloc(HEADER_READ_BUFFER_SIZE);
        let data = '';

        // Important: Use filePosition (bytes) not data.length (characters) for fs.readSync
        // UTF-8 strings have character count != byte count for multi-byte characters
        let filePosition = 0; // Track actual byte position in file
        let bytesRead = fs.readSync(fd, buf, 0, buf.length, filePosition);

        while (!data.includes('\n') && bytesRead > 0) {
          data += buf.toString('utf8', 0, bytesRead);

          // Increment by actual bytes read, not string characters
          // This ensures correct file positioning for subsequent reads
          filePosition += bytesRead;

          if (!data.includes('\n')) {
            // Use filePosition (byte offset) not data.length (character count)
            bytesRead = fs.readSync(fd, buf, 0, buf.length, filePosition);
          }
        }

        const idx = data.indexOf('\n');
        if (idx !== -1) {
          header = JSON.parse(data.slice(0, idx));
        }
      } catch (e) {
        logger.debug(`failed to read asciinema header for session ${sessionId}: ${e}`);
      } finally {
        // Ensure file descriptor is always closed to prevent leaks
        // This executes even if an exception occurs during read operations
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch (closeError) {
            logger.debug(`failed to close file descriptor: ${closeError}`);
          }
        }
      }

      // Analyze the stream starting from stored offset to find the most recent clear sequence
      // This allows us to prune old terminal content and only send what's currently visible
      const analysisStream = fs.createReadStream(streamPath, {
        encoding: 'utf8',
        start: startOffset,
      });
      let lineBuffer = '';
      const events: AsciinemaEvent[] = [];
      const eventOffsets: number[] = [];
      let lastClearIndex = -1;
      let lastResizeBeforeClear: AsciinemaResizeEvent | null = null;
      let currentResize: AsciinemaResizeEvent | null = null;

      // Track byte offset in the file for accurate position tracking
      // This is crucial for UTF-8 encoded files where character count != byte count
      let fileOffset = startOffset;
      let lastClearOffset = startOffset;

      analysisStream.on('data', (chunk: string | Buffer) => {
        lineBuffer += chunk.toString();
        let index = lineBuffer.indexOf('\n');
        while (index !== -1) {
          const line = lineBuffer.slice(0, index);
          lineBuffer = lineBuffer.slice(index + 1);

          // Calculate byte length of the line plus newline character
          // Buffer.byteLength correctly handles multi-byte UTF-8 characters
          const lineStartOffset = fileOffset;
          fileOffset += Buffer.byteLength(line, 'utf8') + 1;

          if (line.trim()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.version && parsed.width && parsed.height) {
                header = parsed;
              } else if (Array.isArray(parsed)) {
                // Check if it's an exit event first
                if (parsed[0] === 'exit') {
                  events.push(parsed as AsciinemaExitEvent);
                  eventOffsets.push(lineStartOffset);
                } else if (parsed.length >= 3 && typeof parsed[0] === 'number') {
                  const event = parsed as AsciinemaEvent;

                  // Track resize events
                  if (isResizeEvent(event)) {
                    currentResize = event;
                  }

                  // Check for clear sequence in output events
                  if (isOutputEvent(event) && containsPruningSequence(event[2])) {
                    const clearResult = this.processClearSequence(
                      event as AsciinemaOutputEvent,
                      events.length,
                      fileOffset,
                      currentResize,
                      line
                    );
                    if (clearResult) {
                      lastClearIndex = clearResult.lastClearIndex;
                      lastClearOffset = clearResult.lastClearOffset;
                      lastResizeBeforeClear = clearResult.lastResizeBeforeClear;
                    }
                  }

                  events.push(event);
                  eventOffsets.push(lineStartOffset);
                }
              }
            } catch (e) {
              logger.debug(`skipping invalid JSON line during analysis: ${e}`);
            }
          }
          index = lineBuffer.indexOf('\n');
        }
      });

      analysisStream.on('end', () => {
        // Process any remaining line in analysis
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer);
            const lineStartOffset = fileOffset;
            fileOffset += Buffer.byteLength(lineBuffer, 'utf8');
            if (Array.isArray(parsed)) {
              if (parsed[0] === 'exit') {
                events.push(parsed as AsciinemaExitEvent);
                eventOffsets.push(lineStartOffset);
              } else if (parsed.length >= 3 && typeof parsed[0] === 'number') {
                const event = parsed as AsciinemaEvent;

                if (isResizeEvent(event)) {
                  currentResize = event;
                }
                if (isOutputEvent(event) && containsPruningSequence(event[2])) {
                  const clearResult = this.processClearSequence(
                    event as AsciinemaOutputEvent,
                    events.length,
                    fileOffset,
                    currentResize,
                    lineBuffer
                  );
                  if (clearResult) {
                    lastClearIndex = clearResult.lastClearIndex;
                    lastClearOffset = clearResult.lastClearOffset;
                    lastResizeBeforeClear = clearResult.lastResizeBeforeClear;
                  }
                }
                events.push(event);
                eventOffsets.push(lineStartOffset);
              }
            }
          } catch (e) {
            logger.debug(`skipping invalid JSON in line buffer during analysis: ${e}`);
          }
        }

        // Now replay the stream with pruning
        const baseStartIndex = lastClearIndex >= 0 ? lastClearIndex + 1 : 0;

        if (lastClearIndex >= 0) {
          logger.log(
            chalk.green(
              `pruning stream: skipping ${lastClearIndex + 1} events before last clear at offset ${lastClearOffset}`
            )
          );

          // Persist new clear offset to session only if session already exists
          if (sessionInfo) {
            sessionInfo.lastClearOffset = lastClearOffset;
            this.sessionManager.saveSessionInfo(sessionId, sessionInfo);
          }
        }

        // Send header first - update dimensions if we have a resize
        if (header) {
          const headerToSend = { ...header };
          if (lastClearIndex >= 0 && lastResizeBeforeClear) {
            // Update header with last known dimensions before clear
            const dimensions = lastResizeBeforeClear[2].split('x');
            headerToSend.width = Number.parseInt(dimensions[0], 10);
            headerToSend.height = Number.parseInt(dimensions[1], 10);
          }
          client.response.write(`data: ${JSON.stringify(headerToSend)}\n\n`);
        }

        const totalOutputEvents = events
          .slice(baseStartIndex)
          .reduce((count, event) => (isOutputEvent(event) ? count + 1 : count), 0);

        if (initialTailLines > 0 && events.length > baseStartIndex) {
          let sendStartIndex = events.length - 1;
          let outputCounter = 0;

          for (let idx = events.length - 1; idx >= baseStartIndex; idx--) {
            sendStartIndex = idx;
            const event = events[idx];
            if (isOutputEvent(event)) {
              outputCounter++;
              if (outputCounter >= initialTailLines) {
                break;
              }
            }
          }

          sendStartIndex = Math.max(sendStartIndex, baseStartIndex);
          const hasMoreHistory = sendStartIndex > baseStartIndex;

          const chunkEvents: AsciinemaEvent[] = [];
          let chunkOutputEvents = 0;
          let exitEventToSend: AsciinemaExitEvent | null = null;

          for (let i = sendStartIndex; i < events.length; i++) {
            const event = events[i];

            if (isExitEvent(event)) {
              exitEventToSend = event;
              continue;
            }

            if (isOutputEvent(event) || isResizeEvent(event)) {
              if (isOutputEvent(event)) {
                chunkOutputEvents++;
              }

              const normalizedEvent: AsciinemaEvent = [0, event[1], event[2]];
              chunkEvents.push(normalizedEvent);
            }
          }

          const payload = {
            type: 'history-chunk',
            mode: 'tail',
            hasMore: hasMoreHistory,
            totalEvents: Math.max(events.length - baseStartIndex, 0),
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

          client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
          if (client.response.flush) {
            try {
              client.response.flush();
            } catch (flushError) {
              logger.debug(`flush failed for history chunk: ${flushError}`);
            }
          }

          if (exitEventToSend) {
            client.response.write(`data: ${JSON.stringify(exitEventToSend)}\n\n`);
            logger.log(
              chalk.yellow(
                `session ${client.response.locals?.sessionId || 'unknown'} already ended, closing stream`
              )
            );
            client.response.end();
          }

          return;
        }

        // Legacy behaviour (no tail limit requested)
        let startIndex = baseStartIndex;

        // Send remaining events
        let exitEventFound = false;
        for (let i = startIndex; i < events.length; i++) {
          const event = events[i];
          if (isExitEvent(event)) {
            exitEventFound = true;
            client.response.write(`data: ${JSON.stringify(event)}\n\n`);
          } else if (isOutputEvent(event) || isResizeEvent(event)) {
            // Set timestamp to 0 for existing content
            const instantEvent: AsciinemaEvent = [0, event[1], event[2]];
            client.response.write(`data: ${JSON.stringify(instantEvent)}\n\n`);
          }
        }

        // If exit event found, close connection
        if (exitEventFound) {
          logger.log(
            chalk.yellow(
              `session ${client.response.locals?.sessionId || 'unknown'} already ended, closing stream`
            )
          );
          client.response.end();
        }
      });

      analysisStream.on('error', (error) => {
        logger.error('failed to analyze stream for pruning:', error);
        // If stream fails, client will simply not receive existing content
        // This is extremely rare and would indicate a serious filesystem issue
      });
    } catch (error) {
      logger.error('failed to create read stream:', error);
    }
  }

  /**
   * Start watching a file for changes
   */
  private startWatching(sessionId: string, streamPath: string, watcherInfo: WatcherInfo): void {
    logger.log(chalk.green(`started watching stream file for session ${sessionId}`));

    // Use standard fs.watch with stat checking
    watcherInfo.watcher = fs.watch(streamPath, { persistent: true }, (eventType) => {
      if (eventType === 'change') {
        try {
          // Check if file actually changed by comparing stats
          const stats = fs.statSync(streamPath);

          // Only process if size increased (append-only file)
          if (stats.size > watcherInfo.lastSize || stats.mtimeMs > watcherInfo.lastMtime) {
            const sizeDiff = stats.size - watcherInfo.lastSize;
            if (sizeDiff > 0) {
              logger.debug(`file grew by ${sizeDiff} bytes`);
            }
            watcherInfo.lastSize = stats.size;
            watcherInfo.lastMtime = stats.mtimeMs;

            // Read only new data
            if (stats.size > watcherInfo.lastOffset) {
              const fd = fs.openSync(streamPath, 'r');
              const buffer = Buffer.alloc(stats.size - watcherInfo.lastOffset);
              fs.readSync(fd, buffer, 0, buffer.length, watcherInfo.lastOffset);
              fs.closeSync(fd);

              // Update offset
              watcherInfo.lastOffset = stats.size;

              // Process new data
              const newData = buffer.toString('utf8');
              watcherInfo.lineBuffer += newData;

              // Process complete lines
              const lines = watcherInfo.lineBuffer.split('\n');
              watcherInfo.lineBuffer = lines.pop() || '';

              for (const line of lines) {
                if (line.trim()) {
                  this.broadcastLine(sessionId, line, watcherInfo);
                }
              }
            }
          }
        } catch (error) {
          logger.error('failed to read file changes:', error);
        }
      }
    });

    watcherInfo.watcher.on('error', (error) => {
      logger.error(`file watcher error for session ${sessionId}:`, error);
    });
  }

  /**
   * Broadcast a line to all clients
   */
  private broadcastLine(sessionId: string, line: string, watcherInfo: WatcherInfo): void {
    const parsed = this.parseAsciinemaLine(line);

    if (!parsed) {
      // Handle non-JSON as raw output
      logger.debug(`broadcasting raw output line: ${line.substring(0, 50)}...`);
      const currentTime = Date.now() / 1000;
      for (const client of watcherInfo.clients) {
        const castEvent: AsciinemaOutputEvent = [currentTime - client.startTime, 'o', line];
        this.sendEventToClient(client, castEvent);
      }
      return;
    }

    // Skip duplicate headers
    if (!Array.isArray(parsed)) {
      return;
    }

    // Handle exit events
    if (isExitEvent(parsed)) {
      logger.log(chalk.yellow(`session ${sessionId} ended with exit code ${parsed[1]}`));
      for (const client of watcherInfo.clients) {
        this.sendEventToClient(client, parsed);
      }
      return;
    }

    // Log resize broadcasts at debug level only
    if (isResizeEvent(parsed)) {
      logger.debug(`Broadcasting resize ${parsed[2]} to ${watcherInfo.clients.size} clients`);
    }

    // Calculate relative timestamp for each client
    const currentTime = Date.now() / 1000;
    for (const client of watcherInfo.clients) {
      const relativeEvent: AsciinemaEvent = [currentTime - client.startTime, parsed[1], parsed[2]];
      try {
        client.response.write(`data: ${JSON.stringify(relativeEvent)}\n\n`);
        if (client.response.flush) client.response.flush();
      } catch (error) {
        logger.debug(
          `client write failed (likely disconnected): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  /**
   * Start git watching for a session if it's in a git repository
   */
  private async startGitWatching(sessionId: string, response: Response): Promise<void> {
    try {
      const sessionInfo = this.sessionManager.loadSessionInfo(sessionId);
      if (sessionInfo?.gitRepoPath && sessionInfo.workingDir) {
        logger.debug(`Starting git watcher for session ${sessionId} at ${sessionInfo.gitRepoPath}`);
        await gitWatcher.startWatching(sessionId, sessionInfo.workingDir, sessionInfo.gitRepoPath);
        gitWatcher.addClient(sessionId, response);
      }
    } catch (error) {
      logger.error(`Failed to start git watching for session ${sessionId}:`, error);
    }
  }

  /**
   * Clean up all watchers and listeners
   */
  private cleanup(): void {
    const watcherCount = this.activeWatchers.size;
    if (watcherCount > 0) {
      logger.log(chalk.yellow(`cleaning up ${watcherCount} active watchers`));
      for (const [sessionId, watcherInfo] of this.activeWatchers) {
        if (watcherInfo.watcher) {
          watcherInfo.watcher.close();
        }
        logger.debug(`closed watcher for session ${sessionId}`);
      }
      this.activeWatchers.clear();
    }
    // Clean up git watchers
    gitWatcher.cleanup();
  }
}
