/**
 * Task types for the task queue management system
 */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type TaskPriority = 'high' | 'normal' | 'low';

/**
 * Recurrence configuration for recurring tasks
 */
export interface TaskRecurrence {
  /** Recurrence type: cron expression or interval */
  kind: 'cron' | 'interval';
  /** Cron expression (for kind: 'cron') e.g., '0 9 * * 1' (every Monday at 9am) */
  cron?: string;
  /** Interval in milliseconds (for kind: 'interval') */
  intervalMs?: number;
  /** Timezone for cron schedules (e.g., 'America/New_York') */
  timezone?: string;
  /** Maximum number of recurrences (undefined = unlimited) */
  maxOccurrences?: number;
  /** Current occurrence count */
  occurrenceCount?: number;
  /** End date for recurrence (undefined = never ends) */
  endAt?: number;
  /** ID of the parent recurring task (for generated instances) */
  parentId?: string;
}

/**
 * A task in the queue
 */
export interface Task {
  id: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  projectId?: string; // Optional association with project
  blockedBy?: string[]; // Task IDs that must complete before this task can start
  blocks?: string[]; // Task IDs that are blocked by this task
  assignee?: string; // Assistant or user assigned to this task
  /** Recurrence configuration for recurring tasks */
  recurrence?: TaskRecurrence;
  /** Whether this is a recurring task template (instances are created from it) */
  isRecurringTemplate?: boolean;
  /** Next scheduled run time for recurring tasks */
  nextRunAt?: number;
}

/**
 * Options for creating a new task
 */
export interface TaskCreateOptions {
  description: string;
  priority?: TaskPriority;
  projectId?: string;
  blockedBy?: string[];
  blocks?: string[];
  assignee?: string;
  /** Recurrence configuration for recurring tasks */
  recurrence?: {
    kind: 'cron' | 'interval';
    cron?: string;
    intervalMs?: number;
    timezone?: string;
    maxOccurrences?: number;
    endAt?: number;
  };
}

/**
 * The persisted task store data
 */
export interface TaskStoreData {
  tasks: Task[];
  paused: boolean;
  autoRun: boolean;
}

/**
 * Priority order for sorting (higher value = higher priority)
 */
export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};
