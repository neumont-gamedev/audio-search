import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let logFilePath: string | null = null;

function defaultLevel(): Level {
  // Test runs assert on behaviour, not log output; only real failures are worth printing.
  if (process.env.VITEST) return 'error';
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

let minLevel: Level = defaultLevel();

/**
 * Points the logger at a file inside the app's user-data directory. Called once during
 * startup; before that, logs go to the console only.
 */
export function initLogger(userDataDir: string): void {
  try {
    const dir = join(userDataDir, 'logs');
    mkdirSync(dir, { recursive: true });
    logFilePath = join(dir, 'app.log');
  } catch (error) {
    console.error('[logger] could not open log file', error);
  }
}

export function setLogLevel(level: Level): void {
  minLevel = level;
}

function write(level: Level, scope: string, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const detailText = detail === undefined ? '' : ` ${formatDetail(detail)}`;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${detailText}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (logFilePath) {
    try {
      appendFileSync(logFilePath, `${line}\n`);
    } catch {
      // A failing log file must never take down an operation.
    }
  }
}

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`;
  if (typeof detail === 'string') return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, detail?: unknown) => write('debug', scope, message, detail),
    info: (message: string, detail?: unknown) => write('info', scope, message, detail),
    warn: (message: string, detail?: unknown) => write('warn', scope, message, detail),
    error: (message: string, detail?: unknown) => write('error', scope, message, detail),
  };
}

export type Logger = ReturnType<typeof createLogger>;
