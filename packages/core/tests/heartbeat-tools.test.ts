import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ToolRegistry } from '../src/tools/registry';
import {
  createHeartbeatToolExecutors,
  registerHeartbeatTools,
} from '../src/tools/heartbeat';
import { appendHeartbeatHistory } from '../src/heartbeat/history';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';
import type { Heartbeat } from '../src/heartbeat/types';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-heartbeat-tools-'));
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  process.env.ASSISTANTS_DIR = tempDir;
  resetDatabaseSingleton();
});

afterEach(() => {
  closeDatabase();
  resetDatabaseSingleton();
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('heartbeat tools', () => {
  test('heartbeat_status returns state and runs', async () => {
    const sessionId = 'sess-tools';
    const historyPath = join(tempDir, 'heartbeats', 'runs', `${sessionId}.jsonl`);
    const run: Heartbeat = {
      sessionId,
      timestamp: new Date(Date.now() - 5000).toISOString(),
      state: 'idle',
      lastActivity: new Date(Date.now() - 2000).toISOString(),
      stats: { messagesProcessed: 2, toolCallsExecuted: 1, errorsEncountered: 0, uptimeSeconds: 5 },
    };
    await appendHeartbeatHistory(historyPath, run);

    const executors = createHeartbeatToolExecutors({
      sessionId,
      getHeartbeatState: () => ({
        enabled: true,
        state: 'idle',
        lastActivity: run.lastActivity,
        uptimeSeconds: 5,
        isStale: false,
      }),
      getHeartbeatConfig: () => ({
        historyPath,
      }),
    });

    const result = JSON.parse(await executors.heartbeat_status({ includeRuns: true, limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.runs.length).toBeGreaterThan(0);
    expect(result.state).toBe('idle');
  });

  test('heartbeat_runs returns run list', async () => {
    const sessionId = 'sess-runs';
    const historyPath = join(tempDir, 'heartbeats', 'runs', `${sessionId}.jsonl`);
    const run: Heartbeat = {
      sessionId,
      timestamp: new Date().toISOString(),
      state: 'processing',
      lastActivity: new Date().toISOString(),
      stats: { messagesProcessed: 0, toolCallsExecuted: 0, errorsEncountered: 0, uptimeSeconds: 1 },
    };
    await appendHeartbeatHistory(historyPath, run);

    const executors = createHeartbeatToolExecutors({
      sessionId,
      getHeartbeatConfig: () => ({ historyPath }),
    });

    const result = JSON.parse(await executors.heartbeat_runs({ limit: 10 }));
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.runs[0].state).toBe('processing');
  });
});

describe('registerHeartbeatTools', () => {
  test('registers heartbeat tools', () => {
    const registry = new ToolRegistry();
    registerHeartbeatTools(registry, { sessionId: 'sess' });
    const names = registry.getTools().map((t) => t.name);
    expect(names).toContain('heartbeat_status');
    expect(names).toContain('heartbeat_runs');
  });
});
