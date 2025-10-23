import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let rootOverride: string | undefined;

function normalizeDir(dir: string): string {
  return path.resolve(dir);
}

export function setVibeTunnelRootDir(dir: string): void {
  rootOverride = normalizeDir(dir);
}

export function getVibeTunnelRootDir(): string {
  if (rootOverride) {
    return rootOverride;
  }

  const envRoot = process.env.VIBETUNNEL_ROOT_DIR;
  if (envRoot && envRoot.trim().length > 0) {
    return normalizeDir(envRoot);
  }

  return path.join(os.homedir(), '.vibetunnel');
}

export function resolveRootPath(...segments: string[]): string {
  return path.join(getVibeTunnelRootDir(), ...segments);
}

export function ensureRootPath(...segments: string[]): string {
  const target = resolveRootPath(...segments);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

export function getControlDir(): string {
  const overridden = process.env.VIBETUNNEL_CONTROL_DIR;
  if (overridden && overridden.trim().length > 0) {
    return path.resolve(overridden);
  }
  return resolveRootPath('control');
}

export function getLogDir(): string {
  return resolveRootPath();
}

export function getLogFilePath(): string {
  return path.join(getLogDir(), 'log.txt');
}

export function resolveWithinControlDir(...segments: string[]): string {
  return path.join(getControlDir(), ...segments);
}
