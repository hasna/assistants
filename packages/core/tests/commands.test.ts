import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { CommandLoader } from '../src/commands/loader';
import { CommandExecutor } from '../src/commands/executor';
import { BuiltinCommands } from '../src/commands/builtin';
import { TelephonyManager } from '../src/telephony/manager';
import { listProjects, readProject } from '../src/projects/store';
import type { CommandContext, CommandResult } from '../src/commands/types';
import { IdentityManager } from '../src/identity/identity-manager';
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendHeartbeatHistory } from '../src/heartbeat/history';
import { listSchedules, saveSchedule, computeNextRun } from '../src/scheduler/store';
import { generateId } from '@hasna/assistants-shared';
import { getRuntime } from '../src/runtime';
import { SessionStorage } from '../src/logger';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

describe('CommandLoader', () => {
  let loader: CommandLoader;
  let testDir: string;
  let commandsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `assistants-test-${Date.now()}`);
    commandsDir = join(testDir, '.assistants', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    loader = new CommandLoader(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadAll', () => {
    test('should load commands from directory', async () => {
      // Create a test command file
      writeFileSync(join(commandsDir, 'test.md'), `---
name: test
description: A test command
---

Test content here.
`);

      await loader.loadAll();
      const commands = loader.getCommands();
      expect(commands.length).toBeGreaterThan(0);

      const testCmd = loader.getCommand('test');
      expect(testCmd).toBeDefined();
      expect(testCmd?.description).toBe('A test command');
      expect(testCmd?.content).toBe('Test content here.');
    });

    test('should load global commands from HOME', async () => {
      const originalHome = process.env.HOME;
      const homeDir = join(testDir, 'home');
      const globalDir = join(homeDir, '.assistants', 'commands');
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(globalDir, 'global.md'), `---
name: global
description: Global command
---
Global content`);

      process.env.HOME = homeDir;
      const homeLoader = new CommandLoader(testDir);
      await homeLoader.loadAll();

      expect(homeLoader.hasCommand('global')).toBe(true);

      process.env.HOME = originalHome;
    });

    test('should handle missing directory', async () => {
      const emptyLoader = new CommandLoader('/nonexistent/path');
      await emptyLoader.loadAll();
      expect(emptyLoader.getCommands()).toEqual([]);
    });

    test('should derive name from filename if not in frontmatter', async () => {
      writeFileSync(join(commandsDir, 'mycommand.md'), `---
description: Command without name
---

Content.
`);

      await loader.loadAll();
      expect(loader.hasCommand('mycommand')).toBe(true);
    });

    test('should parse tags from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'tagged.md'), `---
name: tagged
description: A tagged command
tags: [git, automation]
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('tagged');
      expect(cmd?.tags).toEqual(['git', 'automation']);
    });

    test('should parse frontmatter with CRLF newlines', async () => {
      writeFileSync(join(commandsDir, 'crlf.md'), `---\r\nname: crlf\r\ndescription: CRLF\r\n---\r\n\r\nContent.`);

      await loader.loadAll();
      const cmd = loader.getCommand('crlf');
      expect(cmd?.description).toBe('CRLF');
      expect(cmd?.content).toBe('Content.');
    });

    test('should parse allowed-tools from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'restricted.md'), `---
name: restricted
description: Restricted tools
allowed-tools: bash, read
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('restricted');
      expect(cmd?.allowedTools).toEqual(['bash', 'read']);
    });

    test('should parse allowed-tools array from frontmatter', async () => {
      writeFileSync(join(commandsDir, 'restricted-array.md'), `---
name: restricted-array
description: Restricted tools array
allowed-tools: [bash, read]
---

Content.
`);

      await loader.loadAll();
      const cmd = loader.getCommand('restricted-array');
      expect(cmd?.allowedTools).toEqual(['bash', 'read']);
    });

    test('should handle nested directories with namespacing', async () => {
      const gitDir = join(commandsDir, 'git');
      mkdirSync(gitDir, { recursive: true });
      writeFileSync(join(gitDir, 'commit.md'), `---
description: Git commit command
---

Commit changes.
`);

      await loader.loadAll();
      expect(loader.hasCommand('git:commit')).toBe(true);
    });

    test('should handle file without frontmatter', async () => {
      writeFileSync(join(commandsDir, 'plain.md'), 'Just plain content.');

      await loader.loadAll();
      const cmd = loader.getCommand('plain');
      expect(cmd).toBeDefined();
      expect(cmd?.content).toBe('Just plain content.');
    });
  });

  describe('register', () => {
    test('should register a command programmatically', () => {
      loader.register({
        name: 'programmatic',
        description: 'A programmatic command',
        content: 'Content here',
        builtin: true,
      });

      expect(loader.hasCommand('programmatic')).toBe(true);
      const cmd = loader.getCommand('programmatic');
      expect(cmd?.builtin).toBe(true);
    });
  });

  describe('getCommand', () => {
    test('should return undefined for non-existent command', () => {
      expect(loader.getCommand('nonexistent')).toBeUndefined();
    });
  });

  describe('findMatching', () => {
    test('should find commands by partial name', async () => {
      loader.register({ name: 'commit', description: 'Commit changes', content: '' });
      loader.register({ name: 'config', description: 'Configuration', content: '' });
      loader.register({ name: 'help', description: 'Show help', content: '' });

      const matches = loader.findMatching('co');
      expect(matches.length).toBe(2);
      expect(matches.map(c => c.name)).toContain('commit');
      expect(matches.map(c => c.name)).toContain('config');
    });

    test('should find commands by description', async () => {
      loader.register({ name: 'commit', description: 'Commit changes', content: '' });

      const matches = loader.findMatching('changes');
      expect(matches.length).toBe(1);
      expect(matches[0].name).toBe('commit');
    });
  });
});

describe('CommandExecutor', () => {
  let loader: CommandLoader;
  let executor: CommandExecutor;
  let mockContext: CommandContext;
  let emittedChunks: Array<{ type: string; content?: string }>;

  beforeEach(() => {
    loader = new CommandLoader();
    executor = new CommandExecutor(loader);
    emittedChunks = [];

    mockContext = {
      cwd: process.cwd(),
      sessionId: 'test-session',
      messages: [],
      tools: [],
      clearMessages: () => {},
      addSystemMessage: () => {},
      emit: (type, content) => {
        emittedChunks.push({ type, content });
      },
    };
  });

  describe('parseCommand', () => {
    test('should parse command with name only', () => {
      const result = executor.parseCommand('/help');
      expect(result).toEqual({ name: 'help', args: '' });
    });

    test('should parse command with arguments', () => {
      const result = executor.parseCommand('/search hello world');
      expect(result).toEqual({ name: 'search', args: 'hello world' });
    });

    test('should return null for non-command input', () => {
      expect(executor.parseCommand('hello')).toBeNull();
      expect(executor.parseCommand('')).toBeNull();
    });

    test('should handle command with colon namespace', () => {
      const result = executor.parseCommand('/git:commit message');
      expect(result).toEqual({ name: 'git:commit', args: 'message' });
    });
  });

  describe('isCommand', () => {
    test('should return true for slash commands', () => {
      expect(executor.isCommand('/help')).toBe(true);
      expect(executor.isCommand('/search foo')).toBe(true);
    });

    test('should return false for non-commands', () => {
      expect(executor.isCommand('hello')).toBe(false);
      expect(executor.isCommand('')).toBe(false);
    });
  });

  describe('execute', () => {
    test('should handle unknown command', async () => {
      const result = await executor.execute('/unknown', mockContext);

      expect(result.handled).toBe(true);
      expect(emittedChunks.some(c => c.content?.includes('Unknown command'))).toBe(true);
    });

    test('should execute self-handled command', async () => {
      let handlerCalled = false;

      loader.register({
        name: 'test',
        description: 'Test command',
        content: '',
        selfHandled: true,
        handler: async (args, ctx) => {
          handlerCalled = true;
          ctx.emit('text', `Args: ${args}`);
          ctx.emit('done');
          return { handled: true };
        },
      });

      const result = await executor.execute('/test myargs', mockContext);

      expect(result.handled).toBe(true);
      expect(handlerCalled).toBe(true);
      expect(emittedChunks.some(c => c.content === 'Args: myargs')).toBe(true);
    });

    test('should return prompt for non-self-handled command', async () => {
      loader.register({
        name: 'summarize',
        description: 'Summarize topic',
        content: 'Please summarize: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/summarize main.ts', mockContext);

      expect(result.handled).toBe(false);
      expect(result.prompt).toContain('Please summarize:');
      expect(result.prompt).toContain('main.ts');
    });

    test('should substitute $ARGUMENTS placeholder', async () => {
      loader.register({
        name: 'debug',
        description: 'Debug issue',
        content: 'Debug this: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/debug error in line 42', mockContext);

      expect(result.prompt).toBe('Debug this: error in line 42');
    });

    test('should handle missing arguments', async () => {
      loader.register({
        name: 'test',
        description: 'Test',
        content: 'Args: $ARGUMENTS',
        selfHandled: false,
      });

      const result = await executor.execute('/test', mockContext);

      expect(result.prompt).toBe('Args: (no arguments provided)');
    });

    test('should execute shell commands in content', async () => {
      loader.register({
        name: 'shell',
        description: 'Shell command',
        content: 'Output:\n!echo hello',
        selfHandled: false,
      });

      const result = await executor.execute('/shell', mockContext);

      expect(result.prompt).toContain('hello');
    });

    test('should preserve indentation for shell command output', async () => {
      loader.register({
        name: 'shell-indent',
        description: 'Shell command with indent',
        content: 'List:\n  !echo indented',
        selfHandled: false,
      });

      const result = await executor.execute('/shell-indent', mockContext);
      expect(result.prompt).toContain('  ```');
      expect(result.prompt).toContain('  indented');
    });

    test('should ignore empty shell command lines', async () => {
      loader.register({
        name: 'shell-empty',
        description: 'Empty shell command',
        content: '!\nNext',
        selfHandled: false,
      });

      const result = await executor.execute('/shell-empty', mockContext);
      expect(result.prompt).toContain('!');
      expect(result.prompt).toContain('Next');
    });

    test('should not execute shell commands inside code blocks', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'assistants-shell-block-'));
      loader.register({
        name: 'block',
        description: 'Shell in code block',
        content: '```bash\n!pwd\n```',
        selfHandled: false,
      });

      mockContext.cwd = tempDir;
      const result = await executor.execute('/block', mockContext);

      expect(result.prompt).toContain('!pwd');
      expect(result.prompt).not.toContain(tempDir);

      rmSync(tempDir, { recursive: true, force: true });
    });

    test('should run shell commands from context cwd', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'assistants-shell-'));
      loader.register({
        name: 'cwd',
        description: 'Shell cwd command',
        content: 'Output:\n!pwd',
        selfHandled: false,
      });

      mockContext.cwd = tempDir;
      const result = await executor.execute('/cwd', mockContext);

      expect(result.prompt).toContain(tempDir);

      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe('getSuggestions', () => {
    test('should return matching commands for partial input', () => {
      loader.register({ name: 'help', description: 'Show help', content: '' });
      loader.register({ name: 'history', description: 'Show history', content: '' });

      const suggestions = executor.getSuggestions('/h');
      expect(suggestions.length).toBe(2);
    });

    test('should return empty for non-slash input', () => {
      expect(executor.getSuggestions('hello')).toEqual([]);
    });
  });
});

describe('BuiltinCommands', () => {
  let builtins: BuiltinCommands;
  let loader: CommandLoader;
  let mockContext: CommandContext;
  let emittedContent: string[];
  let messagesCleared: boolean;
  let tempDir: string;
  let originalAssistantsDir: string | undefined;
  let activeProjectId: string | null;
  let projectContextContent: string | null;
  const heartbeatState = {
    enabled: true,
    state: 'idle' as const,
    lastActivity: new Date().toISOString(),
    uptimeSeconds: 42,
    isStale: false,
  };

  beforeEach(() => {
    builtins = new BuiltinCommands();
    loader = new CommandLoader();
    emittedContent = [];
    messagesCleared = false;
    activeProjectId = null;
    projectContextContent = null;
    tempDir = mkdtempSync(join(tmpdir(), 'assistants-cmd-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();

    mockContext = {
      cwd: tempDir,
      sessionId: 'session-123',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      tools: [
        { name: 'bash', description: 'Run commands', parameters: { type: 'object', properties: {} } },
        { name: 'read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ],
      skills: [
        { name: 'alpha', description: 'Alpha skill', argumentHint: '[arg]' },
      ],
      connectors: [],
      getHeartbeatState: () => heartbeatState,
      getHeartbeatConfig: () => ({
        historyPath: join(tempDir, 'heartbeats', 'runs', '{sessionId}.jsonl'),
      }),
      getActiveProjectId: () => activeProjectId,
      setActiveProjectId: (id) => { activeProjectId = id; },
      setProjectContext: (content) => { projectContextContent = content; },
      clearMessages: () => { messagesCleared = true; },
      addSystemMessage: () => {},
      emit: (type, content) => {
        if (type === 'text' && content) {
          emittedContent.push(content);
        }
      },
    };

    builtins.registerAll(loader);
  });

  afterEach(() => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('token usage tracking', () => {
    test('should track and return token usage', () => {
      builtins.updateTokenUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });

      const usage = builtins.getTokenUsage();
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.totalTokens).toBe(1500);
    });
  });

  describe('/help command', () => {
    test('should list all commands', async () => {
      const cmd = loader.getCommand('help');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(true);

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Available Slash Commands'))).toBe(true);
      }
    });

    test('should include and sort custom commands', async () => {
      loader.register({ name: 'zeta', description: 'Zeta cmd', content: 'z', builtin: false });
      loader.register({ name: 'alpha', description: 'Alpha cmd', content: 'a', builtin: false });

      const cmd = loader.getCommand('help');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);

        const output = emittedContent.join('\n');
        const alphaIndex = output.indexOf('/alpha - Alpha cmd');
        const zetaIndex = output.indexOf('/zeta - Zeta cmd');
        expect(alphaIndex).toBeGreaterThanOrEqual(0);
        expect(zetaIndex).toBeGreaterThanOrEqual(0);
        expect(alphaIndex).toBeLessThan(zetaIndex);
      }
    });
  });

  describe('/communication command', () => {
    let telephonyManager: TelephonyManager;

    beforeEach(() => {
      telephonyManager = new TelephonyManager({
        assistantId: 'assistant-1',
        assistantName: 'Tester',
        config: { enabled: true },
      });
      mockContext.getTelephonyManager = () => telephonyManager;
    });

    afterEach(() => {
      telephonyManager.close();
    });

    test('sets default number via /communication default', async () => {
      const cmd = loader.getCommand('communication');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('default +15550001111', mockContext);
        expect(result.handled).toBe(true);
        const status = telephonyManager.getStatus();
        expect(status.defaultPhoneNumber).toBe('+15550001111');
        expect(emittedContent.join('\n')).toContain('Default phone number set');
      }
    });

    test('reports default number in /communication status', async () => {
      telephonyManager.setDefaultPhoneNumber('+15550002222');
      const cmd = loader.getCommand('communication');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        await cmd.handler('status', mockContext);
        const output = emittedContent.join('\n');
        expect(output).toContain('Default #:' );
        expect(output).toContain('+15550002222');
      }
    });

    test('registers /phone alias for communication', () => {
      expect(loader.hasCommand('phone')).toBe(true);
      expect(loader.getCommand('phone')?.name).toBe('communication');
    });
  });

  describe('/about command', () => {
    test('prints about summary', async () => {
      const cmd = loader.getCommand('about');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('About Hasna');
        expect(output).toContain('About Hasna Assistants');
      }
    });
  });

  describe('/docs command', () => {
    test('includes communication and voice commands without listen', async () => {
      const cmd = loader.getCommand('docs');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('/communication');
        expect(output).toContain('/talk');
        expect(output).not.toContain('/listen');
      }
    });
  });

  describe('/whoami command', () => {
    test('prints fallback when identity is unavailable', async () => {
      const cmd = loader.getCommand('whoami');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('No active assistant or identity');
      }
    });

    test('prints assistant without identity when identity missing', async () => {
      const cmd = loader.getCommand('whoami');
      expect(cmd).toBeDefined();

      const assistantManager = {
        getActive: () => ({ id: 'assistant-1', name: 'Assistant One' }),
      };
      const contextWithAssistant: CommandContext = {
        ...mockContext,
        getAssistantManager: () => assistantManager as any,
        getIdentityManager: () => null,
        getModel: () => 'claude-opus-4-5',
      };

      if (cmd?.handler) {
        const result = await cmd.handler('', contextWithAssistant);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Assistant: Assistant One');
        expect(output).toContain('Identity: (not configured)');
        expect(output).toContain('Model: claude-opus-4-5');
      }
    });
  });

  describe('/clear command', () => {
    test('should clear conversation', async () => {
      const cmd = loader.getCommand('clear');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.clearConversation).toBe(true);
        expect(messagesCleared).toBe(true);
      }
    });
  });

  describe('/identity command', () => {
    test('edit opens identity panel with target id', async () => {
      const cmd = loader.getCommand('identity');
      expect(cmd).toBeDefined();

      const identityManager = new IdentityManager('assistant-test', tempDir);
      await identityManager.initialize();
      const identity = await identityManager.createIdentity({ name: 'Primary' });

      const contextWithIdentity: CommandContext = {
        ...mockContext,
        getIdentityManager: () => identityManager,
      };

      if (cmd?.handler) {
        const result = await cmd.handler(`edit ${identity.id}`, contextWithIdentity);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('identity');
        expect(result.panelValue).toBe(`edit:${identity.id}`);
      }
    });
  });

  describe('/assistants command', () => {
    const createAssistant = (id: string, name: string) => ({
      id,
      name,
      description: undefined,
      avatar: undefined,
      settings: { model: 'claude-opus-4-5' },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    });

    test('switch falls back to manager.switchAssistant when context hook is unavailable', async () => {
      const cmd = loader.getCommand('assistants');
      expect(cmd).toBeDefined();

      const assistants = [createAssistant('a1', 'One'), createAssistant('a2', 'Two')];
      let activeId: string | null = 'a1';
      const switchCalls: string[] = [];
      const manager = {
        getActive: () => assistants.find((assistant) => assistant.id === activeId) ?? null,
        getActiveId: () => activeId,
        listAssistants: () => assistants,
        createAssistant: async () => assistants[0],
        updateAssistant: async () => assistants[0],
        deleteAssistant: async () => {},
        switchAssistant: async (id: string) => {
          switchCalls.push(id);
          activeId = id;
          return assistants.find((assistant) => assistant.id === id) ?? null;
        },
      };

      const context: CommandContext = {
        ...mockContext,
        getAssistantManager: () => manager as any,
      };

      if (cmd?.handler) {
        const result = await cmd.handler('switch Two', context);
        expect(result.handled).toBe(true);
        expect(switchCalls).toEqual(['a2']);
        expect(activeId).toBe('a2');
      }
    });

    test('create syncs with context switch hook', async () => {
      const cmd = loader.getCommand('assistants');
      expect(cmd).toBeDefined();

      const assistants = [createAssistant('a1', 'One')];
      let activeId: string | null = 'a1';
      const contextSwitchCalls: string[] = [];
      const manager = {
        getActive: () => assistants.find((assistant) => assistant.id === activeId) ?? null,
        getActiveId: () => activeId,
        listAssistants: () => assistants,
        createAssistant: async ({ name }: { name: string }) => {
          const created = createAssistant('a2', name);
          assistants.push(created);
          activeId = created.id;
          return created;
        },
        updateAssistant: async () => assistants[0],
        deleteAssistant: async () => {},
        switchAssistant: async (id: string) => {
          activeId = id;
          return assistants.find((assistant) => assistant.id === id) ?? null;
        },
      };

      const context: CommandContext = {
        ...mockContext,
        getAssistantManager: () => manager as any,
        switchAssistant: async (assistantId: string) => {
          contextSwitchCalls.push(assistantId);
          activeId = assistantId;
        },
      };

      if (cmd?.handler) {
        const result = await cmd.handler('create Planner', context);
        expect(result.handled).toBe(true);
        expect(contextSwitchCalls).toEqual(['a2']);
      }
    });

    test('delete blocks deleting the last remaining assistant', async () => {
      const cmd = loader.getCommand('assistants');
      expect(cmd).toBeDefined();

      const assistants = [createAssistant('a1', 'Only')];
      let deleteCalls = 0;
      const manager = {
        getActive: () => assistants[0],
        getActiveId: () => assistants[0].id,
        listAssistants: () => assistants,
        createAssistant: async () => assistants[0],
        updateAssistant: async () => assistants[0],
        deleteAssistant: async () => { deleteCalls += 1; },
        switchAssistant: async () => assistants[0],
      };

      const context: CommandContext = {
        ...mockContext,
        getAssistantManager: () => manager as any,
      };

      if (cmd?.handler) {
        const result = await cmd.handler('delete Only', context);
        expect(result.handled).toBe(true);
        expect(deleteCalls).toBe(0);
        expect(emittedContent.join('\n')).toContain('Cannot delete the last remaining assistant.');
      }
    });

    test('delete of active assistant syncs switch hook to next active assistant', async () => {
      const cmd = loader.getCommand('assistants');
      expect(cmd).toBeDefined();

      const assistants = [createAssistant('a1', 'One'), createAssistant('a2', 'Two')];
      let activeId: string | null = 'a1';
      const contextSwitchCalls: string[] = [];
      const manager = {
        getActive: () => assistants.find((assistant) => assistant.id === activeId) ?? null,
        getActiveId: () => activeId,
        listAssistants: () => assistants,
        createAssistant: async () => assistants[0],
        updateAssistant: async () => assistants[0],
        deleteAssistant: async (id: string) => {
          const index = assistants.findIndex((assistant) => assistant.id === id);
          if (index >= 0) {
            assistants.splice(index, 1);
          }
          if (activeId === id) {
            activeId = assistants[0]?.id ?? null;
          }
        },
        switchAssistant: async (id: string) => {
          activeId = id;
          return assistants.find((assistant) => assistant.id === id) ?? null;
        },
      };

      const context: CommandContext = {
        ...mockContext,
        getAssistantManager: () => manager as any,
        switchAssistant: async (assistantId: string) => {
          contextSwitchCalls.push(assistantId);
          activeId = assistantId;
        },
      };

      if (cmd?.handler) {
        const result = await cmd.handler('delete One', context);
        expect(result.handled).toBe(true);
        expect(contextSwitchCalls).toEqual(['a2']);
      }
    });
  });

  describe('/status command', () => {
    test('should show session status', async () => {
      builtins.updateTokenUsage({
        inputTokens: 5000,
        outputTokens: 2000,
        totalTokens: 7000,
        maxContextTokens: 200000,
      });

      const cmd = loader.getCommand('status');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Session Status'))).toBe(true);
        expect(emittedContent.some(c => c.includes(tempDir))).toBe(true);
        expect(emittedContent.some(c => c.includes('session-123'))).toBe(true);
      }
    });

    test('should include cache token usage when available', async () => {
      builtins.updateTokenUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        maxContextTokens: 200000,
        cacheReadTokens: 25,
        cacheWriteTokens: 10,
      });

      const cmd = loader.getCommand('status');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Cache Read');
        expect(output).toContain('Cache Write');
      }
    });
  });

  describe('/cost command', () => {
    test('should show cost estimate', async () => {
      builtins.updateTokenUsage({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        maxContextTokens: 200000,
      });

      const cmd = loader.getCommand('cost');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Estimated Session Cost'))).toBe(true);
        expect(emittedContent.some(c => c.includes('$'))).toBe(true);
      }
    });

    test('should include cache savings when cache tokens exist', async () => {
      builtins.updateTokenUsage({
        inputTokens: 10000,
        outputTokens: 5000,
        totalTokens: 15000,
        maxContextTokens: 200000,
        cacheReadTokens: 5000,
      });

      const cmd = loader.getCommand('cost');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Cache savings'))).toBe(true);
      }
    });
  });

  describe('/model command', () => {
    test('should open model selector panel with no args', async () => {
      const cmd = loader.getCommand('model');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('model');
      }
    });

    test('should show model information for status', async () => {
      const cmd = loader.getCommand('model');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('status', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Current Model'))).toBe(true);
      }
    });
  });

  describe('/config command', () => {
    test('should show configuration', async () => {
      const cmd = loader.getCommand('config');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('config');
      }
    });
  });

  describe('/budgets command', () => {
    test('project set preserves original casing', async () => {
      const cmd = loader.getCommand('budgets');
      expect(cmd).toBeDefined();

      let selectedProject: string | null = null;
      const context: CommandContext = {
        ...mockContext,
        setActiveProjectId: (projectId: string | null) => {
          selectedProject = projectId;
        },
      };

      if (cmd?.handler) {
        const result = await cmd.handler('project Revenue Team Q1', context);
        expect(result.handled).toBe(true);
        expect(selectedProject).toBe('Revenue Team Q1');
        expect(emittedContent.join('\n')).toContain('Revenue Team Q1');
      }
    });

    test('reset with invalid scope does not reset all budgets', async () => {
      const cmd = loader.getCommand('budgets');
      expect(cmd).toBeDefined();

      const resetCalls: Array<'session' | 'assistant' | 'swarm' | 'project' | undefined> = [];
      const context: CommandContext = {
        ...mockContext,
        resetBudget: (scope) => {
          resetCalls.push(scope);
        },
      };

      if (cmd?.handler) {
        const result = await cmd.handler('reset invalid', context);
        expect(result.handled).toBe(true);
        expect(resetCalls).toEqual([]);
        expect(emittedContent.join('\n')).toContain('Invalid scope');
      }
    });

    test('status uses runtime budget summary when available', async () => {
      const cmd = loader.getCommand('budgets');
      expect(cmd).toBeDefined();

      const nowIso = new Date(0).toISOString();
      const context: CommandContext = {
        ...mockContext,
        getBudgetSummary: () => ({
          enabled: true,
          session: {
            scope: 'session',
            limits: { maxTotalTokens: 2000, maxLlmCalls: 10 },
            usage: {
              inputTokens: 600,
              outputTokens: 634,
              totalTokens: 1234,
              llmCalls: 3,
              toolCalls: 0,
              durationMs: 0,
              periodStartedAt: nowIso,
              lastUpdatedAt: nowIso,
            },
            checks: {},
            overallExceeded: false,
            warningsCount: 0,
          },
          swarm: {
            scope: 'swarm',
            limits: {},
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              llmCalls: 0,
              toolCalls: 0,
              durationMs: 0,
              periodStartedAt: nowIso,
              lastUpdatedAt: nowIso,
            },
            checks: {},
            overallExceeded: false,
            warningsCount: 0,
          },
          project: null,
          assistantCount: 0,
          anyExceeded: false,
          totalWarnings: 0,
        }),
      };

      if (cmd?.handler) {
        const result = await cmd.handler('status', context);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Enforcement: **enabled**');
        expect(output).toContain('Tokens: 1,234 / 2,000');
      }
    });

    test('extend updates runtime budget config', async () => {
      const cmd = loader.getCommand('budgets');
      expect(cmd).toBeDefined();

      let updatedConfig: any = null;
      const context: CommandContext = {
        ...mockContext,
        budgetConfig: {
          enabled: true,
          session: { maxTotalTokens: 1000 },
          assistant: {},
          swarm: {},
          project: {},
          onExceeded: 'warn',
          persist: false,
        },
        setBudgetConfig: (config) => {
          updatedConfig = config;
        },
      };

      if (cmd?.handler) {
        const result = await cmd.handler('extend 500', context);
        expect(result.handled).toBe(true);
        expect(updatedConfig).toBeTruthy();
        expect(updatedConfig.session?.maxTotalTokens).toBe(1500);
        expect(emittedContent.join('\n')).toContain('new limit: 1,500');
      }
    });
  });

  describe('/wallet command', () => {
    test('add opens wallet panel in add mode', async () => {
      const cmd = loader.getCommand('wallet');
      expect(cmd).toBeDefined();

      const manager = {
        list: async () => [],
        remove: async () => ({ success: true, message: 'ok' }),
        getRateLimitStatus: () => ({ readsUsed: 0, maxReads: 10, windowResetMinutes: 60 }),
        checkCredentials: async () => ({ valid: true }),
        getStorageMode: () => 'local',
      };

      const context: CommandContext = {
        ...mockContext,
        getWalletManager: () => manager as any,
      };

      if (cmd?.handler) {
        const result = await cmd.handler('add', context);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('wallet');
        expect(result.panelValue).toBe('add');
      }
    });
  });

  describe('/secrets command', () => {
    test('add opens secrets panel in add mode', async () => {
      const cmd = loader.getCommand('secrets');
      expect(cmd).toBeDefined();

      const context: CommandContext = {
        ...mockContext,
        getSecretsManager: () => ({}) as any,
      };

      if (cmd?.handler) {
        const result = await cmd.handler('add', context);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('secrets');
        expect(result.panelValue).toBe('add');
      }
    });
  });

  describe('non-self-handled commands', () => {
    test('/compact should return LLM prompt', () => {
      const cmd = loader.getCommand('compact');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(false);
      expect(cmd?.content).toContain('summarize');
    });

    test('/memory should return LLM prompt', () => {
      const cmd = loader.getCommand('memory');
      expect(cmd).toBeDefined();
      expect(cmd?.selfHandled).toBe(true);
    });
  });

  describe('/tokens command', () => {
    test('should show token usage', async () => {
      builtins.updateTokenUsage({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        maxContextTokens: 10,
      });

      const cmd = loader.getCommand('tokens');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Token Usage'))).toBe(true);
      }
    });
  });

  describe('/skills command', () => {
    test('should list available skills', async () => {
      const cmd = loader.getCommand('skills');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('skills');
      }
    });

    test('should handle no skills', async () => {
      const cmd = loader.getCommand('skills');
      expect(cmd).toBeDefined();

      const contextNoSkills = { ...mockContext, skills: [] };
      if (cmd?.handler) {
        const result = await cmd.handler('', contextNoSkills);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('skills');
      }
    });
  });

  describe('/session command', () => {
    test('should return list action when no args', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.sessionAction).toBe('list');
      }
    });

    test('should return new action', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('new', mockContext);
        expect(result.sessionAction).toBe('new');
      }
    });

    test('should return switch action for numeric arg', async () => {
      const cmd = loader.getCommand('session');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('2', mockContext);
        expect(result.sessionAction).toBe('switch');
        expect(result.sessionNumber).toBe(2);
      }
    });
  });

  describe('/exit and /new commands', () => {
    test('exit should signal exit', async () => {
      const cmd = loader.getCommand('exit');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.exit).toBe(true);
      }
    });

    test('new should clear conversation', async () => {
      const cmd = loader.getCommand('new');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.clearConversation).toBe(true);
        expect(messagesCleared).toBe(true);
      }
    });
  });

  describe('/init command', () => {
    test('should create commands directory and example', async () => {
      const cmd = loader.getCommand('init');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('Initialized assistants'))).toBe(true);
        expect(existsSync(join(tempDir, '.assistants', 'commands', 'reflect.md'))).toBe(true);
      }
    });
  });

  describe('/connectors command', () => {
    test('should show empty state when no connectors', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();
      if (cmd?.handler) {
        const result = await cmd.handler('--list', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('No connectors found'))).toBe(true);
      }
    });

    test('should report unknown connector when name not found', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          { name: 'demo', description: 'Demo connector', cli: 'connect-demo', commands: [] },
        ],
      };

      if (cmd?.handler) {
        const result = await cmd.handler('--list missing', contextWithConnector);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('not found'))).toBe(true);
      }
    });

    test('should show connector details when name provided', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ authenticated: true, user: 'test' })));
              controller.close();
            },
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: Promise.resolve(0),
          kill: () => {},
        }) as any;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list demo', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Demo'))).toBe(true);
        }
      } finally {
        runtime.spawn = originalSpawn;
      }
    });

    test('should list connectors with status', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify({ authenticated: true })));
              controller.close();
            },
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: Promise.resolve(0),
          kill: () => {},
        }) as any;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Available Connectors'))).toBe(true);
          expect(emittedContent.some(c => c.includes('demo'))).toBe(true);
        }
      } finally {
        runtime.spawn = originalSpawn;
      }
    });

    test('should fall back to timeout status when auth check hangs', async () => {
      const cmd = loader.getCommand('connectors');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalSpawn = runtime.spawn;
      const originalSetTimeout = globalThis.setTimeout;

      runtime.spawn = () =>
        ({
          stdout: new ReadableStream<Uint8Array>({
            start() {},
          }),
          stderr: null,
          stdin: null,
          pid: 1,
          exited: new Promise(() => {}),
          kill: () => {},
        }) as any;
      globalThis.setTimeout = ((fn: (...args: any[]) => void, _ms?: number, ...args: any[]) => {
        fn(...args);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

      const contextWithConnector = {
        ...mockContext,
        connectors: [
          {
            name: 'demo',
            description: 'Demo connector',
            cli: 'connect-demo',
            commands: [{ name: 'list', description: 'List items' }],
          },
        ],
      };

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('--list', contextWithConnector);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Available Connectors'))).toBe(true);
          expect(emittedContent.some(c => c.includes('| ○ |'))).toBe(true);
        }
      } finally {
        globalThis.setTimeout = originalSetTimeout;
        runtime.spawn = originalSpawn;
      }
    });
  });

  describe('/schedules command', () => {
    test('should list schedules', async () => {
      const cmd = loader.getCommand('schedules');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const future = new Date(Date.now() + 60_000).toISOString();
        const scheduleId = generateId();
        const schedule = {
          id: scheduleId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: 'user' as const,
          sessionId: mockContext.sessionId,
          command: '/status',
          status: 'active' as const,
          schedule: { kind: 'once' as const, at: future },
        };
        schedule.nextRunAt = computeNextRun(schedule, Date.now());
        await saveSchedule(tempDir, schedule);
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        expect(emittedContent.some(c => c.includes('| ID |'))).toBe(true);
      }
    });

    test('should show help on unknown action', async () => {
      const cmd = loader.getCommand('schedules');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('resume', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Schedules');
        expect(output).toContain('Usage');
      }
    });
  });

  describe('/heartbeat command', () => {
    test('should list heartbeat runs', async () => {
      const cmd = loader.getCommand('heartbeat');
      expect(cmd).toBeDefined();

      const historyPath = join(tempDir, 'heartbeats', 'runs', `${mockContext.sessionId}.jsonl`);
      const heartbeatRun = {
        sessionId: mockContext.sessionId,
        timestamp: new Date(Date.now() - 10_000).toISOString(),
        state: 'idle' as const,
        lastActivity: new Date(Date.now() - 5_000).toISOString(),
        stats: { messagesProcessed: 1, toolCallsExecuted: 2, errorsEncountered: 0, uptimeSeconds: 10 },
      };
      await appendHeartbeatHistory(historyPath, heartbeatRun);

      if (cmd?.handler) {
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Heartbeat Status');
        expect(output).toContain('| Time | State |');
      }
    });

    test('should show status', async () => {
      const cmd = loader.getCommand('heartbeat');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('status', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain('Heartbeat Status');
        expect(output).toContain('State: idle');
      }
    });
  });

  describe('/resume command', () => {
    test('should open resume panel by default', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('', mockContext);
        expect(result.handled).toBe(true);
        expect(result.showPanel).toBe('resume');
      }
    });

    test('should list sessions scoped to cwd', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      const rootId = 'resume-root';
      const otherId = 'resume-other';
      const rootSession = new SessionStorage(rootId);
      rootSession.save({
        messages: [],
        startedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
        cwd: tempDir,
      });

      const otherSession = new SessionStorage(otherId);
      otherSession.save({
        messages: [],
        startedAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:01.000Z',
        cwd: '/tmp/other',
      });

      if (cmd?.handler) {
        const result = await cmd.handler('list', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain(rootId.slice(0, 8));
        expect(output).not.toContain(otherId.slice(0, 8));
      }
    });

    test('should list sessions across assistants with --all', async () => {
      const cmd = loader.getCommand('resume');
      expect(cmd).toBeDefined();

      const rootId = 'resume-all-root';
      const assistantSessionId = 'resume-all-assistant';
      const rootSession = new SessionStorage(rootId);
      rootSession.save({
        messages: [],
        startedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:01.000Z',
        cwd: tempDir,
      });

      const assistantId = 'assistant-test';
      const assistantSession = new SessionStorage(assistantSessionId, undefined, assistantId);
      assistantSession.save({
        messages: [],
        startedAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:01.000Z',
        cwd: tempDir,
      });

      if (cmd?.handler) {
        const result = await cmd.handler('list --all', mockContext);
        expect(result.handled).toBe(true);
        const output = emittedContent.join('\n');
        expect(output).toContain(rootId.slice(0, 8));
        expect(output).toContain(assistantSessionId.slice(0, 8));
      }
    });
  });

  describe('/projects and /plans commands', () => {
    test('should create and switch to a project', async () => {
      const cmd = loader.getCommand('projects');
      expect(cmd).toBeDefined();

      if (cmd?.handler) {
        const result = await cmd.handler('new Alpha', mockContext);
        expect(result.handled).toBe(true);
        expect(activeProjectId).toBeTruthy();
        expect(projectContextContent).toContain('Project: Alpha');

        const projects = await listProjects(tempDir);
        expect(projects.length).toBe(1);
        const saved = await readProject(tempDir, projects[0].id);
        expect(saved?.name).toBe('Alpha');
      }
    });

    test('should add a plan and step', async () => {
      const projectsCmd = loader.getCommand('projects');
      const plansCmd = loader.getCommand('plans');
      expect(projectsCmd).toBeDefined();
      expect(plansCmd).toBeDefined();

      if (projectsCmd?.handler && plansCmd?.handler) {
        await projectsCmd.handler('new Beta', mockContext);
        const createResult = await plansCmd.handler('new Launch Plan', mockContext);
        expect(createResult.handled).toBe(true);

        const activeId = activeProjectId as string;
        const project = await readProject(tempDir, activeId);
        expect(project?.plans.length).toBe(1);
        const planId = project?.plans[0].id as string;

        const addResult = await plansCmd.handler(`add ${planId} Define requirements`, mockContext);
        expect(addResult.handled).toBe(true);
        const updated = await readProject(tempDir, activeId);
        expect(updated?.plans[0].steps.length).toBe(1);
      }
    });
  });

  describe('/feedback command', () => {
    test('should emit success message without opening browser', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      const quietMock = mock(async () => {});
      runtime.shell = (() => ({ quiet: quietMock })) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Opening GitHub'))).toBe(true);
          // Verify shell was called via mock (headless — no real browser opened)
          expect(quietMock).toHaveBeenCalled();
        }
      } finally {
        runtime.shell = originalShell;
      }
    });

    test('should render fallback when shell command fails', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      const quietMock = mock(async () => { throw new Error('headless: no browser'); });
      runtime.shell = (() => ({ quiet: quietMock })) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Submit Feedback'))).toBe(true);
          expect(quietMock).toHaveBeenCalled();
        }
      } finally {
        runtime.shell = originalShell;
      }
    });

    test('should label bug feedback appropriately without opening browser', async () => {
      const cmd = loader.getCommand('feedback');
      expect(cmd).toBeDefined();

      const runtime = getRuntime();
      const originalShell = runtime.shell;
      const quietMock = mock(async () => {});
      runtime.shell = (() => ({ quiet: quietMock })) as any;

      try {
        if (cmd?.handler) {
          const result = await cmd.handler('bug', mockContext);
          expect(result.handled).toBe(true);
          expect(emittedContent.some(c => c.includes('Opening GitHub'))).toBe(true);
          expect(quietMock).toHaveBeenCalled();
        }
      } finally {
        runtime.shell = originalShell;
      }
    });
  });
});
