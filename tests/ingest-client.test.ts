import { IngestClient } from '../src/ingest-client';
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
  url: 'http://ingest.example.com/ingest',
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

describe('IngestClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends events as a JSON array to the correct URL', async () => {
    let receivedBody: unknown;
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      receivedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ status: 'ok', inserted: 2 }), { status: 200 });
    });

    const client = new IngestClient(defaultConfig, defaultRetry, silentLogger);
    await client.send([makeEvent('build'), makeEvent('deploy')]);

    expect(Array.isArray(receivedBody)).toBe(true);
    const rows = receivedBody as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].event_type).toBe('build');
    expect(rows[1].event_type).toBe('deploy');
  });

  it('maps ObservabilityEvent fields to the proxy ProjectEvent shape', async () => {
    let receivedBody: unknown;
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      receivedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ status: 'ok', inserted: 1 }), { status: 200 });
    });

    const event: ObservabilityEvent = {
      id: 'evt-1',
      appName: 'my-app',
      eventName: 'deploy',
      value: 5000,
      payload: { status: 'success', version: 'abc' },
      labels: { team: 'saptech', env: 'prod' },
      timestamp: '2024-06-01T12:34:56.000Z',
      environment: 'production',
    };

    const client = new IngestClient(defaultConfig, defaultRetry, silentLogger);
    await client.send([event]);

    const rows = receivedBody as Array<Record<string, unknown>>;
    expect(rows[0].project_name).toBe('my-app');
    expect(rows[0].team).toBe('saptech');
    expect(rows[0].event_type).toBe('deploy');
    expect(rows[0].status).toBe('success');
    expect(rows[0].metric_value).toBe(5000);
    expect(rows[0].occurred_at).toBe('2024-06-01 12:34:56');
  });

  it('sends the X-Batch-Size header', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const client = new IngestClient(defaultConfig, defaultRetry, silentLogger);
    await client.send([makeEvent(), makeEvent(), makeEvent()]);

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['X-Batch-Size']).toBe('3');
  });

  it('no-ops when events array is empty', async () => {
    const client = new IngestClient(defaultConfig, defaultRetry, silentLogger);
    await expect(client.send([])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the ingestion endpoint returns an error', async () => {
    fetchMock.mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const client = new IngestClient(defaultConfig, defaultRetry, silentLogger);
    await expect(client.send([makeEvent()])).rejects.toThrow();
  });
});
