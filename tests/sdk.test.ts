import nock from 'nock';
import { ObservabilitySDK } from '../src/sdk';
import { SDKValidationError } from '../src/schema-validator';

const CLICKHOUSE_URL = 'http://ch-test.example.com';

function makeSDK() {
  return new ObservabilitySDK();
}

async function initSDK(sdk: ObservabilitySDK, overrides: Record<string, unknown> = {}) {
  await sdk.init({
    appName: 'test-service',
    environment: 'test',
    logLevel: 'silent',
    batch: { maxSize: 100, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
    prometheus: { enabled: false, port: 0, path: '/metrics', collectDefaultMetrics: false, prefix: '' },
    clickhouse: {
      enabled: true,
      url: `${CLICKHOUSE_URL}/ingest`,
      table: 'events',
      timeoutMs: 5_000,
    },
    ...overrides,
  });
}

describe('ObservabilitySDK', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  // ─── init ──────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('initialises successfully', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(sdk.isInitialised()).toBe(true);
      await sdk.shutdown();
    });

    it('is idempotent — second call is a no-op', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      await initSDK(sdk); // should not throw
      expect(sdk.isInitialised()).toBe(true);
      await sdk.shutdown();
    });
  });

  // ─── event() ───────────────────────────────────────────────────────────────

  describe('event()', () => {
    it('enqueues an event without throwing', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.event('test-service', 'user_login', 1)).not.toThrow();
      await sdk.shutdown();
    });

    it('enqueues an event with payload and labels', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() =>
        sdk.event('test-service', 'purchase', 99.99, { orderId: '123' }, { region: 'eu' }),
      ).not.toThrow();
      await sdk.shutdown();
    });

    it('throws SDKValidationError on invalid appName', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.event('', 'event', 1)).toThrow(SDKValidationError);
      await sdk.shutdown();
    });

    it('throws SDKValidationError on Infinity value', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.event('app', 'ev', Infinity)).toThrow(SDKValidationError);
      await sdk.shutdown();
    });

    it('throws if called before init()', () => {
      const sdk = makeSDK();
      expect(() => sdk.event('app', 'ev', 1)).toThrow(/init\(\)/);
    });
  });

  // ─── counter() ─────────────────────────────────────────────────────────────

  describe('counter()', () => {
    it('records a counter without throwing', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.counter('http_requests_total', 1, { method: 'GET' })).not.toThrow();
      await sdk.shutdown();
    });

    it('defaults value to 1', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.counter('hits_total')).not.toThrow();
      await sdk.shutdown();
    });

    it('throws SDKValidationError on negative value', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.counter('c', -1)).toThrow(SDKValidationError);
      await sdk.shutdown();
    });

    it('throws if called before init()', () => {
      const sdk = makeSDK();
      expect(() => sdk.counter('c', 1)).toThrow(/init\(\)/);
    });
  });

  // ─── gauge() ───────────────────────────────────────────────────────────────

  describe('gauge()', () => {
    it('records a positive gauge', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.gauge('memory_bytes', 1_048_576)).not.toThrow();
      await sdk.shutdown();
    });

    it('records a negative gauge', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      expect(() => sdk.gauge('temperature_c', -12.5)).not.toThrow();
      await sdk.shutdown();
    });

    it('throws if called before init()', () => {
      const sdk = makeSDK();
      expect(() => sdk.gauge('g', 1)).toThrow(/init\(\)/);
    });
  });

  // ─── flush() ───────────────────────────────────────────────────────────────

  describe('flush()', () => {
    it('flushes queued events and returns success', async () => {
      nock(CLICKHOUSE_URL).post('/ingest').query(true).reply(200, {});

      const sdk = makeSDK();
      await initSDK(sdk);
      sdk.event('test-service', 'signup', 1);
      const result = await sdk.flush();
      expect(result.success).toBe(true);
      expect(result.eventsCount).toBe(1);
      await sdk.shutdown();
    });

    it('returns eventsCount=0 when queue is empty', async () => {
      const sdk = makeSDK();
      await initSDK(sdk);
      const result = await sdk.flush();
      expect(result.eventsCount).toBe(0);
      await sdk.shutdown();
    });
  });

  // ─── shutdown() ────────────────────────────────────────────────────────────

  describe('shutdown()', () => {
    it('flushes remaining events on shutdown', async () => {
      nock(CLICKHOUSE_URL).post('/ingest').query(true).reply(200, {});

      const sdk = makeSDK();
      await initSDK(sdk);
      sdk.event('test-service', 'shutdown_event', 1);
      await sdk.shutdown();

      expect(sdk.isInitialised()).toBe(false);
    });

    it('is safe to call when not initialised', async () => {
      const sdk = makeSDK();
      await expect(sdk.shutdown()).resolves.toBeUndefined();
    });
  });
});
