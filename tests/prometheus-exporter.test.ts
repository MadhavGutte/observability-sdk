import { PrometheusExporter } from '../src/prometheus-exporter';
import { Logger } from '../src/logger';
import * as http from 'http';

const silentLogger = new Logger('silent', 'test');

function makeConfig(port: number) {
  return {
    enabled: true,
    port,
    path: '/metrics',
    collectDefaultMetrics: false, // keep tests fast
    prefix: 'test_',
    defaultLabels: { app: 'test' },
  };
}

async function fetchMetrics(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/metrics`, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchStatus(port: number, path = '/metrics'): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });
}

describe('PrometheusExporter', () => {
  // Use a unique port per test to avoid port conflicts
  let port = 19_464;
  const nextPort = () => ++port;

  it('starts an HTTP server that serves /metrics', async () => {
    const p = nextPort();
    const exporter = new PrometheusExporter(makeConfig(p), silentLogger);
    await exporter.start();

    const body = await fetchMetrics(p);
    expect(typeof body).toBe('string');

    await exporter.stop();
  });

  it('returns 404 for unknown paths', async () => {
    const p = nextPort();
    const exporter = new PrometheusExporter(makeConfig(p), silentLogger);
    await exporter.start();

    const status = await fetchStatus(p, '/unknown');
    expect(status).toBe(404);

    await exporter.stop();
  });

  it('incrementCounter produces output in /metrics', async () => {
    const p = nextPort();
    const exporter = new PrometheusExporter(makeConfig(p), silentLogger);
    await exporter.start();

    exporter.incrementCounter('api_calls', 5, { method: 'GET' });

    const body = await fetchMetrics(p);
    expect(body).toContain('test_api_calls');

    await exporter.stop();
  });

  it('setGauge produces output in /metrics', async () => {
    const p = nextPort();
    const exporter = new PrometheusExporter(makeConfig(p), silentLogger);
    await exporter.start();

    exporter.setGauge('heap_bytes', 1_048_576, {});

    const body = await fetchMetrics(p);
    expect(body).toContain('test_heap_bytes');
    expect(body).toContain('1048576');

    await exporter.stop();
  });

  it('no-ops when disabled', async () => {
    const config = { ...makeConfig(nextPort()), enabled: false };
    const exporter = new PrometheusExporter(config, silentLogger);
    // Should not bind a port or throw
    await expect(exporter.start()).resolves.toBeUndefined();
    exporter.incrementCounter('should_not_appear', 1, {});
    await expect(exporter.stop()).resolves.toBeUndefined();
  });

  it('accumulates counter values across multiple calls', async () => {
    const p = nextPort();
    const exporter = new PrometheusExporter(makeConfig(p), silentLogger);
    await exporter.start();

    exporter.incrementCounter('events_total', 3, {});
    exporter.incrementCounter('events_total', 7, {});

    const body = await fetchMetrics(p);
    expect(body).toContain('10');

    await exporter.stop();
  });
});
