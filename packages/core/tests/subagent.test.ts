import { describe, expect, test } from 'bun:test';
import type { LLMClient } from '../src/llm/client';
import { MockLLMClient } from './fixtures/mock-llm';

const { runHookAssistant } = await import('../src/agent/subagent');

describe('runHookAssistant', () => {
  test('collects response text and uses default allowed tools', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ content: 'ALLOW\nReason' });

    const result = await runHookAssistant({
      hook: { prompt: 'Check if allowed' },
      input: { action: 'test' },
      timeout: 3000,
      cwd: '/tmp',
      llmClient: llm,
    });

    expect(llm.getCallHistory().length).toBeGreaterThan(0);
    expect(typeof result).toBe('string');
  });

  test('respects provided allowed tools', async () => {
    const llm = new MockLLMClient();
    llm.queueResponse({ content: 'ALLOW' });

    await runHookAssistant({
      hook: { prompt: 'Test' },
      input: { value: 1 },
      timeout: 1000,
      cwd: '/tmp',
      allowedTools: ['write'],
      llmClient: llm,
    });
  });

  test('returns empty response on timeout', async () => {
    class HangingLLM implements LLMClient {
      async *chat(): AsyncGenerator<any> {
        await new Promise(() => {});
      }
      getModel(): string {
        return 'hang';
      }
    }

    const result = await runHookAssistant({
      hook: { prompt: 'Timeout' },
      input: { value: 1 },
      timeout: 0,
      cwd: '/tmp',
      llmClient: new HangingLLM(),
    });

    expect(result).toBe('');
  });
});
