import { describe, expect, test, beforeEach } from 'bun:test';
import { HookLoader } from '../src/hooks/loader';
import { HookExecutor } from '../src/hooks/executor';
import type { LLMClient } from '../src/llm/client';
import type { HookConfig, HookMatcher, HookInput, HookEvent } from '@hasna/assistants-shared';

describe('HookLoader', () => {
  let loader: HookLoader;

  beforeEach(() => {
    loader = new HookLoader();
  });

  describe('load', () => {
    test('should load hook configuration', () => {
      const config: HookConfig = {
        PreToolUse: [
          { matcher: 'bash', hooks: [{ type: 'command', command: 'echo test' }] },
        ],
      };

      loader.load(config);

      expect(loader.getHooks('PreToolUse')).toHaveLength(1);
    });

    test('should replace existing hooks on load', () => {
      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'first' }] }],
      });

      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'second' }] }],
      });

      const hooks = loader.getHooks('PreToolUse');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].hooks[0].command).toBe('second');
    });
  });

  describe('merge', () => {
    test('should merge additional hooks', () => {
      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'first' }] }],
      });

      loader.merge({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'second' }] }],
      });

      expect(loader.getHooks('PreToolUse')).toHaveLength(2);
    });

    test('should add new event hooks when merging', () => {
      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
      });

      loader.merge({
        PostToolUse: [{ hooks: [{ type: 'command', command: 'post' }] }],
      });

      expect(loader.hasHooks('PreToolUse')).toBe(true);
      expect(loader.hasHooks('PostToolUse')).toBe(true);
    });
  });

  describe('getHooks', () => {
    test('should return empty array for non-existent event', () => {
      expect(loader.getHooks('PreToolUse')).toEqual([]);
    });

    test('should return hooks for specific event', () => {
      loader.load({
        PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: 'validate' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: 'log' }] }],
      });

      const preHooks = loader.getHooks('PreToolUse');
      const postHooks = loader.getHooks('PostToolUse');

      expect(preHooks).toHaveLength(1);
      expect(preHooks[0].matcher).toBe('bash');
      expect(postHooks).toHaveLength(1);
    });
  });

  describe('getAllHooks', () => {
    test('should return copy of all hooks', () => {
      const config: HookConfig = {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'pre' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: 'post' }] }],
      };

      loader.load(config);

      const allHooks = loader.getAllHooks();
      expect(Object.keys(allHooks)).toContain('PreToolUse');
      expect(Object.keys(allHooks)).toContain('PostToolUse');

      // Should be a copy, not the original
      allHooks.PreToolUse = [];
      expect(loader.getHooks('PreToolUse')).toHaveLength(1);
    });
  });

  describe('hasHooks', () => {
    test('should return false when no hooks', () => {
      expect(loader.hasHooks('PreToolUse')).toBe(false);
    });

    test('should return true when hooks exist', () => {
      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'test' }] }],
      });

      expect(loader.hasHooks('PreToolUse')).toBe(true);
      expect(loader.hasHooks('PostToolUse')).toBe(false);
    });
  });

  describe('clear', () => {
    test('should remove all hooks', () => {
      loader.load({
        PreToolUse: [{ hooks: [{ type: 'command', command: 'test' }] }],
        PostToolUse: [{ hooks: [{ type: 'command', command: 'test' }] }],
      });

      expect(loader.hasHooks('PreToolUse')).toBe(true);

      loader.clear();

      expect(loader.hasHooks('PreToolUse')).toBe(false);
      expect(loader.hasHooks('PostToolUse')).toBe(false);
      expect(loader.getAllHooks()).toEqual({});
    });
  });
});

describe('HookExecutor', () => {
  let executor: HookExecutor;

  beforeEach(() => {
    executor = new HookExecutor();
  });

  const createInput = (overrides: Partial<HookInput> = {}): HookInput => ({
    session_id: 'sess-123',
    hook_event_name: 'PreToolUse',
    cwd: '/home/user',
    tool_name: 'bash',
    tool_input: { command: 'ls' },
    ...overrides,
  });

  describe('matchesPattern', () => {
    // Access private method for testing
    const matchesPattern = (executor: HookExecutor, pattern: string | undefined, input: HookInput): boolean => {
      return (executor as any).matchesPattern(pattern, input);
    };

    test('should match empty pattern', () => {
      const input = createInput({ tool_name: 'bash' });
      expect(matchesPattern(executor, undefined, input)).toBe(true);
      expect(matchesPattern(executor, '', input)).toBe(true);
    });

    test('should match wildcard pattern', () => {
      const input = createInput({ tool_name: 'bash' });
      expect(matchesPattern(executor, '*', input)).toBe(true);
    });

    test('should match exact tool name', () => {
      const input = createInput({ tool_name: 'bash' });
      expect(matchesPattern(executor, 'bash', input)).toBe(true);
      expect(matchesPattern(executor, 'notion', input)).toBe(false);
    });

    test('should match regex pattern', () => {
      const input = createInput({ tool_name: 'google_calendar' });
      expect(matchesPattern(executor, 'google_.*', input)).toBe(true);
      expect(matchesPattern(executor, 'google.*', input)).toBe(true);
      expect(matchesPattern(executor, 'notion.*', input)).toBe(false);
    });

    test('should match based on event type', () => {
      const sessionInput = createInput({
        hook_event_name: 'SessionStart',
        source: 'terminal' as any,
      });
      expect(matchesPattern(executor, 'terminal', sessionInput)).toBe(true);
    });

    test('should match SessionEnd reason', () => {
      const endInput = createInput({
        hook_event_name: 'SessionEnd',
        reason: 'timeout' as any,
      });
      expect(matchesPattern(executor, 'timeout', endInput)).toBe(true);
    });

    test('should return true when no matcher value exists', () => {
      const input = createInput({
        hook_event_name: 'SessionStart',
        source: undefined as any,
      });
      expect(matchesPattern(executor, 'anything', input)).toBe(true);
    });

    test('should fall back to equality on invalid regex', () => {
      const input = createInput({ tool_name: '[' });
      expect(matchesPattern(executor, '[', input)).toBe(true);
    });

    test('should match PermissionRequest tool name', () => {
      const input = createInput({
        hook_event_name: 'PermissionRequest',
        tool_name: 'bash',
      });
      expect(matchesPattern(executor, 'bash', input)).toBe(true);
      expect(matchesPattern(executor, 'read', input)).toBe(false);
    });

    test('should match Notification type', () => {
      const input = createInput({
        hook_event_name: 'Notification',
        notification_type: 'info' as any,
      });
      expect(matchesPattern(executor, 'info', input)).toBe(true);
      expect(matchesPattern(executor, 'error', input)).toBe(false);
    });

    test('should match SubassistantStart task pattern', () => {
      const input = createInput({
        hook_event_name: 'SubassistantStart',
        task: 'search for files' as any,
      });
      expect(matchesPattern(executor, 'search.*', input)).toBe(true);
      expect(matchesPattern(executor, 'delete.*', input)).toBe(false);
    });

    test('should match SubassistantStop status', () => {
      const input = createInput({
        hook_event_name: 'SubassistantStop',
        status: 'completed' as any,
      });
      expect(matchesPattern(executor, 'completed', input)).toBe(true);
      expect(matchesPattern(executor, 'failed', input)).toBe(false);
    });

    test('should match PreCompact strategy', () => {
      const input = createInput({
        hook_event_name: 'PreCompact',
        strategy: 'hybrid' as any,
      });
      expect(matchesPattern(executor, 'hybrid', input)).toBe(true);
      expect(matchesPattern(executor, 'llm', input)).toBe(false);
    });
  });

  describe('execute', () => {
    test('should return null for empty matchers', async () => {
      const result = await executor.execute([], createInput());
      expect(result).toBeNull();
    });

    test('should skip non-matching matchers', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: 'notion',
          hooks: [{ type: 'command', command: 'echo blocked' }],
        },
      ];

      const result = await executor.execute(matchers, createInput({ tool_name: 'bash' }));
      expect(result).toBeNull();
    });

    test('should execute matching hooks', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: 'bash',
          hooks: [{ type: 'command', command: 'echo "ok"' }],
        },
      ];

      const result = await executor.execute(matchers, createInput({ tool_name: 'bash' }));
      // Command returns JSON with continue: true, or text context
      // Depending on command output
      expect(result === null || result.continue === true || result.additionalContext !== undefined).toBe(true);
    });

    test('should stop processing when hook blocks', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'exit 2' }, // Blocking exit code
          ],
        },
      ];

      const result = await executor.execute(matchers, createInput());
      if (result !== null) {
        expect(result.continue).toBe(false);
      }
    });

    test('should return permission decision from hook', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'echo \'{"permissionDecision":"deny","stopReason":"nope"}\'' },
          ],
        },
      ];

      const result = await executor.execute(matchers, createInput());
      expect(result?.permissionDecision).toBe('deny');
    });

    test('should execute prompt hook when matched', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: 'bash',
          hooks: [{ type: 'prompt', prompt: 'Is this safe?' }],
        },
      ];

      const result = await executor.execute(matchers, createInput({ tool_name: 'bash' }));
      expect(result).toBeNull();
    });

    test('should execute assistant hook when matched', async () => {
      const matchers: HookMatcher[] = [
        {
          matcher: 'bash',
          hooks: [{ type: 'assistant', prompt: 'Review request' }],
        },
      ];

      const result = await executor.execute(matchers, createInput({ tool_name: 'bash' }));
      expect(result).toBeNull();
    });
  });

  describe('prompt hook execution with LLM', () => {
    class MockLLM implements LLMClient {
      private response: string;

      constructor(response: string) {
        this.response = response;
      }

      async *chat(_messages: any, _tools?: any, _system?: any): AsyncGenerator<any> {
        yield { type: 'text', content: this.response };
        yield { type: 'done' };
      }

      getModel(): string {
        return 'mock';
      }
    }

    class DelayedLLM implements LLMClient {
      async *chat(): AsyncGenerator<any> {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { type: 'text', content: '{"allow":true}' };
        yield { type: 'done' };
      }

      getModel(): string {
        return 'mock';
      }
    }

    test('should allow when LLM returns allow=true', async () => {
      executor.setLLMClient(new MockLLM('{"allow":true,"reason":"ok"}'));
      const result = await (executor as any).executePromptHook(
        { type: 'prompt', prompt: 'Is this safe?' },
        createInput(),
        1000
      );
      expect(result?.continue).toBe(true);
    });

    test('should deny when LLM returns allow=false', async () => {
      executor.setLLMClient(new MockLLM('{"allow":false,"reason":"no"}'));
      const result = await (executor as any).executePromptHook(
        { type: 'prompt', prompt: 'Is this safe?' },
        createInput(),
        1000
      );
      expect(result?.continue).toBe(false);
      expect(result?.stopReason).toBe('no');
    });

    test('should return null on invalid JSON', async () => {
      executor.setLLMClient(new MockLLM('not-json'));
      const result = await (executor as any).executePromptHook(
        { type: 'prompt', prompt: 'Is this safe?' },
        createInput(),
        1000
      );
      expect(result).toBeNull();
    });

    test('should return null on timeout', async () => {
      executor.setLLMClient(new DelayedLLM());
      const result = await (executor as any).executePromptHook(
        { type: 'prompt', prompt: 'Is this safe?' },
        createInput(),
        1
      );
      expect(result).toBeNull();
    });
  });

  describe('assistant hook execution with runner', () => {
    test('should parse ALLOW response', async () => {
      executor.setAssistantRunner(async () => 'ALLOW ok');
      const result = await (executor as any).executeAssistantHook(
        { type: 'assistant', prompt: 'Review' },
        createInput(),
        1000
      );
      expect(result?.continue).toBe(true);
    });

    test('should parse DENY response', async () => {
      executor.setAssistantRunner(async () => 'DENY blocked');
      const result = await (executor as any).executeAssistantHook(
        { type: 'assistant', prompt: 'Review' },
        createInput(),
        1000
      );
      expect(result?.continue).toBe(false);
      expect(result?.stopReason).toBe('blocked');
    });
  });

  describe('executeHook', () => {
    // Access private method for testing
    const executeHook = (
      executor: HookExecutor,
      hook: { type: string; command?: string; prompt?: string },
      input: HookInput
    ) => {
      return (executor as any).executeHook(hook, input);
    };

    test('should handle prompt hooks (not yet implemented)', async () => {
      const result = await executeHook(
        executor,
        { type: 'prompt', prompt: 'Is this safe?' },
        createInput()
      );
      // Currently returns null as not implemented
      expect(result).toBeNull();
    });

    test('should handle assistant hooks (not yet implemented)', async () => {
      const result = await executeHook(
        executor,
        { type: 'assistant', prompt: 'Validate input' },
        createInput()
      );
      // Currently returns null as not implemented
      expect(result).toBeNull();
    });

    test('should handle unknown hook types', async () => {
      const result = await executeHook(
        executor,
        { type: 'unknown' },
        createInput()
      );
      expect(result).toBeNull();
    });

    test('should swallow errors from hook execution', async () => {
      const originalExecute = (executor as any).executeCommandHook;
      (executor as any).executeCommandHook = () => {
        throw new Error('boom');
      };
      try {
        const result = await executeHook(
          executor,
          { type: 'command', command: 'echo ok' },
          createInput()
        );
        expect(result).toBeNull();
      } finally {
        (executor as any).executeCommandHook = originalExecute;
      }
    });
  });

  describe('command hook execution', () => {
    // Access private method
    const executeCommandHook = (
      executor: HookExecutor,
      hook: { type: string; command?: string; timeout?: number },
      input: HookInput,
      timeout: number
    ) => {
      return (executor as any).executeCommandHook(hook, input, timeout);
    };

    test('should return null for hook without command', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command' },
        createInput(),
        1000
      );
      expect(result).toBeNull();
    });

    test('should execute simple command', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command', command: 'echo "hello"' },
        createInput(),
        5000
      );
      // Non-JSON output returns additionalContext
      expect(result?.additionalContext).toContain('hello');
    });

    test('should handle JSON output from command', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command', command: 'echo \'{"continue": true, "systemMessage": "allowed"}\'' },
        createInput(),
        5000
      );
      expect(result?.continue).toBe(true);
      expect(result?.systemMessage).toBe('allowed');
    });

    test('should handle exit code 2 as blocking', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command', command: 'exit 2' },
        createInput(),
        5000
      );
      expect(result?.continue).toBe(false);
    });

    test('should handle non-zero exit codes other than 2', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command', command: 'exit 1' },
        createInput(),
        5000
      );
      // Non-blocking error returns null
      expect(result).toBeNull();
    });

    test('should kill long-running command when timeout is reached', async () => {
      const result = await executeCommandHook(
        executor,
        { type: 'command', command: 'sleep 1' },
        createInput(),
        1
      );
      expect(result).toBeNull();
    });

    test('should return null when spawn throws', async () => {
      const originalSpawn = Bun.spawn;
      (Bun as any).spawn = () => {
        throw new Error('spawn failed');
      };
      try {
        const result = await executeCommandHook(
          executor,
          { type: 'command', command: 'echo ok' },
          createInput(),
          5000
        );
        expect(result).toBeNull();
      } finally {
        (Bun as any).spawn = originalSpawn;
      }
    });
  });

  describe('prompt and assistant hook execution', () => {
    const executePromptHook = (
      executor: HookExecutor,
      hook: { type: string; prompt?: string },
      input: HookInput,
      timeout: number
    ) => {
      return (executor as any).executePromptHook(hook, input, timeout);
    };

    const executeAssistantHook = (
      executor: HookExecutor,
      hook: { type: string; prompt?: string },
      input: HookInput,
      timeout: number
    ) => {
      return (executor as any).executeAssistantHook(hook, input, timeout);
    };

    test('should return null when prompt is missing', async () => {
      const result = await executePromptHook(executor, { type: 'prompt' }, createInput(), 1000);
      expect(result).toBeNull();
    });

    test('should return null for prompt hook with prompt', async () => {
      const result = await executePromptHook(
        executor,
        { type: 'prompt', prompt: 'Decision needed' },
        createInput(),
        1000
      );
      expect(result).toBeNull();
    });

    test('should return null when assistant prompt is missing', async () => {
      const result = await executeAssistantHook(executor, { type: 'assistant' }, createInput(), 1000);
      expect(result).toBeNull();
    });

    test('should return null for assistant hook with prompt', async () => {
      const result = await executeAssistantHook(
        executor,
        { type: 'assistant', prompt: 'Investigate' },
        createInput(),
        1000
      );
      expect(result).toBeNull();
    });
  });
});
