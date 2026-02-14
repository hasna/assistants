import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { ConnectorBridge } from '../src/tools/connector';
import { JobManager } from '../src/jobs/job-manager';
import { ToolRegistry } from '../src/tools/registry';
import type { JobsConfig } from '../src/jobs/types';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

// Mock the config dir for testing
const originalEnv = process.env.ASSISTANTS_DIR;

describe('Jobs Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-jobs-int-'));
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();
    // Ensure jobs and cache directories exist
    await mkdir(join(tempDir, 'jobs'), { recursive: true });
    await mkdir(join(tempDir, 'cache'), { recursive: true });
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalEnv;
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('ConnectorBridge with JobManager', () => {
    test('connector runs async when config enables it', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 5000,
        connectors: {
          echo: { enabled: true },
        },
      };

      const jobManager = new JobManager(jobConfig, 'test-session');
      const bridge = new ConnectorBridge(tempDir);

      // Set job manager on bridge
      bridge.setJobManagerGetter(() => jobManager);

      // Verify shouldRunAsync returns true for 'echo'
      expect(jobManager.shouldRunAsync('echo', {})).toBe(true);

      // Verify shouldRunAsync returns false for unconfigured connector
      expect(jobManager.shouldRunAsync('unknown', {})).toBe(false);
    });

    test('explicit async=true overrides config', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        connectors: {
          // 'test' not configured
        },
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      // Without explicit flag, unconfigured connector returns false
      expect(jobManager.shouldRunAsync('test', {})).toBe(false);

      // With explicit async=true, it should return true
      expect(jobManager.shouldRunAsync('test', { async: true })).toBe(true);
    });

    test('explicit async=false overrides config', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        connectors: {
          browseruse: { enabled: true },
        },
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      // Config enables it
      expect(jobManager.shouldRunAsync('browseruse', {})).toBe(true);

      // Explicit async=false overrides
      expect(jobManager.shouldRunAsync('browseruse', { async: false })).toBe(false);
    });

    test('disabled jobs system prevents async', async () => {
      const jobConfig: JobsConfig = {
        enabled: false,
        connectors: {
          browseruse: { enabled: true },
        },
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      // Even though connector is configured, system is disabled
      expect(jobManager.shouldRunAsync('browseruse', {})).toBe(false);

      // Even explicit async=true doesn't work
      expect(jobManager.shouldRunAsync('browseruse', { async: true })).toBe(false);
    });
  });

  describe('Job completion notifications', () => {
    test('notifications are sent when jobs complete', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 5000,
      };

      const jobManager = new JobManager(jobConfig, 'test-session');
      const notifications: Array<{ jobId: string; status: string; connector: string }> = [];

      jobManager.onJobComplete((event) => {
        notifications.push({
          jobId: event.jobId,
          status: event.status,
          connector: event.connector,
        });
      });

      // Start a job with 'echo' (should complete quickly)
      const job = await jobManager.startJob('test-connector', 'hello world', {}, 'echo');

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check notification was received
      expect(notifications.length).toBe(1);
      expect(notifications[0].jobId).toBe(job.id);
      expect(notifications[0].status).toBe('completed');
      expect(notifications[0].connector).toBe('test-connector');
    });

    test('multiple callbacks are all called', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 5000,
      };

      const jobManager = new JobManager(jobConfig, 'test-session');
      const callback1Results: string[] = [];
      const callback2Results: string[] = [];

      jobManager.onJobComplete((event) => {
        callback1Results.push(event.jobId);
      });

      jobManager.onJobComplete((event) => {
        callback2Results.push(event.status);
      });

      const job = await jobManager.startJob('test', 'test', {}, 'echo');

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(callback1Results.length).toBe(1);
      expect(callback1Results[0]).toBe(job.id);
      expect(callback2Results.length).toBe(1);
      expect(callback2Results[0]).toBe('completed');
    });
  });

  describe('Job manager cleanup', () => {
    test('cleanup removes old completed jobs', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        maxJobAgeMs: 100, // Very short for testing
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      // Create and wait for a job to complete
      const job = await jobManager.startJob('test', 'done', {}, 'echo');
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify job exists
      let status = await jobManager.getJobStatus(job.id);
      expect(status).not.toBeNull();

      // Wait for job to become "old"
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Clean up
      const cleaned = await jobManager.cleanup();
      expect(cleaned).toBe(1);

      // Verify job is gone
      status = await jobManager.getJobStatus(job.id);
      expect(status).toBeNull();
    });

    test('shutdown cancels running jobs', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 10000, // Long timeout
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      // Start a long-running job
      const job = await jobManager.startJob('test', '5', {}, 'sleep');

      // Small delay to ensure job started
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Shutdown
      await jobManager.shutdown();

      // Wait a bit for status update
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Job should be cancelled
      const status = await jobManager.getJobStatus(job.id);
      expect(status).not.toBeNull();
      expect(status!.status).toBe('cancelled');
    });
  });

  describe('Per-connector timeout configuration', () => {
    test('uses connector-specific timeout', async () => {
      const jobConfig: JobsConfig = {
        enabled: true,
        defaultTimeoutMs: 1000,
        connectors: {
          browseruse: { enabled: true, timeoutMs: 300000 }, // 5 minutes
          playwright: { enabled: true, timeoutMs: 180000 }, // 3 minutes
        },
      };

      const jobManager = new JobManager(jobConfig, 'test-session');

      expect(jobManager.getTimeout('browseruse')).toBe(300000);
      expect(jobManager.getTimeout('playwright')).toBe(180000);
      expect(jobManager.getTimeout('unknown')).toBe(1000); // Falls back to default
    });
  });
});
