import { createLogger, format, transports, Logger as WinstonLogger } from 'winston';
import type { LogLevel } from './types';

/**
 * Thin structured logger wrapping winston.
 * The SDK creates one instance and passes it through the dependency graph.
 */
export class Logger {
  private readonly winston: WinstonLogger;

  constructor(level: LogLevel, appName: string) {
    this.winston = createLogger({
      silent: level === 'silent',
      level: level === 'silent' ? 'error' : level,
      format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json(),
      ),
      defaultMeta: { sdk: '@observability/sdk', app: appName },
      transports: [new transports.Console()],
    });
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.winston.debug(message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.winston.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.winston.warn(message, meta);
  }

  error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const extra = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack }
      : { errorRaw: String(error) };
    this.winston.error(message, { ...extra, ...meta });
  }
}
