import type { IngestConfig, ObservabilityEvent, PlatformSemanticDeclaration, RegisterSemanticsResult } from './types';
import type { Logger } from './logger';
import { RetryClient } from './retry-client';
import type { RetryConfig } from './types';

const SDK_VERSION = '1.0.0';

/**
 * Sends batches of ObservabilityEvents to the ingest proxy via HTTP POST.
 *
 * The proxy accepts a JSON array of project events at `config.url`
 * (e.g. http://localhost:3100/ingest).
 */
export class IngestClient {
  private readonly config: IngestConfig;
  private readonly logger: Logger;
  private readonly retryClient: RetryClient;

  constructor(config: IngestConfig, retryConfig: RetryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.retryClient = new RetryClient({
      retry: retryConfig,
      logger,
      timeoutMs: config.timeoutMs,
    });
  }

  /**
   * Sends a batch of events to the ingest proxy.
   * Maps ObservabilityEvent fields to the ProjectEvent shape expected by the
   * proxy, then serialises as a JSON array.
   * Throws if all retry attempts fail.
   */
  async send(events: ObservabilityEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Map to the ProjectEvent shape expected by the ingest proxy.
    // team    — taken from labels.team (set via globalLabels in SDK config)
    // status  — taken from payload.status, defaults to 'unknown'
    const mapped = events.map((e) => ({
      project_name: e.appName,
      team:         (e.labels?.['team'] as string | undefined) ?? '',
      event_type:   e.eventName,
      status:       (e.payload?.['status'] as string | undefined) ?? 'unknown',
      metric_value:  typeof e.value === 'number' ? e.value : null,
      metadata:     { ...e.payload, environment: e.environment, labels: e.labels },
      occurred_at:  e.timestamp.slice(0, 19).replace('T', ' '),
    }));

    const body = JSON.stringify(mapped);

    this.logger.debug('Sending batch to ingest proxy', {
      url: this.config.url,
      eventCount: mapped.length,
      byteSize: Buffer.byteLength(body, 'utf8'),
    });

    await this.retryClient.post(
      this.config.url,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-SDK-Version': SDK_VERSION,
          'X-Batch-Size': String(mapped.length),
        },
      },
    );

    this.logger.info('Batch ingested successfully', {
      count: mapped.length,
    });
  }

  /**
   * Registers event-semantics declarations with the platform catalog.
   * Idempotent on the server: rows a human configured in the dashboard are never
   * overwritten. Returns the platform's { registered, skipped, invalid } summary.
   */
  async registerSemantics(declarations: PlatformSemanticDeclaration[]): Promise<RegisterSemanticsResult> {
    const empty: RegisterSemanticsResult = { registered: 0, skipped: 0, invalid: 0 };
    if (declarations.length === 0) return empty;

    const url = this.config.semanticsUrl ?? deriveSemanticsUrlFallback(this.config.url);
    const body = JSON.stringify(declarations);

    this.logger.debug('Registering event semantics', { url, count: declarations.length });

    const result = await this.retryClient.post<RegisterSemanticsResult>(
      url,
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-SDK-Version': SDK_VERSION,
        },
      },
    );

    this.logger.info('Event semantics registered', {
      registered: (result ?? empty).registered,
      skipped: (result ?? empty).skipped,
      invalid: (result ?? empty).invalid,
    });
    return result ?? empty;
  }
}

/** Fallback used only when config.semanticsUrl is absent (e.g. hand-built config in tests). */
function deriveSemanticsUrlFallback(ingestUrl: string): string {
  const trimmed = ingestUrl.replace(/\/+$/, '');
  return /\/ingest$/.test(trimmed) ? `${trimmed}/semantics` : `${trimmed}/ingest/semantics`;
}
