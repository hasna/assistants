import { describe, expect, test } from 'bun:test';
import type { HookInput, HookOutput, NativeHook } from '@hasna/assistants-shared';
import { NativeHookRegistry } from '../src/hooks/native';

const baseInput: HookInput = {
  session_id: 'session-1',
  hook_event_name: 'SessionStart',
  cwd: '/tmp',
};

describe('NativeHookRegistry', () => {
  test('registers hooks and sorts by priority', () => {
    const registry = new NativeHookRegistry();
    const hookA: NativeHook = { id: 'a', event: 'SessionStart', priority: 5, handler: async () => null };
    const hookB: NativeHook = { id: 'b', event: 'SessionStart', priority: 1, handler: async () => null };
    registry.register(hookA);
    registry.register(hookB);

    const hooks = registry.getHooks('SessionStart');
    expect(hooks[0].id).toBe('b');
    expect(hooks[1].id).toBe('a');
  });

  test('deduplicates hooks by id per event and keeps latest registration', async () => {
    const registry = new NativeHookRegistry();
    const calls: string[] = [];

    registry.register({
      id: 'dup',
      event: 'Stop',
      priority: 50,
      handler: async () => {
        calls.push('old');
        return null;
      },
    });
    registry.register({
      id: 'dup',
      event: 'Stop',
      priority: 1,
      handler: async () => {
        calls.push('new');
        return null;
      },
    });

    const hooks = registry.getHooks('Stop');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].priority).toBe(1);

    await registry.execute('Stop', { ...baseInput, hook_event_name: 'Stop' }, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
    });
    expect(calls).toEqual(['new']);
  });

  test('execute returns blocking result', async () => {
    const registry = new NativeHookRegistry();
    const hook: NativeHook = {
      id: 'block',
      event: 'SessionStart',
      priority: 1,
      handler: async (): Promise<HookOutput> => ({ continue: false, stopReason: 'blocked' }),
    };
    registry.register(hook);

    const result = await registry.execute('SessionStart', baseInput, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
    });

    expect(result?.continue).toBe(false);
    expect(result?.stopReason).toBe('blocked');
  });

  test('disables scope verification hook via config', async () => {
    const registry = new NativeHookRegistry();
    const hook: NativeHook = {
      id: 'scope-verification',
      event: 'Stop',
      priority: 1,
      handler: async (): Promise<HookOutput> => ({ continue: false }),
    };
    registry.register(hook);
    registry.setConfig({ scopeVerification: { enabled: false } });

    const result = await registry.execute('Stop', { ...baseInput, hook_event_name: 'Stop' }, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
      config: registry.getConfig(),
    });

    expect(result).toBeNull();
  });

  test('ignores hook errors', async () => {
    const registry = new NativeHookRegistry();
    const hook: NativeHook = {
      id: 'bad',
      event: 'SessionStart',
      priority: 1,
      handler: async () => {
        throw new Error('boom');
      },
    };
    registry.register(hook);

    const result = await registry.execute('SessionStart', baseInput, {
      sessionId: 'session-1',
      cwd: '/tmp',
      messages: [],
    });

    expect(result).toBeNull();
  });
});
