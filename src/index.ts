/**
 * @observability/sdk — Public API
 *
 * Quick start:
 *
 *   import { metrics } from '@observability/sdk';
 *
 *   await metrics.init({ appName: 'my-service', environment: 'production', apiUrl: 'http://localhost:3100/ingest' });
 *
 *   metrics.event('my-service', 'user_signup', 1, { plan: 'pro' });
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
  IngestConfig,
  ObservabilityEvent,
  FlushResult,
  SDKErrorCode,
  EventAggregation,
  EventSemanticDeclaration,
  EventSemanticsMap,
  RegisterSemanticsResult,
} from './types';

// ─── Errors ───────────────────────────────────────────────────────────────────
export { SDKValidationError } from './schema-validator';

// ─── Singleton convenience export ─────────────────────────────────────────────
// The `metrics` singleton is the primary entrypoint for most applications.
// Import and call `await metrics.init(...)` once at startup, then use
// `metrics.event()` anywhere.
import { ObservabilitySDK } from './sdk';

/**
 * Pre-built singleton instance of ObservabilitySDK.
 *
 * @example
 *   import { metrics } from '@observability/sdk';
 *   await metrics.init({ appName: 'checkout', environment: 'production' });
 *   metrics.event('checkout', 'order_placed', 99.99);
 */
export const metrics = new ObservabilitySDK();
