import { describe, expect, test } from 'bun:test';
import { withRetry } from '../src/utils/retry';

describe('withRetry', () => {
  test('should retry on retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new Error('fail');
      }, {
        maxRetries: 2,
        baseDelay: 1,
        maxDelay: 2,
        backoffFactor: 1,
        retryOn: () => true,
      })
    ).rejects.toThrow('fail');

    expect(attempts).toBe(3);
  });

  test('should stop retrying when retryOn returns false', async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw new Error('nope');
      }, {
        maxRetries: 3,
        baseDelay: 1,
        maxDelay: 2,
        backoffFactor: 1,
        retryOn: () => false,
      })
    ).rejects.toThrow('nope');

    expect(attempts).toBe(1);
  });

  test('should resolve after a successful retry', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw new Error('temporary');
      }
      return 'ok';
    }, {
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 2,
      backoffFactor: 1,
      retryOn: () => true,
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});
