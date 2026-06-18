import { RetryClient } from '../src/retry-client';
import { Logger } from '../src/logger';

const silentLogger = new Logger('silent', 'test');

const BASE_URL = 'http://ingest.example.com';
const PATH = '/events';

const defaultRetry = {
  maxAttempts: 3,
  initialDelayMs: 1,   // keep tests fast
  maxDelayMs: 5,
  multiplier: 2,
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function fail(status: number): Response {
  return new Response('error', { status });
}

describe('RetryClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns response data on first successful POST', async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, { hello: 'world' });
    expect(result).toEqual({ ok: true });

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${BASE_URL}${PATH}`);
    expect(JSON.parse(init?.body as string)).toEqual({ hello: 'world' });
  });

  it('retries on 500 errors and succeeds on third attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValueOnce(fail(500))
      .mockResolvedValueOnce(ok({ ingested: true }));

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ingested: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 429 rate-limit errors', async () => {
    fetchMock
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(ok({ ok: true }));

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 2 },
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ok: true });
  });

  it('throws after exhausting all retry attempts', async () => {
    fetchMock.mockResolvedValue(fail(503));

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 2 },
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 bad request', async () => {
    fetchMock.mockResolvedValueOnce(fail(400));

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 unauthorized', async () => {
    fetchMock.mockResolvedValueOnce(fail(401));

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends Authorization header when apiKey is provided', async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true }));

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 1 },
      logger: silentLogger,
      timeoutMs: 5_000,
      apiKey: 'secret-token',
    });

    await client.post(`${BASE_URL}${PATH}`, {});
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer secret-token');
  });

  it('retries on network error', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(ok({ ok: true }));

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 2 },
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
