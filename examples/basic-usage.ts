/**
 * basic-usage.ts — Example usage of the @observability/sdk
 *
 * Run with:   npx ts-node examples/basic-usage.ts
 * Or compile: npx tsc --project tsconfig.test.json && node dist/examples/basic-usage.js
 */

import { metrics, ObservabilitySDK } from '../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// 1. One-time initialisation (at application startup)
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  await metrics.init({
    appName: 'checkout-service',
    environment: 'production',
    logLevel: 'info',

    // Prometheus: scrape endpoint at http://0.0.0.0:9464/metrics
    prometheus: {
      enabled: true,
      port: 9464,
      collectDefaultMetrics: true,
      prefix: 'checkout_',
      defaultLabels: { service: 'checkout' },
    },

    // ClickHouse: business events ingested via HTTP
    clickhouse: {
      enabled: true,
      url: 'https://ingest.internal.example.com/events',
      table: 'business_events',
      apiKey: process.env.CLICKHOUSE_API_KEY,
      timeoutMs: 8_000,
    },

    // Batching: flush every 5 s or when 200 events accumulate
    batch: {
      maxSize: 200,
      flushIntervalMs: 5_000,
    },

    // Retries: 3 attempts with exponential backoff + jitter
    retry: {
      maxAttempts: 3,
      initialDelayMs: 300,
      maxDelayMs: 15_000,
      multiplier: 2,
    },

    // Labels appended to every metric and event
    globalLabels: {
      region: 'eu-west-1',
      version: '2.4.1',
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Emit business events  →  ClickHouse
  //    metrics.event(appName, eventName, value, payload?, labels?)
  // ─────────────────────────────────────────────────────────────────────────

  // Simple numeric event
  metrics.event('checkout-service', 'order_placed', 149.99);

  // Event with structured payload
  metrics.event(
    'checkout-service',
    'order_placed',
    49.99,
    { orderId: 'ord-001', currency: 'EUR', items: 3 },
    { paymentMethod: 'card' },
  );

  // High-volume click-stream event
  metrics.event('checkout-service', 'product_viewed', 1, { productId: 'sku-9876' });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Prometheus counters  →  /metrics scrape endpoint
  //    metrics.counter(name, value?, labels?)
  // ─────────────────────────────────────────────────────────────────────────

  metrics.counter('http_requests_total', 1, { method: 'POST', status: '200', path: '/orders' });
  metrics.counter('http_requests_total', 1, { method: 'GET', status: '404', path: '/orders/99' });
  metrics.counter('payment_attempts_total', 1, { provider: 'stripe', result: 'success' });

  // Default value is 1
  metrics.counter('cache_hits_total');

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Prometheus gauges  →  /metrics scrape endpoint
  //    metrics.gauge(name, value, labels?)
  // ─────────────────────────────────────────────────────────────────────────

  metrics.gauge('memory_heap_used_bytes', process.memoryUsage().heapUsed);
  metrics.gauge('active_db_connections', 12, { pool: 'primary' });
  metrics.gauge('queue_depth', 0, { queue: 'orders' });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Manual flush (optional — useful in tests or before SIGTERM)
  // ─────────────────────────────────────────────────────────────────────────

  const result = await metrics.flush();
  console.log('Manual flush result:', result);

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Using a standalone SDK instance instead of the singleton
  // ─────────────────────────────────────────────────────────────────────────

  const mySDK = new ObservabilitySDK();
  await mySDK.init({ appName: 'worker-service', environment: 'staging', logLevel: 'debug' });
  mySDK.event('worker-service', 'job_processed', 1, { jobId: 'j-42', durationMs: 120 });
  await mySDK.shutdown();

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Graceful shutdown (SIGTERM / SIGINT handlers are registered automatically)
  //    Calling shutdown() manually is optional but ensures clean exit in scripts.
  // ─────────────────────────────────────────────────────────────────────────

  await metrics.shutdown();
  console.log('SDK shut down — all events flushed.');
}

main().catch((err) => {
  console.error('Fatal error in example:', err);
  process.exit(1);
});
