/**
 * Logs Tools
 *
 * Read-only tools for querying security events, hook execution history,
 * and session logs. Provides the assistant with programmatic access to
 * all log sources for debugging, error detection, and security reporting.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { SecurityLogger } from '../security/logger';
import type { Severity } from '../security/types';
import { Logger, type LogLevel } from '../logger';
import { HookLogger, type HookLogEntry } from '../hooks/logger';

// ============================================
// Types
// ============================================

export type LogSource = 'security' | 'hooks' | 'session' | 'all';

export interface LogsToolContext {
  sessionId: string;
}

export interface NormalizedLogEntry {
  timestamp: string;
  source: 'security' | 'hooks' | 'session';
  level: 'debug' | 'info' | 'warn' | 'error' | 'critical';
  message: string;
  sessionId?: string;
  details: Record<string, unknown>;
}

// ============================================
// Helpers
// ============================================

/**
 * Parse relative time strings like "1h", "30m", "2d" into ISO timestamps.
 */
function parseSince(since: string): string {
  // Already an ISO timestamp
  if (since.includes('T') || since.includes('-')) return since;

  const match = since.match(/^(\d+)([smhd])$/);
  if (!match) return since;

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = Date.now();
  const ms: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(now - value * (ms[unit] || 0)).toISOString();
}

/**
 * Map security severity to normalized level.
 */
function securitySeverityToLevel(severity: Severity): NormalizedLogEntry['level'] {
  switch (severity) {
    case 'critical': return 'critical';
    case 'high': return 'error';
    case 'medium': return 'warn';
    case 'low': return 'info';
    default: return 'info';
  }
}

/**
 * Map hook action to normalized level.
 */
function hookActionToLevel(action: HookLogEntry['action_taken']): NormalizedLogEntry['level'] {
  switch (action) {
    case 'error': return 'error';
    case 'blocked': return 'warn';
    case 'modified': return 'info';
    case 'skipped': return 'debug';
    case 'allowed': return 'info';
    default: return 'info';
  }
}

/**
 * Fetch and normalize entries from all sources.
 */
function fetchNormalizedEntries(options: {
  source: LogSource;
  sessionId?: string;
  severity?: Severity;
  eventType?: string;
  level?: LogLevel;
  since?: string;
  limit?: number;
  offset?: number;
}): NormalizedLogEntry[] {
  const entries: NormalizedLogEntry[] = [];
  const source = options.source || 'all';
  const sinceTs = options.since ? parseSince(options.since) : undefined;

  // Security logs
  if (source === 'security' || source === 'all') {
    const securityEvents = SecurityLogger.readPersistedEvents({
      severity: options.severity,
      eventType: options.eventType,
      sessionId: options.sessionId,
      since: sinceTs,
    });

    for (const event of securityEvents) {
      entries.push({
        timestamp: event.timestamp,
        source: 'security',
        level: securitySeverityToLevel(event.severity),
        message: `[${event.eventType}] ${event.details.reason}`,
        sessionId: event.sessionId,
        details: {
          eventType: event.eventType,
          severity: event.severity,
          tool: event.details.tool,
          command: event.details.command,
          path: event.details.path,
        },
      });
    }
  }

  // Hook logs
  if (source === 'hooks' || source === 'all') {
    const hookEntries = HookLogger.getHistory(500);

    for (const entry of hookEntries) {
      if (options.sessionId && entry.session_id !== options.sessionId) continue;
      if (sinceTs && entry.timestamp < sinceTs) continue;

      entries.push({
        timestamp: entry.timestamp,
        source: 'hooks',
        level: hookActionToLevel(entry.action_taken),
        message: `[${entry.event}] ${entry.hook_name || entry.hook_id}: ${entry.action_taken}${entry.error ? ` - ${entry.error}` : ''}`,
        sessionId: entry.session_id,
        details: {
          hookId: entry.hook_id,
          hookName: entry.hook_name,
          event: entry.event,
          matcher: entry.matcher,
          actionTaken: entry.action_taken,
          durationMs: entry.duration_ms,
          exitCode: entry.exit_code,
          error: entry.error,
        },
      });
    }
  }

  // Session logs
  if (source === 'session' || source === 'all') {
    const sessionEntries = Logger.readEntries({
      sessionId: options.sessionId,
      level: options.level,
      since: sinceTs,
    });

    for (const entry of sessionEntries) {
      entries.push({
        timestamp: entry.timestamp,
        source: 'session',
        level: entry.level,
        message: entry.message,
        sessionId: entry.sessionId,
        details: entry.data != null ? { data: entry.data } : {},
      });
    }
  }

  // Sort by timestamp descending
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const offset = options.offset ?? 0;
  const limit = options.limit ?? 50;
  return entries.slice(offset, offset + limit);
}

// ============================================
// Tool Definitions
// ============================================

export const logsQueryTool: Tool = {
  name: 'logs_query',
  description: 'Query log entries with filtering and pagination across security, hooks, and session logs. Use this to investigate errors, debug problems, and review security posture.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['security', 'hooks', 'session', 'all'],
        description: 'Log source to query (default: "all")',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter security logs by severity',
      },
      eventType: {
        type: 'string',
        enum: ['blocked_command', 'path_violation', 'validation_failure'],
        description: 'Filter by security event type',
      },
      level: {
        type: 'string',
        enum: ['debug', 'info', 'warn', 'error'],
        description: 'Minimum log level for session logs',
      },
      sessionOnly: {
        type: 'boolean',
        description: 'Only show entries from the current session (default: true)',
      },
      since: {
        type: 'string',
        description: 'Time filter - ISO timestamp or relative ("1h", "30m", "2d")',
      },
      limit: {
        type: 'number',
        description: 'Maximum entries to return (default: 50, max: 200)',
      },
      offset: {
        type: 'number',
        description: 'Pagination offset',
      },
    },
    required: [],
  },
};

export const logsStatsTool: Tool = {
  name: 'logs_stats',
  description: 'Get aggregated statistics across log sources: counts by severity/type, top hooks, recent errors. Quick overview of system health.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        enum: ['security', 'hooks', 'session', 'all'],
        description: 'Log source to analyze (default: "all")',
      },
      sessionOnly: {
        type: 'boolean',
        description: 'Only analyze current session entries (default: true)',
      },
      since: {
        type: 'string',
        description: 'Time filter - ISO timestamp or relative ("1h", "30m", "2d")',
      },
    },
    required: [],
  },
};

export const logsSearchTool: Tool = {
  name: 'logs_search',
  description: 'Full-text search across all log types. Case-insensitive search matching message, reason, tool name, hook name, and error fields.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search text (case-insensitive)',
      },
      source: {
        type: 'string',
        enum: ['security', 'hooks', 'session', 'all'],
        description: 'Log source to search (default: "all")',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 50, max: 200)',
      },
    },
    required: ['query'],
  },
};

export const logsTailTool: Tool = {
  name: 'logs_tail',
  description: 'Get the most recent N log entries. Quick "tail -f" style view of recent activity.',
  parameters: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'Number of entries (default: 10, max: 50)',
      },
      source: {
        type: 'string',
        enum: ['security', 'hooks', 'session', 'all'],
        description: 'Log source to tail (default: "all")',
      },
    },
    required: [],
  },
};

export const logsTools: Tool[] = [
  logsQueryTool,
  logsStatsTool,
  logsSearchTool,
  logsTailTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createLogsToolExecutors(
  context: LogsToolContext
): Record<string, ToolExecutor> {
  return {
    logs_query: async (input: Record<string, unknown>): Promise<string> => {
      const sessionOnly = input.sessionOnly !== false;
      const limit = Math.min(200, Math.max(1, typeof input.limit === 'number' ? input.limit : 50));
      const offset = typeof input.offset === 'number' ? Math.max(0, input.offset) : 0;

      const entries = fetchNormalizedEntries({
        source: (input.source as LogSource) || 'all',
        sessionId: sessionOnly ? context.sessionId : undefined,
        severity: input.severity as Severity | undefined,
        eventType: input.eventType as string | undefined,
        level: input.level as LogLevel | undefined,
        since: input.since as string | undefined,
        limit,
        offset,
      });

      return JSON.stringify({
        success: true,
        total: entries.length,
        offset,
        limit,
        sessionOnly,
        entries,
      });
    },

    logs_stats: async (input: Record<string, unknown>): Promise<string> => {
      const sessionOnly = input.sessionOnly !== false;
      const sinceTs = input.since ? parseSince(input.since as string) : undefined;
      const sessionId = sessionOnly ? context.sessionId : undefined;

      // Fetch a large batch to compute stats
      const entries = fetchNormalizedEntries({
        source: (input.source as LogSource) || 'all',
        sessionId,
        since: sinceTs,
        limit: 1000,
      });

      // Counts per source
      const bySource: Record<string, number> = { security: 0, hooks: 0, session: 0 };
      // Counts per level
      const byLevel: Record<string, number> = { debug: 0, info: 0, warn: 0, error: 0, critical: 0 };
      // Security event types
      const byEventType: Record<string, number> = {};
      // Hook names
      const hookCounts: Record<string, number> = {};
      // Recent errors
      const recentErrors: Array<{ timestamp: string; source: string; message: string }> = [];

      for (const entry of entries) {
        bySource[entry.source] = (bySource[entry.source] || 0) + 1;
        byLevel[entry.level] = (byLevel[entry.level] || 0) + 1;

        if (entry.source === 'security' && entry.details.eventType) {
          const et = entry.details.eventType as string;
          byEventType[et] = (byEventType[et] || 0) + 1;
        }

        if (entry.source === 'hooks' && entry.details.hookName) {
          const hn = entry.details.hookName as string;
          hookCounts[hn] = (hookCounts[hn] || 0) + 1;
        }

        if ((entry.level === 'error' || entry.level === 'critical') && recentErrors.length < 5) {
          recentErrors.push({
            timestamp: entry.timestamp,
            source: entry.source,
            message: entry.message,
          });
        }
      }

      // Top 5 hooks by execution count
      const topHooks = Object.entries(hookCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      return JSON.stringify({
        success: true,
        total: entries.length,
        sessionOnly,
        bySource,
        byLevel,
        byEventType: Object.keys(byEventType).length > 0 ? byEventType : null,
        topHooks: topHooks.length > 0 ? topHooks : null,
        recentErrors: recentErrors.length > 0 ? recentErrors : null,
        status:
          byLevel.critical > 0 ? 'critical issues detected' :
          byLevel.error > 0 ? 'errors detected' :
          byLevel.warn > 0 ? 'warnings present' :
          entries.length > 0 ? 'healthy' : 'no log entries',
      });
    },

    logs_search: async (input: Record<string, unknown>): Promise<string> => {
      const query = (input.query as string || '').toLowerCase();
      if (!query) {
        return JSON.stringify({ success: false, error: 'query parameter is required' });
      }

      const limit = Math.min(200, Math.max(1, typeof input.limit === 'number' ? input.limit : 50));

      // Fetch a large set to search through
      const allEntries = fetchNormalizedEntries({
        source: (input.source as LogSource) || 'all',
        limit: 1000,
      });

      const matches: NormalizedLogEntry[] = [];
      for (const entry of allEntries) {
        if (matches.length >= limit) break;

        // Search across message and detail values
        const searchable = [
          entry.message,
          ...Object.values(entry.details).map(v => String(v ?? '')),
        ].join(' ').toLowerCase();

        if (searchable.includes(query)) {
          matches.push(entry);
        }
      }

      return JSON.stringify({
        success: true,
        query: input.query,
        total: matches.length,
        entries: matches,
      });
    },

    logs_tail: async (input: Record<string, unknown>): Promise<string> => {
      const count = Math.min(50, Math.max(1, typeof input.count === 'number' ? input.count : 10));

      const entries = fetchNormalizedEntries({
        source: (input.source as LogSource) || 'all',
        limit: count,
      });

      return JSON.stringify({
        success: true,
        count: entries.length,
        entries,
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerLogsTools(
  registry: ToolRegistry,
  context: LogsToolContext
): void {
  const executors = createLogsToolExecutors(context);

  for (const tool of logsTools) {
    registry.register(tool, executors[tool.name]);
  }
}
