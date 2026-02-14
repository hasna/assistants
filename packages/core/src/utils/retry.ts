import { sleep } from '@hasna/assistants-shared';

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryOn?: (error: Error) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === options.maxRetries) {
        break;
      }

      if (options.retryOn && !options.retryOn(lastError)) {
        break;
      }

      const delay = Math.min(
        options.baseDelay * Math.pow(options.backoffFactor, attempt),
        options.maxDelay
      );

      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Retry failed without a captured error');
}

export const LLMRetryConfig: RetryOptions = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
};

export const ConnectorRetryConfig: RetryOptions = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5000,
  backoffFactor: 2,
};
