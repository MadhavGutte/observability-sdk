import nock from 'nock';
import { ClickHouseClient } from '../src/clickhouse-client';
import { Logger } from '../src/logger';
import type { ObservabilityEvent } from '../src/types';

const silentLogger = new Logger('silent', 'test');

const defaultRetry = {
  maxAttempts: 2,
  initialDelayMs: 1,
  maxDelayMs: 5,
  multiplier: 2,
};

const defaultConfig = {
  enabled: true,
  url: 'http://clickhouse.example.com/ingest',
  table: 'observability_events',
  timeoutMs: 5_000,
};

function makeEvent(name = 'test_event'): ObservabilityEvent {
  return {
    id: 'event-id-1',
    appName: 'test-app',
    eventName: name,
    value: 42,
    payload: { key: 'value' },
    labels: { env: 'test' },
    timestamp: '2024-01-01T00:00:00.000Z',
    environment: 'test',
  };
}

describe('ClickHouseClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('sends events as NDJson to the correct URL', async () => {
    let receivedBody = '';
    nock('http://clickhouse.example.com')
      .post('/ingest')
      .query({ table: 'observability_events' })
      .reply(200, function (_uri, requestBody) {
        receivedBody = requestBody as string;
        return { status: 'ok' };
      });

    const client = new ClickHouseClient(defaultConfig, defaultRetry, silentLogger);
    await client.send([makeEvent('purchase'), makeEvent('view')]);

    const lines = receivedBody.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).eventName).toBe('purchase');
    expect(JSON.parse(lines[1]).eventName).toBe('view');
  });

  it('sends the X-Batch-Size header', async () => {
    nock('http://clickhouse.example.com', {
      reqheaders: { 'x-batch-size': '3' },
    })
      .post('/ingest')
      .query(true)
      .reply(200, {});

    const client = new ClickHouseClient(defaultConfig, defaultRetry, silentLogger);
    await client.send([makeEvent(), makeEvent(), makeEvent()]);
  });

  it('no-ops when enabled is false', async () => {
    const config = { ...defaultConfig, enabled: false };
    const client = new ClickHouseClient(config, defaultRetry, silentLogger);
    // nock would throw if a real HTTP request is made
    await expect(client.send([makeEvent()])).resolves.toBeUndefined();
  });

  it('no-ops when events array is empty', async () => {
    const client = new ClickHouseClient(defaultConfig, defaultRetry, silentLogger);
    await expect(client.send([])).resolves.toBeUndefined();
  });

  it('sends apiKey as Bearer token', async () => {
    nock('http://clickhouse.example.com', {
      reqheaders: { authorization: 'Bearer my-secret' },
    })
      .post('/ingest')
      .query(true)
      .reply(200, {});

    const config = { ...defaultConfig, apiKey: 'my-secret' };
    const client = new ClickHouseClient(config, defaultRetry, silentLogger);
    await client.send([makeEvent()]);
  });

  it('throws when the ingestion endpoint returns an error', async () => {
    nock('http://clickhouse.example.com')
      .post('/ingest')
      .query(true)
      .reply(500, 'Internal Server Error')
      .persist();

    const client = new ClickHouseClient(defaultConfig, defaultRetry, silentLogger);
    await expect(client.send([makeEvent()])).rejects.toThrow();
  });
});
