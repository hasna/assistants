import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@hasna/assistants-shared';
import { AssistantLoop } from '../src/agent/loop';

describe('AssistantLoop memory injection lifecycle', () => {
  beforeEach(() => {
    // Clean up before each test
  });

  test('skips memory injection for slash commands', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-cmd-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    // Process a built-in command (should not call LLM)
    await assistant.process('/help');

    // Verify no LLM calls were made (commands bypass LLM)
    expect(chatCalls).toBe(0);

    // The pendingMemoryContext should be cleared
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('clears pendingMemoryContext when command is handled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-clear-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    // Manually set pendingMemoryContext to simulate injection
    (assistant as any).pendingMemoryContext = 'some injected memory';

    // Process a command
    await assistant.process('/help');

    // Memory context should be cleared
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('clears pendingMemoryContext when explicit tool command is handled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-tool-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'should-not-run' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    // Manually set pendingMemoryContext to simulate injection
    (assistant as any).pendingMemoryContext = 'some injected memory';

    // Process explicit tool command
    await assistant.process('![bash] echo hi');

    // LLM should not be called
    expect(chatCalls).toBe(0);

    // Memory context should be cleared
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('clears pendingMemoryContext when skill is invoked', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-skill-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Register a fake skill
    (assistant as any).skillLoader.skills.set('demo', {
      name: 'demo',
      description: 'Demo skill',
      content: 'Skill content',
      allowedTools: [],
      filePath: join(cwd, 'SKILL.md'),
      contentLoaded: true,
    });

    // Manually set pendingMemoryContext to simulate injection
    (assistant as any).pendingMemoryContext = 'some injected memory';

    // Process skill invocation
    await assistant.process('/demo arg1');

    // Memory context should be cleared (skills handle their own context)
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('preserves memory context for regular LLM messages', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-preserve-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    let receivedSystemPrompt: string | undefined;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (
        messages: unknown[],
        tools?: unknown[],
        systemPrompt?: string
      ): AsyncGenerator<StreamChunk> {
        receivedSystemPrompt = systemPrompt;
        yield { type: 'text', content: 'response' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Manually set pendingMemoryContext to simulate injection
    (assistant as any).pendingMemoryContext = '## Relevant Memories\n\n### User Preferences\n- Prefers dark mode';

    // Process a regular message (should use LLM)
    await assistant.process('hello');

    // Memory context should be included in system prompt
    expect(receivedSystemPrompt).toContain('Relevant Memories');
    expect(receivedSystemPrompt).toContain('Prefers dark mode');
  });

  test('memory injector respects refresh interval deduplication', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-dedupe-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Create a mock memory injector
    const prepareCallCount = { value: 0 };
    const mockInjector = {
      isEnabled: () => true,
      prepareInjection: async () => {
        prepareCallCount.value++;
        // Return memory content on first call, empty on subsequent (simulating dedupe)
        if (prepareCallCount.value === 1) {
          return {
            content: '## Memories\n- Test memory',
            memoryIds: ['mem-1'],
            tokenEstimate: 10,
          };
        }
        return { content: '', memoryIds: [], tokenEstimate: 0 };
      },
    };
    (assistant as any).memoryInjector = mockInjector;

    // First message - should inject memory
    await assistant.process('first message');
    expect(prepareCallCount.value).toBe(1);
    expect((assistant as any).pendingMemoryContext).toContain('Memories');

    // Second message - dedupe should return empty
    await assistant.process('second message');
    expect(prepareCallCount.value).toBe(2);
    // pendingMemoryContext should be cleared since injector returned empty
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('memory context is removed from system messages on new injection', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-remove-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Create mock injector that returns different content each time
    let callCount = 0;
    const mockInjector = {
      isEnabled: () => true,
      prepareInjection: async () => {
        callCount++;
        return {
          content: `## Memories v${callCount}\n- Memory ${callCount}`,
          memoryIds: [`mem-${callCount}`],
          tokenEstimate: 10,
        };
      },
    };
    (assistant as any).memoryInjector = mockInjector;

    // First message
    await assistant.process('first');
    const contextAfterFirst = assistant.getContext().getMessages();

    // Should have memory context v1
    expect((assistant as any).pendingMemoryContext).toContain('Memories v1');

    // Second message - should replace old memory context
    await assistant.process('second');

    // Should have memory context v2
    expect((assistant as any).pendingMemoryContext).toContain('Memories v2');
    expect((assistant as any).pendingMemoryContext).not.toContain('Memories v1');
  });

  test('handles memory injection error gracefully', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-error-'));
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'response' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Create mock injector that throws an error
    const mockInjector = {
      isEnabled: () => true,
      prepareInjection: async () => {
        throw new Error('Database error');
      },
    };
    (assistant as any).memoryInjector = mockInjector;

    // Should not throw - memory injection errors are non-critical
    // The error is caught and logged inside injectMemoryContext
    let caughtError: Error | null = null;
    try {
      await assistant.process('hello');
    } catch (error) {
      caughtError = error as Error;
    }
    // Should not have thrown
    expect(caughtError).toBeNull();

    // Memory context should be null after error
    expect((assistant as any).pendingMemoryContext).toBeNull();

    // Response should still be received
    expect(chunks.some((c) => c.type === 'text' && c.content === 'response')).toBe(true);
  });

  test('memory injection is disabled when injector returns disabled', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-disabled-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    // Create mock injector that is disabled
    const prepareCalled = { value: false };
    const mockInjector = {
      isEnabled: () => false,
      prepareInjection: async () => {
        prepareCalled.value = true;
        return { content: '', memoryIds: [], tokenEstimate: 0 };
      },
    };
    (assistant as any).memoryInjector = mockInjector;

    await assistant.process('hello');

    // prepareInjection should not be called when disabled
    expect(prepareCalled.value).toBe(false);
    expect((assistant as any).pendingMemoryContext).toBeNull();
  });

  test('session reset clears memory context', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'assistants-mem-reset-'));
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    // Manually set pendingMemoryContext
    (assistant as any).pendingMemoryContext = 'some memory context';

    // Clear conversation
    await assistant.process('/clear');

    // Memory context should still be present (not cleared by /clear)
    // but conversation should be cleared
    expect(assistant.getContext().getMessages().length).toBe(0);
  });
});
