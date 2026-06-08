import * as http from 'http';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Gauge,
} from 'prom-client';
import type { PrometheusConfig, Labels } from './types';
import type { Logger } from './logger';

/**
 * Manages a dedicated Prometheus Registry, exposes a /metrics HTTP endpoint,
 * and provides typed counter/gauge registration + recording.
 */
export class PrometheusExporter {
  private readonly registry: Registry;
  private readonly config: PrometheusConfig;
  private readonly logger: Logger;
  private readonly counters = new Map<string, Counter>();
  private readonly gauges = new Map<string, Gauge>();
  private server: http.Server | null = null;

  constructor(config: PrometheusConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.registry = new Registry();

    if (config.defaultLabels) {
      this.registry.setDefaultLabels(
        Object.fromEntries(
          Object.entries(config.defaultLabels).map(([k, v]) => [k, String(v)]),
        ),
      );
    }

    if (config.collectDefaultMetrics) {
      collectDefaultMetrics({ register: this.registry, prefix: config.prefix });
    }
  }

  /** Starts the HTTP server that serves the /metrics scrape endpoint. */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Prometheus exporter is disabled — skipping');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        if (req.method !== 'GET' || req.url !== this.config.path) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        try {
          const metrics = await this.registry.metrics();
          res.setHeader('Content-Type', this.registry.contentType);
          res.writeHead(200);
          res.end(metrics);
        } catch (err) {
          this.logger.error('Failed to collect metrics', err);
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      });

      this.server.on('error', (err) => {
        this.logger.error('Prometheus HTTP server error', err);
        reject(err);
      });

      this.server.listen(this.config.port, () => {
        this.logger.info('Prometheus metrics server started', {
          port: this.config.port,
          path: this.config.path,
        });
        resolve();
      });
    });
  }

  /** Shuts down the HTTP server gracefully. */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          this.logger.error('Error closing Prometheus server', err);
          reject(err);
        } else {
          this.logger.info('Prometheus metrics server stopped');
          resolve();
        }
      });
    });
  }

  /**
   * Increments a named counter by `value`.
   * The counter is lazily registered on first use.
   */
  incrementCounter(name: string, value: number, labels: Labels): void {
    if (!this.config.enabled) return;
    const fullName = this.config.prefix + name;
    let counter = this.counters.get(fullName);

    if (!counter) {
      counter = new Counter({
        name: fullName,
        help: `Counter: ${name}`,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.counters.set(fullName, counter);
    }

    const stringLabels = this.toStringLabels(labels);
    counter.inc(stringLabels, value);
    this.logger.debug('Counter incremented', { name: fullName, value, labels });
  }

  /**
   * Sets a named gauge to `value`.
   * The gauge is lazily registered on first use.
   */
  setGauge(name: string, value: number, labels: Labels): void {
    if (!this.config.enabled) return;
    const fullName = this.config.prefix + name;
    let gauge = this.gauges.get(fullName);

    if (!gauge) {
      gauge = new Gauge({
        name: fullName,
        help: `Gauge: ${name}`,
        labelNames: Object.keys(labels),
        registers: [this.registry],
      });
      this.gauges.set(fullName, gauge);
    }

    const stringLabels = this.toStringLabels(labels);
    gauge.set(stringLabels, value);
    this.logger.debug('Gauge set', { name: fullName, value, labels });
  }

  /** Returns the raw Prometheus Registry (useful for testing / composition). */
  getRegistry(): Registry {
    return this.registry;
  }

  private toStringLabels(labels: Labels): Record<string, string> {
    return Object.fromEntries(
      Object.entries(labels).map(([k, v]) => [k, String(v)]),
    );
  }
}
