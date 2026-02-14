import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { Job, JobStatus } from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const STALE_JOB_GRACE_MS = 30_000;

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface JobRow {
  id: string;
  session_id: string;
  connector_name: string;
  action: string;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  timeout_ms: number | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function jobToRow(job: Job): [string, string, string, string, string, string, string | null, string | null, number, number, number | null, number | null] {
  return [
    job.id,
    job.sessionId,
    job.connectorName,
    job.command,
    job.status,
    JSON.stringify(job.input),
    job.result ? JSON.stringify(job.result) : null,
    job.error ? JSON.stringify(job.error) : null,
    job.timeoutMs,
    job.createdAt,
    job.startedAt ?? null,
    job.completedAt ?? null,
  ];
}

function rowToJob(row: JobRow): Job {
  const job: Job = {
    id: row.id,
    sessionId: row.session_id,
    connectorName: row.connector_name,
    command: row.action,
    status: row.status as JobStatus,
    input: row.input ? JSON.parse(row.input) : {},
    timeoutMs: row.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    createdAt: row.created_at,
  };
  if (row.started_at != null) job.startedAt = row.started_at;
  if (row.completed_at != null) job.completedAt = row.completed_at;
  if (row.output) job.result = JSON.parse(row.output);
  if (row.error) job.error = JSON.parse(row.error);
  return job;
}

/**
 * Save a job to the database
 */
export async function saveJob(job: Job): Promise<void> {
  const params = jobToRow(job);
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO jobs (id, session_id, connector_name, action, status, input, output, error, timeout_ms, created_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(...params);
}

/**
 * Read a job from the database
 */
export async function readJob(id: string): Promise<Job | null> {
  try {
    const row = getDb()
      .query<JobRow>('SELECT * FROM jobs WHERE id = ?')
      .get(id);
    if (!row) return null;
    return rowToJob(row);
  } catch {
    return null;
  }
}

/**
 * Delete a job from the database
 */
export async function deleteJob(id: string): Promise<boolean> {
  try {
    const result = getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return result.changes > 0;
  } catch {
    return false;
  }
}

/**
 * List all jobs
 */
export async function listJobs(): Promise<Job[]> {
  try {
    const rows = getDb()
      .query<JobRow>('SELECT * FROM jobs ORDER BY created_at DESC')
      .all();
    return rows.map(rowToJob);
  } catch {
    return [];
  }
}

/**
 * List jobs for a specific session
 */
export async function listJobsForSession(sessionId: string): Promise<Job[]> {
  try {
    const rows = getDb()
      .query<JobRow>('SELECT * FROM jobs WHERE session_id = ? ORDER BY created_at DESC')
      .all(sessionId);
    return rows.map(rowToJob);
  } catch {
    return [];
  }
}

/**
 * List jobs with a specific status
 */
export async function listJobsByStatus(status: JobStatus): Promise<Job[]> {
  try {
    const rows = getDb()
      .query<JobRow>('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC')
      .all(status);
    return rows.map(rowToJob);
  } catch {
    return [];
  }
}

/**
 * Update a job atomically
 */
export async function updateJob(
  id: string,
  updater: (job: Job) => Job
): Promise<Job | null> {
  const job = await readJob(id);
  if (!job) return null;
  const updated = updater(job);
  await saveJob(updated);
  return updated;
}

/**
 * Clean up old jobs beyond maxAge
 */
export async function cleanupOldJobs(maxAgeMs: number): Promise<number> {
  const jobs = await listJobs();
  const now = Date.now();
  let cleaned = 0;

  for (const job of jobs) {
    const isCompleted = ['completed', 'failed', 'timeout', 'cancelled'].includes(job.status);
    const isStale = isStaleJob(job, now);
    if ((isCompleted || isStale) && now - job.createdAt > maxAgeMs) {
      const deleted = await deleteJob(job.id);
      if (deleted) cleaned++;
    }
  }

  return cleaned;
}

/**
 * Clean up jobs for a specific session
 */
export async function cleanupSessionJobs(sessionId: string): Promise<number> {
  const jobs = await listJobsForSession(sessionId);
  let cleaned = 0;

  for (const job of jobs) {
    if (['completed', 'failed', 'timeout', 'cancelled'].includes(job.status) || isStaleJob(job, Date.now())) {
      const deleted = await deleteJob(job.id);
      if (deleted) cleaned++;
    }
  }

  return cleaned;
}

function isStaleJob(job: Job, now: number): boolean {
  if (!['pending', 'running'].includes(job.status)) return false;
  const startedAt = job.startedAt ?? job.createdAt;
  const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return now - startedAt > timeoutMs + STALE_JOB_GRACE_MS;
}
