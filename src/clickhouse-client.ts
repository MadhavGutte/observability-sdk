import type { ClickHouseConfig, ObservabilityEvent } from './types';
import type { Logger } from './logger';
import { RetryClient } from './retry-client';
import type { RetryConfig } from './types';

const SDK_VERSION = '1.0.0';

/**
 * Sends batches of ObservabilityEvents to a ClickHouse-compatible HTTP
 * ingestion service using newline-delimited JSON (NDJson).
 *
 * The service is expected to accept a POST body of NDJson rows, one
 * ObservabilityEvent per line, at `config.url`.
 */
export class ClickHouseClient {
  private readonly config: ClickHouseConfig;
  private readonly logger: Logger;
  private readonly retryClient: RetryClient;

  constructor(config: ClickHouseConfig, retryConfig: RetryConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.retryClient = new RetryClient({
      retry: retryConfig,
      logger,
      timeoutMs: config.timeoutMs,
      apiKey: config.apiKey,
    });
  }

  /**
   * Sends a batch of events to the ingestion endpoint.
   * Serialises as NDJson for efficient ClickHouse ingestion.
   * Throws if all retry attempts fail.
   */
  async send(events: ObservabilityEvent[]): Promise<void> {
    if (!this.config.enabled) {
      this.logger.debug('ClickHouse client is disabled — skipping send', {
        count: events.length,
      });
      return;
    }

    if (events.length === 0) return;

    // Build NDJson body: one JSON object per line
    const ndjson = events.map((e) => JSON.stringify(e)).join('\n');

    const url = this.buildUrl();

    this.logger.debug('Sending batch to ClickHouse', {
      url,
      eventCount: events.length,
      byteSize: Buffer.byteLength(ndjson, 'utf8'),
    });

    await this.retryClient.post(
      url,
      ndjson,
      {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-SDK-Version': SDK_VERSION,
          'X-Batch-Size': String(events.length),
        },
      },
    );

    this.logger.info('Batch ingested successfully', {
      count: events.length,
      table: this.config.table,
    });
  }

  /** Builds the full ingestion URL including the target table parameter. */
  private buildUrl(): string {
    const url = new URL(this.config.url);
    url.searchParams.set('table', this.config.table);
    return url.toString();
  }
}
