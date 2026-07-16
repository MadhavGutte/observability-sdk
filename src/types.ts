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

export interface IngestConfig {
  /** Full URL to the ingest proxy endpoint (e.g. 'http://localhost:3100/ingest') */
  url: string;
  /** Request timeout in ms (default: 10_000) */
  timeoutMs: number;
  /** Full URL to the semantics registration endpoint. Derived from `url` when omitted. */
  semanticsUrl?: string;
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
  /** Ingest proxy configuration */
  ingest: IngestConfig;
  /** Global labels appended to every event */
  globalLabels?: Labels;
  /** Event semantics declared up front, registered with the platform on init */
  events?: EventSemanticsMap;
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
  globalLabels?: Labels;
  /**
   * Optional map of eventName → its meaning. When provided, the SDK registers
   * these with the platform's semantics catalog on init so the AI assistant can
   * answer questions about them without a human configuring each one. A human
   * dashboard edit always takes precedence over an SDK declaration.
   */
  events?: EventSemanticsMap;
};

// ─────────────────────────────────────────────────────────────────────────────
// Event semantics declaration
// ─────────────────────────────────────────────────────────────────────────────

/** How a metric event's value should be aggregated when answering "how many". */
export type EventAggregation = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** Declares what one event type means. Sent once to the platform catalog. */
export interface EventSemanticDeclaration {
  /** Count events, or aggregate their metric_value (sum/avg/min/max). */
  aggregation: EventAggregation;
  /** Unit label shown to users, e.g. 'customers', 'milliseconds'. */
  unit?: string;
  /** Human-friendly name, e.g. 'New customers'. */
  displayName?: string;
  /** Longer description of what the event represents. */
  description?: string;
  /** Alternative phrasings a user might ask about, e.g. ['signups']. */
  aliases?: string[];
}

/** Map of eventName → its declared semantics. */
export type EventSemanticsMap = Record<string, EventSemanticDeclaration>;

/** Wire shape sent to the platform's POST /ingest/semantics endpoint. */
export interface PlatformSemanticDeclaration {
  project_name: string;
  event_type: string;
  default_aggregation: EventAggregation;
  metric_unit: string | null;
  display_name: string | null;
  description: string | null;
  aliases: string[];
}

/** Result of registering event semantics with the platform. */
export interface RegisterSemanticsResult {
  registered: number;
  skipped: number;
  invalid: number;
}

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
  | 'QUEUE_FULL'
  | 'FLUSH_TIMEOUT';
