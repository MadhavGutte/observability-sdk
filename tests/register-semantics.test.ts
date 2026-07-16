import { describe, it, beforeEach, expect, vi } from 'vitest';
import { IngestClient } from '../src/ingest-client';
import { Logger } from '../src/logger';
import type { PlatformSemanticDeclaration } from '../src/types';

const silentLogger = new Logger('silent', 'test');

const defaultRetry = {
  maxAttempts: 2,
  initialDelayMs: 1,
  maxDelayMs: 5,
  multiplier: 2,
};

const config = {
  url: 'http://ingest.example.com/ingest',
  timeoutMs: 5_000,
  semanticsUrl: 'http://ingest.example.com/ingest/semantics',
};

function decl(overrides: Partial<PlatformSemanticDeclaration> = {}): PlatformSemanticDeclaration {
  return {
    project_name: 'my-app',
    event_type: 'new_customer',
    default_aggregation: 'sum',
    metric_unit: 'customers',
    display_name: 'New customers',
    description: null,
    aliases: ['signups'],
    ...overrides,
  };
}

describe('IngestClient.registerSemantics', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('POSTs declarations to the semantics URL and returns the result', async () => {
    let receivedUrl = '';
    let receivedBody: unknown;
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      receivedUrl = url;
      receivedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ registered: 1, skipped: 0, invalid: 0 }), { status: 200 });
    });

    const client = new IngestClient(config, defaultRetry, silentLogger);
    const result = await client.registerSemantics([decl()]);

    expect(receivedUrl).toBe('http://ingest.example.com/ingest/semantics');
    expect(Array.isArray(receivedBody)).toBe(true);
    expect((receivedBody as PlatformSemanticDeclaration[])[0].event_type).toBe('new_customer');
    expect(result).toEqual({ registered: 1, skipped: 0, invalid: 0 });
  });

  it('is a no-op for an empty declaration list', async () => {
    const client = new IngestClient(config, defaultRetry, silentLogger);
    const result = await client.registerSemantics([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ registered: 0, skipped: 0, invalid: 0 });
  });

  it('derives the semantics URL when not explicitly configured', async () => {
    let receivedUrl = '';
    fetchMock.mockImplementationOnce(async (url: string) => {
      receivedUrl = url;
      return new Response(JSON.stringify({ registered: 1, skipped: 0, invalid: 0 }), { status: 200 });
    });

    const client = new IngestClient(
      { url: 'http://host/ingest', timeoutMs: 5_000 },
      defaultRetry,
      silentLogger,
    );
    await client.registerSemantics([decl()]);
    expect(receivedUrl).toBe('http://host/ingest/semantics');
  });
});
