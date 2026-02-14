import { describe, expect, test } from 'bun:test';
import { getNextCronRun, parseCronExpression } from '../src/scheduler/cron';

describe('cron helpers', () => {
  test('parseCronExpression returns null for invalid input', () => {
    expect(parseCronExpression('')).toBeNull();
    expect(parseCronExpression('* * * *')).toBeNull();
  });

  test('parseCronExpression parses steps and ranges', () => {
    const fields = parseCronExpression('*/15 0-6 1,15 * 1-5');
    expect(fields).not.toBeNull();
    if (!fields) return;

    expect(fields.minutes.has(0)).toBe(true);
    expect(fields.minutes.has(15)).toBe(true);
    expect(fields.hours.has(0)).toBe(true);
    expect(fields.hours.has(6)).toBe(true);
    expect(fields.days.has(1)).toBe(true);
    expect(fields.days.has(15)).toBe(true);
    expect(fields.weekdays.has(1)).toBe(true);
    expect(fields.weekdays.has(5)).toBe(true);
  });

  test('getNextCronRun finds next match without timezone', () => {
    const base = new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).getTime();
    const next = getNextCronRun('*/5 * * * *', base);
    expect(next).toBeDefined();
    if (next) {
      const diffMins = Math.round((next - base) / 60000);
      expect(diffMins).toBe(5);
    }
  });

  test('getNextCronRun works with time zones', () => {
    const base = new Date(Date.UTC(2026, 1, 1, 0, 0, 0)).getTime();
    const next = getNextCronRun('* * * * *', base, 'UTC');
    expect(next).toBeDefined();
    if (next) {
      const diffMins = Math.round((next - base) / 60000);
      expect(diffMins).toBe(1);
    }
  });
});
