import type {
  SDKConfig,
  SDKInitOptions,
  RetryConfig,
  BatchConfig,
  PrometheusConfig,
  ClickHouseConfig,
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

const DEFAULT_PROMETHEUS: PrometheusConfig = {
  enabled: true,
  port: 9464,
  path: '/metrics',
  collectDefaultMetrics: true,
  prefix: '',
};

const DEFAULT_CLICKHOUSE: ClickHouseConfig = {
  enabled: true,
  url: 'http://localhost:8123/ingest',
  table: 'observability_events',
  timeoutMs: 10_000,
};

/**
 * Merges user-supplied init options with SDK defaults to produce a
 * fully-resolved SDKConfig.
 */
export function resolveConfig(options: SDKInitOptions): SDKConfig {
  return {
    appName: options.appName,
    environment: options.environment,
    logLevel: options.logLevel ?? 'warn',
    globalLabels: options.globalLabels,
    retry: { ...DEFAULT_RETRY, ...options.retry },
    batch: { ...DEFAULT_BATCH, ...options.batch },
    prometheus: { ...DEFAULT_PROMETHEUS, ...options.prometheus },
    clickhouse: { ...DEFAULT_CLICKHOUSE, ...options.clickhouse },
  };
}
