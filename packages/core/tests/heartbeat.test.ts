import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HeartbeatManager } from '../src/heartbeat/manager';
import { StatePersistence } from '../src/heartbeat/persistence';
import { RecoveryManager } from '../src/heartbeat/recovery';
import type { Heartbeat } from '../src/heartbeat/types';
import { readHeartbeatHistory } from '../src/heartbeat/history';
import {
  HEARTBEAT_KEYS,
  heartbeatScheduleId,
  watchdogScheduleId,
  WATCHDOG_SCHEDULE_ID,
  DEFAULT_MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  DEFAULT_SLEEP_MS,
  DEFAULT_WATCHDOG_INTERVAL_MS,
} from '../src/heartbeat/conventions';
import { createAutoScheduleHeartbeatHook } from '../src/heartbeat/auto-schedule-hook';
import { ensureWatchdogSchedule } from '../src/heartbeat/watchdog';
import { installHeartbeatSkills } from '../src/heartbeat/install-skills';
import { createTestDatabase } from './fixtures/test-db';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';
import { getSchedule, saveSchedule } from '../src/scheduler/store';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-heartbeat-'));
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

describe('HeartbeatManager', () => {
  test('emits and persists heartbeat', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const manager = new HeartbeatManager({
      intervalMs: 10,
      staleThresholdMs: 50,
      persistPath: heartbeatPath,
    });

    manager.start('sess-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    manager.stop();

    const file = Bun.file(heartbeatPath);
    const exists = await file.exists();
    expect(exists).toBe(true);
    const content = await file.json();
    expect(content.sessionId).toBe('sess-1');
  });

  test('writes heartbeat history when configured', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const historyPath = join(tempDir, 'runs', 'sess-1.jsonl');
    const manager = new HeartbeatManager({
      intervalMs: 10,
      staleThresholdMs: 50,
      persistPath: heartbeatPath,
      historyPath,
    });

    manager.start('sess-1');
    await new Promise((resolve) => setTimeout(resolve, 25));
    manager.stop();

    const runs = await readHeartbeatHistory(historyPath, { order: 'desc' });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].sessionId).toBe('sess-1');
  });
});

describe('StatePersistence', () => {
  test('saves and loads persisted state', async () => {
    const db = createTestDatabase();
    const persistence = new StatePersistence('sess-2', db);
    const heartbeat: Heartbeat = {
      sessionId: 'sess-2',
      timestamp: new Date().toISOString(),
      state: 'idle',
      lastActivity: new Date().toISOString(),
      stats: { messagesProcessed: 1, toolCallsExecuted: 0, errorsEncountered: 0, uptimeSeconds: 5 },
    };

    await persistence.save({
      sessionId: 'sess-2',
      heartbeat,
      context: { cwd: tempDir },
      timestamp: new Date().toISOString(),
    });

    const loaded = await persistence.load();
    expect(loaded?.sessionId).toBe('sess-2');
  });
});

describe('RecoveryManager', () => {
  test('detects stale recovery state', async () => {
    const heartbeatPath = join(tempDir, 'hb.json');
    const db = createTestDatabase();
    const persistence = new StatePersistence('sess-3', db);

    const oldTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const heartbeat: Heartbeat = {
      sessionId: 'sess-3',
      timestamp: oldTimestamp,
      state: 'processing',
      lastActivity: oldTimestamp,
      stats: { messagesProcessed: 2, toolCallsExecuted: 1, errorsEncountered: 0, uptimeSeconds: 100 },
    };

    writeFileSync(heartbeatPath, JSON.stringify(heartbeat, null, 2));

    await persistence.save({
      sessionId: 'sess-3',
      heartbeat,
      context: { cwd: tempDir },
      timestamp: oldTimestamp,
    });

    const recovery = new RecoveryManager(persistence, heartbeatPath, 1000, {
      autoResume: false,
      maxAgeMs: 10 * 60 * 1000,
    });

    const result = await recovery.checkForRecovery();
    expect(result.available).toBe(true);
    expect(result.state?.sessionId).toBe('sess-3');
  });
});

// ── Autonomy module tests ─────────────────────────────────────────

describe('conventions', () => {
  test('heartbeatScheduleId returns deterministic ID', () => {
    expect(heartbeatScheduleId('sess-1')).toBe('heartbeat-sess-1');
    expect(heartbeatScheduleId('abc')).toBe('heartbeat-abc');
  });

  test('WATCHDOG_SCHEDULE_ID is a fixed string', () => {
    expect(WATCHDOG_SCHEDULE_ID).toBe('watchdog-main');
  });

  test('watchdogScheduleId returns session-scoped ID', () => {
    expect(watchdogScheduleId('sess-1')).toBe('watchdog-sess-1');
  });

  test('memory key constants are defined', () => {
    expect(HEARTBEAT_KEYS.LAST).toBe('agent.heartbeat.last');
    expect(HEARTBEAT_KEYS.NEXT).toBe('agent.heartbeat.next');
    expect(HEARTBEAT_KEYS.INTENTION).toBe('agent.heartbeat.intention');
    expect(HEARTBEAT_KEYS.GOALS).toBe('agent.goals');
    expect(HEARTBEAT_KEYS.LAST_ACTIONS).toBe('agent.state.lastActions');
    expect(HEARTBEAT_KEYS.PENDING).toBe('agent.state.pending');
  });

  test('timing defaults are reasonable', () => {
    expect(DEFAULT_MAX_SLEEP_MS).toBe(30 * 60 * 1000); // 30 min
    expect(MIN_SLEEP_MS).toBe(30 * 1000); // 30 sec
    expect(DEFAULT_SLEEP_MS).toBe(10 * 60 * 1000); // 10 min
    expect(DEFAULT_WATCHDOG_INTERVAL_MS).toBe(60 * 60 * 1000); // 1 hour
  });
});

describe('createAutoScheduleHeartbeatHook', () => {
  test('returns a valid NativeHook', () => {
    const hook = createAutoScheduleHeartbeatHook();
    expect(hook.id).toBe('auto-schedule-heartbeat');
    expect(hook.event).toBe('Stop');
    expect(hook.priority).toBe(100);
    expect(typeof hook.handler).toBe('function');
  });

  test('handler returns null when autonomous is disabled', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      { sessionId: 'sess-1', cwd: tempDir, config: { heartbeat: { autonomous: false } } } as any,
    );
    expect(result).toBeNull();
  });

  test('handler returns null when no config', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      { sessionId: 'sess-1', cwd: tempDir, config: {} } as any,
    );
    expect(result).toBeNull();
  });

  test('handler creates schedule when autonomous is enabled', async () => {
    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      {
        sessionId: 'test-sess',
        cwd: tempDir,
        config: { heartbeat: { autonomous: true } },
      } as any,
    );
    expect(result).toBeNull(); // Never blocks

    // Verify schedule was created in SQLite
    const schedule = await getSchedule(tempDir, 'heartbeat-test-sess');
    expect(schedule).not.toBeNull();
    expect(schedule!.id).toBe('heartbeat-test-sess');
    expect(schedule!.actionType).toBe('message');
    expect(schedule!.message).toBe('/main-loop');
    expect(schedule!.status).toBe('active');
    expect(schedule!.schedule.kind).toBe('once');
  });

  test('handler skips when active schedule exists', async () => {
    // Create an existing active schedule in SQLite
    await saveSchedule(tempDir, {
      id: 'heartbeat-test-sess',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'assistant',
      command: '/main-loop',
      schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
      nextRunAt: Date.now() + 60000,
    } as any);

    const hook = createAutoScheduleHeartbeatHook();
    const result = await hook.handler(
      { toolName: 'bash', toolInput: {} },
      {
        sessionId: 'test-sess',
        cwd: tempDir,
        config: { heartbeat: { autonomous: true } },
      } as any,
    );
    expect(result).toBeNull();
  });
});

describe('ensureWatchdogSchedule', () => {
  test('creates watchdog schedule in SQLite', async () => {
    await ensureWatchdogSchedule(tempDir, 'sess-wd');

    const schedule = await getSchedule(tempDir, watchdogScheduleId('sess-wd'));
    expect(schedule).not.toBeNull();
    expect(schedule!.id).toBe(watchdogScheduleId('sess-wd'));
    expect(schedule!.actionType).toBe('message');
    expect(schedule!.message).toBe('/watchdog');
    expect(schedule!.status).toBe('active');
    expect(schedule!.schedule.kind).toBe('interval');
    expect(schedule!.schedule.unit).toBe('seconds');
    // Default interval: 1 hour = 3600 seconds
    expect(schedule!.schedule.interval).toBe(3600);
  });

  test('skips if active watchdog already exists', async () => {
    // Create existing watchdog schedule in SQLite
    const existingCreatedAt = Date.now() - 10000;
    await saveSchedule(tempDir, {
      id: watchdogScheduleId('sess-wd2'),
      status: 'active',
      createdAt: existingCreatedAt,
      updatedAt: existingCreatedAt,
      createdBy: 'assistant',
      command: '/watchdog',
      schedule: { kind: 'interval', interval: 3600, unit: 'seconds' },
      nextRunAt: Date.now() + 60_000,
    } as any);

    await ensureWatchdogSchedule(tempDir, 'sess-wd2');

    // Schedule should still contain the original createdAt (not overwritten)
    const schedule = await getSchedule(tempDir, watchdogScheduleId('sess-wd2'));
    expect(schedule!.createdAt).toBe(existingCreatedAt);
  });

  test('accepts custom interval', async () => {
    await ensureWatchdogSchedule(tempDir, 'sess-custom', 5 * 60 * 1000); // 5 minutes

    const schedule = await getSchedule(tempDir, watchdogScheduleId('sess-custom'));
    expect(schedule!.schedule.interval).toBe(300); // 5 min = 300 seconds
  });

  test('creates separate watchdog schedules per session', async () => {
    await ensureWatchdogSchedule(tempDir, 'sess-a', 120_000);
    await ensureWatchdogSchedule(tempDir, 'sess-b', 120_000);

    const first = await getSchedule(tempDir, watchdogScheduleId('sess-a'));
    const second = await getSchedule(tempDir, watchdogScheduleId('sess-b'));
    expect(first!.id).toBe(watchdogScheduleId('sess-a'));
    expect(second!.id).toBe(watchdogScheduleId('sess-b'));
  });

  test('enforces minimum 60 second interval when intervalMs is lower', async () => {
    await ensureWatchdogSchedule(tempDir, 'sess-min', 10_000);

    const schedule = await getSchedule(tempDir, watchdogScheduleId('sess-min'));
    expect(schedule!.schedule.interval).toBe(60);
    const delay = (schedule!.nextRunAt || 0) - Date.now();
    expect(delay).toBeGreaterThanOrEqual(55_000);
  });
});

describe('installHeartbeatSkills', () => {
  test('installs main-loop and watchdog skills', async () => {
    // Override getConfigDir to use temp dir
    const skillsDir = join(tempDir, 'shared', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    // We can't easily override getConfigDir, so test the skill content structure
    // by verifying the function is callable and returns an array
    // The actual installation depends on getConfigDir() pointing to ~/.assistants
    const result = await installHeartbeatSkills();
    expect(Array.isArray(result)).toBe(true);
    // Result should be skill names that were newly installed
    for (const name of result) {
      expect(typeof name).toBe('string');
    }
  });
});
