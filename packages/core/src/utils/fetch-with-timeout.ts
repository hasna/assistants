import { ErrorCodes, ToolExecutionError } from '../errors';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
}

/**
 * Fetch a URL with an automatic timeout.
 *
 * Creates an AbortController, sets a timeout that aborts the request, performs
 * the fetch, and clears the timeout on completion.  If the request is aborted
 * due to the timeout, a ToolExecutionError with TOOL_TIMEOUT code is thrown.
 *
 * Any existing AbortSignal supplied in `options.signal` is **not** composed
 * with the timeout signal — the timeout signal takes precedence.
 */
export async function fetchWithTimeout(
  url: string,
  options?: FetchWithTimeoutOptions,
): Promise<Response> {
  const { timeout = 30_000, ...fetchInit } = options ?? {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ToolExecutionError(`Request timed out after ${timeout}ms`, {
        toolName: 'fetch',
        toolInput: { url },
        code: ErrorCodes.TOOL_TIMEOUT,
        recoverable: true,
        retryable: true,
        suggestion: 'Try again or increase the timeout.',
      });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
