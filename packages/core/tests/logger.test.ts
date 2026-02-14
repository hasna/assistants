import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Logger, SessionStorage, initAssistantsDir } from '../src/logger';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-logger-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(() => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Logger', () => {
  test('initAssistantsDir creates base directories', () => {
    initAssistantsDir();
    expect(existsSync(join(tempDir, 'logs'))).toBe(true);
    expect(existsSync(join(tempDir, 'temp'))).toBe(true);
    expect(existsSync(join(tempDir, 'messages'))).toBe(true);
    expect(existsSync(join(tempDir, 'backups'))).toBe(true);
  });

  test('writes log entries to file', () => {
    const logger = new Logger('session-123');
    logger.info('hello', { ok: true });

    const date = new Date().toISOString().split('T')[0];
    const logPath = join(tempDir, 'logs', `${date}.log`);
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, 'utf-8').trim().split('\n').pop() || '';
    const entry = JSON.parse(content);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello');
    expect(entry.sessionId).toBe('session-123');
  });

  test('writes debug entries', () => {
    const logger = new Logger('session-456');
    logger.debug('debugging');

    const date = new Date().toISOString().split('T')[0];
    const logPath = join(tempDir, 'logs', `${date}.log`);
    const content = readFileSync(logPath, 'utf-8').trim().split('\n').pop() || '';
    const entry = JSON.parse(content);
    expect(entry.level).toBe('debug');
    expect(entry.message).toBe('debugging');
    expect(entry.sessionId).toBe('session-456');
  });

  test('writes warn and error entries', () => {
    const logger = new Logger('session-789');
    logger.warn('warn-msg');
    logger.error('error-msg');

    const date = new Date().toISOString().split('T')[0];
    const logPath = join(tempDir, 'logs', `${date}.log`);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]);
    const secondLast = JSON.parse(lines[lines.length - 2]);

    expect(secondLast.level).toBe('warn');
    expect(secondLast.message).toBe('warn-msg');
    expect(last.level).toBe('error');
    expect(last.message).toBe('error-msg');
  });
});

describe('SessionStorage', () => {
  test('save and load round-trip', () => {
    const storage = new SessionStorage('sess');
    storage.save({
      messages: [{ id: '1' }],
      startedAt: 'start',
      updatedAt: 'end',
      cwd: '/tmp',
    });

    const loaded = storage.load();
    expect(loaded?.cwd).toBe('/tmp');
    expect(storage.getSessionId()).toBe('sess');
  });
});
