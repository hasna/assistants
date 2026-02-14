import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Job, JobsConfig } from '../src/jobs/types';
import {
  saveJob,
  readJob,
  deleteJob,
  listJobs,
  listJobsForSession,
  listJobsByStatus,
  updateJob,
  cleanupOldJobs,
  cleanupSessionJobs,
} from '../src/jobs/job-store';
import { JobManager } from '../src/jobs/job-manager';
import { createJobTools } from '../src/jobs/tools';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

// Mock the config dir for testing
const originalEnv = process.env.ASSISTANTS_DIR;

describe('Jobs System', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-jobs-'));
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();
    // Ensure jobs directory exists
    await mkdir(join(tempDir, 'jobs'), { recursive: true });
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Job Store', () => {
    test('save and read job', async () => {
      const job: Job = {
        id: 'test-job-1',
        sessionId: 'session-123',
        connectorName: 'browseruse',
        command: 'navigate',
        input: { url: 'https://example.com' },
        status: 'pending',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);
      const loaded = await readJob(job.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(job.id);
      expect(loaded!.connectorName).toBe('browseruse');
      expect(loaded!.command).toBe('navigate');
      expect(loaded!.status).toBe('pending');
    });

    test('list all jobs', async () => {
      const job1: Job = {
        id: 'job-1',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const job2: Job = {
        id: 'job-2',
        sessionId: 'session-2',
        connectorName: 'playwright',
        command: 'click',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job1);
      await saveJob(job2);

      const jobs = await listJobs();
      expect(jobs.length).toBe(2);
    });

    test('list jobs for session', async () => {
      const job1: Job = {
        id: 'job-1',
        sessionId: 'session-A',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const job2: Job = {
        id: 'job-2',
        sessionId: 'session-B',
        connectorName: 'playwright',
        command: 'click',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job1);
      await saveJob(job2);

      const sessionAJobs = await listJobsForSession('session-A');
      expect(sessionAJobs.length).toBe(1);
      expect(sessionAJobs[0].id).toBe('job-1');

      const sessionBJobs = await listJobsForSession('session-B');
      expect(sessionBJobs.length).toBe(1);
      expect(sessionBJobs[0].id).toBe('job-2');
    });

    test('list jobs by status', async () => {
      const job1: Job = {
        id: 'job-1',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const job2: Job = {
        id: 'job-2',
        sessionId: 'session-1',
        connectorName: 'playwright',
        command: 'click',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job1);
      await saveJob(job2);

      const runningJobs = await listJobsByStatus('running');
      expect(runningJobs.length).toBe(1);
      expect(runningJobs[0].id).toBe('job-2');

      const completedJobs = await listJobsByStatus('completed');
      expect(completedJobs.length).toBe(1);
      expect(completedJobs[0].id).toBe('job-1');
    });

    test('delete job', async () => {
      const job: Job = {
        id: 'job-to-delete',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);
      expect(await readJob(job.id)).not.toBeNull();

      const deleted = await deleteJob(job.id);
      expect(deleted).toBe(true);
      expect(await readJob(job.id)).toBeNull();
    });

    test('update job', async () => {
      const job: Job = {
        id: 'job-to-update',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'pending',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const updated = await updateJob(job.id, (j) => ({
        ...j,
        status: 'running',
        startedAt: Date.now(),
      }));

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('running');
      expect(updated!.startedAt).toBeDefined();
    });

    test('cleanup old jobs', async () => {
      const oldJob: Job = {
        id: 'old-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000, // 2 days ago
        timeoutMs: 60000,
      };

      const newJob: Job = {
        id: 'new-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'click',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(oldJob);
      await saveJob(newJob);

      // Clean up jobs older than 1 day
      const cleaned = await cleanupOldJobs(24 * 60 * 60 * 1000);
      expect(cleaned).toBe(1);

      // Old job should be deleted, new job should remain
      expect(await readJob('old-job')).toBeNull();
      expect(await readJob('new-job')).not.toBeNull();
    });

    test('cleanup session jobs', async () => {
      const completedJob: Job = {
        id: 'completed-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const runningJob: Job = {
        id: 'running-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'click',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const otherSessionJob: Job = {
        id: 'other-session-job',
        sessionId: 'session-2',
        connectorName: 'browseruse',
        command: 'type',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(completedJob);
      await saveJob(runningJob);
      await saveJob(otherSessionJob);

      const cleaned = await cleanupSessionJobs('session-1');
      expect(cleaned).toBe(1); // Only completed job from session-1

      // Running job should remain (not completed)
      expect(await readJob('running-job')).not.toBeNull();
      // Other session's job should remain
      expect(await readJob('other-session-job')).not.toBeNull();
      // Completed job should be deleted
      expect(await readJob('completed-job')).toBeNull();
    });

    test('rejects unsafe job ids', async () => {
      const badId = '../escape';
      const deleted = await deleteJob(badId);
      expect(deleted).toBe(false);

      const read = await readJob(badId);
      expect(read).toBeNull();
    });

    test('handles non-existent job', async () => {
      const read = await readJob('non-existent');
      expect(read).toBeNull();

      const deleted = await deleteJob('non-existent');
      expect(deleted).toBe(false);

      const updated = await updateJob('non-existent', (j) => j);
      expect(updated).toBeNull();
    });
  });

  describe('Job Manager', () => {
    test('isEnabled returns correct value', () => {
      const enabledManager = new JobManager({ enabled: true }, 'session-1');
      expect(enabledManager.isEnabled()).toBe(true);

      const disabledManager = new JobManager({ enabled: false }, 'session-1');
      expect(disabledManager.isEnabled()).toBe(false);

      const defaultManager = new JobManager({}, 'session-1');
      expect(defaultManager.isEnabled()).toBe(true); // Default is enabled
    });

    test('shouldRunAsync with explicit async flag', () => {
      const manager = new JobManager({}, 'session-1');

      // Explicit async=true
      expect(manager.shouldRunAsync('browseruse', { async: true })).toBe(true);

      // Explicit async=false overrides
      expect(manager.shouldRunAsync('browseruse', { async: false })).toBe(false);
    });

    test('shouldRunAsync with connector config', () => {
      const config: JobsConfig = {
        enabled: true,
        connectors: {
          browseruse: { enabled: true },
          playwright: { enabled: false },
        },
      };
      const manager = new JobManager(config, 'session-1');

      // browseruse is enabled in config
      expect(manager.shouldRunAsync('browseruse', {})).toBe(true);

      // playwright is disabled in config
      expect(manager.shouldRunAsync('playwright', {})).toBe(false);

      // unknown connector not in config
      expect(manager.shouldRunAsync('unknown', {})).toBe(false);
    });

    test('getTimeout returns correct values', () => {
      const config: JobsConfig = {
        defaultTimeoutMs: 30000,
        connectors: {
          browseruse: { timeoutMs: 300000 },
        },
      };
      const manager = new JobManager(config, 'session-1');

      // Connector-specific timeout
      expect(manager.getTimeout('browseruse')).toBe(300000);

      // Default timeout for unknown connector
      expect(manager.getTimeout('unknown')).toBe(30000);
    });

    test('getTimeout with no config', () => {
      const manager = new JobManager({}, 'session-1');

      // Should use hardcoded default (60000ms)
      expect(manager.getTimeout('browseruse')).toBe(60000);
    });

    test('listSessionJobs returns jobs for session', async () => {
      const manager = new JobManager({}, 'session-1');

      const job1: Job = {
        id: 'job-1',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      const job2: Job = {
        id: 'job-2',
        sessionId: 'session-2',
        connectorName: 'playwright',
        command: 'click',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job1);
      await saveJob(job2);

      const jobs = await manager.listSessionJobs();
      expect(jobs.length).toBe(1);
      expect(jobs[0].id).toBe('job-1');
    });

    test('getJobStatus returns job', async () => {
      const manager = new JobManager({}, 'session-1');

      const job: Job = {
        id: 'status-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const status = await manager.getJobStatus('status-job');
      expect(status).not.toBeNull();
      expect(status!.status).toBe('running');
    });

    test('getJobResult returns completed job immediately', async () => {
      const manager = new JobManager({}, 'session-1');

      const job: Job = {
        id: 'result-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        timeoutMs: 60000,
        result: { content: 'Success!' },
      };

      await saveJob(job);

      const result = await manager.getJobResult('result-job');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.result?.content).toBe('Success!');
    });

    test('cancelJob updates job status', async () => {
      const manager = new JobManager({}, 'session-1');

      const job: Job = {
        id: 'cancel-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'pending',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const cancelled = await manager.cancelJob('cancel-job');
      expect(cancelled).toBe(true);

      const updated = await readJob('cancel-job');
      expect(updated!.status).toBe('cancelled');
      expect(updated!.error?.code).toBe('JOB_CANCELLED');
    });

    test('cancelJob rejects already completed job', async () => {
      const manager = new JobManager({}, 'session-1');

      const job: Job = {
        id: 'completed-cancel-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const cancelled = await manager.cancelJob('completed-cancel-job');
      expect(cancelled).toBe(false);
    });

    test('onJobComplete callback is called', async () => {
      const manager = new JobManager({}, 'session-1');
      const events: Array<{ jobId: string; status: string }> = [];

      manager.onJobComplete((event) => {
        events.push({ jobId: event.jobId, status: event.status });
      });

      // Simulate a job completing by directly calling the callback mechanism
      // We'll test this indirectly through cancelJob which triggers notification
      const job: Job = {
        id: 'callback-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);
      await manager.cancelJob('callback-job');

      expect(events.length).toBe(1);
      expect(events[0].jobId).toBe('callback-job');
      expect(events[0].status).toBe('cancelled');
    });
  });

  describe('Job Tools', () => {
    test('createJobTools returns all tools', () => {
      const tools = createJobTools(() => null);
      expect(tools.length).toBe(5);

      const toolNames = tools.map((t) => t.tool.name);
      expect(toolNames).toContain('job_status');
      expect(toolNames).toContain('job_result');
      expect(toolNames).toContain('job_cancel');
      expect(toolNames).toContain('job_list');
      expect(toolNames).toContain('job_clear');
    });

    test('job_status tool returns job info', async () => {
      const manager = new JobManager({}, 'session-1');
      const tools = createJobTools(() => manager);
      const statusTool = tools.find((t) => t.tool.name === 'job_status')!;

      const job: Job = {
        id: 'tool-status-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'running',
        createdAt: Date.now(),
        startedAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const result = await statusTool.executor({ job_id: 'tool-status-job' });
      expect(result).toContain('Job ID: tool-status-job');
      expect(result).toContain('Status: running');
      expect(result).toContain('Connector: browseruse');
    });

    test('job_status tool handles missing job', async () => {
      const manager = new JobManager({}, 'session-1');
      const tools = createJobTools(() => manager);
      const statusTool = tools.find((t) => t.tool.name === 'job_status')!;

      const result = await statusTool.executor({ job_id: 'non-existent' });
      expect(result).toContain('Job not found');
    });

    test('job_result tool returns completed job result', async () => {
      const manager = new JobManager({}, 'session-1');
      const tools = createJobTools(() => manager);
      const resultTool = tools.find((t) => t.tool.name === 'job_result')!;

      const job: Job = {
        id: 'tool-result-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        timeoutMs: 60000,
        result: { content: 'Navigation successful!' },
      };

      await saveJob(job);

      const result = await resultTool.executor({ job_id: 'tool-result-job' });
      expect(result).toBe('Navigation successful!');
    });

    test('job_cancel tool cancels job', async () => {
      const manager = new JobManager({}, 'session-1');
      const tools = createJobTools(() => manager);
      const cancelTool = tools.find((t) => t.tool.name === 'job_cancel')!;

      const job: Job = {
        id: 'tool-cancel-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'pending',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const result = await cancelTool.executor({ job_id: 'tool-cancel-job' });
      expect(result).toContain('has been cancelled');

      const updated = await readJob('tool-cancel-job');
      expect(updated!.status).toBe('cancelled');
    });

    test('job_list tool lists jobs', async () => {
      const manager = new JobManager({}, 'session-1');
      const tools = createJobTools(() => manager);
      const listTool = tools.find((t) => t.tool.name === 'job_list')!;

      const job: Job = {
        id: 'tool-list-job',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'navigate',
        input: {},
        status: 'completed',
        createdAt: Date.now(),
        timeoutMs: 60000,
      };

      await saveJob(job);

      const result = await listTool.executor({});
      expect(result).toContain('Found 1 job(s)');
      expect(result).toContain('tool-list-job');
      expect(result).toContain('browseruse');
    });

    test('job tools handle disabled manager', async () => {
      const tools = createJobTools(() => null);
      const statusTool = tools.find((t) => t.tool.name === 'job_status')!;

      const result = await statusTool.executor({ job_id: 'any' });
      expect(result).toBe('Jobs system is not enabled');
    });
  });

  describe('Job with actual subprocess', () => {
    test('startJob creates and executes a simple job', async () => {
      const config: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 5000,
      };
      const manager = new JobManager(config, 'session-1');

      // Use 'echo' as a simple CLI that exists everywhere
      const job = await manager.startJob('test', 'hello', {}, 'echo');

      expect(job.id).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.connectorName).toBe('test');
      expect(job.command).toBe('hello');

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const completed = await manager.getJobStatus(job.id);
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
      expect(completed!.result?.content).toContain('hello');
    });

    test('job times out correctly', async () => {
      const config: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 50, // Very short timeout
      };
      const manager = new JobManager(config, 'session-1');

      // Use 'sleep' which takes longer than timeout (1 second)
      const job = await manager.startJob('test', '1', {}, 'sleep');

      // Wait for timeout to trigger (longer than 50ms but less than 1s)
      await new Promise((resolve) => setTimeout(resolve, 300));

      const timedOut = await manager.getJobStatus(job.id);
      expect(timedOut).not.toBeNull();
      // Job should be timed out or still running (if timeout hasn't kicked in yet)
      // The key is it shouldn't be 'completed'
      expect(['timeout', 'running', 'cancelled'].includes(timedOut!.status)).toBe(true);

      // Give more time for timeout to complete
      await new Promise((resolve) => setTimeout(resolve, 200));

      const finalStatus = await manager.getJobStatus(job.id);
      // Should be timed out by now
      expect(finalStatus!.status).toBe('timeout');
      expect(finalStatus!.error?.code).toBe('JOB_TIMEOUT');
    });

    test('job fails with non-zero exit code', async () => {
      const config: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 5000,
      };
      const manager = new JobManager(config, 'session-1');

      // Use 'false' command which always returns exit code 1
      const job = await manager.startJob('test', '', {}, 'false');

      // Wait for job to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const failed = await manager.getJobStatus(job.id);
      expect(failed).not.toBeNull();
      expect(failed!.status).toBe('failed');
    });
  });
});
