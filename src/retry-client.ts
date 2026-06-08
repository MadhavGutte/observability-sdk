import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
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

/**
 * Transient HTTP errors that warrant a retry.
 * 429 (rate-limit) and 5xx server errors are retryable.
 * 4xx client errors (except 429) are not retried.
 */
function isRetryable(error: AxiosError): boolean {
  if (!error.response) {
    // Network / timeout error — always retry
    return true;
  }
  const status = error.response.status;
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
  private readonly client: AxiosInstance;
  private readonly retry: RetryConfig;
  private readonly logger: Logger;

  constructor(options: RetryClientOptions) {
    this.retry = options.retry;
    this.logger = options.logger;

    this.client = axios.create({
      timeout: options.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': '@observability/sdk',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
      },
    });
  }

  /**
   * Executes a POST request with exponential-backoff retry logic.
   * Throws on non-retryable errors or after maxAttempts exhausted.
   */
  async post<T = unknown>(url: string, data: unknown, config?: AxiosRequestConfig): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.retry.maxAttempts; attempt++) {
      try {
        const response = await this.client.post<T>(url, data, config);
        return response.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        lastError = axiosErr;

        if (!isRetryable(axiosErr)) {
          this.logger.error('Non-retryable HTTP error — aborting', axiosErr, {
            url,
            status: axiosErr.response?.status,
          });
          throw axiosErr;
        }

        if (attempt < this.retry.maxAttempts - 1) {
          const delay = backoffMs(attempt, this.retry);
          this.logger.warn('Retryable error — backing off before retry', {
            attempt: attempt + 1,
            maxAttempts: this.retry.maxAttempts,
            delayMs: Math.round(delay),
            status: axiosErr.response?.status,
            url,
          });
          await sleep(delay);
        }
      }
    }

    this.logger.error('All retry attempts exhausted', lastError, {
      url,
      maxAttempts: this.retry.maxAttempts,
    });
    throw lastError ?? new Error('All retry attempts exhausted');
  }
}
