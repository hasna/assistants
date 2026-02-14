import { describe, expect, test } from 'bun:test';
import { AssistantLoop } from '../src/agent/loop';
import type { Tool } from '@hasna/assistants-shared';

const makeTool = (name: string): Tool => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});

describe('AssistantLoop allowed tools', () => {
  test('should intersect global and command allowed tools', () => {
    const assistant = new AssistantLoop({ allowedTools: ['Read', 'Bash'] });
    const current = (assistant as any).normalizeAllowedTools(['Edit', 'Bash']);
    (assistant as any).currentAllowedTools = current;

    const tools = [makeTool('read'), makeTool('write'), makeTool('bash')];
    const filtered = (assistant as any).filterAllowedTools(tools) as Tool[];

    expect(filtered.map((t) => t.name)).toEqual(['bash']);
    expect((assistant as any).isToolAllowed('bash')).toBe(true);
    expect((assistant as any).isToolAllowed('read')).toBe(false);
  });

  test('should allow all tools when no restrictions are set', () => {
    const assistant = new AssistantLoop();
    const tools = [makeTool('read'), makeTool('write')];
    const filtered = (assistant as any).filterAllowedTools(tools) as Tool[];
    expect(filtered).toEqual(tools);
  });
});

describe('AssistantLoop system prompt composition', () => {
  test('should compose base, extra, and system messages without duplication', () => {
    const assistant = new AssistantLoop({ extraSystemPrompt: 'Extra' });
    (assistant as any).systemPrompt = 'Base';

    const messages = [
      { role: 'system', content: 'Base' },
      { role: 'system', content: 'Skill' },
    ];

    const prompt = (assistant as any).buildSystemPrompt(messages);
    expect(prompt).toContain('Base');
    expect(prompt).toContain('Extra');
    expect(prompt).toContain('Skill');
  });
});

describe('AssistantLoop tool execution', () => {
  test('should inject cwd into tool input', async () => {
    const assistant = new AssistantLoop({ cwd: '/tmp/assistant-cwd' });
    let receivedInput: Record<string, unknown> | undefined;

    (assistant as any).toolRegistry.register(
      makeTool('spy'),
      async (input: Record<string, unknown>) => {
        receivedInput = input;
        return 'ok';
      }
    );

    await (assistant as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(receivedInput?.cwd).toBe('/tmp/assistant-cwd');
  });

  test('should apply updatedInput from PreToolUse hook', async () => {
    const assistant = new AssistantLoop({ cwd: '/tmp/base' });
    let receivedInput: Record<string, unknown> | undefined;

    (assistant as any).toolRegistry.register(
      makeTool('spy'),
      async (input: Record<string, unknown>) => {
        receivedInput = input;
        return 'ok';
      }
    );

    (assistant as any).hookLoader = {
      getHooks: (event: string) => (event === 'PreToolUse' ? ['pre'] : []),
    };

    (assistant as any).hookExecutor = {
      execute: async (_hooks: unknown, input: any) => {
        if (input.hook_event_name === 'PreToolUse') {
          return { updatedInput: { command: 'ls', cwd: '/tmp/override' } };
        }
        return null;
      },
    };

    await (assistant as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(receivedInput?.command).toBe('ls');
    expect(receivedInput?.cwd).toBe('/tmp/override');
  });

  test('should emit failure result when hook denies tool', async () => {
    const assistant = new AssistantLoop({ cwd: '/tmp/base' });
    const events: string[] = [];
    const toolResults: string[] = [];

    (assistant as any).toolRegistry.register(makeTool('spy'), async () => 'ok');

    (assistant as any).hookLoader = {
      getHooks: (event: string) => [event],
    };

    (assistant as any).hookExecutor = {
      execute: async (_hooks: unknown, input: any) => {
        events.push(input.hook_event_name);
        if (input.hook_event_name === 'PreToolUse') {
          return { permissionDecision: 'deny', stopReason: 'nope' };
        }
        return null;
      },
    };

    (assistant as any).onChunk = (chunk: any) => {
      if (chunk.type === 'tool_result') {
        toolResults.push(chunk.toolResult.content);
      }
    };

    const results = await (assistant as any).executeToolCalls([{ id: '1', name: 'spy', input: {} }]);

    expect(results[0].isError).toBe(true);
    expect(toolResults[0]).toContain('nope');
    expect(events).toContain('PreToolUse');
    expect(events).toContain('PostToolUseFailure');
  });

  test('should ignore tool result when stop() is called during execution', async () => {
    const assistant = new AssistantLoop({ cwd: '/tmp/base' });
    const emittedResults: unknown[] = [];

    // Register a tool that triggers stop during execution
    (assistant as any).toolRegistry.register(makeTool('slow-tool'), async () => {
      // Simulate stop being called during tool execution
      assistant.stop();
      return 'should be ignored';
    });

    (assistant as any).onChunk = (chunk: any) => {
      if (chunk.type === 'tool_result') {
        emittedResults.push(chunk.toolResult);
      }
    };

    const results = await (assistant as any).executeToolCalls([{ id: '1', name: 'slow-tool', input: {} }]);

    // The result should not be emitted or included in results
    expect(emittedResults.length).toBe(0);
    expect(results.length).toBe(0);
    // pendingToolCalls should be cleared
    expect((assistant as any).pendingToolCalls.size).toBe(0);
  });

  test('should clear pendingToolCalls when stop() is called', async () => {
    const assistant = new AssistantLoop({ cwd: '/tmp/base' });

    // Manually add pending tool calls
    (assistant as any).pendingToolCalls.set('1', 'tool1');
    (assistant as any).pendingToolCalls.set('2', 'tool2');

    expect((assistant as any).pendingToolCalls.size).toBe(2);

    assistant.stop();

    expect((assistant as any).pendingToolCalls.size).toBe(0);
  });
});
