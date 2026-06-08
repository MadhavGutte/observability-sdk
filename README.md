# @observability/sdk

A production-grade Node.js/TypeScript SDK for emitting observability data:

- **Business events** → ClickHouse (batched NDJson ingestion)
- **Technical metrics** → Prometheus (scraped `/metrics` endpoint)

---

## Installation

```bash
npm install @observability/sdk
```

Requires **Node.js ≥ 18**.

---

## Quick Start

```typescript
import { metrics } from '@observability/sdk';

// 1. Initialise once at application startup
await metrics.init({
  appName: 'checkout-service',
  environment: 'production',
  clickhouse: {
    url: 'https://ingest.example.com/events',
    table: 'business_events',
    apiKey: process.env.CLICKHOUSE_API_KEY,
  },
});

// 2. Emit a business event (→ ClickHouse)
metrics.event('checkout-service', 'order_placed', 149.99, { orderId: 'ord-001' });

// 3. Increment a Prometheus counter (→ /metrics)
metrics.counter('http_requests_total', 1, { method: 'POST', status: '200' });

// 4. Set a Prometheus gauge (→ /metrics)
metrics.gauge('memory_heap_used_bytes', process.memoryUsage().heapUsed);

// 5. Shutdown gracefully (also auto-wired to SIGTERM / SIGINT)
await metrics.shutdown();
```

---

## API Reference

### `metrics.init(options)`

Initialises the SDK. Must be called **once** before any metric methods.

| Option | Type | Default | Description |
|---|---|---|---|
| `appName` | `string` | **required** | Name of your service |
| `environment` | `string` | **required** | `production`, `staging`, `development`, etc. |
| `logLevel` | `string` | `'warn'` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `globalLabels` | `object` | `{}` | Labels appended to every metric and event |
| `prometheus` | `object` | see below | Prometheus exporter config |
| `clickhouse` | `object` | see below | ClickHouse ingestion config |
| `batch` | `object` | see below | Batching config |
| `retry` | `object` | see below | Retry config |

#### `prometheus` defaults
```typescript
{
  enabled: true,
  port: 9464,           // scrape port
  path: '/metrics',
  prefix: '',           // prepended to all metric names
  collectDefaultMetrics: true,  // Node.js process metrics
  defaultLabels: {},
}
```

#### `clickhouse` defaults
```typescript
{
  enabled: true,
  url: 'http://localhost:8123/ingest',
  table: 'observability_events',
  apiKey: undefined,    // sent as Bearer token
  timeoutMs: 10_000,
}
```

#### `batch` defaults
```typescript
{
  maxSize: 100,             // flush when queue reaches 100 events
  flushIntervalMs: 5_000,   // flush every 5 seconds regardless
  flushTimeoutMs: 30_000,   // abort a stuck flush after 30 seconds
}
```

#### `retry` defaults
```typescript
{
  maxAttempts: 3,
  initialDelayMs: 200,
  maxDelayMs: 10_000,
  multiplier: 2,            // exponential backoff with full jitter
}
```

---

### `metrics.event(appName, eventName, value, payload?, labels?)`

Enqueues a business event for delivery to ClickHouse.

```typescript
metrics.event(
  'checkout-service',         // appName
  'order_placed',             // eventName  (alphanumeric, _ - . space)
  149.99,                     // value      (finite number)
  { orderId: 'ord-001' },     // payload    (any JSON object)
  { region: 'eu-west-1' },   // labels     (key → string | number | boolean)
);
```

Throws `SDKValidationError` on invalid input.

---

### `metrics.counter(name, value?, labels?)`

Increments a Prometheus counter.

```typescript
metrics.counter('http_requests_total', 1, { method: 'GET', status: '200' });
metrics.counter('cache_hits_total');  // value defaults to 1
```

- `name` must be a valid Prometheus metric name: `/^[a-zA-Z_:][a-zA-Z0-9_:]*$/`
- `value` must be ≥ 0

---

### `metrics.gauge(name, value, labels?)`

Sets a Prometheus gauge to an arbitrary value (can be negative).

```typescript
metrics.gauge('memory_heap_used_bytes', process.memoryUsage().heapUsed);
metrics.gauge('temperature_c', -12.5);
```

---

### `metrics.flush()`

Manually flushes all queued events immediately. Returns a `FlushResult`.

```typescript
const { success, eventsCount, error } = await metrics.flush();
```

---

### `metrics.shutdown()`

Flushes remaining events and stops the Prometheus HTTP server. Also called automatically on `SIGTERM`, `SIGINT`, and `beforeExit`.

---

## ClickHouse Ingestion Contract

The SDK sends **POST** requests with an NDJson body (one JSON object per line) to `clickhouse.url?table=<table>`.

Each row has this shape:

```json
{
  "id": "uuid-v4",
  "appName": "checkout-service",
  "eventName": "order_placed",
  "value": 149.99,
  "payload": { "orderId": "ord-001" },
  "labels": { "region": "eu-west-1" },
  "timestamp": "2024-01-15T10:30:00.000Z",
  "environment": "production"
}
```

Your ClickHouse table must have columns matching this schema (see [Setup Guide](#clickhouse-setup)).

---

## Prometheus Integration

The SDK starts an HTTP server (default port **9464**). Point your Prometheus scrape config at it:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'checkout-service'
    static_configs:
      - targets: ['checkout-service:9464']
```

---

## Error Handling

```typescript
import { SDKValidationError } from '@observability/sdk';

try {
  metrics.event('', 'bad', Infinity);
} catch (err) {
  if (err instanceof SDKValidationError) {
    console.error(err.message);  // detailed field-level validation message
    console.error(err.issues);   // raw Zod issues array
  }
}
```

Non-retryable transport errors (4xx) are logged and dropped. Retryable errors (5xx, 429, network) are retried with exponential backoff + jitter up to `retry.maxAttempts`.

---

## Using Multiple Instances

The exported `metrics` is a singleton. For multiple instances (e.g., micro-frontends or workers with separate configs):

```typescript
import { ObservabilitySDK } from '@observability/sdk';

const workerSDK = new ObservabilitySDK();
await workerSDK.init({ appName: 'worker', environment: 'production' });
```

---

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Watch mode
npm run build:watch
npm run test:watch
```

---

## ClickHouse Setup

See the [ClickHouse Self-Hosting Guide](#) in your setup documentation.

---

## License

MIT
