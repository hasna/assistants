import { describe, expect, test } from 'bun:test';
import type { Message } from '@hasna/assistants-shared';
import { MockLLMClient } from './fixtures/mock-llm';
import { HybridSummarizer, LLMSummarizer } from '../src/context/summarizer';

const buildMessage = (overrides?: Partial<Message>): Message => ({
  id: 'msg-1',
  role: 'user',
  content: 'Hello',
  timestamp: Date.now(),
  ...overrides,
});

describe('LLMSummarizer', () => {
  test('summarize includes transcript with tool calls/results and truncation', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ content: 'Summary text' });

    const longText = 'a'.repeat(4200);
    const longTool = 'b'.repeat(2200);
    const messages: Message[] = [
      buildMessage({ content: longText, role: 'user' }),
      buildMessage({
        role: 'assistant',
        content: 'Response',
        toolCalls: [{ id: 'call-1', name: 'tool', input: { ok: true } }],
        toolResults: [
          {
            toolName: 'tool',
            content: longTool,
            rawContent: longTool,
            isError: false,
          },
        ],
      }) as Message,
    ];

    const summarizer = new LLMSummarizer(llm, { maxTokens: 1234 });
    const summary = await summarizer.summarize(messages);
    expect(summary).toBe('Summary text');

    const prompt = llm.getCallHistory()[0]?.messages[0]?.content || '';
    expect(prompt).toContain('[Tool calls: tool]');
    expect(prompt).toContain('[Tool results]');
    expect(prompt).toContain('characters truncated');
    expect(prompt).toContain('1234 tokens');
  });

  test('summarize throws on error chunk', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ error: 'bad' });
    const summarizer = new LLMSummarizer(llm);
    await expect(summarizer.summarize([buildMessage()])).rejects.toThrow('bad');
  });
});

describe('HybridSummarizer', () => {
  test('extracts files, commands, tools, and errors', async () => {
    const fakeLLM = { summarize: async () => 'LLM summary' } as any;
    const hybrid = new HybridSummarizer(fakeLLM);

    const messages: Message[] = [
      buildMessage({
        role: 'user',
        content: 'Check ./src/index.ts and C:\\temp\\log.txt\n$ npm test\nError: failed',
      }),
      buildMessage({
        role: 'assistant',
        content: 'Running: bun test',
        toolCalls: [{ id: 'call-1', name: 'grep', input: { pattern: 'x' } }],
        toolResults: [{ toolName: 'grep', content: 'ok', isError: false }],
      }) as Message,
    ];

    const summary = await hybrid.summarize(messages);
    expect(summary).toContain('## Files Referenced');
    expect(summary).toContain('src/index.ts');
    expect(summary).toContain('C:/temp/log.txt');
    expect(summary).toContain('## Commands & Actions');
    expect(summary).toContain('npm test');
    expect(summary).toContain('bun test');
    expect(summary).toContain('## Tools Invoked');
    expect(summary).toContain('grep');
    expect(summary).toContain('## Errors & Warnings');
    expect(summary).toContain('Error: failed');
    expect(summary).toContain('## Conversation Summary');
    expect(summary).toContain('LLM summary');
  });
});
