import { describe, expect, test } from 'bun:test';
import { MockLLMClient } from './fixtures/mock-llm';

describe('MockLLMClient', () => {
  test('streams queued response and tool calls', async () => {
    const client = new MockLLMClient();
    client.queueResponse({
      content: 'hello',
      toolCalls: [{ id: 't1', name: 'bash', input: { command: 'ls' } }],
    });

    const chunks = [] as string[];
    for await (const chunk of client.chat([{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }])) {
      if (chunk.type === 'text' && chunk.content) chunks.push(chunk.content);
      if (chunk.type === 'tool_use') {
        expect(chunk.toolCall?.name).toBe('bash');
      }
    }

    expect(chunks.join('')).toBe('hello');
  });

  test('yields error when queued', async () => {
    const client = new MockLLMClient();
    client.queueResponse({ content: '', error: 'boom' });

    let error = '';
    for await (const chunk of client.chat([{ id: 'm1', role: 'user', content: 'hi', timestamp: 0 }])) {
      if (chunk.type === 'error') error = chunk.error || '';
    }

    expect(error).toBe('boom');
  });
});
