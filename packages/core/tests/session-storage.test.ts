import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { SessionStorage } from '../src/logger';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, mkdirSync } from 'fs';

let tempDir: string;
let originalHome: string | undefined;
let originalAssistantsDir: string | undefined;

beforeEach(async () => {
  originalHome = process.env.HOME;
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = await mkdtemp(join(tmpdir(), 'assistants-sessions-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('SessionStorage', () => {
  test('should save and load session data', () => {
    const storage = new SessionStorage('session-1');
    storage.save({
      messages: [{ role: 'user', content: 'hi' }],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      cwd: '/tmp/project',
    });

    const loaded = storage.load();
    expect(loaded?.cwd).toBe('/tmp/project');
    expect(loaded?.messages.length).toBe(1);
  });

  test('should list and load latest session', () => {
    const storage1 = new SessionStorage('session-1');
    storage1.save({
      messages: [],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      cwd: '/tmp/project1',
    });

    const storage2 = new SessionStorage('session-2');
    storage2.save({
      messages: [],
      startedAt: '2024-01-01T00:00:02.000Z',
      updatedAt: '2024-01-01T00:00:03.000Z',
      cwd: '/tmp/project2',
    });

    const sessions = SessionStorage.listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe('session-2');

    const latest = SessionStorage.getLatestSession();
    expect(latest?.id).toBe('session-2');

    const loaded = SessionStorage.loadSession('session-1');
    expect(loaded?.cwd).toBe('/tmp/project1');
  });

  test('uses active assistant sessions when available', () => {
    const assistantId = 'assistant-1';
    const sessionsDir = join(tempDir, 'assistants', assistantId, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(tempDir, 'active.json'), JSON.stringify({ id: assistantId }));

    const storage = new SessionStorage('session-a', undefined, assistantId);
    storage.save({
      messages: [{ role: 'user', content: 'hello' }],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:05.000Z',
      cwd: '/tmp/project-a',
    });

    const sessions = SessionStorage.listSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe('session-a');

    const loaded = SessionStorage.loadSession('session-a');
    expect(loaded?.cwd).toBe('/tmp/project-a');
  });

  test('lists sessions across assistants', () => {
    const rootStorage = new SessionStorage('session-root');
    rootStorage.save({
      messages: [],
      startedAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z',
      cwd: '/tmp/root',
    });

    const assistantId = 'assistant-2';
    const assistantStorage = new SessionStorage('session-assistant', undefined, assistantId);
    assistantStorage.save({
      messages: [],
      startedAt: '2024-01-02T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:01.000Z',
      cwd: '/tmp/assistant',
    });

    const sessions = SessionStorage.listAllSessions();
    expect(sessions.length).toBe(2);
    const assistantSession = sessions.find((session) => session.id === 'session-assistant');
    expect(assistantSession?.assistantId).toBe(assistantId);
  });
});
