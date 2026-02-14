/**
 * Security Tools
 *
 * Tools for retrieving and managing security log events.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { SecurityLogger } from '../security/logger';
import type { Severity } from '../security/types';

// ============================================
// Types
// ============================================

export interface SecurityToolsContext {
  getSecurityLogger: () => SecurityLogger;
  sessionId: string;
}

// ============================================
// Tool Definitions
// ============================================

export const securityLogListTool: Tool = {
  name: 'security_log_list',
  description: 'List security log events. Shows blocked commands, path violations, and validation failures. Useful for understanding what security protections have been triggered.',
  parameters: {
    type: 'object',
    properties: {
      severity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Filter by severity level',
      },
      eventType: {
        type: 'string',
        enum: ['blocked_command', 'path_violation', 'validation_failure'],
        description: 'Filter by event type',
      },
      sessionOnly: {
        type: 'boolean',
        description: 'Only show events from the current session (default: true)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 50)',
      },
    },
    required: [],
  },
};

export const securityLogClearTool: Tool = {
  name: 'security_log_clear',
  description: 'Clear the in-memory security log. Does not affect persisted log file.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const securityLogSummaryTool: Tool = {
  name: 'security_log_summary',
  description: 'Get a summary of security events showing counts by type and severity.',
  parameters: {
    type: 'object',
    properties: {
      sessionOnly: {
        type: 'boolean',
        description: 'Only show events from the current session (default: true)',
      },
    },
    required: [],
  },
};

export const securityTools: Tool[] = [
  securityLogListTool,
  securityLogClearTool,
  securityLogSummaryTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createSecurityToolExecutors(
  context: SecurityToolsContext
): Record<string, ToolExecutor> {
  return {
    security_log_list: async (input: Record<string, unknown>): Promise<string> => {
      const logger = context.getSecurityLogger();
      const sessionOnly = input.sessionOnly !== false; // Default true
      const limit = typeof input.limit === 'number' ? Math.min(100, Math.max(1, input.limit)) : 50;

      // Build filter
      type EventType = 'blocked_command' | 'path_violation' | 'validation_failure';
      const filter: {
        eventType?: EventType;
        severity?: Severity;
        sessionId?: string;
      } = {};

      if (input.eventType) {
        filter.eventType = input.eventType as EventType;
      }
      if (input.severity) {
        filter.severity = input.severity as Severity;
      }
      if (sessionOnly) {
        filter.sessionId = context.sessionId;
      }

      const events = logger.getEvents(filter);

      // Sort by timestamp descending (most recent first)
      const sorted = events
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, limit);

      const formattedEvents = sorted.map((event) => ({
        timestamp: event.timestamp,
        eventType: event.eventType,
        severity: event.severity,
        tool: event.details.tool || null,
        reason: event.details.reason,
        command: event.details.command || null,
        path: event.details.path || null,
      }));

      return JSON.stringify({
        success: true,
        total: events.length,
        showing: formattedEvents.length,
        sessionOnly,
        events: formattedEvents,
      });
    },

    security_log_clear: async (): Promise<string> => {
      const logger = context.getSecurityLogger();
      const count = logger.getEvents({}).length;
      logger.clear();

      return JSON.stringify({
        success: true,
        message: `Cleared ${count} security events from memory`,
        clearedCount: count,
        note: 'Persisted log file was not affected',
      });
    },

    security_log_summary: async (input: Record<string, unknown>): Promise<string> => {
      const logger = context.getSecurityLogger();
      const sessionOnly = input.sessionOnly !== false; // Default true

      const events = sessionOnly
        ? logger.getEvents({ sessionId: context.sessionId })
        : logger.getEvents({});

      // Count by event type
      const byType: Record<string, number> = {
        blocked_command: 0,
        path_violation: 0,
        validation_failure: 0,
      };

      // Count by severity
      const bySeverity: Record<Severity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };

      // Recent events
      const recentHighSeverity: Array<{
        timestamp: string;
        eventType: string;
        reason: string;
      }> = [];

      for (const event of events) {
        byType[event.eventType] = (byType[event.eventType] || 0) + 1;
        bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;

        if (event.severity === 'critical' || event.severity === 'high') {
          recentHighSeverity.push({
            timestamp: event.timestamp,
            eventType: event.eventType,
            reason: event.details.reason,
          });
        }
      }

      // Sort and limit recent high severity events
      const topHighSeverity = recentHighSeverity
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(0, 5);

      return JSON.stringify({
        success: true,
        total: events.length,
        sessionOnly,
        byType,
        bySeverity,
        recentHighSeverity: topHighSeverity.length > 0 ? topHighSeverity : null,
        status:
          bySeverity.critical > 0
            ? 'critical issues detected'
            : bySeverity.high > 0
              ? 'high severity issues detected'
              : events.length > 0
                ? 'some security events logged'
                : 'no security events',
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerSecurityTools(
  registry: ToolRegistry,
  context: SecurityToolsContext
): void {
  const executors = createSecurityToolExecutors(context);

  for (const tool of securityTools) {
    registry.register(tool, executors[tool.name]);
  }
}
