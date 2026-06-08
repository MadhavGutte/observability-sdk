import { BatchQueue } from '../src/batch-queue';
import type { ObservabilityEvent } from '../src/types';
import { Logger } from '../src/logger';

// Minimal logger that does nothing during tests
const silentLogger = new Logger('silent', 'test');

function makeEvent(name = 'test_event'): ObservabilityEvent {
  return {
    id: `id-${Math.random()}`,
    appName: 'test-app',
    eventName: name,
    value: 1,
    payload: {},
    labels: {},
    timestamp: new Date().toISOString(),
    environment: 'test',
  };
}

describe('BatchQueue', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('enqueues events and reports correct size', () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      config: { maxSize: 10, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    queue.enqueue(makeEvent());
    queue.enqueue(makeEvent());
    expect(queue.size()).toBe(2);
  });

  it('flushes all events and clears the queue', async () => {
    const flushed: ObservabilityEvent[][] = [];
    const onFlush = jest.fn().mockImplementation(async (events) => {
      flushed.push(events);
    });

    const queue = new BatchQueue({
      config: { maxSize: 100, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    queue.enqueue(makeEvent('a'));
    queue.enqueue(makeEvent('b'));

    const result = await queue.flush();

    expect(result.success).toBe(true);
    expect(result.eventsCount).toBe(2);
    expect(queue.size()).toBe(0);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(flushed[0]).toHaveLength(2);
  });

  it('triggers immediate flush when queue reaches maxSize', async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      config: { maxSize: 3, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    queue.enqueue(makeEvent());
    queue.enqueue(makeEvent());
    queue.enqueue(makeEvent()); // triggers flush

    // Give the microtask queue a tick to allow the async flush to start
    await new Promise((r) => setImmediate(r));

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('returns eventsCount=0 when queue is empty', async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      config: { maxSize: 10, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    const result = await queue.flush();
    expect(result.eventsCount).toBe(0);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('returns success=false and an error when onFlush rejects', async () => {
    const onFlush = jest.fn().mockRejectedValue(new Error('network error'));
    const queue = new BatchQueue({
      config: { maxSize: 10, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    queue.enqueue(makeEvent());
    const result = await queue.flush();

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('network error');
  });

  it('emits flushError event on failed flush', async () => {
    const onFlush = jest.fn().mockRejectedValue(new Error('upstream down'));
    const queue = new BatchQueue({
      config: { maxSize: 10, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });

    const errorHandler = jest.fn();
    queue.on('flushError', errorHandler);

    queue.enqueue(makeEvent());
    await queue.flush();

    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  it('stops the timer and flushes remaining events on stop()', async () => {
    const onFlush = jest.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      config: { maxSize: 100, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      logger: silentLogger,
      onFlush,
    });
    queue.start();
    queue.enqueue(makeEvent());
    await queue.stop();

    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('handles flush timeout', async () => {
    const onFlush = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10_000)), // never resolves in time
    );
    const queue = new BatchQueue({
      config: { maxSize: 100, flushIntervalMs: 60_000, flushTimeoutMs: 50 },
      logger: silentLogger,
      onFlush,
    });

    queue.enqueue(makeEvent());
    const result = await queue.flush();

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('timed out');
  });
});
