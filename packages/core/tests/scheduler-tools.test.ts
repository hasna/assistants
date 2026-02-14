import { describe, expect, test } from 'bun:test';
import { withTempDir } from './fixtures/helpers';
import {
  saveSchedule,
  readSchedule,
  computeNextRun,
} from '../src/scheduler/store';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import { SchedulerTool } from '../src/tools/scheduler';

const buildSchedule = (overrides?: Partial<ScheduledCommand>): ScheduledCommand => ({
  id: 'sched-1',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  createdBy: 'assistant',
  command: 'cmd',
  status: 'active',
  schedule: { kind: 'once', at: new Date(Date.now() + 60000).toISOString() },
  nextRunAt: undefined,
  ...overrides,
});

describe('SchedulerTool', () => {
  test('list action formats output', async () => {
    await withTempDir(async (dir) => {
      const first = buildSchedule({ id: 'a', nextRunAt: Date.now() + 1000, command: 'cmd-a' });
      const second = buildSchedule({ id: 'b', nextRunAt: Date.now() + 2000, command: 'cmd-b' });
      await saveSchedule(dir, second);
      await saveSchedule(dir, first);

      const output = await SchedulerTool.executor({ action: 'list', cwd: dir });
      const firstIndex = output.indexOf('- a [active] [global] cmd-a');
      const secondIndex = output.indexOf('- b [active] [global] cmd-b');
      expect(firstIndex).toBeGreaterThanOrEqual(0);
      expect(secondIndex).toBeGreaterThan(firstIndex);
    });
  });

  test('create action validates inputs', async () => {
    expect(await SchedulerTool.executor({ action: 'create', command: '' })).toBe('Error: command is required.');
    expect(await SchedulerTool.executor({ action: 'create', command: 'cmd' })).toBe('Error: provide at (ISO time), cron, every (fixed interval), or minInterval+maxInterval for random scheduling.');

    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', at: '2026-02-01T10:00:00', timezone: 'Bad/Zone' })
    ).toBe('Error: invalid timezone "Bad/Zone".');

    const past = new Date(Date.now() - 1000).toISOString();
    const error = await SchedulerTool.executor({ action: 'create', command: 'cmd', at: past });
    expect(error).toBe('Error: unable to compute next run for schedule.');
  });

  test('create action validates random interval inputs', async () => {
    // minInterval and maxInterval must be positive
    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', minInterval: 0, maxInterval: 10 })
    ).toBe('Error: minInterval and maxInterval must be positive numbers.');
    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', minInterval: 5, maxInterval: -1 })
    ).toBe('Error: minInterval and maxInterval must be positive numbers.');

    // minInterval cannot be greater than maxInterval
    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', minInterval: 20, maxInterval: 5 })
    ).toBe('Error: minInterval cannot be greater than maxInterval.');
  });

  test('create action validates fixed interval inputs', async () => {
    // every must be positive
    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', every: 0 })
    ).toBe('Error: every must be a positive number.');
    expect(
      await SchedulerTool.executor({ action: 'create', command: 'cmd', every: -5 })
    ).toBe('Error: every must be a positive number.');
  });

  test('create action saves fixed interval schedule', async () => {
    await withTempDir(async (dir) => {
      const output = await SchedulerTool.executor({
        action: 'create',
        command: 'interval-cmd',
        every: 15,
        unit: 'seconds',
        cwd: dir,
      });
      expect(output).toContain('Scheduled interval-cmd');
      expect(output).toContain('every 15 seconds');

      const match = output.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.command).toBe('interval-cmd');
      expect(saved?.schedule.kind).toBe('interval');
      expect(saved?.schedule.interval).toBe(15);
      expect(saved?.schedule.unit).toBe('seconds');
      expect(saved?.nextRunAt).toBeGreaterThan(Date.now());
    });
  });

  test('create action saves sub-minute interval (1 second)', async () => {
    await withTempDir(async (dir) => {
      const output = await SchedulerTool.executor({
        action: 'create',
        command: 'fast-cmd',
        every: 1,
        unit: 'seconds',
        cwd: dir,
      });
      expect(output).toContain('Scheduled fast-cmd');
      expect(output).toContain('every 1 seconds');

      const match = output.match(/\(([^)]+)\)/);
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.schedule.kind).toBe('interval');
      expect(saved?.schedule.interval).toBe(1);
      expect(saved?.schedule.unit).toBe('seconds');
      // Next run should be about 1 second from now
      const expectedMin = Date.now() + 900; // Allow some margin
      const expectedMax = Date.now() + 1100;
      expect(saved?.nextRunAt).toBeGreaterThanOrEqual(expectedMin);
      expect(saved?.nextRunAt).toBeLessThanOrEqual(expectedMax);
    });
  });

  test('create action saves random interval schedule', async () => {
    await withTempDir(async (dir) => {
      const output = await SchedulerTool.executor({
        action: 'create',
        command: 'random-cmd',
        minInterval: 5,
        maxInterval: 15,
        unit: 'minutes',
        cwd: dir,
      });
      expect(output).toContain('Scheduled random-cmd');
      expect(output).toContain('randomly every 5-15 minutes');

      const match = output.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.command).toBe('random-cmd');
      expect(saved?.schedule.kind).toBe('random');
      expect(saved?.schedule.minInterval).toBe(5);
      expect(saved?.schedule.maxInterval).toBe(15);
      expect(saved?.schedule.unit).toBe('minutes');
      expect(saved?.nextRunAt).toBeGreaterThan(Date.now());
    });
  });

  test('create action saves schedule', async () => {
    await withTempDir(async (dir) => {
      const future = new Date(Date.now() + 60000).toISOString();
      const output = await SchedulerTool.executor({ action: 'create', command: 'cmd', at: future, cwd: dir });
      const match = output.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.command).toBe('cmd');
    });
  });

  test('create action supports immediate first run for recurring cron schedules', async () => {
    await withTempDir(async (dir) => {
      const before = Date.now();
      const output = await SchedulerTool.executor({
        action: 'create',
        command: 'cron-cmd',
        cron: '*/5 * * * *',
        startImmediately: true,
        cwd: dir,
      });
      expect(output).toContain('Scheduled cron-cmd');

      const match = output.match(/\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const id = match?.[1];
      const saved = id ? await readSchedule(dir, id) : null;
      expect(saved?.schedule.kind).toBe('cron');
      expect(saved?.schedule.cron).toBe('*/5 * * * *');
      expect(saved?.nextRunAt).toBeGreaterThanOrEqual(before);
      expect(saved?.nextRunAt).toBeLessThanOrEqual(Date.now() + 5000);
    });
  });

  test('delete action handles missing id and not found', async () => {
    expect(await SchedulerTool.executor({ action: 'delete', id: '' })).toBe('Error: id is required.');
    await withTempDir(async (dir) => {
      const response = await SchedulerTool.executor({ action: 'delete', id: 'missing', cwd: dir });
      expect(response).toBe('Schedule missing not found.');
    });
  });

  test('pause/resume actions update schedule', async () => {
    await withTempDir(async (dir) => {
      const schedule = buildSchedule({ id: 'sched-1' });
      schedule.nextRunAt = computeNextRun(schedule, Date.now());
      await saveSchedule(dir, schedule);

      const paused = await SchedulerTool.executor({ action: 'pause', id: 'sched-1', cwd: dir });
      expect(paused).toBe('Paused schedule sched-1.');
      const pausedSchedule = await readSchedule(dir, 'sched-1');
      expect(pausedSchedule?.status).toBe('paused');

      const resumed = await SchedulerTool.executor({ action: 'resume', id: 'sched-1', cwd: dir });
      expect(resumed).toBe('Resumed schedule sched-1.');
      const resumedSchedule = await readSchedule(dir, 'sched-1');
      expect(resumedSchedule?.status).toBe('active');
    });
  });

  test('unknown action returns error', async () => {
    const output = await SchedulerTool.executor({ action: 'unknown' });
    expect(output).toBe('Error: unknown action "unknown".');
  });
});
