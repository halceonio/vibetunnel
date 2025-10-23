#!/usr/bin/env node
// Entry point for the server - imports the modular server which starts automatically

// Suppress xterm.js errors globally - must be before any other imports
import { suppressXtermErrors } from './shared/suppress-xterm-errors.js';

suppressXtermErrors();

import * as fs from 'fs';
import * as path from 'path';
import { closeLogger, createLogger, initLogger, VerbosityLevel } from './server/utils/logger.js';
import { setVibeTunnelRootDir } from './server/utils/vt-paths.js';
import { parseVerbosityFromEnv } from './server/utils/verbosity-parser.js';
import { VERSION } from './server/version.js';

let startVibeTunnelForward: typeof import('./server/fwd.js')['startVibeTunnelForward'];
let startVibeTunnelServer: typeof import('./server/server.js')['startVibeTunnelServer'];

function ensureModulesLoaded(): Promise<void> {
  if (modulesPromise) {
    return modulesPromise;
  }
  modulesPromise = (async () => {
    const fwd = await import('./server/fwd.js');
    startVibeTunnelForward = fwd.startVibeTunnelForward;
    const server = await import('./server/server.js');
    startVibeTunnelServer = server.startVibeTunnelServer;
  })();
  return modulesPromise;
}

let modulesPromise: Promise<void> | null = null;

if (process.argv[2] === 'version') {
  console.log(`VibeTunnel Server v${VERSION}`);
  process.exit(0);
}

const verbosityLevel = parseVerbosityFromEnv();
const debugMode = process.env.VIBETUNNEL_DEBUG === '1' || process.env.VIBETUNNEL_DEBUG === 'true';

const SERVER_ONLY_COMMANDS = new Set([undefined, '', 'help', 'version']);
const NON_SERVER_COMMANDS = new Set([
  'fwd',
  'follow',
  'unfollow',
  'git-event',
  'systemd',
  'status',
]);

function extractConfigDir(argv: string[]): string | null {
  const primaryArg = argv[2];
  const isServerCommand =
    SERVER_ONLY_COMMANDS.has(primaryArg as string | undefined) ||
    (primaryArg?.startsWith('-') ?? false) ||
    !NON_SERVER_COMMANDS.has(primaryArg ?? '');

  if (!isServerCommand) {
    return null;
  }

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      break;
    }
    if (arg === '--config-dir') {
      const value = argv[i + 1];
      if (!value) {
        console.error('--config-dir requires a path argument');
        process.exit(1);
      }
      return value;
    }

    if (arg.startsWith('--config-dir=')) {
      return arg.slice('--config-dir='.length);
    }
  }

  return null;
}

const configDirArg = extractConfigDir(process.argv);
if (configDirArg) {
  const resolvedConfigDir = path.resolve(configDirArg);
  try {
    const stats = fs.statSync(resolvedConfigDir);
    if (!stats.isDirectory()) {
      console.error(`Config directory is not a directory: ${resolvedConfigDir}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Config directory does not exist: ${resolvedConfigDir}`);
    if (error instanceof Error && error.message) {
      console.error(error.message);
    }
    process.exit(1);
  }

  process.env.VIBETUNNEL_ROOT_DIR = resolvedConfigDir;
  setVibeTunnelRootDir(resolvedConfigDir);
}

initLogger(debugMode, verbosityLevel);
const logger = createLogger('cli');

interface GlobalWithVibetunnel {
  __vibetunnelStarted?: boolean;
}

const globalWithVibetunnel = global as unknown as GlobalWithVibetunnel;

if (globalWithVibetunnel.__vibetunnelStarted) {
  process.exit(0);
}
globalWithVibetunnel.__vibetunnelStarted = true;

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  logger.error('Stack trace:', error.stack);
  closeLogger();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error) {
    logger.error('Stack trace:', reason.stack);
  }
  closeLogger();
  process.exit(1);
});

function printHelp(): void {
  console.log(`VibeTunnel Server v${VERSION}`);
  console.log('');
  console.log('Usage:');
  console.log('  vibetunnel [options]                    Start VibeTunnel server');
  console.log('  vibetunnel fwd <session-id> <command>   Forward command to session');
  console.log('  vibetunnel status                       Show server and follow mode status');
  console.log('  vibetunnel follow [branch]              Enable Git follow mode');
  console.log('  vibetunnel unfollow                     Disable Git follow mode');
  console.log('  vibetunnel git-event                    Notify server of Git event');
  console.log('  vibetunnel systemd [action]             Manage systemd service (Linux)');
  console.log('  vibetunnel version                      Show version');
  console.log('  vibetunnel help                         Show this help');
  console.log('');
  console.log('Systemd Service Actions:');
  console.log('  install   - Install VibeTunnel as systemd service (default)');
  console.log('  uninstall - Remove VibeTunnel systemd service');
  console.log('  status    - Check systemd service status');
  console.log('');
  console.log('Examples:');
  console.log('  vibetunnel --port 8080 --no-auth');
  console.log('  vibetunnel fwd abc123 "ls -la"');
  console.log('  vibetunnel systemd');
  console.log('  vibetunnel systemd uninstall');
  console.log('  vibetunnel --config-dir /srv/vibe --port 4100');
  console.log('');
  console.log('For more options, run: vibetunnel --help');
}

function printVersion(): void {
  console.log(`VibeTunnel Server v${VERSION}`);
}

async function handleForwardCommand(): Promise<void> {
  await ensureModulesLoaded();
  try {
    await startVibeTunnelForward(process.argv.slice(3));
  } catch (error) {
    logger.error('Fatal error:', error);
    closeLogger();
    process.exit(1);
  }
}

async function handleSystemdService(): Promise<void> {
  try {
    const { installSystemdService } = await import('./server/services/systemd-installer.js');
    const action = process.argv[3] || 'install';
    installSystemdService(action);
  } catch (error) {
    logger.error('Failed to load systemd installer:', error);
    closeLogger();
    process.exit(1);
  }
}

async function handleSocketCommand(command: string): Promise<void> {
  try {
    const { SocketApiClient } = await import('./server/socket-api-client.js');
    const client = new SocketApiClient();

    switch (command) {
      case 'status': {
        const status = await client.getStatus();
        console.log('VibeTunnel Server Status:');
        console.log(`  Running: ${status.running ? 'Yes' : 'No'}`);
        if (status.running) {
          console.log(`  Port: ${status.port || 'Unknown'}`);
          console.log(`  URL: ${status.url || 'Unknown'}`);

          if (status.followMode) {
            console.log('\nGit Follow Mode:');
            console.log(`  Enabled: ${status.followMode.enabled ? 'Yes' : 'No'}`);
            if (status.followMode.enabled && status.followMode.branch) {
              console.log(`  Following branch: ${status.followMode.branch}`);
              console.log(`  Worktree: ${status.followMode.repoPath || 'Unknown'}`);
            }
          } else {
            console.log('\nGit Follow Mode: Not in a git repository');
          }
        }
        break;
      }
      case 'follow': {
        const args = process.argv.slice(3);
        let worktreePath: string | undefined;
        let mainRepoPath: string | undefined;

        for (let i = 0; i < args.length; i++) {
          switch (args[i]) {
            case '--from-worktree':
              break;
            case '--worktree-path':
              worktreePath = args[++i];
              break;
            case '--main-repo':
              mainRepoPath = args[++i];
              break;
          }
        }

        const response = await client.setFollowMode({
          enable: true,
          worktreePath,
          mainRepoPath,
          repoPath: mainRepoPath,
        });

        if (!response.success) {
          console.error(`Failed to enable follow mode: ${response.error || 'Unknown error'}`);
          process.exit(1);
        }
        break;
      }
      case 'unfollow': {
        const repoPath = process.cwd();
        const response = await client.setFollowMode({
          enable: false,
          repoPath,
        });

        if (!response.success) {
          console.error(`Failed to disable follow mode: ${response.error || 'Unknown error'}`);
          process.exit(1);
        }
        break;
      }
      case 'git-event': {
        const repoPath = process.cwd();
        await client.sendGitEvent({
          repoPath,
          type: 'other',
        });
        break;
      }
      default:
        console.error(`Unknown socket command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'VibeTunnel server is not running') {
      console.error('Error: VibeTunnel server is not running');
      console.error('Start the server first with: vibetunnel');
    } else {
      logger.error('Socket command failed:', error);
    }
    closeLogger();
    process.exit(1);
  }
}

function handleStartServer(): void {
  ensureModulesLoaded()
    .then(() => {
      if (verbosityLevel !== undefined && verbosityLevel >= VerbosityLevel.INFO) {
        logger.log('Starting VibeTunnel server...');
      }
      startVibeTunnelServer();
    })
    .catch((error) => {
      logger.error('Fatal error:', error);
      closeLogger();
      process.exit(1);
    });
}

async function parseCommandAndExecute(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'version':
      printVersion();
      process.exit(0);
      break;

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      process.exit(0);
      break;

    case 'fwd':
      await handleForwardCommand();
      break;

    case 'status':
    case 'follow':
    case 'unfollow':
    case 'git-event':
      await handleSocketCommand(command);
      break;

    case 'systemd':
      await handleSystemdService();
      break;

    default:
      handleStartServer();
      break;
  }
}

function isMainModule(): boolean {
  return (
    !module.parent &&
    (require.main === module ||
      require.main === undefined ||
      (require.main?.filename?.endsWith('/vibetunnel-cli') ?? false))
  );
}

if (isMainModule()) {
  parseCommandAndExecute().catch((error) => {
    logger.error('Unhandled error in main execution:', error);
    if (error instanceof Error) {
      logger.error('Stack trace:', error.stack);
    }
    closeLogger();
    process.exit(1);
  });
}
