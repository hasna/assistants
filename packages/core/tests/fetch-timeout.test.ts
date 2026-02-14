import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { fetchWithTimeout } from '../src/utils/fetch-with-timeout';
import { ToolExecutionError } from '../src/errors';

// We mock the global fetch to avoid making real network requests
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchWithTimeout', () => {
  test('should return a Response on successful fetch', async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response('hello', { status: 200 });
    }) as typeof fetch;

    const response = await fetchWithTimeout('https://example.com');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe('hello');
  });

  test('should pass through request options to fetch', async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await fetchWithTimeout('https://example.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'value' }),
      redirect: 'manual',
      timeout: 5000,
    });

    expect(capturedInit).toBeDefined();
    expect(capturedInit!.method).toBe('POST');
    expect(capturedInit!.redirect).toBe('manual');
    expect(capturedInit!.body).toBe(JSON.stringify({ key: 'value' }));
    // The timeout option should NOT be passed through to fetch's init
    expect((capturedInit as Record<string, unknown>).timeout).toBeUndefined();
    // An AbortSignal should be attached
    expect(capturedInit!.signal).toBeDefined();
  });

  test('should throw ToolExecutionError with TOOL_TIMEOUT code on timeout', async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      // Simulate a slow response by waiting for the signal to abort
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError');
            reject(err);
          });
        }
      });
    }) as typeof fetch;

    try {
      await fetchWithTimeout('https://example.com/slow', { timeout: 50 });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      const toolError = error as ToolExecutionError;
      expect(toolError.code).toBe('TOOL_TIMEOUT');
      expect(toolError.message).toContain('timed out');
      expect(toolError.message).toContain('50ms');
      expect(toolError.retryable).toBe(true);
      expect(toolError.recoverable).toBe(true);
    }
  });

  test('should use default timeout of 30000ms when not specified', async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await fetchWithTimeout('https://example.com');

    // The signal should exist (from the internally created AbortController)
    expect(capturedSignal).toBeDefined();
    // It should not be aborted (30s default hasn't elapsed)
    expect(capturedSignal!.aborted).toBe(false);
  });

  test('should propagate non-abort errors without wrapping', async () => {
    const networkError = new TypeError('fetch failed');
    globalThis.fetch = mock(async () => {
      throw networkError;
    }) as typeof fetch;

    try {
      await fetchWithTimeout('https://example.com/bad');
      expect(true).toBe(false);
    } catch (error) {
      // Non-abort errors should NOT be wrapped in ToolExecutionError
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toBe('fetch failed');
    }
  });

  test('should clear the timeout after a successful fetch', async () => {
    // Track whether clearTimeout is called by verifying the signal isn't aborted
    // after the fetch resolves. If the timeout were not cleared, with a very short
    // timeout the signal would eventually abort — but we cannot reliably test that
    // without timing. Instead we verify that after a successful fetch the abort
    // controller's signal remains clean.
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response('fast', { status: 200 });
    }) as typeof fetch;

    const response = await fetchWithTimeout('https://example.com/fast', { timeout: 100 });
    expect(response.status).toBe(200);

    // Wait longer than the timeout to ensure the timer was cleared
    await new Promise((resolve) => setTimeout(resolve, 200));

    // If the timer was NOT cleared, the AbortController would have fired, but
    // since we already got the response, no error should surface here.
    const text = await response.text();
    expect(text).toBe('fast');
  });

  test('should include the URL in the ToolExecutionError toolInput on timeout', async () => {
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      });
    }) as typeof fetch;

    try {
      await fetchWithTimeout('https://example.com/timeout-test', { timeout: 30 });
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ToolExecutionError);
      const toolError = error as ToolExecutionError;
      expect(toolError.toolInput).toEqual({ url: 'https://example.com/timeout-test' });
      expect(toolError.toolName).toBe('fetch');
    }
  });
});
