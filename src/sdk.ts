import { randomUUID } from 'crypto';
import type {
  SDKInitOptions,
  SDKConfig,
  ObservabilityEvent,
  EventPayload,
  Labels,
  FlushResult,
  EventSemanticsMap,
  PlatformSemanticDeclaration,
  RegisterSemanticsResult,
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
 *      components and starts the flush timer.
 *   2. Use `sdk.event()` freely.
 *   3. `await sdk.shutdown()` — flushes the queue and stops the flush timer.
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

    // Register declared event semantics with the platform catalog. Fire-and-forget:
    // a catalog outage must never prevent the app from emitting events.
    if (this.config.events && Object.keys(this.config.events).length > 0) {
      void this.declareEvents(this.config.events).catch((err: unknown) => {
        this.logger.warn('Event semantics registration failed (events still ingest normally)', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Flushes any queued events and stops the flush timer.
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

  /**
   * Declares the meaning of one or more event types to the platform's semantics
   * catalog. Called automatically on init when `events` is supplied, but can also
   * be called explicitly. `project_name` is this SDK instance's `appName`.
   *
   * Precedence: a semantics entry a human configured in the dashboard is never
   * overwritten by an SDK declaration.
   *
   * @example
   *   await metrics.declareEvents({
   *     new_customer: { aggregation: 'sum', unit: 'customers', aliases: ['signups'] },
   *     deploy:       { aggregation: 'count' },
   *   });
   */
  async declareEvents(events: EventSemanticsMap): Promise<RegisterSemanticsResult> {
    this.assertInitialised('declareEvents');

    const declarations: PlatformSemanticDeclaration[] = Object.entries(events).map(
      ([eventName, decl]) => ({
        project_name: this.config.appName,
        event_type: eventName,
        default_aggregation: decl.aggregation,
        metric_unit: decl.unit ?? null,
        display_name: decl.displayName ?? null,
        description: decl.description ?? null,
        aliases: decl.aliases ?? [],
      }),
    );

    return this.ingest.registerSemantics(declarations);
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
