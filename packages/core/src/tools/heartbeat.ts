/**
 * Heartbeat Tools
 *
 * Provide visibility into heartbeat status and recent heartbeat runs.
 */

import type { Tool, HeartbeatState, HeartbeatConfig } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import {
  readHeartbeatHistory,
  readLatestHeartbeat,
  resolveHeartbeatHistoryPath,
  resolveHeartbeatPersistPath,
} from '../heartbeat/history';

// ============================================
// Types
// ============================================

export interface HeartbeatToolsContext {
  sessionId: string;
  getHeartbeatState?: () => HeartbeatState | null;
  getHeartbeatConfig?: () => HeartbeatConfig | null;
  baseDir?: string;
}

// ============================================
// Tool Definitions
// ============================================

export const heartbeatStatusTool: Tool = {
  name: 'heartbeat_status',
  description: 'Get heartbeat status, last heartbeat record, and optional recent runs for a session.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Optional session id (defaults to current session)',
      },
      includeRuns: {
        type: 'boolean',
        description: 'Include recent heartbeat runs in the response',
      },
      limit: {
        type: 'number',
        description: 'Max number of runs to include (default: 20)',
      },
    },
    required: [],
  },
};

export const heartbeatRunsTool: Tool = {
  name: 'heartbeat_runs',
  description: 'List heartbeat runs for a session with optional limits and ordering.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Optional session id (defaults to current session)',
      },
      limit: {
        type: 'number',
        description: 'Max number of runs to return (default: 50)',
      },
      order: {
        type: 'string',
        description: 'Sort order: "asc" or "desc" (default: desc)',
        enum: ['asc', 'desc'],
      },
    },
    required: [],
  },
};

export const heartbeatTools: Tool[] = [heartbeatStatusTool, heartbeatRunsTool];

// ============================================
// Helpers
// ============================================

function parseLimit(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

// ============================================
// Executors
// ============================================

export function createHeartbeatToolExecutors(
  context: HeartbeatToolsContext
): Record<string, ToolExecutor> {
  return {
    heartbeat_status: async (input: Record<string, unknown>): Promise<string> => {
      const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
        ? input.sessionId.trim()
        : context.sessionId;
      const config = context.getHeartbeatConfig?.() ?? null;
      const persistPath = resolveHeartbeatPersistPath(sessionId, config?.persistPath, context.baseDir);
      const historyPath = resolveHeartbeatHistoryPath(sessionId, config?.historyPath, context.baseDir);

      const lastHeartbeat = await readLatestHeartbeat(persistPath, historyPath);
      const state = context.getHeartbeatState?.() ?? null;
      const staleThreshold = config?.staleThresholdMs ?? 120000;
      const lastTimestamp = lastHeartbeat ? new Date(lastHeartbeat.timestamp).getTime() : null;
      const computedStale = lastTimestamp ? Date.now() - lastTimestamp > staleThreshold : true;

      const includeRuns = Boolean(input.includeRuns);
      const limit = parseLimit(input.limit, 20);
      const runs = includeRuns
        ? await readHeartbeatHistory(historyPath, { limit, order: 'desc' })
        : undefined;

      const enabled = state?.enabled ?? (config ? true : false);

      return JSON.stringify({
        success: true,
        sessionId,
        enabled,
        state: state?.state ?? lastHeartbeat?.state ?? null,
        isStale: state?.isStale ?? computedStale,
        lastActivity: state?.lastActivity ?? lastHeartbeat?.lastActivity ?? null,
        uptimeSeconds: state?.uptimeSeconds ?? lastHeartbeat?.stats?.uptimeSeconds ?? null,
        lastHeartbeat,
        runs,
      });
    },
    heartbeat_runs: async (input: Record<string, unknown>): Promise<string> => {
      const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0
        ? input.sessionId.trim()
        : context.sessionId;
      const config = context.getHeartbeatConfig?.() ?? null;
      const historyPath = resolveHeartbeatHistoryPath(sessionId, config?.historyPath, context.baseDir);
      const order = input.order === 'asc' ? 'asc' : 'desc';
      const limit = parseLimit(input.limit, 50);
      const runs = await readHeartbeatHistory(historyPath, { limit, order });

      return JSON.stringify({
        success: true,
        sessionId,
        count: runs.length,
        runs,
      });
    },
  };
}

// ============================================
// Registration
// ============================================

export function registerHeartbeatTools(
  registry: ToolRegistry,
  context: HeartbeatToolsContext
): void {
  const executors = createHeartbeatToolExecutors(context);
  for (const tool of heartbeatTools) {
    registry.register(tool, executors[tool.name]);
  }
}
