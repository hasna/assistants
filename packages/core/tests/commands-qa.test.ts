/**
 * QA tests for all slash commands
 *
 * Exercises each built-in command handler to verify:
 * - No crashes / thrown exceptions
 * - Command is registered and findable
 * - Self-handled commands produce expected result shape
 * - Non-self-handled commands have content for the LLM
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { CommandLoader } from '../src/commands/loader';
import { CommandExecutor } from '../src/commands/executor';
import { BuiltinCommands } from '../src/commands/builtin';
import type { CommandContext } from '../src/commands/types';

describe('Slash command QA', () => {
  let loader: CommandLoader;
  let executor: CommandExecutor;
  let mockContext: CommandContext;
  let emittedChunks: Array<{ type: string; content?: string }>;

  beforeEach(() => {
    loader = new CommandLoader();
    executor = new CommandExecutor(loader);
    const builtins = new BuiltinCommands();
    builtins.registerAll(loader);

    emittedChunks = [];
    mockContext = {
      cwd: process.cwd(),
      sessionId: 'qa-test-session',
      messages: [],
      tools: [],
      skills: [],
      connectors: [],
      clearMessages: () => {},
      addSystemMessage: () => {},
      emit: (type: string, content?: string) => {
        emittedChunks.push({ type, content });
      },
    };
  });

  // All builtin commands that should be registered
  const EXPECTED_COMMANDS = [
    'help', 'docs', 'clear', 'new', 'sessions', 'status', 'tokens', 'context',
    'projects', 'plans', 'summarize', 'rest', 'voice',
    'assistants', 'identity', 'whoami', 'compact', 'config', 'budgets',
    'registry', 'swarm', 'workspace', 'init', 'cost',
    'model', 'skill', 'skills', 'memory', 'hooks', 'feedback',
    'schedules',
    'connectors', 'logs', 'guardrails', 'verification',
    'inbox', 'wallet', 'secrets', 'jobs', 'messages', 'tasks',
    'exit', 'diff', 'undo',
  ];

  test('all expected commands are registered', () => {
    for (const name of EXPECTED_COMMANDS) {
      const cmd = loader.getCommand(name);
      expect(cmd).toBeDefined();
    }
  });

  test('/agents command is NOT registered (merged into /assistants)', () => {
    expect(loader.getCommand('agents')).toBeUndefined();
  });

  // Self-handled commands that produce immediate results
  describe('self-handled commands - no crash verification', () => {
    test('/help', async () => {
      const result = await executor.execute('/help', mockContext);
      expect(result.handled).toBe(true);
      expect(emittedChunks.length).toBeGreaterThan(0);
    });

    test('/docs', async () => {
      const result = await executor.execute('/docs', mockContext);
      expect(result.handled).toBe(true);
      expect(emittedChunks.some(c => c.type === 'text' && (c.content || '').includes('assistants Documentation'))).toBe(true);
    });

    test('/clear', async () => {
      const result = await executor.execute('/clear', mockContext);
      expect(result.handled).toBe(true);
      expect(result.clearConversation).toBe(true);
    });

    test('/new', async () => {
      const result = await executor.execute('/new', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/status', async () => {
      const result = await executor.execute('/status', mockContext);
      expect(result.handled).toBe(true);
      expect(emittedChunks.some(c => c.type === 'text')).toBe(true);
    });

    test('/tokens', async () => {
      const result = await executor.execute('/tokens', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/context', async () => {
      const result = await executor.execute('/context', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/voice', async () => {
      const result = await executor.execute('/voice', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/whoami', async () => {
      const result = await executor.execute('/whoami', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/config shows panel', async () => {
      const result = await executor.execute('/config', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('config');
    });

    test('/budgets shows panel', async () => {
      const result = await executor.execute('/budgets', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('budget');
    });

    test('/budget alias shows panel', async () => {
      const result = await executor.execute('/budget', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('budget');
    });

    test('/hooks shows panel', async () => {
      const result = await executor.execute('/hooks', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('hooks');
    });

    test('/connectors shows panel', async () => {
      const result = await executor.execute('/connectors', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('connectors');
    });

    test('/projects shows panel', async () => {
      const result = await executor.execute('/projects', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('projects');
    });

    test('/plans shows panel', async () => {
      const result = await executor.execute('/plans', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('plans');
    });

    test('/tasks shows panel', async () => {
      const result = await executor.execute('/tasks', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('tasks');
    });

    test('/guardrails shows panel', async () => {
      const result = await executor.execute('/guardrails', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('guardrails');
    });

    test('/schedules shows panel', async () => {
      const result = await executor.execute('/schedules', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('schedules');
    });

    // Commands that show panels only when managers are available
    // Without managers they return handled:true with text output instead
    test('/identity handled', async () => {
      const result = await executor.execute('/identity', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/messages handled', async () => {
      const result = await executor.execute('/messages', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/inbox handled', async () => {
      const result = await executor.execute('/inbox', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/wallet handled', async () => {
      const result = await executor.execute('/wallet', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/secrets handled', async () => {
      const result = await executor.execute('/secrets', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/swarm handled', async () => {
      const result = await executor.execute('/swarm', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/registry (assistants) handled', async () => {
      const result = await executor.execute('/registry', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/workspace handled', async () => {
      const result = await executor.execute('/workspace', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/cost handled', async () => {
      const result = await executor.execute('/cost', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/model shows panel', async () => {
      const result = await executor.execute('/model', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('model');
    });

    test('/init handled', async () => {
      const result = await executor.execute('/init', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/rest handled', async () => {
      const result = await executor.execute('/rest', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/sessions handled', async () => {
      const result = await executor.execute('/sessions', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/session alias works', async () => {
      const result = await executor.execute('/session', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/schedule command is removed (merged into /schedules)', async () => {
      const cmd = loader.getCommand('schedule');
      expect(cmd).toBeUndefined();
    });

    test('/unschedule command is removed (merged into /schedules)', async () => {
      const cmd = loader.getCommand('unschedule');
      expect(cmd).toBeUndefined();
    });

    test('/pause command is removed (merged into /schedules)', async () => {
      const cmd = loader.getCommand('pause');
      expect(cmd).toBeUndefined();
    });

    test('/resume handled', async () => {
      const result = await executor.execute('/resume', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('resume');
    });

    test('/logs handled and shows panel', async () => {
      const result = await executor.execute('/logs', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('logs');
    });

    test('/security-log alias handled', async () => {
      const result = await executor.execute('/security-log', mockContext);
      expect(result.handled).toBe(true);
      expect(result.showPanel).toBe('logs');
    });

    test('/verification handled', async () => {
      const result = await executor.execute('/verification', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/jobs handled', async () => {
      const result = await executor.execute('/jobs', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/memory handled', async () => {
      const result = await executor.execute('/memory', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/feedback handled', async () => {
      const result = await executor.execute('/feedback good This is great', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/exit handled', async () => {
      const result = await executor.execute('/exit', mockContext);
      expect(result.handled).toBe(true);
      expect(result.exit).toBe(true);
    });

    test('/summarize handled', async () => {
      const result = await executor.execute('/summarize', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/skills handled', async () => {
      const result = await executor.execute('/skills', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/assistants handled', async () => {
      const result = await executor.execute('/assistants', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/diff handled', async () => {
      const result = await executor.execute('/diff', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/diff --staged handled', async () => {
      const result = await executor.execute('/diff --staged', mockContext);
      expect(result.handled).toBe(true);
    });

    test('/undo handled', async () => {
      const result = await executor.execute('/undo', mockContext);
      expect(result.handled).toBe(true);
    });
  });

  // Non-self-handled commands that send content to LLM
  describe('LLM-routed commands', () => {
    test('/compact has content for LLM', () => {
      const cmd = loader.getCommand('compact');
      expect(cmd).toBeDefined();
      expect(cmd!.selfHandled).toBe(false);
      expect(cmd!.content.length).toBeGreaterThan(0);
    });

    test('/skill returns result', async () => {
      const result = await executor.execute('/skill nonexistent', mockContext);
      expect(result).toBeDefined();
    });
  });

  describe('command descriptions', () => {
    test('all commands have descriptions', () => {
      const commands = loader.getCommands();
      for (const cmd of commands) {
        expect(cmd.description).toBeTruthy();
      }
    });
  });
});
