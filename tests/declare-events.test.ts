import { describe, it, beforeEach, expect, vi } from 'vitest';
import { ObservabilitySDK } from '../src/sdk';
import { deriveSemanticsUrl } from '../src/config';

const INGEST_URL = 'http://ingest-test.example.com/ingest';

describe('deriveSemanticsUrl', () => {
  it('appends /semantics to an /ingest URL', () => {
    expect(deriveSemanticsUrl('http://host/ingest')).toBe('http://host/ingest/semantics');
    expect(deriveSemanticsUrl('http://host/ingest/')).toBe('http://host/ingest/semantics');
  });

  it('appends /ingest/semantics to a base URL', () => {
    expect(deriveSemanticsUrl('http://host')).toBe('http://host/ingest/semantics');
  });
});

describe('ObservabilitySDK.declareEvents', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ registered: 2, skipped: 0, invalid: 0 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  async function init(sdk: ObservabilitySDK, extra: Record<string, unknown> = {}) {
    await sdk.init({
      appName: 'checkout',
      environment: 'test',
      logLevel: 'silent',
      apiUrl: INGEST_URL,
      batch: { maxSize: 100, flushIntervalMs: 60_000, flushTimeoutMs: 5_000 },
      ...extra,
    });
  }

  it('maps friendly declarations to the platform wire shape', async () => {
    let body: unknown;
    let url = '';
    fetchMock.mockImplementationOnce(async (u: string, i?: RequestInit) => {
      url = u;
      body = JSON.parse(i?.body as string);
      return new Response(JSON.stringify({ registered: 1, skipped: 0, invalid: 0 }), { status: 200 });
    });

    const sdk = new ObservabilitySDK();
    await init(sdk);
    const result = await sdk.declareEvents({
      new_customer: { aggregation: 'sum', unit: 'customers', aliases: ['signups'] },
    });

    expect(url).toBe('http://ingest-test.example.com/ingest/semantics');
    const rows = body as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      project_name: 'checkout',
      event_type: 'new_customer',
      default_aggregation: 'sum',
      metric_unit: 'customers',
      aliases: ['signups'],
    });
    expect(result).toEqual({ registered: 1, skipped: 0, invalid: 0 });
    await sdk.shutdown();
  });

  it('auto-registers declared events on init', async () => {
    const semanticsCalls: string[] = [];
    fetchMock.mockImplementation(async (u: string) => {
      if (String(u).endsWith('/semantics')) semanticsCalls.push(String(u));
      return new Response(JSON.stringify({ registered: 1, skipped: 0, invalid: 0 }), { status: 200 });
    });

    const sdk = new ObservabilitySDK();
    await init(sdk, { events: { deploy: { aggregation: 'count' } } });
    // init fires registration without awaiting; allow the microtask to settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(semanticsCalls.length).toBeGreaterThanOrEqual(1);
    await sdk.shutdown();
  });

  it('throws when called before init', async () => {
    const sdk = new ObservabilitySDK();
    await expect(sdk.declareEvents({ x: { aggregation: 'count' } })).rejects.toThrow();
  });
});
