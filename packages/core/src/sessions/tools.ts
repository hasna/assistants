/**
 * Session management tools for assistant use
 * Tools that allow assistants to create and manage sessions programmatically
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';

// ============================================
// Types
// ============================================

export interface SessionContext {
  userId: string;
  sessionId: string;
  /** Function to query sessions from the database or API */
  queryFn: SessionQueryFunctions;
}

export interface SessionQueryFunctions {
  /** Get current session info */
  getSession: (sessionId: string, userId: string) => Promise<AssistantSessionData | null>;
  /** List sessions for user */
  listSessions: (userId: string, options: ListSessionsOptions) => Promise<AssistantSessionData[]>;
  /** Create a new session */
  createSession: (userId: string, data: CreateSessionData) => Promise<AssistantSessionData>;
  /** Update a session */
  updateSession: (sessionId: string, userId: string, data: UpdateSessionData) => Promise<AssistantSessionData | null>;
  /** Delete a session */
  deleteSession: (sessionId: string, userId: string) => Promise<boolean>;
  /** Verify assistant ownership */
  verifyAssistantOwnership?: (assistantId: string, userId: string) => Promise<boolean>;
}

export interface AssistantSessionData {
  id: string;
  label: string | null;
  assistantId: string | null;
  cwd: string | null;
  metadata: SessionMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMetadata {
  lastMessageAt?: string;
  messageCount?: number;
  context?: Record<string, unknown>;
}

export interface ListSessionsOptions {
  limit?: number;
  search?: string;
  assistantId?: string;
}

export interface CreateSessionData {
  label?: string;
  assistantId?: string;
  cwd?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateSessionData {
  label?: string;
  metadata?: Record<string, unknown>;
}

// ============================================
// Tool Definitions
// ============================================

/**
 * session_info - Get current session info
 */
export const sessionInfoTool: Tool = {
  name: 'session_info',
  description:
    'Get information about the current session including ID, label, assistant, and metadata.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * session_list - List user sessions
 */
export const sessionListTool: Tool = {
  name: 'session_list',
  description:
    'List sessions owned by the current user. Can filter by search term or assistant ID.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20, max: 50)',
      },
      search: {
        type: 'string',
        description: 'Search term to filter by session label',
      },
      assistantId: {
        type: 'string',
        description: 'Filter sessions by assistant UUID',
      },
    },
    required: [],
  },
};

/**
 * session_create - Create a new session
 */
export const sessionCreateTool: Tool = {
  name: 'session_create',
  description:
    'Create a new session with optional label, assistant assignment, and metadata.',
  parameters: {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Session label/name (auto-generated if not provided)',
      },
      assistantId: {
        type: 'string',
        description: 'Assistant UUID to assign to this session',
      },
      metadata: {
        type: 'object',
        description: 'Custom metadata to attach to the session',
      },
    },
    required: [],
  },
};

/**
 * session_update - Update session label or metadata
 */
export const sessionUpdateTool: Tool = {
  name: 'session_update',
  description:
    'Update a session\'s label or metadata. If no session ID is provided, updates the current session.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session UUID to update (defaults to current session)',
      },
      label: {
        type: 'string',
        description: 'New label for the session',
      },
      metadata: {
        type: 'object',
        description: 'Metadata to merge with existing metadata',
      },
    },
    required: [],
  },
};

/**
 * session_delete - Delete a session
 */
export const sessionDeleteTool: Tool = {
  name: 'session_delete',
  description:
    'Delete a session and all its associated messages. Cannot delete the current session.',
  parameters: {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'Session UUID to delete',
      },
    },
    required: ['sessionId'],
  },
};

// ============================================
// Tool Executors
// ============================================

/**
 * Create executors for session tools
 */
export function createSessionToolExecutors(
  getContext: () => SessionContext | null
): Record<string, ToolExecutor> {
  return {
    session_info: async () => {
      const ctx = getContext();
      if (!ctx) {
        return 'Error: Session context is not available.';
      }

      try {
        const session = await ctx.queryFn.getSession(ctx.sessionId, ctx.userId);
        if (!session) {
          return 'Error: Current session not found.';
        }

        return formatSessionAsMarkdown(session, true);
      } catch (error) {
        return `Error getting session info: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    session_list: async (input) => {
      const ctx = getContext();
      if (!ctx) {
        return 'Error: Session context is not available.';
      }

      const limit = Math.min(
        Math.max(1, typeof input.limit === 'number' ? input.limit : 20),
        50
      );
      const search = input.search ? String(input.search).trim() : undefined;
      const assistantId = input.assistantId ? String(input.assistantId).trim() : undefined;

      try {
        const sessions = await ctx.queryFn.listSessions(ctx.userId, {
          limit,
          search,
          assistantId,
        });

        if (sessions.length === 0) {
          return 'No sessions found.';
        }

        const lines: string[] = [];
        lines.push(`## Sessions (${sessions.length})`);
        lines.push('');

        for (const session of sessions) {
          const isCurrent = session.id === ctx.sessionId;
          const currentIndicator = isCurrent ? ' <- current' : '';
          const label = session.label || 'Untitled';
          const date = new Date(session.updatedAt).toLocaleDateString();

          lines.push(`- **${label}**${currentIndicator}`);
          lines.push(`  ID: \`${session.id}\``);
          if (session.assistantId) {
            lines.push(`  Assistant: ${session.assistantId}`);
          }
          lines.push(`  Updated: ${date}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing sessions: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    session_create: async (input) => {
      const ctx = getContext();
      if (!ctx) {
        return 'Error: Session context is not available.';
      }

      const label = input.label ? String(input.label).trim() : undefined;
      const assistantId = input.assistantId ? String(input.assistantId).trim() : undefined;
      const metadata = input.metadata as Record<string, unknown> | undefined;

      // Validate assistantId ownership if provided
      if (assistantId && ctx.queryFn.verifyAssistantOwnership) {
        try {
          const isOwner = await ctx.queryFn.verifyAssistantOwnership(assistantId, ctx.userId);
          if (!isOwner) {
            return 'Error: You do not own this assistant or it does not exist.';
          }
        } catch (error) {
          return `Error verifying assistant ownership: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      try {
        const session = await ctx.queryFn.createSession(ctx.userId, {
          label,
          assistantId,
          metadata,
        });

        return formatSessionCreatedMessage(session);
      } catch (error) {
        return `Error creating session: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    session_update: async (input) => {
      const ctx = getContext();
      if (!ctx) {
        return 'Error: Session context is not available.';
      }

      const sessionId = input.sessionId ? String(input.sessionId).trim() : ctx.sessionId;
      const label = input.label ? String(input.label).trim() : undefined;
      const metadata = input.metadata as Record<string, unknown> | undefined;

      if (!label && !metadata) {
        return 'Error: At least one of label or metadata must be provided.';
      }

      try {
        const session = await ctx.queryFn.updateSession(sessionId, ctx.userId, {
          label,
          metadata,
        });

        if (!session) {
          return 'Error: Session not found or you do not have permission to update it.';
        }

        return formatSessionUpdatedMessage(session);
      } catch (error) {
        return `Error updating session: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    session_delete: async (input) => {
      const ctx = getContext();
      if (!ctx) {
        return 'Error: Session context is not available.';
      }

      const sessionId = String(input.sessionId || '').trim();
      if (!sessionId) {
        return 'Error: Session ID is required.';
      }

      // Safety: cannot delete current session
      if (sessionId === ctx.sessionId) {
        return 'Error: Cannot delete the current session. Switch to a different session first.';
      }

      try {
        const deleted = await ctx.queryFn.deleteSession(sessionId, ctx.userId);

        if (!deleted) {
          return 'Error: Session not found or you do not have permission to delete it.';
        }

        return `Session \`${sessionId}\` has been deleted along with all its messages.`;
      } catch (error) {
        return `Error deleting session: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

// ============================================
// Formatting Helpers
// ============================================

function formatSessionAsMarkdown(session: AssistantSessionData, verbose = false): string {
  const lines: string[] = [];

  lines.push(`## Session: ${session.label || 'Untitled'}`);
  lines.push('');
  lines.push(`**ID:** \`${session.id}\``);

  if (session.assistantId) {
    lines.push(`**Assistant:** ${session.assistantId}`);
  }

  if (session.cwd) {
    lines.push(`**Working Directory:** ${session.cwd}`);
  }

  lines.push(`**Created:** ${new Date(session.createdAt).toLocaleString()}`);
  lines.push(`**Updated:** ${new Date(session.updatedAt).toLocaleString()}`);

  if (verbose && session.metadata) {
    lines.push('');
    lines.push('### Metadata');
    if (session.metadata.lastMessageAt) {
      lines.push(`- Last message: ${new Date(session.metadata.lastMessageAt).toLocaleString()}`);
    }
    if (typeof session.metadata.messageCount === 'number') {
      lines.push(`- Message count: ${session.metadata.messageCount}`);
    }
    if (session.metadata.context) {
      lines.push(`- Context: ${JSON.stringify(session.metadata.context)}`);
    }
  }

  return lines.join('\n');
}

function formatSessionCreatedMessage(session: AssistantSessionData): string {
  const lines: string[] = [];

  lines.push('Session created successfully.');
  lines.push('');
  lines.push(`**ID:** \`${session.id}\``);
  lines.push(`**Label:** ${session.label || 'Untitled'}`);

  if (session.assistantId) {
    lines.push(`**Assistant:** ${session.assistantId}`);
  }

  return lines.join('\n');
}

function formatSessionUpdatedMessage(session: AssistantSessionData): string {
  const lines: string[] = [];

  lines.push('Session updated successfully.');
  lines.push('');
  lines.push(`**ID:** \`${session.id}\``);
  lines.push(`**Label:** ${session.label || 'Untitled'}`);
  lines.push(`**Updated:** ${new Date(session.updatedAt).toLocaleString()}`);

  return lines.join('\n');
}

// ============================================
// Registration
// ============================================

/**
 * All session tools
 */
export const sessionTools: Tool[] = [
  sessionInfoTool,
  sessionListTool,
  sessionCreateTool,
  sessionUpdateTool,
  sessionDeleteTool,
];

/**
 * Register session tools with a tool registry
 */
export function registerSessionTools(
  registry: ToolRegistry,
  getContext: () => SessionContext | null
): void {
  const executors = createSessionToolExecutors(getContext);

  for (const tool of sessionTools) {
    registry.register(tool, executors[tool.name]);
  }
}
