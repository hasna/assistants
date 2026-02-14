import type { Tool } from '@hasna/assistants-shared';
import {
  getTasks,
  resolveTaskId,
  addTask,
  getNextTask,
  startTask,
  completeTask,
  failTask,
  isPaused,
  getTaskCounts,
  getRecurringTasks,
  cancelRecurringTask,
  type Task,
  type TaskPriority,
} from '../tasks';

export interface TasksToolContext {
  cwd: string;
  projectId?: string;
}

/**
 * Tool for listing tasks in the queue
 */
export const tasksListTool: Tool = {
  name: 'tasks_list',
  description: 'List all tasks in the task queue with their status and priority',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status: pending, in_progress, completed, failed, or all (default: all)',
        enum: ['pending', 'in_progress', 'completed', 'failed', 'all'],
      },
    },
  },
};

/**
 * Tool for getting task details
 */
export const tasksGetTool: Tool = {
  name: 'tasks_get',
  description: 'Get details of a specific task by ID',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for adding a new task
 */
export const tasksAddTool: Tool = {
  name: 'tasks_add',
  description: 'Add a new task to the queue',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'The task description - what needs to be done',
      },
      priority: {
        type: 'string',
        description: 'Task priority: high, normal, or low (default: normal)',
        enum: ['high', 'normal', 'low'],
      },
      assignee: {
        type: 'string',
        description: 'Name or ID of person/assistant to assign this task to',
      },
    },
    required: ['description'],
  },
};

/**
 * Tool for getting the next pending task
 */
export const tasksNextTool: Tool = {
  name: 'tasks_next',
  description: 'Get the next pending task to work on (highest priority first)',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Tool for marking a task as completed
 */
export const tasksCompleteTool: Tool = {
  name: 'tasks_complete',
  description: 'Mark a task as completed with an optional result message',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
      result: {
        type: 'string',
        description: 'Optional result or summary of what was accomplished',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for marking a task as failed
 */
export const tasksFailTool: Tool = {
  name: 'tasks_fail',
  description: 'Mark a task as failed with an error message',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The task ID',
      },
      error: {
        type: 'string',
        description: 'The error message or reason for failure',
      },
    },
    required: ['id'],
  },
};

/**
 * Tool for checking queue status
 */
export const tasksStatusTool: Tool = {
  name: 'tasks_status',
  description: 'Get the current status of the task queue (counts by status, paused state)',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Tool for listing recurring tasks
 */
export const tasksRecurringListTool: Tool = {
  name: 'tasks_recurring_list',
  description: 'List all recurring task templates with their schedule and next run time',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Tool for adding a recurring task
 */
export const tasksRecurringAddTool: Tool = {
  name: 'tasks_recurring_add',
  description: 'Add a new recurring task that creates instances on a schedule',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'The task description - what needs to be done each time',
      },
      kind: {
        type: 'string',
        description: 'Recurrence type: "cron" for cron expression or "interval" for fixed intervals',
        enum: ['cron', 'interval'],
      },
      cron: {
        type: 'string',
        description: 'Cron expression (for kind: "cron"), e.g., "0 9 * * 1" for every Monday at 9am',
      },
      intervalMs: {
        type: 'number',
        description: 'Interval in milliseconds (for kind: "interval"), e.g., 86400000 for daily',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for cron schedules (e.g., "America/New_York")',
      },
      maxOccurrences: {
        type: 'number',
        description: 'Maximum number of times to run (optional, unlimited if not set)',
      },
      priority: {
        type: 'string',
        description: 'Task priority: high, normal, or low (default: normal)',
        enum: ['high', 'normal', 'low'],
      },
    },
    required: ['description', 'kind'],
  },
};

/**
 * Tool for cancelling a recurring task
 */
export const tasksRecurringCancelTool: Tool = {
  name: 'tasks_recurring_cancel',
  description: 'Cancel a recurring task, stopping future instances from being created',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The recurring task template ID to cancel',
      },
    },
    required: ['id'],
  },
};

/**
 * All task management tools
 */
export const taskTools: Tool[] = [
  tasksListTool,
  tasksGetTool,
  tasksAddTool,
  tasksNextTool,
  tasksCompleteTool,
  tasksFailTool,
  tasksStatusTool,
  tasksRecurringListTool,
  tasksRecurringAddTool,
  tasksRecurringCancelTool,
];

/**
 * Create tool executors for task management
 */
export function createTaskToolExecutors(context: TasksToolContext) {
  const formatTaskMatch = (task: Task): string => {
    const desc = task.description.length > 60
      ? `${task.description.slice(0, 60)}...`
      : task.description;
    return `${task.id} - ${desc}`;
  };

  const handleResolveError = (id: string, matches: Task[], label: string): string => {
    if (matches.length > 1) {
      const listed = matches.slice(0, 5).map(formatTaskMatch).join('\n');
      const more = matches.length > 5 ? `\n...and ${matches.length - 5} more` : '';
      return `Multiple ${label} match "${id}". Use a longer ID prefix.\n${listed}${more}`;
    }
    return `${label} not found: ${id}`;
  };

  return {
    tasks_list: async (input: { status?: string }) => {
      const tasks = await getTasks(context.cwd);
      const status = input.status || 'all';

      const filtered = status === 'all'
        ? tasks
        : tasks.filter((t) => t.status === status);

      if (filtered.length === 0) {
        return `No ${status === 'all' ? '' : status + ' '}tasks in queue.`;
      }

      const lines = filtered.map((t) => {
        const statusIcon = t.status === 'pending' ? '○' :
                          t.status === 'in_progress' ? '◐' :
                          t.status === 'completed' ? '●' : '✗';
        const priorityIcon = t.priority === 'high' ? '↑' :
                            t.priority === 'low' ? '↓' : '-';
        return `${statusIcon} [${priorityIcon}] ${t.id} - ${t.description}`;
      });

      return `Tasks (${filtered.length}):\n${lines.join('\n')}`;
    },

    tasks_get: async (input: { id: string }) => {
      const { task, matches } = await resolveTaskId(context.cwd, input.id);
      if (!task) {
        return handleResolveError(input.id, matches, 'Task');
      }

      const lines = [
        `ID: ${task.id}`,
        `Description: ${task.description}`,
        `Status: ${task.status}`,
        `Priority: ${task.priority}`,
        `Created: ${new Date(task.createdAt).toISOString()}`,
      ];

      if (task.startedAt) {
        lines.push(`Started: ${new Date(task.startedAt).toISOString()}`);
      }
      if (task.completedAt) {
        lines.push(`Completed: ${new Date(task.completedAt).toISOString()}`);
      }
      if (task.result) {
        lines.push(`Result: ${task.result}`);
      }
      if (task.error) {
        lines.push(`Error: ${task.error}`);
      }

      return lines.join('\n');
    },

    tasks_add: async (input: { description: string; priority?: string; assignee?: string }) => {
      const priority = (input.priority || 'normal') as TaskPriority;
      if (input.assignee) {
        const task = await addTask(context.cwd, {
          description: input.description,
          priority,
          projectId: context.projectId,
          assignee: input.assignee,
        });
        return `Task added: ${task.id}\nDescription: ${task.description}\nPriority: ${task.priority}\nAssignee: ${task.assignee}`;
      }
      const task = await addTask(context.cwd, input.description, priority, context.projectId);
      return `Task added: ${task.id}\nDescription: ${task.description}\nPriority: ${task.priority}`;
    },

    tasks_next: async () => {
      const paused = await isPaused(context.cwd);
      if (paused) {
        return 'Task queue is paused. No tasks will be auto-processed.';
      }

      const task = await getNextTask(context.cwd);
      if (!task) {
        return 'No pending tasks in queue.';
      }

      // Mark as started
      await startTask(context.cwd, task.id);

      return `Next task:\nID: ${task.id}\nPriority: ${task.priority}\nDescription: ${task.description}`;
    },

    tasks_complete: async (input: { id: string; result?: string }) => {
      const { task: resolved, matches } = await resolveTaskId(context.cwd, input.id);
      if (!resolved) {
        return handleResolveError(input.id, matches, 'Task');
      }
      const task = await completeTask(context.cwd, resolved.id, input.result);
      if (!task) {
        return `Task not found: ${input.id}`;
      }
      return `Task completed: ${task.id}${input.result ? `\nResult: ${input.result}` : ''}`;
    },

    tasks_fail: async (input: { id: string; error?: string }) => {
      const { task: resolved, matches } = await resolveTaskId(context.cwd, input.id);
      if (!resolved) {
        return handleResolveError(input.id, matches, 'Task');
      }
      const task = await failTask(context.cwd, resolved.id, input.error);
      if (!task) {
        return `Task not found: ${input.id}`;
      }
      return `Task marked as failed: ${task.id}${input.error ? `\nError: ${input.error}` : ''}`;
    },

    tasks_status: async () => {
      const counts = await getTaskCounts(context.cwd);
      const paused = await isPaused(context.cwd);

      const lines = [
        `Queue Status: ${paused ? 'Paused' : 'Active'}`,
        `Pending: ${counts.pending}`,
        `In Progress: ${counts.in_progress}`,
        `Completed: ${counts.completed}`,
        `Failed: ${counts.failed}`,
        `Total: ${counts.pending + counts.in_progress + counts.completed + counts.failed}`,
      ];

      return lines.join('\n');
    },

    tasks_recurring_list: async () => {
      const recurring = await getRecurringTasks(context.cwd);

      if (recurring.length === 0) {
        return 'No recurring tasks configured.';
      }

      const lines = recurring.map((t) => {
        const schedule = t.recurrence?.kind === 'cron'
          ? `cron: ${t.recurrence.cron}`
          : `interval: ${Math.round((t.recurrence?.intervalMs || 0) / 1000 / 60)}min`;
        const nextRun = t.nextRunAt
          ? new Date(t.nextRunAt).toISOString()
          : 'completed';
        const count = t.recurrence?.occurrenceCount ?? 0;
        const statusIcon = t.status === 'pending' ? '◐' : '●';
        return `${statusIcon} ${t.id} - ${t.description}\n   ${schedule} | next: ${nextRun} | runs: ${count}`;
      });

      return `Recurring Tasks (${recurring.length}):\n${lines.join('\n')}`;
    },

    tasks_recurring_add: async (input: {
      description: string;
      kind: 'cron' | 'interval';
      cron?: string;
      intervalMs?: number;
      timezone?: string;
      maxOccurrences?: number;
      priority?: string;
    }) => {
      if (input.kind === 'cron' && !input.cron) {
        return 'Error: cron expression required for kind: "cron"';
      }
      if (input.kind === 'interval' && !input.intervalMs) {
        return 'Error: intervalMs required for kind: "interval"';
      }

      const task = await addTask(context.cwd, {
        description: input.description,
        priority: (input.priority || 'normal') as TaskPriority,
        projectId: context.projectId,
        recurrence: {
          kind: input.kind,
          cron: input.cron,
          intervalMs: input.intervalMs,
          timezone: input.timezone,
          maxOccurrences: input.maxOccurrences,
        },
      });

      const schedule = task.recurrence?.kind === 'cron'
        ? `cron: ${task.recurrence.cron}`
        : `interval: ${Math.round((task.recurrence?.intervalMs || 0) / 1000 / 60)}min`;

      return `Recurring task created: ${task.id}\nDescription: ${task.description}\nSchedule: ${schedule}\nNext run: ${task.nextRunAt ? new Date(task.nextRunAt).toISOString() : 'calculating...'}`;
    },

    tasks_recurring_cancel: async (input: { id: string }) => {
      const { task: resolved, matches } = await resolveTaskId(
        context.cwd,
        input.id,
        (t) => t.isRecurringTemplate === true
      );
      if (!resolved) {
        return handleResolveError(input.id, matches, 'Recurring task');
      }
      const task = await cancelRecurringTask(context.cwd, resolved.id);
      if (!task) {
        return `Recurring task not found: ${input.id}`;
      }
      return `Recurring task cancelled: ${task.id}\nTotal runs completed: ${task.recurrence?.occurrenceCount ?? 0}`;
    },
  };
}

/**
 * Register task tools with a tool registry
 */
export function registerTaskTools(
  registry: { register: (tool: Tool, executor: (input: unknown) => Promise<string>) => void },
  context: TasksToolContext
): void {
  const executors = createTaskToolExecutors(context);

  for (const tool of taskTools) {
    const executor = executors[tool.name as keyof typeof executors];
    if (executor) {
      registry.register(tool, executor as (input: unknown) => Promise<string>);
    }
  }
}
