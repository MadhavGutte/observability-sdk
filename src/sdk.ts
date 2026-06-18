import { randomUUID } from 'crypto';
import type {
  SDKInitOptions,
  SDKConfig,
  ObservabilityEvent,
  EventPayload,
  Labels,
  FlushResult,
} from './types';
import { resolveConfig } from './config';
import { Logger } from './logger';
import { SchemaValidator } from './schema-validator';
import { BatchQueue } from './batch-queue';
import { IngestClient } from './ingest-client';

/**
 * ObservabilitySDK — the central class that orchestrates all SDK components.
 *
 * Lifecycle:
 *   1. `await sdk.init({ appName, environment, ... })` — wires up all
 *      components and starts the Prometheus HTTP server + flush timer.
 *   2. Use `sdk.event()`, `sdk.counter()`, `sdk.gauge()` freely.
 *   3. `await sdk.shutdown()` — flushes the queue and stops servers.
 *
 * Thread-safety: Node.js is single-threaded; all public methods are safe to
 * call concurrently from async code.
 */
export class ObservabilitySDK {
  private config!: SDKConfig;
  private logger!: Logger;
  private validator!: SchemaValidator;
  private queue!: BatchQueue;
  private ingest!: IngestClient;
  private initialised = false;

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialises the SDK. Must be called exactly once before any metric methods.
   * Idempotent — subsequent calls are no-ops (a warning is logged).
   */
  async init(options: SDKInitOptions): Promise<void> {
    if (this.initialised) {
      // Use a temporary console warning before logger is available
      console.warn('[ObservabilitySDK] init() called more than once — ignoring');
      return;
    }

    this.config = resolveConfig(options);
    this.logger = new Logger(this.config.logLevel, this.config.appName);
    this.validator = new SchemaValidator();

    this.ingest = new IngestClient(
      this.config.ingest,
      this.config.retry,
      this.logger,
    );

    this.queue = new BatchQueue({
      config: this.config.batch,
      logger: this.logger,
      onFlush: (events) => this.ingest.send(events),
    });

    // Forward queue events to consumers via process-level logging
    this.queue.on('flushError', (err: Error) => {
      this.logger.error('Background flush failed — events may be lost', err);
    });

    this.queue.start();

    this.registerShutdownHandlers();

    this.initialised = true;
    this.logger.info('ObservabilitySDK initialised', {
      appName: this.config.appName,
      environment: this.config.environment,
      ingestUrl: this.config.ingest.url,
    });
  }

  /**
   * Flushes any queued events and shuts down the Prometheus HTTP server.
   * Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    if (!this.initialised) return;
    this.logger.info('ObservabilitySDK shutting down…');
    await this.queue.stop();
    this.initialised = false;
    this.logger.info('ObservabilitySDK shut down cleanly');
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Emits a business event to the ingest proxy via the batch queue.
   *
   * @param appName   - Name of the application (e.g. 'checkout-service')
   * @param eventName - Logical event identifier (e.g. 'order_placed')
   * @param value     - Numeric value carried by the event (e.g. order amount)
   * @param payload   - Arbitrary structured data (default: {})
   * @param labels    - Extra label dimensions (default: {})
   *
   * @example
   *   metrics.event('checkout-service', 'order_placed', 49.99, { orderId: 'abc' });
   */
  event(
    appName: string,
    eventName: string,
    value: number,
    payload: EventPayload = {},
    labels: Labels = {},
  ): void {
    this.assertInitialised('event');

    const validated = this.validator.validateEvent({
      appName,
      eventName,
      value,
      payload,
      labels,
    });

    const observabilityEvent: ObservabilityEvent = {
      id: randomUUID(),
      appName: validated.appName,
      eventName: validated.eventName,
      value: validated.value,
      payload: validated.payload,
      labels: { ...this.config.globalLabels, ...validated.labels },
      timestamp: new Date().toISOString(),
      environment: this.config.environment,
    };

    this.queue.enqueue(observabilityEvent);
  }

  /**
   * Manually flushes all queued events immediately.
   * Useful for graceful shutdown or testing.
   */
  async flush(): Promise<FlushResult> {
    this.assertInitialised('flush');
    return this.queue.flush();
  }

  /** Returns true if the SDK has been successfully initialised. */
  isInitialised(): boolean {
    return this.initialised;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private assertInitialised(method: string): void {
    if (!this.initialised) {
      throw new Error(
        `[ObservabilitySDK] ${method}() called before init(). ` +
          'Call await sdk.init({ appName, environment }) first.',
      );
    }
  }

  private registerShutdownHandlers(): void {
    // Each SDK instance adds 3 process listeners. Raise the limit dynamically
    // to avoid spurious MaxListenersExceededWarning when multiple instances
    // coexist (e.g., in test suites).
    process.setMaxListeners(process.getMaxListeners() + 3);

    const shutdownOnce = (() => {
      let called = false;
      return async (signal: string) => {
        if (called) return;
        called = true;
        this.logger.info('Shutdown signal received — flushing events', { signal });
        await this.shutdown();
      };
    })();

    const onSIGTERM = () => void shutdownOnce('SIGTERM');
    const onSIGINT = () => void shutdownOnce('SIGINT');
    const onBeforeExit = () => void shutdownOnce('beforeExit');

    process.once('SIGTERM', onSIGTERM);
    process.once('SIGINT', onSIGINT);
    process.once('beforeExit', onBeforeExit);

    // When the SDK shuts down normally, remove the handlers and release the
    // listener slots so the limit is restored.
    this.queue.once('flush', () => {
      process.off('SIGTERM', onSIGTERM);
      process.off('SIGINT', onSIGINT);
      process.off('beforeExit', onBeforeExit);
      process.setMaxListeners(Math.max(10, process.getMaxListeners() - 3));
    });
  }
}
