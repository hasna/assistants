import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  logsTools,
  logsQueryTool,
  logsStatsTool,
  logsSearchTool,
  logsTailTool,
  createLogsToolExecutors,
  registerLogsTools,
} from '../src/tools/logs';
import { ToolRegistry } from '../src/tools/registry';
import { SecurityLogger } from '../src/security/logger';
import { Logger } from '../src/logger';
import { HookLogger } from '../src/hooks/logger';

// ============================================
// Test helpers
// ============================================

const TEST_DIR = join(import.meta.dir, '.tmp-logs-test');
const TEST_SESSION = 'test-session-123';

function setupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, 'logs'), { recursive: true });
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

function writeSecurityLog(events: Array<Record<string, unknown>>) {
  const content = events.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(TEST_DIR, 'security.log'), content);
}

function writeSessionLog(date: string, entries: Array<Record<string, unknown>>) {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(TEST_DIR, 'logs', `${date}.log`), content);
}

function writeHookLog(entries: Array<Record<string, unknown>>) {
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(join(TEST_DIR, 'logs', 'hooks.jsonl'), content);
}

// ============================================
// Tool Definitions
// ============================================

describe('Logs Tool Definitions', () => {
  test('exports 4 tools', () => {
    expect(logsTools).toHaveLength(4);
  });

  test('logsQueryTool has correct shape', () => {
    expect(logsQueryTool.name).toBe('logs_query');
    expect(logsQueryTool.description).toBeTruthy();
    expect(logsQueryTool.parameters.properties).toHaveProperty('source');
    expect(logsQueryTool.parameters.properties).toHaveProperty('severity');
    expect(logsQueryTool.parameters.properties).toHaveProperty('since');
    expect(logsQueryTool.parameters.properties).toHaveProperty('limit');
    expect(logsQueryTool.parameters.properties).toHaveProperty('offset');
  });

  test('logsStatsTool has correct shape', () => {
    expect(logsStatsTool.name).toBe('logs_stats');
    expect(logsStatsTool.parameters.properties).toHaveProperty('source');
    expect(logsStatsTool.parameters.properties).toHaveProperty('sessionOnly');
    expect(logsStatsTool.parameters.properties).toHaveProperty('since');
  });

  test('logsSearchTool requires query', () => {
    expect(logsSearchTool.name).toBe('logs_search');
    expect(logsSearchTool.parameters.required).toContain('query');
  });

  test('logsTailTool has correct shape', () => {
    expect(logsTailTool.name).toBe('logs_tail');
    expect(logsTailTool.parameters.properties).toHaveProperty('count');
    expect(logsTailTool.parameters.properties).toHaveProperty('source');
  });
});

// ============================================
// SecurityLogger.readPersistedEvents
// ============================================

describe('SecurityLogger.readPersistedEvents', () => {
  beforeEach(setupTestDir);
  afterEach(cleanupTestDir);

  test('returns empty array when no log file', () => {
    const events = SecurityLogger.readPersistedEvents({ logFile: join(TEST_DIR, 'nonexistent.log') });
    expect(events).toEqual([]);
  });

  test('reads and filters events by severity', () => {
    writeSecurityLog([
      { timestamp: '2025-01-01T00:00:00Z', eventType: 'blocked_command', severity: 'high', details: { reason: 'test' }, sessionId: TEST_SESSION },
      { timestamp: '2025-01-01T00:01:00Z', eventType: 'blocked_command', severity: 'low', details: { reason: 'minor' }, sessionId: TEST_SESSION },
    ]);

    const high = SecurityLogger.readPersistedEvents({ logFile: join(TEST_DIR, 'security.log'), severity: 'high' });
    expect(high).toHaveLength(1);
    expect(high[0].severity).toBe('high');
  });

  test('filters by session', () => {
    writeSecurityLog([
      { timestamp: '2025-01-01T00:00:00Z', eventType: 'blocked_command', severity: 'high', details: { reason: 'a' }, sessionId: 'session-1' },
      { timestamp: '2025-01-01T00:01:00Z', eventType: 'blocked_command', severity: 'high', details: { reason: 'b' }, sessionId: 'session-2' },
    ]);

    const result = SecurityLogger.readPersistedEvents({ logFile: join(TEST_DIR, 'security.log'), sessionId: 'session-1' });
    expect(result).toHaveLength(1);
    expect(result[0].details.reason).toBe('a');
  });

  test('respects limit and offset', () => {
    writeSecurityLog([
      { timestamp: '2025-01-01T00:00:00Z', eventType: 'blocked_command', severity: 'low', details: { reason: 'a' }, sessionId: TEST_SESSION },
      { timestamp: '2025-01-01T00:01:00Z', eventType: 'blocked_command', severity: 'low', details: { reason: 'b' }, sessionId: TEST_SESSION },
      { timestamp: '2025-01-01T00:02:00Z', eventType: 'blocked_command', severity: 'low', details: { reason: 'c' }, sessionId: TEST_SESSION },
    ]);

    const result = SecurityLogger.readPersistedEvents({ logFile: join(TEST_DIR, 'security.log'), limit: 1, offset: 1 });
    expect(result).toHaveLength(1);
    // Should be sorted descending, offset 1 skips the most recent
    expect(result[0].details.reason).toBe('b');
  });
});

// ============================================
// Logger.readEntries / listLogDates
// ============================================

describe('Logger.readEntries', () => {
  beforeEach(setupTestDir);
  afterEach(cleanupTestDir);

  test('returns empty array when no log dir', () => {
    const entries = Logger.readEntries({ basePath: join(TEST_DIR, 'nonexistent') });
    expect(entries).toEqual([]);
  });

  test('reads entries from daily log files', () => {
    writeSessionLog('2025-01-15', [
      { timestamp: '2025-01-15T10:00:00Z', level: 'info', message: 'started', sessionId: TEST_SESSION },
      { timestamp: '2025-01-15T10:01:00Z', level: 'error', message: 'failed', sessionId: TEST_SESSION },
    ]);

    const entries = Logger.readEntries({ basePath: TEST_DIR });
    expect(entries).toHaveLength(2);
    // Sorted descending
    expect(entries[0].message).toBe('failed');
  });

  test('filters by level', () => {
    writeSessionLog('2025-01-15', [
      { timestamp: '2025-01-15T10:00:00Z', level: 'debug', message: 'debug msg', sessionId: TEST_SESSION },
      { timestamp: '2025-01-15T10:01:00Z', level: 'info', message: 'info msg', sessionId: TEST_SESSION },
      { timestamp: '2025-01-15T10:02:00Z', level: 'error', message: 'error msg', sessionId: TEST_SESSION },
    ]);

    const entries = Logger.readEntries({ basePath: TEST_DIR, level: 'warn' });
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
  });

  test('filters by session', () => {
    writeSessionLog('2025-01-15', [
      { timestamp: '2025-01-15T10:00:00Z', level: 'info', message: 'a', sessionId: 'session-a' },
      { timestamp: '2025-01-15T10:01:00Z', level: 'info', message: 'b', sessionId: 'session-b' },
    ]);

    const entries = Logger.readEntries({ basePath: TEST_DIR, sessionId: 'session-a' });
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('a');
  });
});

describe('Logger.listLogDates', () => {
  beforeEach(setupTestDir);
  afterEach(cleanupTestDir);

  test('returns empty array when no logs', () => {
    expect(Logger.listLogDates(join(TEST_DIR, 'nonexistent'))).toEqual([]);
  });

  test('lists dates sorted descending', () => {
    writeSessionLog('2025-01-10', [{ timestamp: '2025-01-10T00:00:00Z', level: 'info', message: 'x' }]);
    writeSessionLog('2025-01-15', [{ timestamp: '2025-01-15T00:00:00Z', level: 'info', message: 'y' }]);

    const dates = Logger.listLogDates(TEST_DIR);
    expect(dates).toEqual(['2025-01-15', '2025-01-10']);
  });
});

// ============================================
// Executors
// ============================================

describe('Logs Tool Executors', () => {
  let executors: Record<string, (input: Record<string, unknown>) => Promise<string>>;

  beforeEach(() => {
    setupTestDir();
    executors = createLogsToolExecutors({ sessionId: TEST_SESSION });
  });

  afterEach(cleanupTestDir);

  describe('logs_query', () => {
    test('returns entries with default params', async () => {
      const result = JSON.parse(await executors.logs_query({}));
      expect(result.success).toBe(true);
      expect(result.sessionOnly).toBe(true);
      expect(Array.isArray(result.entries)).toBe(true);
    });

    test('respects limit and offset', async () => {
      const result = JSON.parse(await executors.logs_query({ limit: 5, offset: 0 }));
      expect(result.success).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.offset).toBe(0);
    });

    test('clamps limit to max 200', async () => {
      const result = JSON.parse(await executors.logs_query({ limit: 999 }));
      expect(result.limit).toBe(200);
    });
  });

  describe('logs_stats', () => {
    test('returns aggregated stats', async () => {
      const result = JSON.parse(await executors.logs_stats({}));
      expect(result.success).toBe(true);
      expect(result.bySource).toBeDefined();
      expect(result.byLevel).toBeDefined();
      expect(result.status).toBeDefined();
    });

    test('reports healthy when no entries', async () => {
      const result = JSON.parse(await executors.logs_stats({}));
      expect(result.status).toBe('no log entries');
    });
  });

  describe('logs_search', () => {
    test('requires query parameter', async () => {
      const result = JSON.parse(await executors.logs_search({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('query');
    });

    test('returns matches', async () => {
      const result = JSON.parse(await executors.logs_search({ query: 'test' }));
      expect(result.success).toBe(true);
      expect(Array.isArray(result.entries)).toBe(true);
    });

    test('clamps limit to max 200', async () => {
      const result = JSON.parse(await executors.logs_search({ query: 'test', limit: 500 }));
      expect(result.total).toBeDefined();
    });
  });

  describe('logs_tail', () => {
    test('returns entries with default count', async () => {
      const result = JSON.parse(await executors.logs_tail({}));
      expect(result.success).toBe(true);
      expect(Array.isArray(result.entries)).toBe(true);
    });

    test('clamps count to max 50', async () => {
      const result = JSON.parse(await executors.logs_tail({ count: 100 }));
      expect(result.success).toBe(true);
    });
  });
});

// ============================================
// Registration
// ============================================

describe('registerLogsTools', () => {
  test('registers all 4 tools in registry', () => {
    const registry = new ToolRegistry();
    registerLogsTools(registry, { sessionId: TEST_SESSION });

    const tools = registry.getTools();
    const logToolNames = tools.map(t => t.name).filter(n => n.startsWith('logs_'));
    expect(logToolNames).toContain('logs_query');
    expect(logToolNames).toContain('logs_stats');
    expect(logToolNames).toContain('logs_search');
    expect(logToolNames).toContain('logs_tail');
    expect(logToolNames).toHaveLength(4);
  });
});
