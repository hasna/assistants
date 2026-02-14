import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  computeNextRun,
  deleteSchedule,
  listSchedules,
  readSchedule,
  saveSchedule,
} from '../src/scheduler/store';
import { getNextCronRun } from '../src/scheduler/cron';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

describe('Scheduler', () => {
  let tempDir: string;
  let originalAssistantsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-sched-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('compute next run for cron', () => {
    const now = new Date(2026, 1, 1, 0, 0, 0).getTime();
    const next = getNextCronRun('*/5 * * * *', now);
    expect(next).toBeDefined();
    if (next) {
      const diffMins = Math.round((next - now) / 60000);
      expect(diffMins).toBe(5);
    }
  });

  test('save and list schedules', async () => {
    const schedule: ScheduledCommand = {
      id: 'sched-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'user',
      command: '/status',
      status: 'active',
      schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
      nextRunAt: undefined,
    };
    schedule.nextRunAt = computeNextRun(schedule, Date.now());
    await saveSchedule(tempDir, schedule);
    const list = await listSchedules(tempDir);
    expect(list.length).toBe(1);
    expect(list[0].command).toBe('/status');
  });

  test('deleteSchedule returns false for non-existent id', async () => {
    const deleted = await deleteSchedule(tempDir, 'non-existent');
    expect(deleted).toBe(false);
  });

  test('readSchedule returns null for non-existent id', async () => {
    const read = await readSchedule(tempDir, 'non-existent');
    expect(read).toBeNull();
  });
});
