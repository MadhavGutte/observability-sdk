# @madhavgutte/observability-sdk

A production-grade Node.js/TypeScript SDK for emitting observability data:

- **Project events** → MySQL via the [ingest-proxy](../observability-infra) (batched JSON ingestion)

---

## Installation

```bash
npm install @madhavgutte/observability-sdk
```

Requires **Node.js ≥ 18**.

---

## Quick Start

```typescript
import { metrics } from '@madhavgutte/observability-sdk';

// 1. Initialise once at application startup
//    'team' in globalLabels is written to the project_events.team column
await metrics.init({
  appName: 'my-af-observability',
  environment: 'production',
  apiUrl: '<api-url/ingest>',
  globalLabels: { team: 'my-team' },
});

// 2. Emit a project event (→ MySQL via ingest-proxy)
//    Pass status in payload — it maps to project_events.status
metrics.event('my-af-observability', 'deploy', 42000, { status: 'success', environment: 'dev', version: 'abc123' });

// 3. Shutdown gracefully (also auto-wired to SIGTERM / SIGINT)
await metrics.shutdown();
```

---

## API Reference

### `metrics.init(options)`

Initialises the SDK. Must be called **once** before any metric methods.

| Option | Type | Default | Description |
|---|---|---|---|
| `appName` | `string` | **required** | Name of your project — maps to `project_events.project_name` |
| `environment` | `string` | **required** | `production`, `staging`, `development`, etc. |
| `apiUrl` | `string` | **required** | Full URL of the ingest proxy endpoint (e.g. `http://localhost:3100/ingest`) |
| `logLevel` | `string` | `'warn'` | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `globalLabels` | `object` | `{}` | Labels appended to every event. **Set `team` here** to populate `project_events.team` |
| `events` | `object` | `{}` | Optional map of event semantics (see [Declaring event semantics](#declaring-event-semantics)) |
| `batch` | `object` | see below | Batching config |
| `retry` | `object` | see below | Retry config |

---

## Declaring event semantics

The observability platform ships an AI assistant that answers questions like
*"how many new customers in the last 7 days?"*. To answer correctly it must know
whether "how many" means **counting events** or **summing `metric_value`** — and
that meaning lives in your service, not in the data.

Declare it once, where you know it best. The SDK registers your declarations with
the platform's semantics catalog on init.

```typescript
await metrics.init({
  appName: 'checkout',
  environment: 'production',
  apiUrl: 'http://localhost:3100/ingest',
  globalLabels: { team: 'growth' },

  events: {
    // "how many new customers" → SUM(metric_value), shown as "customers"
    new_customer: { aggregation: 'sum', unit: 'customers', aliases: ['signups', 'new users'] },
    // "how many deploys" → COUNT(*) of events
    deploy:       { aggregation: 'count', displayName: 'Deployments' },
  },
});
```

You can also declare later, explicitly:

```typescript
await metrics.declareEvents({
  order_placed: { aggregation: 'sum', unit: 'currency', description: 'Completed checkout orders' },
});
```

**Declaration fields** (per event):

| Field | Type | Description |
|---|---|---|
| `aggregation` | `'count' \| 'sum' \| 'avg' \| 'min' \| 'max'` | **required** — how the value is interpreted |
| `unit` | `string` | Unit label shown to users (e.g. `customers`) |
| `displayName` | `string` | Human-friendly name |
| `description` | `string` | What the event represents |
| `aliases` | `string[]` | Alternative phrasings a user might ask about |

Notes:
- Registration is **fire-and-forget** on init — a catalog outage never blocks event ingestion.
- **Precedence:** a semantics entry a human edits in the dashboard is **never** overwritten by an SDK declaration.
- Transport: declarations are POSTed to `<apiUrl>/semantics` (i.e. `/ingest/semantics`), the same private machine route as ingestion.

---

## Batching & retry config

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

Enqueues a project event for delivery to MySQL via the ingest proxy.

```typescript
metrics.event(
  'my-af-observability',     // appName       → project_events.project_name
  'deploy',                   // eventName     → project_events.event_type
  42000,                      // value         → project_events.metric_value
  {
    status: 'success',        // payload.status → project_events.status (required for meaningful data)
    version: 'abc123',        // remaining payload keys → project_events.metadata
  },
  { region: 'eu-west-1' },   // labels        → merged into project_events.metadata
);
```

> **`status` convention:** always pass `status` in `payload` with one of: `success`, `failed`, `skipped`. This is the value written to `project_events.status`. If omitted it defaults to `'unknown'`.

> **`team` convention:** set `team` in `globalLabels` during `init()` rather than per-event. It is written to `project_events.team`.

Throws `SDKValidationError` on invalid input.

---

### `metrics.flush()`

Manually flushes all queued events immediately. Returns a `FlushResult`.

```typescript
const { success, eventsCount, error } = await metrics.flush();
```

---

### `metrics.shutdown()`

Flushes remaining events and stops the flush timer. Also called automatically on `SIGTERM`, `SIGINT`, and `beforeExit`.

---

## Ingest Proxy Contract

The SDK sends **POST** requests with a JSON array body to `apiUrl`.

The SDK automatically maps its internal `ObservabilityEvent` fields to the `project_events` table shape:

| SDK field | `project_events` column | Notes |
|---|---|---|
| `appName` | `project_name` | |
| `globalLabels.team` | `team` | Set via `globalLabels: { team: '...' }` |
| `eventName` | `event_type` | |
| `payload.status` | `status` | Defaults to `'unknown'` if absent |
| `value` | `metric_value` | Treat as count or duration in ms |
| `payload` + `labels` + `environment` | `metadata` | Full JSON object |
| `timestamp` | `occurred_at` | Converted to MySQL datetime |

Example payload sent to the proxy:

```json
[
  {
    "project_name": "my-app",
    "team": "my-team",
    "event_type": "deploy",
    "status": "success",
    "metric_value": 42000,
    "metadata": { "status": "success", "version": "abc123", "environment": "production", "labels": { "team": "my-team" } },
    "occurred_at": "2026-06-18 10:00:00"
  }
]
```

See the [ingest-proxy README](../observability-infra/README.md) for the full API reference including `GET /events`.

---

## Error Handling

```typescript
import { SDKValidationError } from '@madhavgutte/observability-sdk';

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

## Examples

### Business metric counts

Use `event_type` as the metric name and `value` as the count. Always pass `status: 'recorded'` in payload for non-transactional metrics.

```typescript
await metrics.init({
  appName: 'my-crm',
  environment: 'production',
  apiUrl: 'http://localhost:3100/ingest',
  globalLabels: { team: 'my-team' },
});

// Customers total = 100
metrics.event('my-crm', 'customers_total', 100, {
  status: 'recorded',
  metric: 'customers_total',
  value: 100,
});

// Subscribers count = 150
metrics.event('my-crm', 'subscribers_count', 150, {
  status: 'recorded',
  metric: 'subscribers_count',
  value: 150,
});
```

This writes to `project_events` as:

| `project_name` | `team` | `event_type` | `status` | `metric_value` | `metadata` |
|---|---|---|---|---|---|
| `my-crm` | `my-team` | `customers_total` | `recorded` | `100` | `{ metric: 'customers_total', value: 100, ... }` |
| `my-crm` | `my-team` | `subscribers_count` | `recorded` | `150` | `{ metric: 'subscribers_count', value: 150, ... }` |

### CI/CD pipeline events

```typescript
// Build succeeded in 12 seconds
metrics.event('my-af-observability', 'build', 12000, {
  status: 'success',
  version: 'abc123',
  branch: 'main',
});

// Deploy failed
metrics.event('my-af-observability', 'deploy', 5000, {
  status: 'failed',
  environment: 'dev',
  reason: 'health check timeout',
});
```

### Query events back via the ingest proxy

```bash
# All CRM metrics recorded today
curl "http://localhost:3100/events?project=my-crm&from=2026-06-18"

# Only subscriber counts
curl "http://localhost:3100/events?project=my-crm&from=2026-06-18" \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(JSON.stringify(d.filter(e=>e.event_type==='subscribers_count'), null, 2))"
```

---

## Using Multiple Instances

The exported `metrics` is a singleton. For multiple instances (e.g., separate workers with different configs):

```typescript
import { ObservabilitySDK } from '@madhavgutte/observability-sdk';

const workerSDK = new ObservabilitySDK();
await workerSDK.init({
  appName: 'worker',
  environment: 'production',
  apiUrl: 'http://localhost:3100/ingest',
  globalLabels: { team: 'my-team' },
});
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

## Database Setup

The ingest proxy writes to a MySQL `project_events` table. Run this DDL against your MySQL instance before starting the proxy:

```sql
CREATE TABLE IF NOT EXISTS project_events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_name  VARCHAR(255)    NOT NULL,
  team          VARCHAR(255)    NOT NULL,
  event_type    VARCHAR(100)    NOT NULL,
  status        VARCHAR(50)     NOT NULL,
  metric_value   INT UNSIGNED,
  metadata      JSON,
  occurred_at   DATETIME        NOT NULL,
  created_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project  (project_name),
  INDEX idx_team     (team),
  INDEX idx_occurred (occurred_at)
);
```

See the [ingest-proxy README](../observability-infra/README.md) for full local setup instructions.

---

## License

MIT
