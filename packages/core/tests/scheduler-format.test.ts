import { describe, expect, test } from 'bun:test';
import { formatRelativeTime, formatAbsoluteTime } from '../src/scheduler/format';

describe('Scheduler Format Utilities', () => {
  describe('formatRelativeTime', () => {
    const baseTime = new Date('2026-02-05T12:00:00.000Z').getTime();

    test('returns "n/a" for undefined timestamp', () => {
      expect(formatRelativeTime(undefined, baseTime)).toBe('n/a');
    });

    test('formats future time in seconds', () => {
      const future = baseTime + 30 * 1000; // 30 seconds in future
      expect(formatRelativeTime(future, baseTime)).toBe('in 30s');
    });

    test('formats future time in minutes and seconds', () => {
      const future = baseTime + (5 * 60 + 30) * 1000; // 5m 30s in future
      expect(formatRelativeTime(future, baseTime)).toBe('in 5m 30s');
    });

    test('formats future time in hours and minutes', () => {
      const future = baseTime + (2 * 60 * 60 + 15 * 60) * 1000; // 2h 15m in future
      expect(formatRelativeTime(future, baseTime)).toBe('in 2h 15m');
    });

    test('formats future time in days and hours', () => {
      const future = baseTime + (3 * 24 * 60 * 60 + 5 * 60 * 60) * 1000; // 3d 5h in future
      expect(formatRelativeTime(future, baseTime)).toBe('in 3d 5h');
    });

    test('formats past time in seconds', () => {
      const past = baseTime - 45 * 1000; // 45 seconds ago
      expect(formatRelativeTime(past, baseTime)).toBe('45s ago');
    });

    test('formats past time in minutes and seconds', () => {
      const past = baseTime - (10 * 60 + 15) * 1000; // 10m 15s ago
      expect(formatRelativeTime(past, baseTime)).toBe('10m 15s ago');
    });

    test('formats past time in hours and minutes', () => {
      const past = baseTime - (4 * 60 * 60 + 30 * 60) * 1000; // 4h 30m ago
      expect(formatRelativeTime(past, baseTime)).toBe('4h 30m ago');
    });

    test('formats past time in days and hours', () => {
      const past = baseTime - (7 * 24 * 60 * 60 + 12 * 60 * 60) * 1000; // 7d 12h ago
      expect(formatRelativeTime(past, baseTime)).toBe('7d 12h ago');
    });

    test('handles exact minute boundary', () => {
      const future = baseTime + 60 * 1000; // exactly 1 minute
      expect(formatRelativeTime(future, baseTime)).toBe('in 1m 0s');
    });

    test('handles exact hour boundary', () => {
      const future = baseTime + 60 * 60 * 1000; // exactly 1 hour
      expect(formatRelativeTime(future, baseTime)).toBe('in 1h 0m');
    });

    test('handles exact day boundary', () => {
      const future = baseTime + 24 * 60 * 60 * 1000; // exactly 1 day
      expect(formatRelativeTime(future, baseTime)).toBe('in 1d 0h');
    });

    test('handles zero difference', () => {
      expect(formatRelativeTime(baseTime, baseTime)).toBe('in 0s');
    });

    test('uses current time when now is not provided', () => {
      const result = formatRelativeTime(Date.now() + 60000);
      expect(result).toMatch(/^in \d+m \d+s$|^in \d+s$/);
    });
  });

  describe('formatAbsoluteTime', () => {
    test('returns "n/a" for undefined timestamp', () => {
      expect(formatAbsoluteTime(undefined)).toBe('n/a');
    });

    test('formats timestamp as locale string', () => {
      const timestamp = new Date('2026-02-05T12:00:00.000Z').getTime();
      const result = formatAbsoluteTime(timestamp);
      // The exact format depends on locale, but should contain date components
      expect(result).not.toBe('n/a');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
