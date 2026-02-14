/**
 * Verification Tools
 *
 * Tools for managing scope verification sessions and settings.
 */

import type { Tool, VerificationSession } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { VerificationSessionStore } from '../sessions/verification';
import { nativeHookRegistry } from '../hooks';
import { getConfigDir } from '../config';

// ============================================
// Types
// ============================================

export interface VerificationToolsContext {
  sessionId: string;
}

// ============================================
// Tool Definitions
// ============================================

export const verificationListTool: Tool = {
  name: 'verification_list',
  description: 'List recent verification sessions. Shows scope verification results for goal-based tasks.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of sessions to return (default: 10, max: 50)',
      },
      sessionOnly: {
        type: 'boolean',
        description: 'Only show sessions from the current parent session (default: false)',
      },
    },
    required: [],
  },
};

export const verificationGetTool: Tool = {
  name: 'verification_get',
  description: 'Get detailed information about a specific verification session.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The verification session ID (full or partial match)',
      },
    },
    required: ['id'],
  },
};

export const verificationStatusTool: Tool = {
  name: 'verification_status',
  description: 'Get the current status of scope verification (enabled/disabled, max retries).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const verificationEnableTool: Tool = {
  name: 'verification_enable',
  description: 'Enable scope verification. When enabled, goal completion is verified before proceeding.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const verificationDisableTool: Tool = {
  name: 'verification_disable',
  description: 'Disable scope verification.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const verificationTools: Tool[] = [
  verificationListTool,
  verificationGetTool,
  verificationStatusTool,
  verificationEnableTool,
  verificationDisableTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createVerificationToolExecutors(
  context: VerificationToolsContext
): Record<string, ToolExecutor> {
  return {
    verification_list: async (input: Record<string, unknown>): Promise<string> => {
      const store = new VerificationSessionStore(getConfigDir());
      const limit = Math.min(50, Math.max(1, typeof input.limit === 'number' ? input.limit : 10));
      const sessionOnly = input.sessionOnly === true;

      let sessions: VerificationSession[];

      if (sessionOnly) {
        sessions = store.getByParentSession(context.sessionId).slice(0, limit);
      } else {
        sessions = store.listRecent(limit);
      }

      if (sessions.length === 0) {
        return JSON.stringify({
          success: true,
          total: 0,
          sessions: [],
          message: sessionOnly ? 'No verification sessions for current session' : 'No verification sessions found',
        });
      }

      const formatted = sessions.map((s) => ({
        id: s.id,
        result: s.result,
        goals: s.goals,
        goalsMet: s.goals.length > 0 ? s.verificationResult.goalsAnalysis.filter((a) => a.met).length : 0,
        goalsTotal: s.goals.length,
        reason: s.reason,
        createdAt: s.createdAt,
        parentSessionId: s.parentSessionId,
      }));

      return JSON.stringify({
        success: true,
        total: sessions.length,
        sessionOnly,
        sessions: formatted,
      });
    },

    verification_get: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Session ID is required',
        });
      }

      const store = new VerificationSessionStore(getConfigDir());

      // Try direct match first
      let session = store.get(id);

      // Try partial match if not found
      if (!session) {
        const sessions = store.listRecent(100);
        session = sessions.find((s) => s.id.startsWith(id)) || null;
      }

      if (!session) {
        return JSON.stringify({
          success: false,
          error: `Verification session "${id}" not found`,
        });
      }

      const goalsAnalysis = session.verificationResult.goalsAnalysis.map((a) => ({
        goal: a.goal,
        met: a.met,
        evidence: a.evidence,
      }));

      return JSON.stringify({
        success: true,
        session: {
          id: session.id,
          type: session.type,
          result: session.result,
          parentSessionId: session.parentSessionId,
          createdAt: session.createdAt,
          goals: session.goals,
          goalsAnalysis,
          reason: session.reason,
          suggestions: session.suggestions,
          summary: {
            goalsMet: goalsAnalysis.filter((a) => a.met).length,
            goalsTotal: goalsAnalysis.length,
          },
        },
      });
    },

    verification_status: async (): Promise<string> => {
      const config = nativeHookRegistry.getConfig();
      const enabled = config.scopeVerification?.enabled !== false;
      const maxRetries = config.scopeVerification?.maxRetries ?? 2;

      return JSON.stringify({
        success: true,
        verification: {
          enabled,
          maxRetries,
        },
      });
    },

    verification_enable: async (): Promise<string> => {
      const currentConfig = nativeHookRegistry.getConfig();

      nativeHookRegistry.setConfig({
        ...currentConfig,
        scopeVerification: {
          ...currentConfig.scopeVerification,
          enabled: true,
        },
      });

      return JSON.stringify({
        success: true,
        message: 'Scope verification enabled',
        status: {
          enabled: true,
          maxRetries: currentConfig.scopeVerification?.maxRetries ?? 2,
        },
      });
    },

    verification_disable: async (): Promise<string> => {
      const currentConfig = nativeHookRegistry.getConfig();

      nativeHookRegistry.setConfig({
        ...currentConfig,
        scopeVerification: {
          ...currentConfig.scopeVerification,
          enabled: false,
        },
      });

      return JSON.stringify({
        success: true,
        message: 'Scope verification disabled',
        status: {
          enabled: false,
          maxRetries: currentConfig.scopeVerification?.maxRetries ?? 2,
        },
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerVerificationTools(
  registry: ToolRegistry,
  context: VerificationToolsContext
): void {
  const executors = createVerificationToolExecutors(context);

  for (const tool of verificationTools) {
    registry.register(tool, executors[tool.name]);
  }
}
