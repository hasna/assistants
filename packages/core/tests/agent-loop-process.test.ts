import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { StreamChunk } from '@hasna/assistants-shared';
import { AssistantLoop } from '../src/agent/loop';
import { nativeHookRegistry } from '../src/hooks/native';
import { ContextManager } from '../src/context/manager';
import type { SummaryStrategy } from '../src/context/summarizer';
import { readSchedule, saveSchedule } from '../src/scheduler/store';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

let callCount = 0;
let originalAssistantsDir: string | undefined;
let currentTempDir: string | null = null;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  currentTempDir = dir;
  process.env.ASSISTANTS_DIR = dir;
  resetDatabaseSingleton();
  return dir;
}

describe('AssistantLoop process', () => {
  beforeEach(() => {
    nativeHookRegistry.clear();
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
  });

  beforeEach(() => {
    callCount = 0;
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    if (currentTempDir) {
      rmSync(currentTempDir, { recursive: true, force: true });
      currentTempDir = null;
    }
  });

  test('auto compaction summarizes when context grows too large', async () => {
    const cwd = createTempDir('assistants-sum-');
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => chunks.push(chunk),
    });

    class StubSummarizer implements SummaryStrategy {
      name = 'stub';
      async summarize(): Promise<string> {
        return 'stub summary';
      }
    }

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    const contextConfig = {
      enabled: true,
      maxContextTokens: 50,
      targetContextTokens: 40,
      summaryTriggerRatio: 0.5,
      keepRecentMessages: 0,
      keepSystemPrompt: false,
      summaryStrategy: 'llm',
      summaryMaxTokens: 50,
      maxMessages: 100,
    };

    (assistant as any).contextConfig = contextConfig;
    (assistant as any).contextManager = new ContextManager(contextConfig, new StubSummarizer());

    await assistant.process('word '.repeat(200));

    const messages = assistant.getContext().getMessages();
    expect(messages.some((msg) => msg.role === 'system' && msg.content.includes('Context Summary'))).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'text' && chunk.content?.includes('Context summarized'))).toBe(true);
  });

  test('executes tool calls and continues the loop', async () => {
    const cwd = createTempDir('assistants-loop-');
    const assistant = new AssistantLoop({ cwd });

    // Inject a fake LLM client and minimal config to avoid network calls
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        callCount += 1;
        if (callCount === 1) {
          yield {
            type: 'tool_use',
            toolCall: { id: 'tc1', name: 'test_tool', input: { foo: 'bar' } },
          };
          yield { type: 'done' };
          return;
        }
        yield { type: 'text', content: 'final' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async (input: Record<string, unknown>) => JSON.stringify(input)
    );

    await assistant.process('hi');

    const messages = assistant.getContext().getMessages();
    const last = messages[messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.content).toContain('final');

    const toolResultMessage = messages.find((m) => m.toolResults?.length);
    expect(toolResultMessage?.toolResults?.[0].content).toContain('"foo":"bar"');
    expect(callCount).toBe(2);
  });

  test('handles built-in commands without calling the LLM', async () => {
    const cwd = createTempDir('assistants-cmd-');
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

    await assistant.process('/help');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'text' && c.content?.includes('Available Slash Commands'))).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('executes explicit bash tool command without LLM', async () => {
    const cwd = createTempDir('assistants-bash-');
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

    await assistant.process('![bash] echo hi');

    expect(chatCalls).toBe(0);
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('explicit bash tool command returns error when tool fails', async () => {
    const cwd = createTempDir('assistants-bash-error-');
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
      async () => 'Error: blocked'
    );

    const result = await (assistant as any).runMessage('![bash] rm -rf /', 'user');

    expect(chatCalls).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Error: blocked');
    }
    expect(chunks.some((c) => c.type === 'tool_use')).toBe(true);
    expect(chunks.some((c) => c.type === 'tool_result')).toBe(true);
    expect(chunks.some((c) => c.type === 'done')).toBe(true);
  });

  test('stop halts streaming after first chunk', async () => {
    const cwd = createTempDir('assistants-stop-');
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          assistant.stop();
        }
      },
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text', content: 'first' };
        yield { type: 'text', content: 'second' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    await assistant.process('hello');

    const last = assistant.getContext().getMessages().slice(-1)[0];
    expect(last?.content).toContain('first');
    expect(last?.content).not.toContain('second');
    expect(chunks.filter((c) => c.type === 'text').length).toBe(1);
  });

  test('stop skips scope verification rerun', async () => {
    const cwd = createTempDir('assistants-stop-scope-');
    const chunks: StreamChunk[] = [];
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        chunks.push(chunk);
        if (chunk.type === 'text') {
          assistant.stop();
        }
      },
    });

    let chatCalls = 0;
    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'first' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    nativeHookRegistry.register({
      id: 'scope-verification',
      event: 'Stop',
      priority: 1,
      handler: async () => ({ continue: false, systemMessage: 'retry' }),
    });

    await assistant.process('fix this bug in the system');

    expect(chatCalls).toBe(2);
  });

  test('stop prevents tool execution after tool_use', async () => {
    const cwd = createTempDir('assistants-stop-tools-');
    let toolStartCalled = false;
    const assistant = new AssistantLoop({
      cwd,
      onChunk: (chunk) => {
        if (chunk.type === 'tool_use') {
          assistant.stop();
        }
      },
      onToolStart: () => {
        toolStartCalled = true;
      },
    });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'tool_use', toolCall: { id: 'tc1', name: 'test_tool', input: { ok: true } } };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'test_tool', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'should-not-run'
    );

    await assistant.process('hi');

    expect(toolStartCalled).toBe(false);
    const hasToolResults = assistant.getContext().getMessages().some((m) => m.toolResults?.length);
    expect(hasToolResults).toBe(false);
  });

  test('clear command resets context via command handler', async () => {
    const cwd = createTempDir('assistants-clear-');
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    assistant.getContext().addUserMessage('hello');
    expect(assistant.getContext().getMessages().length).toBe(1);

    await assistant.process('/clear');

    expect(assistant.getContext().getMessages().length).toBe(0);
  });

  test('runs due schedules immediately after a turn ends', async () => {
    const cwd = createTempDir('assistants-sched-immediate-');
    const assistant = new AssistantLoop({ cwd });
    let chatCalls = 0;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: chatCalls === 1 ? 'user-turn' : 'scheduled-turn' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    const now = Date.now();
    await saveSchedule(cwd, {
      id: 'due-immediately',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      createdBy: 'assistant',
      sessionId: (assistant as any).sessionId,
      command: 'scheduled follow-up',
      status: 'active',
      schedule: {
        kind: 'once',
        at: new Date(now - 1000).toISOString(),
      },
      nextRunAt: now - 50,
    });

    await assistant.process('hello');

    expect(chatCalls).toBe(2);
    const updated = await readSchedule(cwd, 'due-immediately');
    expect(updated?.status).toBe('completed');
    expect(updated?.nextRunAt).toBeUndefined();
  });

  test('does not run due schedules when scheduler is disabled', async () => {
    const cwd = createTempDir('assistants-sched-disabled-');
    const assistant = new AssistantLoop({ cwd });
    let chatCalls = 0;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        chatCalls += 1;
        yield { type: 'text', content: 'user-turn' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = {
      llm: { provider: 'anthropic', model: 'mock' },
      scheduler: { enabled: false },
    };

    const now = Date.now();
    await saveSchedule(cwd, {
      id: 'due-disabled',
      createdAt: now - 1000,
      updatedAt: now - 1000,
      createdBy: 'assistant',
      sessionId: (assistant as any).sessionId,
      command: 'scheduled follow-up',
      status: 'active',
      schedule: {
        kind: 'once',
        at: new Date(now - 1000).toISOString(),
      },
      nextRunAt: now - 50,
    });

    await assistant.process('hello');

    expect(chatCalls).toBe(1);
    const updated = await readSchedule(cwd, 'due-disabled');
    expect(updated?.status).toBe('active');
  });

  test('applies command allowed tools when executing prompt', async () => {
    const cwd = createTempDir('assistants-cmdtools-');
    const assistant = new AssistantLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (
        messages: unknown[],
        tools?: Array<{ name: string }>
      ): AsyncGenerator<StreamChunk> {
        receivedTools = tools;
        yield { type: 'text', content: 'ok' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };
    (assistant as any).builtinCommands.registerAll((assistant as any).commandLoader);

    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (assistant as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (assistant as any).commandLoader.register({
      name: 'run',
      description: 'Run command',
      content: 'Do $ARGUMENTS',
      allowedTools: ['bash'],
    });

    await assistant.process('/run something');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['bash']);
  });

  test('handles skill invocation and filters tools', async () => {
    const cwd = createTempDir('assistants-skill-');
    const assistant = new AssistantLoop({ cwd });
    let receivedTools: Array<{ name: string }> | undefined;
    let receivedSystemPrompt: string | undefined;

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (
        messages: unknown[],
        tools?: Array<{ name: string }>,
        systemPrompt?: string
      ): AsyncGenerator<StreamChunk> {
        receivedTools = tools;
        receivedSystemPrompt = systemPrompt;
        yield { type: 'text', content: 'done' };
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).toolRegistry.register(
      { name: 'read', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );
    (assistant as any).toolRegistry.register(
      { name: 'bash', description: 't', parameters: { type: 'object', properties: {} } },
      async () => 'ok'
    );

    (assistant as any).skillLoader.skills.set('demo', {
      name: 'demo',
      description: 'Demo skill',
      content: 'Skill content',
      allowedTools: ['read'],
      filePath: join(cwd, 'SKILL.md'),
      contentLoaded: true,
    });

    await assistant.process('/demo arg1 arg2');

    expect(receivedTools?.map((t) => t.name).sort()).toEqual(['read']);
    expect(receivedSystemPrompt).toContain('Skill content');
  });

  test('handles /skills and /connectors commands with context data', async () => {
    const cwd = createTempDir('assistants-ctx-');
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

    (assistant as any).skillLoader.skills.set('alpha', {
      name: 'alpha',
      description: 'Alpha skill',
      content: 'Skill',
      filePath: join(cwd, 'SKILL.md'),
    });

    (assistant as any).connectorBridge.connectors.set('demo', {
      name: 'demo',
      cli: 'connect-demo',
      description: 'Demo connector',
      commands: [{ name: 'list', description: 'List', args: [], options: [] }],
    });

    await assistant.process('/skills');
    await assistant.process('/connectors --list');

    const showPanelChunks = chunks.filter((c) => c.type === 'show_panel');
    expect(showPanelChunks.some((c) => c.panel === 'skills')).toBe(true);
    const textChunks = chunks.filter((c) => c.type === 'text' && c.content);
    expect(textChunks.some((c) => c.content?.includes('demo'))).toBe(true);
  });

  test('command context can add system messages', async () => {
    const cwd = createTempDir('assistants-sysmsg-');
    const assistant = new AssistantLoop({ cwd });

    (assistant as any).llmClient = {
      getModel: () => 'mock',
      chat: async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'done' };
      },
    };
    (assistant as any).config = { llm: { provider: 'anthropic', model: 'mock' } };

    (assistant as any).commandLoader.register({
      name: 'sysmsg',
      description: 'Add system message',
      content: '',
      selfHandled: true,
      handler: async (_args, context) => {
        context.addSystemMessage('system-note');
        context.emit('done');
        return { handled: true };
      },
    });

    await assistant.process('/sysmsg');

    const messages = assistant.getContext().getMessages();
    expect(messages.some((m) => m.role === 'system' && m.content === 'system-note')).toBe(true);
  });
});
