import { beforeEach, afterEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@hasna/assistants-shared';

let behavior: 'success' | 'invalid-json' | 'error' = 'success';

class MockStream {
  constructor(private events: any[], private usage: any) {}

  async *[Symbol.asyncIterator]() {
    if (behavior === 'error') {
      throw new Error('stream failed');
    }
    for (const ev of this.events) {
      yield ev;
    }
  }

  async finalMessage() {
    return { usage: this.usage };
  }
}

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      stream: () => {
        const events =
          behavior === 'invalid-json'
            ? [
                { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'bash' } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":' } },
                { type: 'content_block_stop' },
                { type: 'message_stop' },
              ]
            : [
                { type: 'content_block_start', content_block: { type: 'tool_use', id: 't1', name: 'bash' } },
                { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
                { type: 'content_block_stop' },
                { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello' } },
                { type: 'message_stop' },
              ];

        return new MockStream(events, { input_tokens: 1, output_tokens: 2 });
      },
    };
  },
}));

const { AnthropicClient } = await import('../src/llm/anthropic');

describe('AnthropicClient chat', () => {
  test('yields tool use, text, done, and usage', async () => {
    behavior = 'success';
    const client = new AnthropicClient({
      provider: 'anthropic',
      model: 'mock',
      apiKey: 'key',
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chat([])) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'text' && c.content === 'hello')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
    expect(chunks.some((c) => c.type === 'usage')).toBe(true);
  });

  test('handles invalid tool JSON', async () => {
    behavior = 'invalid-json';
    const client = new AnthropicClient({
      provider: 'anthropic',
      model: 'mock',
      apiKey: 'key',
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chat([])) {
      chunks.push(chunk);
    }

    const toolChunk = chunks.find((c) => c.type === 'tool_use');
    expect(toolChunk?.toolCall?.input).toEqual({});
  });

  test('yields error on stream failure', async () => {
    behavior = 'error';
    const client = new AnthropicClient({
      provider: 'anthropic',
      model: 'mock',
      apiKey: 'key',
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of client.chat([])) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === 'error')).toBe(true);
  });
});

describe('AnthropicClient secrets loading', () => {
  let tempHome: string;
  let originalHome: string | undefined;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'assistants-home-'));
    originalHome = process.env.HOME;
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.HOME = tempHome;
    delete process.env.ANTHROPIC_API_KEY;
    writeFileSync(join(tempHome, '.secrets'), 'export ANTHROPIC_API_KEY="secret"');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  test('loads API key from ~/.secrets when env missing', () => {
    const client = new AnthropicClient({
      provider: 'anthropic',
      model: 'mock',
    });
    expect(client.getModel()).toBe('mock');
  });
});
