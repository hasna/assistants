import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { sleep } from '@hasna/assistants-shared';
import { ToolExecutionError, ErrorCodes } from '../errors';

const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (setTimeout safe range)

interface WaitInput {
  durationMs?: number;
  seconds?: number;
  minutes?: number;
  minSeconds?: number;
  maxSeconds?: number;
  minMinutes?: number;
  maxMinutes?: number;
  reason?: string;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}m ${secs}s`;
}

function pickRandom(min: number, max: number): number {
  if (max < min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resolveWaitMs(input: WaitInput): { ms: number; note?: string } {
  const durationMs = toNumber(input.durationMs);
  if (durationMs !== undefined) {
    return { ms: durationMs };
  }

  const seconds = toNumber(input.seconds);
  if (seconds !== undefined) {
    return { ms: seconds * 1000 };
  }

  const minutes = toNumber(input.minutes);
  if (minutes !== undefined) {
    return { ms: minutes * 60 * 1000 };
  }

  const minSeconds = toNumber(input.minSeconds);
  const maxSeconds = toNumber(input.maxSeconds);
  if (minSeconds !== undefined || maxSeconds !== undefined) {
    if (minSeconds === undefined || maxSeconds === undefined) {
      throw new Error('Both minSeconds and maxSeconds are required for a range.');
    }
    const chosen = pickRandom(Math.round(minSeconds), Math.round(maxSeconds));
    return {
      ms: chosen * 1000,
      note: `range ${Math.round(minSeconds)}-${Math.round(maxSeconds)}s`,
    };
  }

  const minMinutes = toNumber(input.minMinutes);
  const maxMinutes = toNumber(input.maxMinutes);
  if (minMinutes !== undefined || maxMinutes !== undefined) {
    if (minMinutes === undefined || maxMinutes === undefined) {
      throw new Error('Both minMinutes and maxMinutes are required for a range.');
    }
    const chosen = pickRandom(Math.round(minMinutes * 60), Math.round(maxMinutes * 60));
    return {
      ms: chosen * 1000,
      note: `range ${Math.round(minMinutes)}-${Math.round(maxMinutes)}m`,
    };
  }

  return { ms: 0 };
}

function buildWaitTool(name: 'wait' | 'sleep'): Tool {
  return {
    name,
    description: 'Pause execution for a duration. Use seconds/minutes or a range. Add timeoutMs if waiting longer than 60s.',
    parameters: {
      type: 'object',
      properties: {
        durationMs: {
          type: 'number',
          description: 'Exact duration in milliseconds.',
        },
        seconds: {
          type: 'number',
          description: 'Exact duration in seconds.',
        },
        minutes: {
          type: 'number',
          description: 'Exact duration in minutes.',
        },
        minSeconds: {
          type: 'number',
          description: 'Minimum seconds for random range.',
        },
        maxSeconds: {
          type: 'number',
          description: 'Maximum seconds for random range.',
        },
        minMinutes: {
          type: 'number',
          description: 'Minimum minutes for random range.',
        },
        maxMinutes: {
          type: 'number',
          description: 'Maximum minutes for random range.',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the wait.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Override tool timeout (should be >= wait duration).',
        },
      },
    },
  };
}

const executor: ToolExecutor = async (input) => {
  let waitMs = 0;
  let note: string | undefined;
  try {
    const resolved = resolveWaitMs(input as WaitInput);
    waitMs = resolved.ms;
    note = resolved.note;
  } catch (error) {
    throw new ToolExecutionError(error instanceof Error ? error.message : String(error), {
      toolName: 'wait',
      toolInput: input,
      code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
      recoverable: false,
      retryable: false,
      suggestion: 'Provide an exact duration or a valid min/max range.',
    });
  }

  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new ToolExecutionError('Wait duration must be a non-negative number.', {
      toolName: 'wait',
      toolInput: input,
      code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
      recoverable: false,
      retryable: false,
    });
  }

  if (waitMs > MAX_WAIT_MS) {
    throw new ToolExecutionError(`Wait duration exceeds max (${Math.round(MAX_WAIT_MS / 1000)}s).`, {
      toolName: 'wait',
      toolInput: input,
      code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
      recoverable: false,
      retryable: false,
      suggestion: 'Use a shorter wait or schedule the action instead.',
    });
  }

  await sleep(waitMs);

  const label = formatDuration(waitMs);
  const reason = typeof (input as WaitInput).reason === 'string' && (input as WaitInput).reason?.trim()
    ? ` (${(input as WaitInput).reason?.trim()})`
    : '';
  const rangeNote = note ? `, ${note}` : '';
  return `Waited ${label}${rangeNote}${reason}.`;
};

export class WaitTool {
  static readonly tool: Tool = buildWaitTool('wait');
  static readonly executor = executor;
}

export class SleepTool {
  static readonly tool: Tool = buildWaitTool('sleep');
  static readonly executor = executor;
}

export const __test__ = {
  resolveWaitMs,
};
