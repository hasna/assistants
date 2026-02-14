import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from '../tools/registry';
import type { JobManager } from './job-manager';
import { readJob, listJobsForSession, cleanupSessionJobs } from './job-store';

/**
 * Create job tools for the assistant
 */
export function createJobTools(getJobManager: () => JobManager | null): Array<{ tool: Tool; executor: ToolExecutor }> {
  return [
    {
      tool: jobStatusTool,
      executor: createJobStatusExecutor(getJobManager),
    },
    {
      tool: jobResultTool,
      executor: createJobResultExecutor(getJobManager),
    },
    {
      tool: jobCancelTool,
      executor: createJobCancelExecutor(getJobManager),
    },
    {
      tool: jobListTool,
      executor: createJobListExecutor(getJobManager),
    },
    {
      tool: jobClearTool,
      executor: createJobClearExecutor(getJobManager),
    },
  ];
}

/**
 * job_status - Check status of a background job
 */
const jobStatusTool: Tool = {
  name: 'job_status',
  description: 'Check the status of a background job. Returns the current status (pending, running, completed, failed, timeout, cancelled) and any available result or error.',
  parameters: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The ID of the job to check',
      },
    },
    required: ['job_id'],
  },
};

function createJobStatusExecutor(getJobManager: () => JobManager | null): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const manager = getJobManager();
    if (!manager) {
      return 'Jobs system is not enabled';
    }

    const jobId = input.job_id as string;
    if (!jobId) {
      return 'Error: job_id is required';
    }

    const job = await manager.getJobStatus(jobId);
    if (!job) {
      return `Job not found: ${jobId}`;
    }

    const parts: string[] = [
      `Job ID: ${job.id}`,
      `Status: ${job.status}`,
      `Connector: ${job.connectorName}`,
      `Command: ${job.command}`,
      `Created: ${new Date(job.createdAt).toISOString()}`,
    ];

    if (job.startedAt) {
      parts.push(`Started: ${new Date(job.startedAt).toISOString()}`);
    }

    if (job.completedAt) {
      parts.push(`Completed: ${new Date(job.completedAt).toISOString()}`);
      const duration = job.completedAt - (job.startedAt || job.createdAt);
      parts.push(`Duration: ${(duration / 1000).toFixed(1)}s`);
    }

    if (job.status === 'running') {
      const elapsed = Date.now() - (job.startedAt || job.createdAt);
      const remaining = job.timeoutMs - elapsed;
      parts.push(`Elapsed: ${(elapsed / 1000).toFixed(1)}s`);
      parts.push(`Timeout in: ${Math.max(0, remaining / 1000).toFixed(1)}s`);
    }

    if (job.result) {
      parts.push(`\nResult:\n${job.result.content}`);
    }

    if (job.error) {
      parts.push(`\nError (${job.error.code}): ${job.error.message}`);
    }

    return parts.join('\n');
  };
}

/**
 * job_result - Get result of a completed job (optionally wait)
 */
const jobResultTool: Tool = {
  name: 'job_result',
  description: 'Get the result of a background job. Optionally wait up to 30 seconds for the job to complete if still running.',
  parameters: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The ID of the job to get results from',
      },
      wait: {
        type: 'boolean',
        description: 'Whether to wait up to 30 seconds for the job to complete (default: false)',
        default: false,
      },
    },
    required: ['job_id'],
  },
};

function createJobResultExecutor(getJobManager: () => JobManager | null): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const manager = getJobManager();
    if (!manager) {
      return 'Jobs system is not enabled';
    }

    const jobId = input.job_id as string;
    if (!jobId) {
      return 'Error: job_id is required';
    }

    const wait = input.wait === true;
    const waitMs = wait ? 30_000 : 0;

    const job = await manager.getJobResult(jobId, waitMs);
    if (!job) {
      return `Job not found: ${jobId}`;
    }

    if (job.status === 'pending' || job.status === 'running') {
      return `Job is still ${job.status}. Use job_status to monitor or job_result with wait=true to wait for completion.`;
    }

    if (job.status === 'completed' && job.result) {
      return job.result.content;
    }

    if (job.error) {
      return `Job ${job.status}: ${job.error.message}`;
    }

    return `Job ${job.status}`;
  };
}

/**
 * job_cancel - Cancel a running job
 */
const jobCancelTool: Tool = {
  name: 'job_cancel',
  description: 'Cancel a running or pending background job.',
  parameters: {
    type: 'object',
    properties: {
      job_id: {
        type: 'string',
        description: 'The ID of the job to cancel',
      },
    },
    required: ['job_id'],
  },
};

function createJobCancelExecutor(getJobManager: () => JobManager | null): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const manager = getJobManager();
    if (!manager) {
      return 'Jobs system is not enabled';
    }

    const jobId = input.job_id as string;
    if (!jobId) {
      return 'Error: job_id is required';
    }

    const cancelled = await manager.cancelJob(jobId);
    if (cancelled) {
      return `Job ${jobId} has been cancelled`;
    }

    const job = await readJob(jobId);
    if (!job) {
      return `Job not found: ${jobId}`;
    }

    return `Cannot cancel job ${jobId}: status is ${job.status}`;
  };
}

/**
 * job_list - List jobs for current session
 */
const jobListTool: Tool = {
  name: 'job_list',
  description: 'List all background jobs for the current session.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status (pending, running, completed, failed, timeout, cancelled)',
        enum: ['pending', 'running', 'completed', 'failed', 'timeout', 'cancelled'],
      },
    },
  },
};

function createJobListExecutor(getJobManager: () => JobManager | null): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const manager = getJobManager();
    if (!manager) {
      return 'Jobs system is not enabled';
    }

    let jobs = await manager.listSessionJobs();

    const statusFilter = input.status as string | undefined;
    if (statusFilter) {
      jobs = jobs.filter((j) => j.status === statusFilter);
    }

    if (jobs.length === 0) {
      return statusFilter
        ? `No jobs with status '${statusFilter}'`
        : 'No jobs found';
    }

    // Sort by created time, newest first
    jobs.sort((a, b) => b.createdAt - a.createdAt);

    const lines: string[] = [`Found ${jobs.length} job(s):\n`];

    for (const job of jobs) {
      const age = formatAge(Date.now() - job.createdAt);
      let line = `[${job.status.toUpperCase()}] ${job.id} - ${job.connectorName} ${job.command} (${age} ago)`;

      if (job.status === 'running' && job.startedAt) {
        const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1);
        line += ` - running for ${elapsed}s`;
      }

      if (job.error) {
        line += ` - ${job.error.message.slice(0, 50)}`;
      }

      lines.push(line);
    }

    return lines.join('\n');
  };
}

/**
 * Format age as human-readable string
 */
function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * job_clear - Clear completed jobs for current session
 */
const jobClearTool: Tool = {
  name: 'job_clear',
  description: 'Clear completed, failed, timed out, or cancelled jobs for the current session. Running and pending jobs are not affected.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

function createJobClearExecutor(getJobManager: () => JobManager | null): ToolExecutor {
  return async (): Promise<string> => {
    const manager = getJobManager();
    if (!manager) {
      return 'Jobs system is not enabled';
    }

    const sessionId = manager.getSessionId();
    const cleaned = await cleanupSessionJobs(sessionId);

    if (cleaned === 0) {
      return 'No completed jobs to clear';
    }

    return `Cleared ${cleaned} completed job(s)`;
  };
}
