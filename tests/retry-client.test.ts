import nock from 'nock';
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

describe('RetryClient', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  it('returns response data on first successful POST', async () => {
    nock(BASE_URL).post(PATH, { hello: 'world' }).reply(200, { ok: true });

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, { hello: 'world' });
    expect(result).toEqual({ ok: true });
  });

  it('retries on 500 errors and succeeds on third attempt', async () => {
    nock(BASE_URL).post(PATH).reply(500, 'Internal Server Error');
    nock(BASE_URL).post(PATH).reply(500, 'Internal Server Error');
    nock(BASE_URL).post(PATH).reply(200, { ingested: true });

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ingested: true });
  });

  it('retries on 429 rate-limit errors', async () => {
    nock(BASE_URL).post(PATH).reply(429, 'Too Many Requests');
    nock(BASE_URL).post(PATH).reply(200, { ok: true });

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 2 },
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ok: true });
  });

  it('throws after exhausting all retry attempts', async () => {
    nock(BASE_URL).post(PATH).reply(503).persist();

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 2 },
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
  });

  it('does NOT retry on 400 bad request', async () => {
    nock(BASE_URL).post(PATH).reply(400, 'Bad Request');

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
    // nock would throw if the endpoint were called more than once
  });

  it('does NOT retry on 401 unauthorized', async () => {
    nock(BASE_URL).post(PATH).reply(401, 'Unauthorized');

    const client = new RetryClient({
      retry: defaultRetry,
      logger: silentLogger,
      timeoutMs: 5_000,
    });

    await expect(client.post(`${BASE_URL}${PATH}`, {})).rejects.toThrow();
  });

  it('sends Authorization header when apiKey is provided', async () => {
    nock(BASE_URL, {
      reqheaders: { authorization: 'Bearer secret-token' },
    })
      .post(PATH)
      .reply(200, { ok: true });

    const client = new RetryClient({
      retry: { ...defaultRetry, maxAttempts: 1 },
      logger: silentLogger,
      timeoutMs: 5_000,
      apiKey: 'secret-token',
    });

    const result = await client.post(`${BASE_URL}${PATH}`, {});
    expect(result).toEqual({ ok: true });
  });
});
