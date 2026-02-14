import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { getConfigDir } from '../config';
import type { HookEvent, HookOutput, HookHandler, HookInput } from '@hasna/assistants-shared';

const MAX_ENTRIES = 1000;

/**
 * Hook execution log entry
 */
export interface HookLogEntry {
  timestamp: string;
  session_id: string;
  hook_id: string;
  hook_name?: string;
  event: HookEvent;
  matcher?: string;
  input: HookInput;
  exit_code?: number;
  duration_ms: number;
  result: HookOutput | null;
  action_taken: 'allowed' | 'blocked' | 'modified' | 'skipped' | 'error';
  error?: string;
}

/**
 * Get the path to the hooks log file
 */
function getLogPath(): string {
  return join(getConfigDir(), 'logs', 'hooks.jsonl');
}

/**
 * Ensure the logs directory exists
 */
function ensureLogsDir(): void {
  const logsDir = join(getConfigDir(), 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

/**
 * Rotate log file if it exceeds MAX_ENTRIES
 */
function rotateIfNeeded(): void {
  const logPath = getLogPath();
  if (!existsSync(logPath)) return;

  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    if (lines.length > MAX_ENTRIES) {
      // Keep only the most recent entries
      const trimmed = lines.slice(-MAX_ENTRIES).join('\n') + '\n';
      writeFileSync(logPath, trimmed, 'utf-8');
    }
  } catch {
    // Ignore rotation errors
  }
}

/**
 * Hook execution logger - logs hook executions for debugging and auditing
 */
export class HookLogger {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Log a hook execution
   */
  log(entry: Omit<HookLogEntry, 'timestamp' | 'session_id'>): void {
    ensureLogsDir();

    const fullEntry: HookLogEntry = {
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      ...entry,
    };

    try {
      appendFileSync(getLogPath(), JSON.stringify(fullEntry) + '\n', 'utf-8');
      rotateIfNeeded();
    } catch {
      // Ignore logging errors
    }
  }

  /**
   * Create a log entry from hook execution
   */
  logExecution(
    hook: HookHandler,
    input: HookInput,
    result: HookOutput | null,
    durationMs: number,
    exitCode?: number,
    error?: string
  ): void {
    let actionTaken: HookLogEntry['action_taken'] = 'allowed';
    if (error) {
      actionTaken = 'error';
    } else if (hook.enabled === false) {
      actionTaken = 'skipped';
    } else if (result?.continue === false) {
      actionTaken = 'blocked';
    } else if (result?.updatedInput) {
      actionTaken = 'modified';
    }

    this.log({
      hook_id: hook.id || 'unknown',
      hook_name: hook.name,
      event: input.hook_event_name,
      input,
      exit_code: exitCode,
      duration_ms: durationMs,
      result,
      action_taken: actionTaken,
      error,
    });
  }

  /**
   * Get recent log entries
   */
  static getHistory(limit: number = 50, hookId?: string): HookLogEntry[] {
    const logPath = getLogPath();
    if (!existsSync(logPath)) return [];

    try {
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: HookLogEntry[] = [];

      // Parse in reverse order (most recent first)
      for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
        try {
          const entry = JSON.parse(lines[i]) as HookLogEntry;
          if (!hookId || entry.hook_id === hookId) {
            entries.push(entry);
          }
        } catch {
          // Skip malformed entries
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Clear all log entries
   */
  static clearHistory(): void {
    const logPath = getLogPath();
    if (existsSync(logPath)) {
      writeFileSync(logPath, '', 'utf-8');
    }
  }
}
