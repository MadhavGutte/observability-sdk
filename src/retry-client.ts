import type { RetryConfig } from './types';
import type { Logger } from './logger';

export interface RetryClientOptions {
  retry: RetryConfig;
  logger: Logger;
  /** Default request timeout in ms */
  timeoutMs: number;
  /** Optional static Bearer token */
  apiKey?: string;
}

interface PostConfig {
  headers?: Record<string, string>;
}

/**
 * Transient HTTP errors that warrant a retry.
 * 429 (rate-limit) and 5xx server errors are retryable.
 * 4xx client errors (except 429) are not retried.
 */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Calculates an exponential backoff delay with full jitter to prevent
 * thundering-herd scenarios when many SDK instances back off together.
 *
 * delay = random(0, min(maxDelayMs, initialDelayMs * multiplier^attempt))
 */
function backoffMs(attempt: number, cfg: RetryConfig): number {
  const cap = Math.min(cfg.maxDelayMs, cfg.initialDelayMs * Math.pow(cfg.multiplier, attempt));
  return Math.random() * cap;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RetryClient {
  private readonly retry: RetryConfig;
  private readonly logger: Logger;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: RetryClientOptions) {
    this.retry = options.retry;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      'User-Agent': '@observability/sdk',
      ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
    };
  }

  /**
   * Executes a POST request with exponential-backoff retry logic.
   * Uses the native fetch API (Node 18+).
   * Throws on non-retryable errors or after maxAttempts exhausted.
   */
  async post<T = unknown>(url: string, data: unknown, config?: PostConfig): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retry.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response | undefined;

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { ...this.defaultHeaders, ...config?.headers },
          body: typeof data === 'string' ? data : JSON.stringify(data),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        clearTimeout(timer);
        lastError = fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr));
        if (attempt < this.retry.maxAttempts - 1) {
          const delay = backoffMs(attempt, this.retry);
          this.logger.warn('Network error — backing off before retry', {
            attempt: attempt + 1,
            maxAttempts: this.retry.maxAttempts,
            delayMs: Math.round(delay),
            url,
          });
          await sleep(delay);
        }
        continue;
      }

      clearTimeout(timer);

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const httpErr = Object.assign(
        new Error(`HTTP ${response.status}`),
        { status: response.status },
      );
      lastError = httpErr;

      if (!isRetryable(response.status)) {
        this.logger.error('Non-retryable HTTP error — aborting', httpErr, {
          url,
          status: response.status,
        });
        throw httpErr;
      }

      if (attempt < this.retry.maxAttempts - 1) {
        const delay = backoffMs(attempt, this.retry);
        this.logger.warn('Retryable error — backing off before retry', {
          attempt: attempt + 1,
          maxAttempts: this.retry.maxAttempts,
          delayMs: Math.round(delay),
          status: response.status,
          url,
        });
        await sleep(delay);
      }
    }

    this.logger.error('All retry attempts exhausted', lastError, {
      url,
      maxAttempts: this.retry.maxAttempts,
    });
    throw lastError ?? new Error('All retry attempts exhausted');
  }
}
