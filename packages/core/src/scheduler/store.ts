import type { ScheduledCommand } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';
import { getNextCronRun } from './cron';

export const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;

function getDb(): DatabaseConnection {
  return getDatabase();
}

export interface ListSchedulesOptions {
  sessionId?: string;
  global?: boolean;
}

interface ScheduleRow {
  id: string;
  project_path: string;
  command: string;
  schedule: string;
  status: string;
  session_id: string | null;
  next_run_at: number | null;
  last_run_at: number | null;
  run_count: number;
  max_runs: number | null;
  created_at: string;
  updated_at: string;
  data: string | null;
}

function rowToSchedule(row: ScheduleRow): ScheduledCommand {
  if (row.data) {
    return JSON.parse(row.data) as ScheduledCommand;
  }
  // Fallback: reconstruct from columns (should not normally happen)
  return {
    id: row.id,
    command: row.command,
    schedule: JSON.parse(row.schedule),
    status: row.status as ScheduledCommand['status'],
    createdBy: 'user',
    sessionId: row.session_id ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    lastRunAt: row.last_run_at ?? undefined,
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  } as ScheduledCommand;
}

export async function listSchedules(cwd: string, options?: ListSchedulesOptions): Promise<ScheduledCommand[]> {
  const rows = getDb().query<ScheduleRow>(
    'SELECT * FROM schedules WHERE project_path = ?'
  ).all(cwd);

  const schedules = rows.map(rowToSchedule);

  if (options?.sessionId && !options?.global) {
    return schedules.filter(
      (s) => s.sessionId === options.sessionId || !s.sessionId
    );
  }

  return schedules;
}

export async function saveSchedule(cwd: string, schedule: ScheduledCommand): Promise<void> {
  const scheduleJson = JSON.stringify(schedule.schedule);
  const data = JSON.stringify(schedule);

  getDb().prepare(
    `INSERT OR REPLACE INTO schedules (id, project_path, command, schedule, status, session_id, next_run_at, last_run_at, run_count, max_runs, created_at, updated_at, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    schedule.id,
    cwd,
    schedule.command,
    scheduleJson,
    schedule.status,
    schedule.sessionId ?? null,
    schedule.nextRunAt ?? null,
    schedule.lastRunAt ?? null,
    0,
    null,
    String(schedule.createdAt),
    String(schedule.updatedAt),
    data
  );
}

export async function getSchedule(cwd: string, id: string): Promise<ScheduledCommand | null> {
  const row = getDb().query<ScheduleRow>(
    'SELECT * FROM schedules WHERE id = ?'
  ).get(id);
  if (!row) return null;
  return rowToSchedule(row);
}

export async function deleteSchedule(cwd: string, id: string): Promise<boolean> {
  const result = getDb().prepare(
    'DELETE FROM schedules WHERE id = ?'
  ).run(id);
  return result.changes > 0;
}

export function computeNextRun(schedule: ScheduledCommand, fromTime: number): number | undefined {
  const timezone = schedule.schedule.timezone;
  const validTimezone = timezone && isValidTimeZone(timezone) ? timezone : undefined;
  if (schedule.schedule.kind === 'once') {
    if (!schedule.schedule.at) return undefined;
    const next = parseScheduledTime(schedule.schedule.at, validTimezone);
    if (!next || next <= fromTime) return undefined;
    return next;
  }
  if (schedule.schedule.kind === 'cron') {
    if (!schedule.schedule.cron) return undefined;
    return getNextCronRun(schedule.schedule.cron, fromTime, validTimezone);
  }
  if (schedule.schedule.kind === 'random') {
    return computeRandomNextRun(schedule.schedule, fromTime);
  }
  if (schedule.schedule.kind === 'interval') {
    return computeIntervalNextRun(schedule.schedule, fromTime);
  }
  return undefined;
}

function computeRandomNextRun(
  schedule: { minInterval?: number; maxInterval?: number; unit?: 'seconds' | 'minutes' | 'hours' },
  fromTime: number
): number | undefined {
  const { minInterval, maxInterval, unit = 'minutes' } = schedule;
  if (!minInterval || !maxInterval || minInterval <= 0 || maxInterval <= 0) {
    return undefined;
  }
  if (minInterval > maxInterval) {
    return undefined;
  }

  const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
  const minMs = minInterval * multiplier;
  const maxMs = maxInterval * multiplier;

  const randomDelay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

  return fromTime + randomDelay;
}

function computeIntervalNextRun(
  schedule: { interval?: number; unit?: 'seconds' | 'minutes' | 'hours' },
  fromTime: number
): number | undefined {
  const { interval, unit = 'minutes' } = schedule;
  if (!interval || interval <= 0) {
    return undefined;
  }

  const multiplier = unit === 'seconds' ? 1000 : unit === 'hours' ? 3600000 : 60000;
  const intervalMs = interval * multiplier;

  return fromTime + intervalMs;
}

export async function getDueSchedules(cwd: string, nowTime: number): Promise<ScheduledCommand[]> {
  const rows = getDb().query<ScheduleRow>(
    "SELECT * FROM schedules WHERE project_path = ? AND status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?"
  ).all(cwd, nowTime);

  return rows.map(rowToSchedule).filter((s) => Number.isFinite(s.nextRunAt));
}

export async function updateSchedule(
  cwd: string,
  id: string,
  updater: (schedule: ScheduledCommand) => ScheduledCommand,
  _options?: { ownerId?: string }
): Promise<ScheduledCommand | null> {
  const d = getDb();
  return d.transaction(() => {
    const row = d.query<ScheduleRow>(
      'SELECT * FROM schedules WHERE id = ?'
    ).get(id);
    if (!row) return null;

    const schedule = rowToSchedule(row);
    const updated = updater(schedule);

    const scheduleJson = JSON.stringify(updated.schedule);
    const data = JSON.stringify(updated);

    d.prepare(
      `UPDATE schedules SET command = ?, schedule = ?, status = ?, session_id = ?, next_run_at = ?, last_run_at = ?, run_count = ?, max_runs = ?, updated_at = ?, data = ? WHERE id = ?`
    ).run(
      updated.command,
      scheduleJson,
      updated.status,
      updated.sessionId ?? null,
      updated.nextRunAt ?? null,
      updated.lastRunAt ?? null,
      0,
      null,
      String(updated.updatedAt),
      data,
      id
    );

    return updated;
  });
}

export async function readSchedule(cwd: string, id: string): Promise<ScheduledCommand | null> {
  return getSchedule(cwd, id);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function parseScheduledTime(value: string, timeZone?: string): number | undefined {
  if (!value) return undefined;
  if (!timeZone || hasTimeZoneOffset(value)) {
    const ts = Date.parse(value);
    return Number.isFinite(ts) ? ts : undefined;
  }

  if (!isValidTimeZone(timeZone)) return undefined;

  const parsed = parseDateTime(value);
  if (!parsed) return undefined;

  const utcGuess = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

function parseDateTime(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59 ||
    second < 0 || second > 59
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function hasTimeZoneOffset(value: string): boolean {
  return /[zZ]|[+-]\d{2}:\d{2}$/.test(value);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get('year'));
  const month = Number(lookup.get('month'));
  const day = Number(lookup.get('day'));
  const hour = Number(lookup.get('hour'));
  const minute = Number(lookup.get('minute'));
  const second = Number(lookup.get('second'));
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}
