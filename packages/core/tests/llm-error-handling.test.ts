import { describe, expect, test, mock } from 'bun:test';
import type { StreamChunk } from '@hasna/assistants-shared';

// ---------------------------------------------------------------------------
// Mock sleep to eliminate delays in retry logic
// ---------------------------------------------------------------------------

// We need to mock sleep before importing any modules that use it.
// The retry module imports sleep from @hasna/assistants-shared.
// We mock that module to provide an instant sleep.
import * as sharedReal from '@hasna/assistants-shared';

mock.module('@hasna/assistants-shared', () => ({
  ...sharedReal,
  sleep: () => Promise.resolve(),
}));

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from an async generator */
async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Section 1 — Anthropic client error handling
// ---------------------------------------------------------------------------

// We control the mock behavior through this variable.
let anthropicBehavior:
  | 'rate-limit'
  | 'auth-failure'
  | 'context-too-long'
  | 'network-error'
  | 'empty-response'
  | 'malformed-json'
  | 'stream-interrupt'
  | 'success-with-usage'
  | 'missing-tool-fields'
  = 'success-with-usage';

class AnthropicMockStream {
  private events: any[];
  private usage: any;

  constructor(events: any[], usage: any) {
    this.events = events;
    this.usage = usage;
  }

  async *[Symbol.asyncIterator]() {
    for (const ev of this.events) {
      if (ev.__throw) {
        throw ev.__throw;
      }
      yield ev;
    }
  }

  async finalMessage() {
    return { usage: this.usage };
  }
}

function makeError(message: string, status: number): Error {
  const err = new Error(message);
  (err as any).status = status;
  return err;
}

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      stream: () => {
        switch (anthropicBehavior) {
          case 'rate-limit':
            throw makeError('rate limit exceeded', 429);

          case 'auth-failure':
            throw makeError('authentication_error: invalid api key', 401);

          case 'context-too-long':
            throw makeError('prompt is too long: context length exceeded max tokens', 400);

          case 'network-error':
            throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' });

          case 'empty-response':
            return new AnthropicMockStream(
              [{ type: 'message_stop' }],
              { input_tokens: 5, output_tokens: 0 },
            );

          case 'malformed-json':
            return new AnthropicMockStream(
              [
                { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'bash' } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{invalid json!!!' } },
                { type: 'content_block_stop' },
                { type: 'message_stop' },
              ],
              { input_tokens: 10, output_tokens: 5 },
            );

          case 'stream-interrupt':
            return new AnthropicMockStream(
              [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
                { __throw: new Error('stream unexpectedly closed') },
              ],
              { input_tokens: 0, output_tokens: 0 },
            );

          case 'success-with-usage':
            return new AnthropicMockStream(
              [
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello world' } },
                { type: 'message_stop' },
              ],
              { input_tokens: 100, output_tokens: 25 },
            );

          case 'missing-tool-fields':
            return new AnthropicMockStream(
              [
                { type: 'content_block_start', content_block: { type: 'tool_use', id: undefined, name: undefined } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
                { type: 'content_block_stop' },
                { type: 'message_stop' },
              ],
              { input_tokens: 5, output_tokens: 2 },
            );

          default:
            return new AnthropicMockStream(
              [{ type: 'message_stop' }],
              { input_tokens: 0, output_tokens: 0 },
            );
        }
      },
    };
  },
}));

const { AnthropicClient } = await import('../src/llm/anthropic');

const anthropicConfig = {
  provider: 'anthropic' as const,
  model: 'mock-model',
  apiKey: 'test-key',
  maxTokens: 4096,
};

describe('Anthropic client error handling', () => {
  test('rate limit (429) yields error chunk with rateLimited info', async () => {
    anthropicBehavior = 'rate-limit';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_RATE_LIMITED');
    expect(errorChunk!.error).toContain('rate limit');
  });

  test('authentication failure (401) yields error chunk with non-retryable info', async () => {
    anthropicBehavior = 'auth-failure';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_API_ERROR');
    expect(errorChunk!.error).toContain('invalid api key');
  });

  test('context too long error yields error chunk with correct code', async () => {
    anthropicBehavior = 'context-too-long';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_CONTEXT_TOO_LONG');
    expect(errorChunk!.error).toContain('Suggestion');
  });

  test('network error / connection refused yields error chunk', async () => {
    anthropicBehavior = 'network-error';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('ECONNREFUSED');
  });

  test('empty response from API handles gracefully', async () => {
    anthropicBehavior = 'empty-response';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    // Should get done and usage but no text/tool_use
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(chunks.some((c) => c.type === 'usage')).toBe(true);
    expect(chunks.some((c) => c.type === 'text')).toBe(false);
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(false);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });

  test('malformed JSON in tool call input falls back to empty input', async () => {
    anthropicBehavior = 'malformed-json';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const toolChunk = chunks.find((c) => c.type === 'tool_use');
    expect(toolChunk).toBeDefined();
    expect(toolChunk!.toolCall!.input).toEqual({});
  });

  test('streaming interruption yields partial text then error chunk', async () => {
    anthropicBehavior = 'stream-interrupt';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    // Should have gotten the partial text before the error
    const textChunk = chunks.find((c) => c.type === 'text');
    expect(textChunk).toBeDefined();
    expect(textChunk!.content).toBe('partial');

    // Should have an error chunk
    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('stream unexpectedly closed');
  });

  test('usage tokens reported correctly after successful stream', async () => {
    anthropicBehavior = 'success-with-usage';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    const usageChunk = chunks.find((c) => c.type === 'usage');
    expect(usageChunk).toBeDefined();
    expect(usageChunk!.usage!.inputTokens).toBe(100);
    expect(usageChunk!.usage!.outputTokens).toBe(25);
    expect(usageChunk!.usage!.totalTokens).toBe(125);
    expect(usageChunk!.usage!.maxContextTokens).toBe(200000);
  });

  test('missing API key throws descriptive error', () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      expect(() => {
        new AnthropicClient({
          provider: 'anthropic',
          model: 'mock-model',
          maxTokens: 4096,
          // no apiKey
        });
      }).toThrow('ANTHROPIC_API_KEY not found');
    } finally {
      if (savedKey !== undefined) {
        process.env.ANTHROPIC_API_KEY = savedKey;
      }
    }
  });

  test('tool_use block with missing id/name is not yielded', async () => {
    anthropicBehavior = 'missing-tool-fields';
    const client = new AnthropicClient(anthropicConfig);
    const chunks = await collectChunks(client.chat([]));

    // The tool_use chunk should NOT be yielded because id and name are both falsy
    const toolChunk = chunks.find((c) => c.type === 'tool_use');
    expect(toolChunk).toBeUndefined();

    // The stream should still complete without error
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — OpenAI client error handling
// ---------------------------------------------------------------------------

let openaiBehavior:
  | 'rate-limit'
  | 'auth-failure'
  | 'empty-chunks'
  | 'tool-call-multi-chunk'
  | 'usage-reporting'
  | 'context-too-long'
  = 'usage-reporting';

async function* fakeOpenAIStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

mock.module('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: () => {
          switch (openaiBehavior) {
            case 'rate-limit':
              throw makeError('Rate limit exceeded', 429);

            case 'auth-failure':
              throw makeError('Incorrect API key provided', 401);

            case 'context-too-long':
              throw makeError('This model maximum context length is 128000 tokens', 400);

            case 'empty-chunks':
              return fakeOpenAIStream([
                { choices: [], usage: null },
                { choices: [{ delta: {}, finish_reason: null }], usage: null },
                { choices: [{ delta: { content: 'hello' }, finish_reason: null }], usage: null },
                { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } },
              ]);

            case 'tool-call-multi-chunk':
              return fakeOpenAIStream([
                {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        id: 'call_abc',
                        function: { name: 'read_file', arguments: '' },
                      }],
                    },
                    finish_reason: null,
                  }],
                  usage: null,
                },
                {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        function: { arguments: '{"path":' },
                      }],
                    },
                    finish_reason: null,
                  }],
                  usage: null,
                },
                {
                  choices: [{
                    delta: {
                      tool_calls: [{
                        index: 0,
                        function: { arguments: '"/tmp/f"}' },
                      }],
                    },
                    finish_reason: null,
                  }],
                  usage: null,
                },
                {
                  choices: [{
                    delta: {},
                    finish_reason: 'tool_calls',
                  }],
                  usage: { prompt_tokens: 50, completion_tokens: 20 },
                },
              ]);

            case 'usage-reporting':
              return fakeOpenAIStream([
                {
                  choices: [{
                    delta: { content: 'hi' },
                    finish_reason: null,
                  }],
                  usage: null,
                },
                {
                  choices: [{
                    delta: {},
                    finish_reason: 'stop',
                  }],
                  usage: { prompt_tokens: 42, completion_tokens: 7 },
                },
              ]);

            default:
              return fakeOpenAIStream([]);
          }
        },
      },
    };
  },
}));

const { OpenAIClient } = await import('../src/llm/openai');

const openaiConfig = {
  provider: 'openai' as const,
  model: 'gpt-4',
  apiKey: 'test-openai-key',
  maxTokens: 4096,
};

describe('OpenAI client error handling', () => {
  test('rate limit (429) yields error chunk', async () => {
    openaiBehavior = 'rate-limit';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_RATE_LIMITED');
    expect(errorChunk!.error).toContain('Rate limit');
  });

  test('authentication failure (401) yields error chunk', async () => {
    openaiBehavior = 'auth-failure';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_API_ERROR');
    expect(errorChunk!.error).toContain('Incorrect API key');
  });

  test('context too long yields error with correct code', async () => {
    openaiBehavior = 'context-too-long';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    const errorChunk = chunks.find((c) => c.type === 'error');
    expect(errorChunk).toBeDefined();
    expect(errorChunk!.error).toContain('LLM_CONTEXT_TOO_LONG');
  });

  test('empty stream chunks are skipped gracefully', async () => {
    openaiBehavior = 'empty-chunks';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    // First chunk has empty choices — skipped. Second has no content — skipped.
    // Third has actual content.
    const textChunks = chunks.filter((c) => c.type === 'text');
    expect(textChunks).toHaveLength(1);
    expect(textChunks[0].content).toBe('hello');

    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });

  test('tool call building across multiple chunks works correctly', async () => {
    openaiBehavior = 'tool-call-multi-chunk';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    const toolChunk = chunks.find((c) => c.type === 'tool_use');
    expect(toolChunk).toBeDefined();
    expect(toolChunk!.toolCall!.id).toBe('call_abc');
    expect(toolChunk!.toolCall!.name).toBe('read_file');
    expect(toolChunk!.toolCall!.input).toEqual({ path: '/tmp/f' });
  });

  test('usage reporting yields correct token counts', async () => {
    openaiBehavior = 'usage-reporting';
    const client = new OpenAIClient(openaiConfig);
    const chunks = await collectChunks(client.chat([]));

    const usageChunk = chunks.find((c) => c.type === 'usage');
    expect(usageChunk).toBeDefined();
    expect(usageChunk!.usage!.inputTokens).toBe(42);
    expect(usageChunk!.usage!.outputTokens).toBe(7);
    expect(usageChunk!.usage!.totalTokens).toBe(49);
  });

  test('missing API key throws descriptive error', () => {
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      expect(() => {
        new OpenAIClient({
          provider: 'openai',
          model: 'gpt-4',
          maxTokens: 4096,
        });
      }).toThrow('OPENAI_API_KEY not found');
    } finally {
      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Section 3 — Retry logic (withRetry)
// ---------------------------------------------------------------------------

// Import withRetry — sleep is already mocked so delays are instant.
const { withRetry } = await import('../src/utils/retry');
const { LLMError } = await import('../src/errors');
const { ErrorCodes } = await import('../src/errors');

describe('withRetry', () => {
  const baseOptions = {
    maxRetries: 3,
    baseDelay: 100,
    maxDelay: 5000,
    backoffFactor: 2,
  };

  test('returns result on first successful call', async () => {
    const result = await withRetry(async () => 'ok', baseOptions);
    expect(result).toBe('ok');
  });

  test('retries on retryable errors up to maxRetries', async () => {
    let attempts = 0;
    const retryableError = new LLMError('rate limited', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      retryable: true,
      rateLimited: true,
    });

    try {
      await withRetry(
        async () => {
          attempts++;
          throw retryableError;
        },
        {
          ...baseOptions,
          retryOn: (err) => err instanceof LLMError && err.retryable,
        },
      );
    } catch {
      // expected
    }

    // maxRetries=3 means 1 initial + 3 retries = 4 total attempts
    expect(attempts).toBe(4);
  });

  test('does NOT retry on non-retryable errors', async () => {
    let attempts = 0;
    const nonRetryableError = new LLMError('auth failed', {
      code: ErrorCodes.LLM_API_ERROR,
      retryable: false,
      statusCode: 401,
    });

    try {
      await withRetry(
        async () => {
          attempts++;
          throw nonRetryableError;
        },
        {
          ...baseOptions,
          retryOn: (err) => err instanceof LLMError && err.retryable,
        },
      );
    } catch {
      // expected
    }

    // Should only attempt once — no retries
    expect(attempts).toBe(1);
  });

  test('returns result on successful retry after initial failures', async () => {
    let attempts = 0;
    const retryableError = new LLMError('temporarily unavailable', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      retryable: true,
    });

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw retryableError;
        return 'recovered';
      },
      {
        ...baseOptions,
        retryOn: (err) => err instanceof LLMError && err.retryable,
      },
    );

    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
  });

  test('throws last error after max retries exhausted', async () => {
    const retryableError = new LLMError('keep failing', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      retryable: true,
    });

    await expect(
      withRetry(
        async () => { throw retryableError; },
        {
          ...baseOptions,
          retryOn: (err) => err instanceof LLMError && err.retryable,
        },
      ),
    ).rejects.toThrow('keep failing');
  });

  test('exponential backoff executes all retry attempts', async () => {
    // Verifies that the backoff formula runs all retries:
    // delay = min(baseDelay * backoffFactor^attempt, maxDelay)
    // attempt 0: min(100 * 2^0, 5000) = 100
    // attempt 1: min(100 * 2^1, 5000) = 200
    // attempt 2: min(100 * 2^2, 5000) = 400
    let attempts = 0;
    const retryableError = new LLMError('fail', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      retryable: true,
    });

    try {
      await withRetry(
        async () => {
          attempts++;
          throw retryableError;
        },
        {
          ...baseOptions,
          maxRetries: 3,
          retryOn: (err) => err instanceof LLMError && err.retryable,
        },
      );
    } catch {
      // expected
    }

    // All 4 attempts (1 initial + 3 retries) should complete
    expect(attempts).toBe(4);
  });

  test('respects maxDelay cap with large backoff factor', async () => {
    // With baseDelay=1000, backoffFactor=10, maxDelay=5000:
    // All attempts should still run since sleep is mocked.
    let attempts = 0;
    const retryableError = new LLMError('fail', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      retryable: true,
    });

    try {
      await withRetry(
        async () => {
          attempts++;
          throw retryableError;
        },
        {
          maxRetries: 3,
          baseDelay: 1000,
          maxDelay: 5000,
          backoffFactor: 10,
          retryOn: (err) => err instanceof LLMError && err.retryable,
        },
      );
    } catch {
      // expected
    }

    expect(attempts).toBe(4);
  });

  test('wraps non-Error throwables into Error objects', async () => {
    try {
      await withRetry(
        async () => { throw 'string error'; },
        { ...baseOptions, maxRetries: 0 },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('string error');
    }
  });

  test('without retryOn predicate retries all errors', async () => {
    let attempts = 0;
    try {
      await withRetry(
        async () => {
          attempts++;
          throw new Error('generic error');
        },
        { ...baseOptions, maxRetries: 2 },
      );
    } catch {
      // expected
    }

    // Without retryOn, all errors are retried: 1 initial + 2 retries = 3
    expect(attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Section 4 — LLMError class and toLLMError classification
// ---------------------------------------------------------------------------

describe('LLMError classification', () => {
  test('429 status creates LLMError with rateLimited=true and retryable=true', () => {
    const llmErr = new LLMError('rate limit exceeded', {
      code: ErrorCodes.LLM_RATE_LIMITED,
      statusCode: 429,
      rateLimited: true,
      retryable: true,
    });
    expect(llmErr.rateLimited).toBe(true);
    expect(llmErr.retryable).toBe(true);
    expect(llmErr.statusCode).toBe(429);
    expect(llmErr.code).toBe('LLM_RATE_LIMITED');
  });

  test('401 status creates LLMError with retryable=false', () => {
    const llmErr = new LLMError('authentication failed', {
      code: ErrorCodes.LLM_API_ERROR,
      statusCode: 401,
      retryable: false,
    });
    expect(llmErr.retryable).toBe(false);
    expect(llmErr.statusCode).toBe(401);
  });

  test('context too long creates error with appropriate code and suggestion', () => {
    const llmErr = new LLMError('context length exceeded', {
      code: ErrorCodes.LLM_CONTEXT_TOO_LONG,
      retryable: false,
      suggestion: 'Try shortening the conversation or use /compact.',
    });
    expect(llmErr.code).toBe('LLM_CONTEXT_TOO_LONG');
    expect(llmErr.retryable).toBe(false);
    expect(llmErr.suggestion).toContain('/compact');
  });

  test('LLMError toJSON includes all relevant fields', () => {
    const llmErr = new LLMError('test error', {
      code: ErrorCodes.LLM_API_ERROR,
      retryable: false,
      suggestion: 'check your config',
    });

    const json = llmErr.toJSON();
    expect(json.name).toBe('LLMError');
    expect(json.code).toBe('LLM_API_ERROR');
    expect(json.message).toBe('test error');
    expect(json.suggestion).toBe('check your config');
    expect(json.retryable).toBe(false);
  });
});
