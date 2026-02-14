import { describe, expect, test } from 'bun:test';
import { buildDisplayMessages } from '../src/components/messageRender';
import type { Message } from '@hasna/assistants-shared';

describe('buildDisplayMessages', () => {
  test('chunks assistant markdown when long', () => {
    const message: Message = {
      id: 'm1',
      role: 'assistant',
      content: 'Line\n'.repeat(20),
      timestamp: 0,
      toolCalls: [{ id: 't1', name: 'bash', input: {}, type: 'tool' } as any],
    };

    const result = buildDisplayMessages([message], 5, 40, { maxWidth: 40 });
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].__rendered).toBe(true);
    expect(result.at(-1)?.toolCalls?.length).toBe(1);
  });

  test('chunks user messages and keeps tool results on last chunk', () => {
    const message: Message = {
      id: 'u1',
      role: 'user',
      content: 'a'.repeat(200),
      timestamp: 0,
      toolResults: [{ toolCallId: 't1', content: 'ok', isError: false } as any],
    };

    const result = buildDisplayMessages([message], 4, 20);
    expect(result.length).toBeGreaterThan(1);
    expect(result.at(-1)?.toolResults?.length).toBe(1);
  });

  test('returns single display message when short', () => {
    const message: Message = {
      id: 'm2',
      role: 'assistant',
      content: 'short',
      timestamp: 0,
    };
    const result = buildDisplayMessages([message], 10, 80);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m2');
  });

  test('normalizes user whitespace when wrapping', () => {
    const message: Message = {
      id: 'u2',
      role: 'user',
      content: 'hello\t\tworld   there   friend',
      timestamp: 0,
    };

    const result = buildDisplayMessages([message], 1, 8);
    for (const chunk of result) {
      expect(chunk.content).not.toContain('\t');
      expect(chunk.content).not.toContain('  ');
    }
  });
});
