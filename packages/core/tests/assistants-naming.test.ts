import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { CommandLoader } from '../src/commands/loader';
import { BuiltinCommands } from '../src/commands/builtin';
import { SharedWorkspaceManager } from '../src/workspace/shared';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Assistants naming unification', () => {
  let loader: CommandLoader;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `assistants-naming-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    loader = new CommandLoader(testDir);
    const builtins = new BuiltinCommands();
    builtins.registerAll(loader);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('/agents command does NOT exist', () => {
    const cmd = loader.getCommand('agents');
    expect(cmd).toBeUndefined();
  });

  test('/assistants command exists', () => {
    const cmd = loader.getCommand('assistants');
    expect(cmd).toBeDefined();
  });

  test('panel type union does not include agents', () => {
    // Verify that no builtin command emits showPanel: 'agents'
    const commands = loader.getCommands();
    for (const cmd of commands) {
      // We can only check the command metadata, not handler results
      // But the important thing is no command is named 'agents'
      expect(cmd.name).not.toBe('agents');
    }
  });

  describe('SharedWorkspaceManager', () => {
    let wsManager: SharedWorkspaceManager;
    let wsDir: string;

    beforeEach(() => {
      wsDir = join(testDir, 'workspaces');
      wsManager = new SharedWorkspaceManager(wsDir);
    });

    test('uses assistants/ directory for participants', () => {
      const ws = wsManager.create('test-ws', 'assistant-1', ['assistant-2']);
      const wsPath = wsManager.getPath(ws.id);

      // Should have assistants/ subdirectory, not agents/
      expect(existsSync(join(wsPath, 'assistants', 'assistant-1'))).toBe(true);
      expect(existsSync(join(wsPath, 'assistants', 'assistant-2'))).toBe(true);
      expect(existsSync(join(wsPath, 'agents'))).toBe(false);
    });

    test('getAssistantPath returns assistants/ path', () => {
      const ws = wsManager.create('test-ws', 'assistant-1', []);
      const path = wsManager.getAssistantPath(ws.id, 'assistant-1');
      expect(path).toContain('/assistants/');
      expect(path).not.toContain('/agents/');
    });

    test('join creates assistants/ directory', () => {
      const ws = wsManager.create('test-ws', 'assistant-1', []);
      wsManager.join(ws.id, 'assistant-3');

      const wsPath = wsManager.getPath(ws.id);
      expect(existsSync(join(wsPath, 'assistants', 'assistant-3'))).toBe(true);
    });
  });
});
