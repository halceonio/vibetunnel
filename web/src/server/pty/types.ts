/**
 * TypeScript interfaces and types for PTY management
 *
 * These types match the tty-fwd format to ensure compatibility
 */

import type * as fs from 'fs';
import type * as net from 'net';
import type { IPty } from 'node-pty';
import type { SessionInfo, TitleMode } from '../../shared/types.js';
import type { ActivityDetector } from '../utils/activity-detector.js';
import type { TitleSequenceFilter } from '../utils/ansi-title-filter.js';
import type { WriteQueue } from '../utils/write-queue.js';
import type { AsciinemaWriter } from './asciinema-writer.js';

export interface AsciinemaHeader {
  version: number;
  width: number;
  height: number;
  timestamp?: number;
  duration?: number;
  command?: string;
  title?: string;
  env?: Record<string, string>;
  theme?: AsciinemaTheme;
}

export interface AsciinemaTheme {
  fg?: string;
  bg?: string;
  palette?: string;
}

export interface ControlMessage {
  cmd: string;
  [key: string]: unknown;
}

export interface ResizeControlMessage extends ControlMessage {
  cmd: 'resize';
  cols: number;
  rows: number;
}

export interface KillControlMessage extends ControlMessage {
  cmd: 'kill';
  signal?: string | number;
}

export interface ResetSizeControlMessage extends ControlMessage {
  cmd: 'reset-size';
}

export type AsciinemaEvent = {
  time: number;
  type: 'o' | 'i' | 'r' | 'm';
  data: string;
};

// Internal session state for PtyManager
export interface PtySession {
  id: string;
  sessionInfo: SessionInfo;
  ptyProcess?: IPty;
  asciinemaWriter?: AsciinemaWriter;
  controlDir: string;
  stdoutPath: string;
  stdinPath: string;
  sessionJsonPath: string;
  startTime: Date;
  // Optional fields for resource cleanup
  inputSocketServer?: net.Server;
  stdoutQueue?: WriteQueue;
  inputQueue?: WriteQueue;
  // Terminal title mode
  titleMode?: TitleMode;
  // Track current working directory for title updates
  currentWorkingDir?: string;
  // Track if initial title has been sent
  initialTitleSent?: boolean;
  // Activity detector for dynamic title mode
  activityDetector?: ActivityDetector;
  // Timer for periodic title updates in dynamic mode
  titleUpdateInterval?: NodeJS.Timeout;
  // Track if activity file has been written (for debug logging)
  activityFileWritten?: boolean;
  // Explicit flag for external terminal detection
  isExternalTerminal: boolean;
  // Title sequence filter for removing terminal title sequences
  titleFilter?: TitleSequenceFilter;
  // Title update tracking
  titleUpdateNeeded?: boolean;
  currentTitle?: string;
  lastActivityStatus?: string;
  // Write activity tracking for safe title injection
  lastWriteTimestamp?: number;
  titleInjectionTimer?: NodeJS.Timeout;
  pendingTitleToInject?: string;
  titleInjectionInProgress?: boolean;
  // File watcher for session.json changes
  sessionJsonWatcher?: fs.FSWatcher;
  // Interval for polling session.json changes
  sessionJsonInterval?: NodeJS.Timeout;
  // Activity status for external tracking
  activityStatus?: {
    specificStatus?: {
      app: string;
      status: string;
    };
  };
  // Connected socket clients for broadcasting
  connectedClients?: Set<net.Socket>;
  // Foreground process tracking
  shellPgid?: number; // Process group ID of the shell
  currentForegroundPgid?: number; // Current foreground process group
  currentCommand?: string; // Command line of current foreground process
  commandStartTime?: number; // When current command started (timestamp)
  processPollingInterval?: NodeJS.Timeout; // Interval for checking process state
  // Tmux attachment tracking
  isTmuxAttachment?: boolean; // True if this session is attached to tmux
  // Buffer for detecting split cursor position queries
  cursorPositionQueryBuffer?: string;
  // Per-client browser resize preferences
  browserResizeClients?: Map<
    string,
    {
      cols: number;
      rows: number;
      lastSeen: number;
    }
  >;
}

export class PtyError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly sessionId?: string
  ) {
    super(message);
    this.name = 'PtyError';
  }
}

// Utility type for session creation result
export interface SessionCreationResult {
  sessionId: string;
  sessionInfo: SessionInfo;
}
