import { describe, expect, test, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  resolveWorkspaceBaseDir,
} from '../src/workspace/active';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

describe('workspace active helpers', () => {
  let testDir: string;
  let originalAssistantsDir: string | undefined;

  afterEach(() => {
    closeDatabase();
    resetDatabaseSingleton();
    if (originalAssistantsDir !== undefined) {
      process.env.ASSISTANTS_DIR = originalAssistantsDir;
    } else {
      delete process.env.ASSISTANTS_DIR;
    }
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('set/get active workspace id', () => {
    testDir = mkdtempSync(join(tmpdir(), 'assistants-ws-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = testDir;
    resetDatabaseSingleton();

    setActiveWorkspaceId('ws_test123');
    expect(getActiveWorkspaceId()).toBe('ws_test123');
  });

  test('resolveWorkspaceBaseDir creates workspace data dir', () => {
    testDir = mkdtempSync(join(tmpdir(), 'assistants-ws-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = testDir;
    resetDatabaseSingleton();

    const resolved = resolveWorkspaceBaseDir('ws_demo', { baseDir: testDir });
    expect(resolved).toBe(join(testDir, 'workspaces', 'ws_demo', '.assistants'));
    expect(existsSync(join(resolved as string, 'logs'))).toBe(true);
    expect(existsSync(join(resolved as string, 'temp'))).toBe(true);
  });
});
