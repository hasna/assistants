import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  computeNextRun,
  deleteSchedule,
  getDueSchedules,
  isValidTimeZone,
  listSchedules,
  readSchedule,
  saveSchedule,
  updateSchedule,
} from '../src/scheduler/store';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

const buildSchedule = (overrides?: Partial<ScheduledCommand>): ScheduledCommand => ({
  id: 'sched-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: 'user',
  command: '/status',
  status: 'active',
  schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
  nextRunAt: undefined,
  ...overrides,
});

describe('scheduler store extras', () => {
  let dir: string;
  let originalAssistantsDir: string | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'assistants-sched-extra-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = dir;
    resetDatabaseSingleton();
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    await rm(dir, { recursive: true, force: true });
  });

  test('saveSchedule and listSchedules work correctly', async () => {
    const schedule = buildSchedule({ id: 'sched-1' });
    schedule.nextRunAt = computeNextRun(schedule, Date.now());
    await saveSchedule(dir, schedule);
    const list = await listSchedules(dir);
    expect(list.length).toBe(1);
  });

  test('deleteSchedule handles missing schedules', async () => {
    const schedule = buildSchedule({ id: 'sched-1' });
    schedule.nextRunAt = computeNextRun(schedule, Date.now());
    await saveSchedule(dir, schedule);
    const list = await listSchedules(dir);
    expect(list.length).toBe(1);

    const deleted = await deleteSchedule(dir, 'missing');
    expect(deleted).toBe(false);
  });

  test('getDueSchedules filters by status and time', async () => {
    const due = buildSchedule({ id: 'due', nextRunAt: Date.now() - 1000 });
    const later = buildSchedule({ id: 'later', nextRunAt: Date.now() + 100000 });
    const paused = buildSchedule({ id: 'paused', status: 'paused', nextRunAt: Date.now() - 1000 });
    await saveSchedule(dir, due);
    await saveSchedule(dir, later);
    await saveSchedule(dir, paused);
    const result = await getDueSchedules(dir, Date.now());
    expect(result.map((item) => item.id)).toEqual(['due']);
  });

  test('updateSchedule reads and writes updates', async () => {
    const schedule = buildSchedule({ id: 'sched-1' });
    await saveSchedule(dir, schedule);
    const updated = await updateSchedule(dir, 'sched-1', (current) => ({
      ...current,
      status: 'paused',
    }));
    expect(updated?.status).toBe('paused');

    const missing = await updateSchedule(dir, 'missing', (current) => current);
    expect(missing).toBeNull();
  });

  test('computeNextRun handles once and cron schedules', () => {
    const now = new Date('2026-02-01T00:00:00Z').getTime();
    const once = buildSchedule({
      schedule: { kind: 'once', at: '2026-02-01T01:00:00Z' },
      nextRunAt: undefined,
    });
    expect(computeNextRun(once, now)).toBeGreaterThan(now);

    const cron = buildSchedule({
      schedule: { kind: 'cron', cron: '*/5 * * * *' },
      nextRunAt: undefined,
    });
    expect(computeNextRun(cron, now)).toBeGreaterThan(now);
  });

  test('readSchedule returns schedule and handles missing', async () => {
    const schedule = buildSchedule({ id: 'sched-1' });
    await saveSchedule(dir, schedule);
    const loaded = await readSchedule(dir, 'sched-1');
    expect(loaded?.id).toBe('sched-1');

    expect(await readSchedule(dir, 'missing')).toBeNull();
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
