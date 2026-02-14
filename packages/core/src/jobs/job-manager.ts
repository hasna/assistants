import { generateId } from '@hasna/assistants-shared';
import type { Job, JobsConfig, JobCompletedEvent, JobCompletionCallback, JobStatus } from './types';
import {
  saveJob,
  readJob,
  updateJob,
  listJobsForSession,
  listJobsByStatus,
  cleanupOldJobs,
} from './job-store';
import { ErrorCodes } from '../errors/codes';
import { getRuntime } from '../runtime';
import { buildCommandArgs, splitCommandLine } from '../utils/command-line';
import type { SpawnResult } from '../runtime';

const DEFAULT_TIMEOUT_MS = 60_000; // 1 minute
const DEFAULT_MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Manages background jobs for long-running connector operations
 */
export class JobManager {
  private config: JobsConfig;
  private sessionId: string;
  private runningJobs: Map<string, { proc: SpawnResult; timer: ReturnType<typeof setTimeout> }> = new Map();
  private timedOutJobs: Set<string> = new Set();
  private cancelledJobs: Set<string> = new Set();
  private completionCallbacks: JobCompletionCallback[] = [];

  constructor(config: JobsConfig = {}, sessionId: string) {
    this.config = config;
    this.sessionId = sessionId;
  }

  /**
   * Register a callback for job completion notifications
   */
  onJobComplete(callback: JobCompletionCallback): void {
    this.completionCallbacks.push(callback);
  }

  /**
   * Get the session ID for this job manager
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if jobs system is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled !== false;
  }

  /**
   * Check if a connector should run in async mode
   */
  shouldRunAsync(connectorName: string, input: Record<string, unknown>): boolean {
    if (!this.isEnabled()) return false;

    // Explicit sync override
    if (input.async === false) return false;

    // Explicit async request
    if (input.async === true) return true;

    // Check connector-specific config
    const connectorConfig = this.config.connectors?.[connectorName];
    return connectorConfig?.enabled === true;
  }

  /**
   * Get timeout for a connector
   */
  getTimeout(connectorName: string): number {
    const connectorConfig = this.config.connectors?.[connectorName];
    return connectorConfig?.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Start a job for a connector command
   */
  async startJob(
    connectorName: string,
    command: string,
    input: Record<string, unknown>,
    cli: string
  ): Promise<Job> {
    const jobId = generateId();
    const timeoutMs = this.getTimeout(connectorName);
    const now = Date.now();

    const job: Job = {
      id: jobId,
      sessionId: this.sessionId,
      connectorName,
      command,
      input,
      status: 'pending',
      createdAt: now,
      timeoutMs,
    };

    await saveJob(job);

    // Start execution in background
    this.executeAsync(job, cli);

    return job;
  }

  /**
   * Execute a job asynchronously
   */
  private async executeAsync(job: Job, cli: string): Promise<void> {
    const existing = await readJob(job.id);
    if (!existing || existing.status === 'cancelled') {
      return;
    }
    // Update status to running
    const runningJob = await updateJob(job.id, (j) => {
      if (j.status === 'cancelled') {
        return j;
      }
      return {
        ...j,
        status: 'running' as JobStatus,
        startedAt: Date.now(),
      };
    });

    if (!runningJob || runningJob.status === 'cancelled') return;

    const args = (job.input.args as string[]) || [];
    const options = (job.input.options as Record<string, unknown>) || {};
    const cwd = typeof job.input.cwd === 'string' ? job.input.cwd : process.cwd();

    // Build command parts
    const cmdParts = buildCommandArgs(cli, [...splitCommandLine(job.command), ...args]);

    // Add options
    for (const [key, value] of Object.entries(options)) {
      if (key === 'timeoutMs' || key === 'timeout' || key === 'async') continue;
      if (value === true) {
        cmdParts.push(`--${key}`);
      } else if (value !== false && value !== undefined) {
        cmdParts.push(`--${key}`, String(value));
      }
    }

    try {
      const runtime = getRuntime();
      const proc = runtime.spawn(cmdParts, {
        cwd,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Set up timeout
      const timer = setTimeout(() => {
        this.handleTimeout(job.id, proc);
      }, job.timeoutMs);

      this.runningJobs.set(job.id, { proc, timer });

      // Wait for completion
      const [stdout, stderr] = await Promise.all([
        proc.stdout ? new Response(proc.stdout).text() : '',
        proc.stderr ? new Response(proc.stderr).text() : '',
      ]);
      const exitCode = await proc.exited;

      // Clear timeout
      clearTimeout(timer);
      this.runningJobs.delete(job.id);

      // Check if this job was timed out or cancelled (using local flags to avoid race condition)
      if (this.timedOutJobs.has(job.id)) {
        this.timedOutJobs.delete(job.id);
        return;
      }

      if (this.cancelledJobs.has(job.id)) {
        this.cancelledJobs.delete(job.id);
        return;
      }

      // Double-check job wasn't cancelled externally
      const currentJob = await readJob(job.id);
      if (!currentJob || currentJob.status === 'cancelled') {
        return;
      }

      // Update job with result
      const completedJob = await updateJob(job.id, (j) => ({
        ...j,
        status: (exitCode === 0 ? 'completed' : 'failed') as JobStatus,
        completedAt: Date.now(),
        result: {
          content: stdout.trim() || stderr.trim() || 'Command completed',
          exitCode,
        },
        error: exitCode !== 0 ? {
          code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
          message: stderr.trim() || `Exit code: ${exitCode}`,
        } : undefined,
      }));

      if (completedJob) {
        this.notifyCompletion(completedJob);
      }
    } catch (error) {
      // Clear timeout if set
      const running = this.runningJobs.get(job.id);
      if (running) {
        clearTimeout(running.timer);
        this.runningJobs.delete(job.id);
      }

      // Check if this was a timeout or cancellation (don't record as failure)
      if (this.timedOutJobs.has(job.id)) {
        this.timedOutJobs.delete(job.id);
        return;
      }

      if (this.cancelledJobs.has(job.id)) {
        this.cancelledJobs.delete(job.id);
        return;
      }

      // Update job with error
      const failedJob = await updateJob(job.id, (j) => ({
        ...j,
        status: 'failed' as JobStatus,
        completedAt: Date.now(),
        error: {
          code: ErrorCodes.CONNECTOR_EXECUTION_FAILED,
          message: error instanceof Error ? error.message : String(error),
        },
      }));

      if (failedJob) {
        this.notifyCompletion(failedJob);
      }
    }
  }

  /**
   * Handle job timeout
   */
  private async handleTimeout(jobId: string, proc: SpawnResult): Promise<void> {
    // Mark as timed out BEFORE killing (to prevent race condition)
    this.timedOutJobs.add(jobId);

    // Kill the process
    try {
      proc.kill();
    } catch {
      // Process may already be dead
    }

    this.runningJobs.delete(jobId);

    // Update job status
    const job = await readJob(jobId);
    if (!job) return;

    const timedOutJob = await updateJob(jobId, (j) => ({
      ...j,
      status: 'timeout' as JobStatus,
      completedAt: Date.now(),
      error: {
        code: 'JOB_TIMEOUT',
        message: `Job timed out after ${Math.round(j.timeoutMs / 1000)} seconds`,
      },
    }));

    if (timedOutJob) {
      this.notifyCompletion(timedOutJob);
    }
  }

  /**
   * Notify callbacks of job completion
   */
  private notifyCompletion(job: Job): void {
    const event: JobCompletedEvent = {
      jobId: job.id,
      status: job.status,
      connector: job.connectorName,
      summary: job.result?.content?.slice(0, 200) || job.error?.message || 'Job completed',
    };

    for (const callback of this.completionCallbacks) {
      try {
        callback(event);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<Job | null> {
    return readJob(jobId);
  }

  /**
   * Get job result, optionally waiting for completion
   */
  async getJobResult(jobId: string, waitMs?: number): Promise<Job | null> {
    const job = await readJob(jobId);
    if (!job) return null;

    // If already done, return immediately
    if (['completed', 'failed', 'timeout', 'cancelled'].includes(job.status)) {
      return job;
    }

    // If no wait requested, return current state
    if (!waitMs || waitMs <= 0) {
      return job;
    }

    // Poll for completion
    const startTime = Date.now();
    const pollInterval = 500; // 500ms

    while (Date.now() - startTime < waitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const currentJob = await readJob(jobId);
      if (!currentJob) return null;

      if (['completed', 'failed', 'timeout', 'cancelled'].includes(currentJob.status)) {
        return currentJob;
      }
    }

    // Return current state after timeout
    return readJob(jobId);
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = await readJob(jobId);
    if (!job) return false;

    // Can only cancel pending or running jobs
    if (!['pending', 'running'].includes(job.status)) {
      return false;
    }

    // Mark as cancelled BEFORE killing (to prevent race condition)
    this.cancelledJobs.add(jobId);

    // Kill process if running
    const running = this.runningJobs.get(jobId);
    if (running) {
      clearTimeout(running.timer);
      try {
        running.proc.kill();
      } catch {
        // Process may already be dead
      }
      this.runningJobs.delete(jobId);
    }

    // Update status
    const cancelled = await updateJob(jobId, (j) => ({
      ...j,
      status: 'cancelled' as JobStatus,
      completedAt: Date.now(),
      error: {
        code: 'JOB_CANCELLED',
        message: 'Job was cancelled by user',
      },
    }));

    if (cancelled) {
      this.notifyCompletion(cancelled);
    }

    return cancelled !== null;
  }

  /**
   * List jobs for current session
   */
  async listSessionJobs(): Promise<Job[]> {
    return listJobsForSession(this.sessionId);
  }

  /**
   * List running jobs
   */
  async listRunningJobs(): Promise<Job[]> {
    return listJobsByStatus('running');
  }

  /**
   * Clean up old jobs
   */
  async cleanup(): Promise<number> {
    const maxAge = this.config.maxJobAgeMs ?? DEFAULT_MAX_JOB_AGE_MS;
    return cleanupOldJobs(maxAge);
  }

  /**
   * Shutdown - cancel all running jobs for this session
   */
  async shutdown(): Promise<void> {
    for (const [jobId, running] of this.runningJobs) {
      // Mark as cancelled BEFORE killing (to prevent race condition)
      this.cancelledJobs.add(jobId);

      clearTimeout(running.timer);
      try {
        running.proc.kill();
      } catch {
        // Ignore
      }
      await updateJob(jobId, (j) => ({
        ...j,
        status: 'cancelled' as JobStatus,
        completedAt: Date.now(),
        error: {
          code: 'JOB_CANCELLED',
          message: 'Job was cancelled due to session shutdown',
        },
      }));
    }
    this.runningJobs.clear();
  }
}
