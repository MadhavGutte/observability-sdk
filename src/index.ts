/**
 * @observability/sdk — Public API
 *
 * Quick start:
 *
 *   import { metrics } from '@observability/sdk';
 *
 *   await metrics.init({ appName: 'my-service', environment: 'production' });
 *
 *   metrics.event('my-service', 'user_signup', 1, { plan: 'pro' });
 *   metrics.counter('http_requests_total', 1, { method: 'GET' });
 *   metrics.gauge('queue_depth', 42);
 */

// ─── Core class ───────────────────────────────────────────────────────────────
export { ObservabilitySDK } from './sdk';

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  Environment,
  LogLevel,
  Labels,
  EventPayload,
  SDKInitOptions,
  SDKConfig,
  RetryConfig,
  BatchConfig,
  PrometheusConfig,
  ClickHouseConfig,
  ObservabilityEvent,
  CounterMetric,
  GaugeMetric,
  FlushResult,
  SDKErrorCode,
} from './types';

// ─── Errors ───────────────────────────────────────────────────────────────────
export { SDKValidationError } from './schema-validator';

// ─── Singleton convenience export ─────────────────────────────────────────────
// The `metrics` singleton is the primary entrypoint for most applications.
// Import and call `await metrics.init(...)` once at startup, then use
// `metrics.event()`, `metrics.counter()`, `metrics.gauge()` anywhere.
import { ObservabilitySDK } from './sdk';

/**
 * Pre-built singleton instance of ObservabilitySDK.
 *
 * @example
 *   import { metrics } from '@observability/sdk';
 *   await metrics.init({ appName: 'checkout', environment: 'production' });
 *   metrics.event('checkout', 'order_placed', 99.99);
 *   metrics.counter('http_requests_total', 1, { method: 'POST' });
 *   metrics.gauge('active_connections', 17);
 */
export const metrics = new ObservabilitySDK();
