import type { LogLevel } from './types';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Lightweight structured JSON logger using the built-in console.
 * Zero dependencies — outputs one JSON line per log entry.
 */
export class Logger {
  private readonly rank: number;
  private readonly baseMeta: Record<string, string>;

  constructor(level: LogLevel, appName: string) {
    this.rank = LEVEL_RANK[level] ?? LEVEL_RANK.warn;
    this.baseMeta = { sdk: '@madhavgutte/observability-sdk', app: appName };
  }

  private write(level: string, rank: number, message: string, extra?: Record<string, unknown>): void {
    if (this.rank < rank) return;
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.baseMeta,
      ...extra,
    });
    if (rank <= LEVEL_RANK.error) {
      console.error(entry);
    } else if (rank === LEVEL_RANK.warn) {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', LEVEL_RANK.debug, message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', LEVEL_RANK.info, message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', LEVEL_RANK.warn, message, meta);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const errFields = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : error !== undefined ? { errorRaw: String(error) } : {};
    this.write('error', LEVEL_RANK.error, message, { ...errFields, ...meta });
  }
}
