// ─────────────────────────────────────────────────────────────────────────────
// Core domain types for the Observability SDK
// ─────────────────────────────────────────────────────────────────────────────

/** Supported deployment environments */
export type Environment = 'development' | 'staging' | 'production' | string;

/** Log levels for internal SDK logging */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/** Arbitrary key-value labels attached to metrics */
export type Labels = Record<string, string | number | boolean>;

/** Arbitrary business event payload */
export type EventPayload = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────────────────────
// SDK Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial backoff delay in ms (default: 200) */
  initialDelayMs: number;
  /** Maximum backoff delay in ms (default: 10_000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  multiplier: number;
}

export interface BatchConfig {
  /** Maximum events per batch (default: 100) */
  maxSize: number;
  /** Flush interval in ms (default: 5_000) */
  flushIntervalMs: number;
  /** Maximum time to wait for a flush to complete in ms (default: 30_000) */
  flushTimeoutMs: number;
}

export interface PrometheusConfig {
  /** Whether to enable Prometheus metrics (default: true) */
  enabled: boolean;
  /** Port for the /metrics HTTP endpoint (default: 9464) */
  port: number;
  /** Path for metrics endpoint (default: '/metrics') */
  path: string;
  /** Default labels added to all Prometheus metrics */
  defaultLabels?: Labels;
  /** Collect default Node.js metrics (default: true) */
  collectDefaultMetrics: boolean;
  /** Prefix for all metric names (default: '') */
  prefix: string;
}

export interface IngestConfig {
  /** Full URL to the ingest proxy endpoint (e.g. 'http://localhost:3100/ingest') */
  url: string;
  /** Request timeout in ms (default: 10_000) */
  timeoutMs: number;
}

export interface SDKConfig {
  /** Name of the application emitting events */
  appName: string;
  /** Deployment environment */
  environment: Environment;
  /** Internal log level (default: 'warn') */
  logLevel: LogLevel;
  /** Retry configuration */
  retry: RetryConfig;
  /** Batching configuration */
  batch: BatchConfig;
  /** Prometheus exporter configuration */
  prometheus: PrometheusConfig;
  /** Ingest proxy configuration */
  ingest: IngestConfig;
  /** Global labels appended to every event */
  globalLabels?: Labels;
}

/** User-supplied partial config merged with defaults */
export type SDKInitOptions = {
  appName: string;
  environment: Environment;
  logLevel?: LogLevel;
  retry?: Partial<RetryConfig>;
  batch?: Partial<BatchConfig>;
  /** URL of the observability ingest proxy (e.g. 'http://localhost:3100/ingest') */
  apiUrl: string;
  prometheus?: Partial<PrometheusConfig>;
  globalLabels?: Labels;
};

// ─────────────────────────────────────────────────────────────────────────────
// Event / Metric domain objects
// ─────────────────────────────────────────────────────────────────────────────

/** A business event to be ingested via the proxy */
export interface ObservabilityEvent {
  /** SDK-level ID (for deduplication / idempotency) */
  id: string;
  /** Name of the emitting application */
  appName: string;
  /** Logical event name (e.g. 'user_signup') */
  eventName: string;
  /** Numeric value carried by the event */
  value: number;
  /** Arbitrary structured payload */
  payload: EventPayload;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Deployment environment */
  environment: Environment;
  /** Additional label dimensions */
  labels: Labels;
}

/** A counter metric (monotonically increasing, goes to Prometheus) */
export interface CounterMetric {
  name: string;
  value: number;
  labels: Labels;
}

/** A gauge metric (arbitrary up/down value, goes to Prometheus) */
export interface GaugeMetric {
  name: string;
  value: number;
  labels: Labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport / internal types
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP ingestion payload sent to the ingest proxy */
export interface IngestionBatch {
  events: ObservabilityEvent[];
  sentAt: string;
  sdkVersion: string;
}

/** Result of a flush attempt */
export interface FlushResult {
  success: boolean;
  eventsCount: number;
  error?: Error;
}

/** Internal SDK error categories */
export type SDKErrorCode =
  | 'INIT_REQUIRED'
  | 'SCHEMA_VALIDATION'
  | 'INGESTION_FAILED'
  | 'PROMETHEUS_ERROR'
  | 'QUEUE_FULL'
  | 'FLUSH_TIMEOUT';
