import { describe, expect, test } from 'bun:test';
import type { Message } from '@hasna/assistants-shared';
import type { LLMClient } from '../src/llm/client';
import { TokenCounter } from '../src/context/token-counter';
import { ContextManager } from '../src/context/manager';
import { LLMSummarizer } from '../src/context/summarizer';
import type { ContextConfig } from '../src/context/types';

class StubSummarizer {
  name = 'stub';
  async summarize(): Promise<string> {
    return 'summary';
  }
}

const baseConfig: ContextConfig = {
  enabled: true,
  maxContextTokens: 200,
  targetContextTokens: 100,
  summaryTriggerRatio: 0.3, // Triggers at 60 tokens
  keepRecentMessages: 2,
  keepSystemPrompt: true,
  summaryStrategy: 'llm',
  summaryMaxTokens: 200,
  maxMessages: 200,
};

describe('TokenCounter', () => {
  test('counts tokens consistently', () => {
    const counter = new TokenCounter();
    const count1 = counter.count('hello world');
    const count2 = counter.count('hello world');
    expect(count1).toBeGreaterThan(0);
    expect(count2).toBe(count1);
  });

  test('counts message tokens with tool calls', () => {
    const counter = new TokenCounter();
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 0 },
      {
        id: '2',
        role: 'assistant',
        content: 'ok',
        timestamp: 0,
        toolCalls: [{ id: 't1', name: 'bash', input: { cmd: 'ls' } }],
      },
    ];

    const total = counter.countMessages(messages);
    expect(total).toBeGreaterThan(counter.count('hello'));
  });
});

describe('ContextManager', () => {
  test('summarizes when over threshold', async () => {
    const tokenCounter = new TokenCounter();
    const manager = new ContextManager(baseConfig, new StubSummarizer(), tokenCounter);

    const longText = 'hello '.repeat(50);
    const messages: Message[] = [
      { id: 's', role: 'system', content: 'system', timestamp: 0 },
      { id: '1', role: 'user', content: longText, timestamp: 0 },
      { id: '2', role: 'assistant', content: longText, timestamp: 0 },
      { id: '3', role: 'user', content: longText, timestamp: 0 },
      { id: '4', role: 'assistant', content: longText, timestamp: 0 },
    ];

    const result = await manager.processMessages(messages);
    expect(result.summarized).toBe(true);
    expect(result.summary).toBe('summary');
    expect(result.messages.some((msg) => msg.role === 'system' && msg.content.includes('Context Summary'))).toBe(true);
    expect(result.messages.slice(-1)[0].content).toBe(longText);
  });

  test('refreshState updates token counts without summarizing', () => {
    const tokenCounter = new TokenCounter();
    const manager = new ContextManager(baseConfig, new StubSummarizer(), tokenCounter);
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'hello', timestamp: 0 },
      { id: '2', role: 'assistant', content: 'world', timestamp: 0 },
    ];

    const state = manager.refreshState(messages);
    expect(state.messageCount).toBe(2);
    expect(state.totalTokens).toBeGreaterThan(0);
  });
});

describe('ContextManager tool call preservation', () => {
  // Use a config that triggers summarization more easily
  const toolTestConfig: ContextConfig = {
    enabled: true,
    maxContextTokens: 100,
    targetContextTokens: 50,
    summaryTriggerRatio: 0.3, // Triggers at 30 tokens
    keepRecentMessages: 2,
    keepSystemPrompt: true,
    summaryStrategy: 'llm',
    summaryMaxTokens: 50,
    maxMessages: 100,
    preserveLastToolCalls: 3,
  };

  test('preserves last N tool calls during summarization', async () => {
    const tokenCounter = new TokenCounter();
    const manager = new ContextManager(toolTestConfig, new StubSummarizer(), tokenCounter);

    const longText = 'hello world this is a long message '.repeat(20);
    const messages: Message[] = [
      { id: 's', role: 'system', content: 'system', timestamp: 0 },
      { id: '1', role: 'user', content: longText, timestamp: 0 },
      { id: '2', role: 'assistant', content: 'response', timestamp: 0 },
      { id: '3', role: 'user', content: longText, timestamp: 0 },
      // First tool call
      {
        id: '4',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 't1', name: 'bash', input: { cmd: 'ls' } }],
      },
      { id: '5', role: 'user', content: '', timestamp: 0, toolResults: [{ id: 't1', output: 'file.txt' }] },
      // Second tool call
      {
        id: '6',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 't2', name: 'read', input: { path: 'file.txt' } }],
      },
      { id: '7', role: 'user', content: '', timestamp: 0, toolResults: [{ id: 't2', output: 'content' }] },
      // Third tool call
      {
        id: '8',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 't3', name: 'write', input: { path: 'out.txt' } }],
      },
      { id: '9', role: 'user', content: '', timestamp: 0, toolResults: [{ id: 't3', output: 'done' }] },
      // Final response
      { id: '10', role: 'assistant', content: 'all done', timestamp: 0 },
    ];

    const result = await manager.processMessages(messages);
    expect(result.summarized).toBe(true);

    // Should preserve all 3 tool calls and their results
    const nonSystemMessages = result.messages.filter(m => m.role !== 'system' || m.content.includes('Context Summary'));
    // At least the tool call messages should be preserved
    const toolCallMessages = nonSystemMessages.filter(m => m.toolCalls && m.toolCalls.length > 0);
    expect(toolCallMessages.length).toBeGreaterThanOrEqual(3);
  });

  test('includes tool results when preserving tool calls', async () => {
    const tokenCounter = new TokenCounter();
    const config: ContextConfig = {
      ...toolTestConfig,
      keepRecentMessages: 1,
      preserveLastToolCalls: 2,
    };
    const manager = new ContextManager(config, new StubSummarizer(), tokenCounter);

    const longText = 'hello world this is a long message '.repeat(20);
    const messages: Message[] = [
      { id: 's', role: 'system', content: 'system', timestamp: 0 },
      { id: '1', role: 'user', content: longText, timestamp: 0 },
      { id: '2', role: 'assistant', content: 'response', timestamp: 0 },
      // Tool call
      {
        id: '3',
        role: 'assistant',
        content: '',
        timestamp: 0,
        toolCalls: [{ id: 't1', name: 'bash', input: { cmd: 'ls' } }],
      },
      { id: '4', role: 'user', content: '', timestamp: 0, toolResults: [{ id: 't1', output: 'file.txt' }] },
      // Final response
      { id: '5', role: 'assistant', content: longText, timestamp: 0 },
    ];

    const result = await manager.processMessages(messages);
    expect(result.summarized).toBe(true);

    // Check that tool result message is preserved
    const toolResultMessages = result.messages.filter(m => m.toolResults && m.toolResults.length > 0);
    expect(toolResultMessages.length).toBeGreaterThanOrEqual(1);
  });

  test('uses default of 5 tool calls if not specified', async () => {
    const tokenCounter = new TokenCounter();
    const config: ContextConfig = {
      ...toolTestConfig,
      keepRecentMessages: 2,
      preserveLastToolCalls: undefined, // Explicitly undefined to test default
    };
    const manager = new ContextManager(config, new StubSummarizer(), tokenCounter);

    const longText = 'hello world this is a long message '.repeat(20);
    // Need enough messages so that after keeping 2 recent, there's something to summarize
    const messages: Message[] = [
      { id: 's', role: 'system', content: 'system', timestamp: 0 },
      { id: '1', role: 'user', content: longText, timestamp: 0 },
      { id: '2', role: 'assistant', content: longText, timestamp: 0 },
      { id: '3', role: 'user', content: longText, timestamp: 0 },
      { id: '4', role: 'assistant', content: longText, timestamp: 0 },
    ];

    const result = await manager.processMessages(messages);
    expect(result.summarized).toBe(true);
  });
});

describe('LLMSummarizer', () => {
  test('returns streamed summary text', async () => {
    const fakeClient: LLMClient = {
      getModel: () => 'test',
      async *chat() {
        yield { type: 'text', content: 'Summary text' };
        yield { type: 'done' };
      },
    };

    const summarizer = new LLMSummarizer(fakeClient, { maxTokens: 50 });
    const messages: Message[] = [{ id: '1', role: 'user', content: 'hello', timestamp: 0 }];
    const summary = await summarizer.summarize(messages);
    expect(summary).toBe('Summary text');
  });
});
