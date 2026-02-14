/**
 * Job status values
 */
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';

/**
 * Job result from a completed connector execution
 */
export interface JobResult {
  content: string;
  exitCode?: number;
}

/**
 * Job error information
 */
export interface JobError {
  code: string;
  message: string;
}

/**
 * A background job for long-running connector operations
 */
export interface Job {
  /** Generated job ID */
  id: string;
  /** Originating session ID */
  sessionId: string;
  /** Connector name (e.g., "browseruse") */
  connectorName: string;
  /** Command being executed */
  command: string;
  /** Original tool input */
  input: Record<string, unknown>;
  /** Current job status */
  status: JobStatus;
  /** Unix timestamp (ms) when job was created */
  createdAt: number;
  /** Unix timestamp (ms) when job started running */
  startedAt?: number;
  /** Unix timestamp (ms) when job completed */
  completedAt?: number;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Result if completed successfully */
  result?: JobResult;
  /** Error if failed or timed out */
  error?: JobError;
}

/**
 * Per-connector job configuration
 */
export interface ConnectorJobConfig {
  /** Whether async mode is enabled for this connector */
  enabled?: boolean;
  /** Custom timeout for this connector (ms) */
  timeoutMs?: number;
}

/**
 * Jobs system configuration (part of AssistantsConfig)
 */
export interface JobsConfig {
  /** Whether jobs system is enabled (default: true) */
  enabled?: boolean;
  /** Default timeout for jobs in ms (default: 60000 = 1 minute) */
  defaultTimeoutMs?: number;
  /** Maximum age for job files in ms (default: 86400000 = 24 hours) */
  maxJobAgeMs?: number;
  /** Per-connector configuration */
  connectors?: Record<string, ConnectorJobConfig>;
}

/**
 * Event emitted when a job completes
 */
export interface JobCompletedEvent {
  jobId: string;
  status: JobStatus;
  connector: string;
  summary: string;
}

/**
 * Callback for job completion notifications
 */
export type JobCompletionCallback = (event: JobCompletedEvent) => void;
