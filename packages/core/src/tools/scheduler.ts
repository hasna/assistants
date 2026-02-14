import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { generateId } from '@hasna/assistants-shared';
import type { ScheduledCommand } from '@hasna/assistants-shared';
import {
  listSchedules,
  saveSchedule,
  deleteSchedule,
  updateSchedule,
  readSchedule,
  computeNextRun,
  isValidTimeZone,
} from '../scheduler/store';

export interface SchedulerContext {
  sessionId?: string;
  cwd: string;
}

const schedulerTool: Tool = {
  name: 'schedule',
  description: 'Create and manage scheduled commands (once, cron, or random interval). Schedules are scoped to the current session by default.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: create, list, delete, pause, resume',
        enum: ['create', 'list', 'delete', 'pause', 'resume'],
      },
      command: {
        type: 'string',
        description: 'Command to schedule (required for create)',
      },
      at: {
        type: 'string',
        description: 'ISO 8601 timestamp for a one-time schedule',
      },
      cron: {
        type: 'string',
        description: 'Cron expression for recurring schedule (5 fields)',
      },
      startImmediately: {
        type: 'boolean',
        description: 'For recurring schedules (cron, interval, random), run once immediately after the current turn ends.',
      },
      minInterval: {
        type: 'number',
        description: 'Minimum interval for random scheduling (e.g., 1)',
      },
      maxInterval: {
        type: 'number',
        description: 'Maximum interval for random scheduling (e.g., 20)',
      },
      unit: {
        type: 'string',
        description: 'Time unit for interval/random scheduling: seconds, minutes, or hours',
        enum: ['seconds', 'minutes', 'hours'],
      },
      every: {
        type: 'number',
        description: 'Fixed interval for recurring schedule (e.g., every: 15 with unit: "seconds" = every 15 seconds). Minimum 1 second.',
      },
      timezone: {
        type: 'string',
        description: 'IANA timezone name (optional, best-effort)',
      },
      description: {
        type: 'string',
        description: 'Optional description for this schedule',
      },
      actionType: {
        type: 'string',
        description: 'Type of action: "command" runs the command, "message" injects custom message into assistant session. Default: "command"',
        enum: ['command', 'message'],
      },
      message: {
        type: 'string',
        description: 'Custom message to inject when actionType is "message"',
      },
      global: {
        type: 'boolean',
        description: 'When listing: show all schedules across sessions. When creating: create a global schedule not scoped to any session.',
      },
      id: {
        type: 'string',
        description: 'Schedule id (for delete/pause/resume)',
      },
      cwd: {
        type: 'string',
        description: 'Project working directory (optional)',
      },
    },
    required: ['action'],
  },
};

function createSchedulerExecutor(getContext: () => SchedulerContext): ToolExecutor {
  return async (input) => {
    const ctx = getContext();
    const action = String(input.action || '');
    const cwd = (input.cwd as string) || ctx.cwd || process.cwd();
    const now = Date.now();
    const isGlobal = input.global === true;

    if (action === 'list') {
      const schedules = await listSchedules(cwd, {
        sessionId: ctx.sessionId,
        global: isGlobal,
      });
      if (schedules.length === 0) return 'No schedules found.';
      const rows = schedules
        .sort((a, b) => (a.nextRunAt || 0) - (b.nextRunAt || 0))
        .map((s) => {
          const next = s.nextRunAt ? new Date(s.nextRunAt).toISOString() : 'n/a';
          let scheduleInfo = '';
          if (s.schedule.kind === 'interval' && s.schedule.interval) {
            scheduleInfo = ` (every ${s.schedule.interval} ${s.schedule.unit || 'minutes'})`;
          } else if (s.schedule.kind === 'random' && s.schedule.minInterval && s.schedule.maxInterval) {
            scheduleInfo = ` (random: ${s.schedule.minInterval}-${s.schedule.maxInterval} ${s.schedule.unit || 'minutes'})`;
          } else if (s.schedule.kind === 'cron' && s.schedule.cron) {
            scheduleInfo = ` (cron: ${s.schedule.cron})`;
          }
          const scope = s.sessionId ? ` [session]` : ' [global]';
          return `- ${s.id} [${s.status}]${scope} ${s.command}${scheduleInfo} (next: ${next})`;
        });
      return rows.join('\n');
    }

    if (action === 'create') {
      const command = String(input.command || '').trim();
      const actionType = input.actionType as 'command' | 'message' | undefined;
      const message = input.message as string | undefined;

      // Validate command/message based on actionType
      if (actionType === 'message') {
        // For message type, require message and allow empty command
        if (!message?.trim()) {
          return 'Error: message is required when actionType is "message".';
        }
      } else {
        // For command type (default), require command
        if (!command) {
          return 'Error: command is required.';
        }
      }

      const at = input.at as string | undefined;
      const cron = input.cron as string | undefined;
      const minInterval = input.minInterval as number | undefined;
      const maxInterval = input.maxInterval as number | undefined;
      const every = input.every as number | undefined;
      const unit = input.unit as 'seconds' | 'minutes' | 'hours' | undefined;
      const startImmediately = input.startImmediately === true;

      // Validate that at least one scheduling method is provided
      const hasRandom = minInterval !== undefined && maxInterval !== undefined;
      const hasInterval = every !== undefined;
      if (!at && !cron && !hasRandom && !hasInterval) {
        return 'Error: provide at (ISO time), cron, every (fixed interval), or minInterval+maxInterval for random scheduling.';
      }

      // Validate interval parameter
      if (hasInterval) {
        if (every <= 0) {
          return 'Error: every must be a positive number.';
        }
        // Minimum 1 second to prevent abuse
        const effectiveUnit = unit || 'minutes';
        const intervalSeconds = effectiveUnit === 'seconds' ? every : effectiveUnit === 'hours' ? every * 3600 : every * 60;
        if (intervalSeconds < 1) {
          return 'Error: minimum interval is 1 second.';
        }
      }

      // Validate random interval parameters
      if (hasRandom) {
        if (minInterval <= 0 || maxInterval <= 0) {
          return 'Error: minInterval and maxInterval must be positive numbers.';
        }
        if (minInterval > maxInterval) {
          return 'Error: minInterval cannot be greater than maxInterval.';
        }
      }

      const timezone = input.timezone as string | undefined;
      if (timezone && !isValidTimeZone(timezone)) {
        return `Error: invalid timezone "${timezone}".`;
      }

      // Determine schedule kind
      let scheduleKind: 'once' | 'cron' | 'random' | 'interval';
      if (hasInterval) {
        scheduleKind = 'interval';
      } else if (hasRandom) {
        scheduleKind = 'random';
      } else if (cron) {
        scheduleKind = 'cron';
      } else {
        scheduleKind = 'once';
      }

      // Auto-inject sessionId unless creating a global schedule
      const sessionId = isGlobal ? undefined : ctx.sessionId;

      const schedule: ScheduledCommand = {
        id: generateId(),
        createdAt: now,
        updatedAt: now,
        createdBy: 'assistant',
        sessionId,
        actionType: actionType || 'command',
        command,
        message: actionType === 'message' ? message : undefined,
        description: input.description as string | undefined,
        status: 'active',
        schedule: {
          kind: scheduleKind,
          at,
          cron,
          timezone,
          minInterval: hasRandom ? minInterval : undefined,
          maxInterval: hasRandom ? maxInterval : undefined,
          unit: (hasRandom || hasInterval) ? (unit || 'minutes') : undefined,
          interval: hasInterval ? every : undefined,
        },
      };
      const isRecurring = scheduleKind !== 'once';
      schedule.nextRunAt = startImmediately && isRecurring
        ? now
        : computeNextRun(schedule, now);
      if (!schedule.nextRunAt) {
        return 'Error: unable to compute next run for schedule.';
      }
      await saveSchedule(cwd, schedule);
      const scopeLabel = sessionId ? ' (session-scoped)' : ' (global)';
      if (scheduleKind === 'interval') {
        return `Scheduled ${schedule.command} (${schedule.id}) every ${every} ${unit || 'minutes'}${scopeLabel}, next run: ${new Date(schedule.nextRunAt).toISOString()}`;
      }
      if (scheduleKind === 'random') {
        return `Scheduled ${schedule.command} (${schedule.id}) randomly every ${minInterval}-${maxInterval} ${unit || 'minutes'}${scopeLabel}, next run: ${new Date(schedule.nextRunAt).toISOString()}`;
      }
      return `Scheduled ${schedule.command} (${schedule.id}) for ${new Date(schedule.nextRunAt).toISOString()}${scopeLabel}`;
    }

    if (action === 'delete') {
      const id = String(input.id || '').trim();
      if (!id) return 'Error: id is required.';

      // Check ownership before deleting
      const schedule = await readSchedule(cwd, id);
      if (!schedule) return `Schedule ${id} not found.`;

      // Only allow deleting if:
      // 1. The schedule belongs to the current session, OR
      // 2. The schedule is global (no sessionId), OR
      // 3. The current session has no sessionId (legacy/admin mode)
      if (schedule.sessionId && ctx.sessionId && schedule.sessionId !== ctx.sessionId) {
        return `Error: cannot delete schedule ${id} - it belongs to a different session.`;
      }

      const ok = await deleteSchedule(cwd, id);
      return ok ? `Deleted schedule ${id}.` : `Schedule ${id} not found.`;
    }

    if (action === 'pause' || action === 'resume') {
      const id = String(input.id || '').trim();
      if (!id) return 'Error: id is required.';

      const schedule = await readSchedule(cwd, id);
      if (!schedule) return `Schedule ${id} not found.`;

      // Check ownership before modifying
      if (schedule.sessionId && ctx.sessionId && schedule.sessionId !== ctx.sessionId) {
        return `Error: cannot ${action} schedule ${id} - it belongs to a different session.`;
      }

      let nextRunAt: number | undefined;
      if (action === 'resume') {
        nextRunAt = computeNextRun(schedule, Date.now());
        if (!nextRunAt) {
          return `Error: unable to compute next run for schedule ${id}.`;
        }
      }
      const updated = await updateSchedule(cwd, id, (s) => ({
        ...s,
        status: action === 'pause' ? 'paused' : 'active',
        updatedAt: Date.now(),
        nextRunAt: action === 'resume' ? nextRunAt : s.nextRunAt,
      }));
      if (!updated) return `Schedule ${id} not found.`;
      return `${action === 'pause' ? 'Paused' : 'Resumed'} schedule ${id}.`;
    }

    return `Error: unknown action "${action}".`;
  };
}

/**
 * Create scheduler tool with context
 * This function creates the scheduler tool with a context getter for session-scoped schedules
 */
export function createSchedulerTool(
  getContext: () => SchedulerContext
): { tool: Tool; executor: ToolExecutor } {
  return {
    tool: schedulerTool,
    executor: createSchedulerExecutor(getContext),
  };
}

/**
 * Register scheduler tools with the tool registry
 */
export function registerSchedulerTools(
  registry: ToolRegistry,
  getContext: () => SchedulerContext
): void {
  const { tool, executor } = createSchedulerTool(getContext);
  registry.register(tool, executor);
}

// Legacy static class for backwards compatibility (without session scoping)
export class SchedulerTool {
  static readonly tool: Tool = schedulerTool;

  static readonly executor: ToolExecutor = createSchedulerExecutor(() => ({
    cwd: process.cwd(),
    sessionId: undefined,
  }));
}
