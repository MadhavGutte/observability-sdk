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

    // Required: URL of the observability ingest proxy
    apiUrl: 'https://ingest.internal.example.com/ingest',

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

    // Declare what each event means so the observability AI assistant can answer
    // questions like "how many new customers this week" without a human
    // configuring semantics. A dashboard edit always overrides these.
    events: {
      order_placed:  { aggregation: 'sum', unit: 'currency', displayName: 'Orders placed' },
      new_customer:  { aggregation: 'sum', unit: 'customers', aliases: ['signups', 'new users'] },
      deploy:        { aggregation: 'count', displayName: 'Deployments' },
    },
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Emit business events  →  ingest proxy
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
  // 3. Manual flush (optional — useful in tests or before SIGTERM)
  // ─────────────────────────────────────────────────────────────────────────

  const result = await metrics.flush();
  console.log('Manual flush result:', result);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Using a standalone SDK instance instead of the singleton
  // ─────────────────────────────────────────────────────────────────────────

  const mySDK = new ObservabilitySDK();
  await mySDK.init({
    appName: 'worker-service',
    environment: 'staging',
    logLevel: 'debug',
    apiUrl: 'https://ingest.internal.example.com/ingest',
  });
  mySDK.event('worker-service', 'job_processed', 1, { jobId: 'j-42', durationMs: 120 });
  await mySDK.shutdown();

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Graceful shutdown (SIGTERM / SIGINT handlers are registered automatically)
  //    Calling shutdown() manually is optional but ensures clean exit in scripts.
  // ─────────────────────────────────────────────────────────────────────────

  await metrics.shutdown();
  console.log('SDK shut down — all events flushed.');
}

main().catch((err) => {
  console.error('Fatal error in example:', err);
  process.exit(1);
});
