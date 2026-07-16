import type {
  SDKConfig,
  SDKInitOptions,
  RetryConfig,
  BatchConfig,
  IngestConfig,
} from './types';

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 10_000,
  multiplier: 2,
};

const DEFAULT_BATCH: BatchConfig = {
  maxSize: 100,
  flushIntervalMs: 5_000,
  flushTimeoutMs: 30_000,
};

const DEFAULT_INGEST_TIMEOUT_MS = 10_000;

/**
 * Derives the semantics-registration endpoint from the ingest URL.
 * The platform exposes it at `/ingest/semantics` (same ZPA machine route).
 *   http://host/ingest        → http://host/ingest/semantics
 *   http://host/ingest/        → http://host/ingest/semantics
 *   http://host                → http://host/ingest/semantics
 */
export function deriveSemanticsUrl(apiUrl: string): string {
  const trimmed = apiUrl.replace(/\/+$/, '');
  if (/\/ingest$/.test(trimmed)) return `${trimmed}/semantics`;
  return `${trimmed}/ingest/semantics`;
}

/**
 * Merges user-supplied init options with SDK defaults to produce a
 * fully-resolved SDKConfig.
 */
export function resolveConfig(options: SDKInitOptions): SDKConfig {
  const ingest: IngestConfig = {
    url: options.apiUrl,
    timeoutMs: DEFAULT_INGEST_TIMEOUT_MS,
    semanticsUrl: deriveSemanticsUrl(options.apiUrl),
  };

  return {
    appName: options.appName,
    environment: options.environment,
    logLevel: options.logLevel ?? 'warn',
    globalLabels: options.globalLabels,
    events: options.events,
    retry: { ...DEFAULT_RETRY, ...options.retry },
    batch: { ...DEFAULT_BATCH, ...options.batch },
    ingest,
  };
}
