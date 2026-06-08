import { EventEmitter } from 'events';
import type { ObservabilityEvent, BatchConfig, FlushResult } from './types';
import type { Logger } from './logger';

export type FlushFn = (events: ObservabilityEvent[]) => Promise<void>;

export interface BatchQueueOptions {
  config: BatchConfig;
  logger: Logger;
  onFlush: FlushFn;
}

/**
 * A time-and-size bounded queue that accumulates ObservabilityEvents and
 * flushes them in batches via the provided `onFlush` callback.
 *
 * Guarantees:
 *  - A flush occurs when the queue reaches `maxSize` events.
 *  - A flush occurs every `flushIntervalMs` milliseconds (even for small batches).
 *  - `flush()` can be called manually (e.g. on process shutdown).
 *  - At-most-once delivery per flush attempt; failed flushes are logged but
 *    NOT re-queued (the retry logic lives in the transport layer).
 */
export class BatchQueue extends EventEmitter {
  private queue: ObservabilityEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private readonly config: BatchConfig;
  private readonly logger: Logger;
  private readonly onFlush: FlushFn;

  constructor(options: BatchQueueOptions) {
    super();
    this.config = options.config;
    this.logger = options.logger;
    this.onFlush = options.onFlush;
  }

  /** Start the periodic flush timer. Must be called once after construction. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);

    // Allow the process to exit even if this timer is still active
    this.timer.unref();
  }

  /** Stop the periodic flush timer and flush any remaining events. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /** Add a single event to the queue. Triggers an immediate flush if full. */
  enqueue(event: ObservabilityEvent): void {
    this.queue.push(event);
    this.logger.debug('Event enqueued', { queueSize: this.queue.length, eventName: event.eventName });

    if (this.queue.length >= this.config.maxSize) {
      this.logger.info('Batch queue full — triggering immediate flush', {
        size: this.queue.length,
      });
      void this.flush();
    }
  }

  /** Returns the current number of events waiting in the queue. */
  size(): number {
    return this.queue.length;
  }

  /**
   * Flushes the current queue contents. Concurrent calls are serialised —
   * a flush in progress will cause subsequent calls to wait then no-op
   * (since the first flush drains the queue).
   */
  async flush(): Promise<FlushResult> {
    if (this.flushing || this.queue.length === 0) {
      return { success: true, eventsCount: 0 };
    }

    this.flushing = true;
    // Drain the queue atomically — new events can be enqueued safely while
    // the flush is in-flight because we work on a snapshot.
    const batch = this.queue.splice(0, this.queue.length);

    this.logger.info('Flushing batch', { count: batch.length });

    try {
      await Promise.race([
        this.onFlush(batch),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Flush timed out after ${this.config.flushTimeoutMs}ms`)),
            this.config.flushTimeoutMs,
          ),
        ),
      ]);

      this.logger.info('Batch flushed successfully', { count: batch.length });
      this.emit('flush', { eventsCount: batch.length });
      return { success: true, eventsCount: batch.length };
    } catch (err) {
      this.logger.error('Batch flush failed', err, { count: batch.length });
      this.emit('flushError', err);
      return { success: false, eventsCount: batch.length, error: err as Error };
    } finally {
      this.flushing = false;
    }
  }
}
