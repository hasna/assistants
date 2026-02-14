/**
 * Assistant Registry Tools
 *
 * Tools for querying and interacting with the assistant registry.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolRegistry } from './registry';
import type { AssistantRegistryService, RegisteredAssistant, AssistantQuery, RegistryAssistantState, AssistantType } from '../registry';

/**
 * Context required for registry tools
 */
export interface RegistryToolContext {
  /** Registry service instance */
  getRegistryService?: () => AssistantRegistryService | null;
  /** Current session ID (for filtering) */
  sessionId?: string;
  /** Current assistant ID */
  assistantId?: string;
}

/**
 * Format assistant for display
 */
function formatAssistant(assistant: RegisteredAssistant): string {
  const lines: string[] = [];

  lines.push(`ID: ${assistant.id}`);
  lines.push(`Name: ${assistant.name}`);
  lines.push(`Type: ${assistant.type}`);
  lines.push(`State: ${assistant.status.state}`);

  if (assistant.description) {
    lines.push(`Description: ${assistant.description}`);
  }

  if (assistant.sessionId) {
    lines.push(`Session: ${assistant.sessionId}`);
  }

  if (assistant.parentId) {
    lines.push(`Parent: ${assistant.parentId}`);
  }

  if (assistant.childIds.length > 0) {
    lines.push(`Children: ${assistant.childIds.join(', ')}`);
  }

  // Capabilities
  const caps: string[] = [];
  if (assistant.capabilities.tools.length > 0) {
    caps.push(`tools: ${assistant.capabilities.tools.slice(0, 5).join(', ')}${assistant.capabilities.tools.length > 5 ? '...' : ''}`);
  }
  if (assistant.capabilities.skills.length > 0) {
    caps.push(`skills: ${assistant.capabilities.skills.slice(0, 3).join(', ')}${assistant.capabilities.skills.length > 3 ? '...' : ''}`);
  }
  if (assistant.capabilities.tags.length > 0) {
    caps.push(`tags: ${assistant.capabilities.tags.join(', ')}`);
  }
  if (caps.length > 0) {
    lines.push(`Capabilities: ${caps.join('; ')}`);
  }

  // Load
  lines.push(`Load: ${assistant.load.activeTasks} active, ${assistant.load.queuedTasks} queued`);

  // Heartbeat
  const staleStatus = assistant.heartbeat.isStale ? ' (STALE)' : '';
  lines.push(`Last Heartbeat: ${assistant.heartbeat.lastHeartbeat}${staleStatus}`);

  return lines.join('\n');
}

/**
 * Registry list tool - list all registered assistants
 */
export const registryListTool: Tool = {
  name: 'registry_list',
  description: 'List all registered assistants in the system. Returns assistant IDs, names, types, and status.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['assistant', 'subassistant', 'coordinator', 'worker'],
        description: 'Filter by assistant type',
      },
      state: {
        type: 'string',
        enum: ['idle', 'processing', 'waiting_input', 'error', 'offline', 'stopped'],
        description: 'Filter by assistant state',
      },
      sessionId: {
        type: 'string',
        description: 'Filter by session ID',
      },
      includeOffline: {
        type: 'boolean',
        description: 'Include offline/stale assistants (default: false)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of assistants to return (default: 20)',
      },
    },
  },
};

/**
 * Create registry_list executor
 */
export function createRegistryListExecutor(context: RegistryToolContext) {
  return async (input: {
    type?: AssistantType;
    state?: RegistryAssistantState;
    sessionId?: string;
    includeOffline?: boolean;
    limit?: number;
  }): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const query: AssistantQuery = {
        type: input.type,
        state: input.state,
        sessionId: input.sessionId,
        includeOffline: input.includeOffline ?? false,
        limit: Math.min(input.limit ?? 20, 100),
        sortBy: 'registeredAt',
        sortDir: 'desc',
      };

      const result = service.query(query);

      if (result.assistants.length === 0) {
        return 'No assistants found matching the criteria.';
      }

      const lines: string[] = [];
      lines.push(`Found ${result.total} assistant(s)${result.total > result.assistants.length ? ` (showing ${result.assistants.length})` : ''}:\n`);

      for (const assistant of result.assistants) {
        lines.push(`---`);
        lines.push(formatAssistant(assistant));
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to list assistants: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry query tool - query assistants by capability
 */
export const registryQueryTool: Tool = {
  name: 'registry_query',
  description: 'Query assistants by capabilities, finding assistants that have specific tools, skills, or tags.',
  parameters: {
    type: 'object',
    properties: {
      requiredTools: {
        type: 'array',
        items: { type: 'string', description: 'Tool name' },
        description: 'Required tools the assistant must have',
      },
      requiredSkills: {
        type: 'array',
        items: { type: 'string', description: 'Skill name' },
        description: 'Required skills the assistant must have',
      },
      requiredTags: {
        type: 'array',
        items: { type: 'string', description: 'Tag name' },
        description: 'Required tags the assistant must have',
      },
      preferredTools: {
        type: 'array',
        items: { type: 'string', description: 'Tool name' },
        description: 'Preferred tools (improves match score)',
      },
      preferredTags: {
        type: 'array',
        items: { type: 'string', description: 'Tag name' },
        description: 'Preferred tags (improves match score)',
      },
      maxLoadFactor: {
        type: 'number',
        description: 'Maximum load factor (0-1, default: 0.8)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of assistants to return (default: 10)',
      },
    },
  },
};

/**
 * Create registry_query executor
 */
export function createRegistryQueryExecutor(context: RegistryToolContext) {
  return async (input: {
    requiredTools?: string[];
    requiredSkills?: string[];
    requiredTags?: string[];
    preferredTools?: string[];
    preferredTags?: string[];
    maxLoadFactor?: number;
    limit?: number;
  }): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const query: AssistantQuery = {
        requiredCapabilities: {
          tools: input.requiredTools,
          skills: input.requiredSkills,
          tags: input.requiredTags,
        },
        preferredCapabilities: {
          tools: input.preferredTools,
          tags: input.preferredTags,
        },
        maxLoadFactor: input.maxLoadFactor ?? 0.8,
        limit: Math.min(input.limit ?? 10, 50),
        includeOffline: false,
      };

      const result = service.query(query);

      if (result.assistants.length === 0) {
        return 'No assistants found matching the capability requirements.';
      }

      const lines: string[] = [];
      lines.push(`Found ${result.total} matching assistant(s)${result.total > result.assistants.length ? ` (showing ${result.assistants.length})` : ''}:\n`);

      for (const assistant of result.assistants) {
        const score = result.scores.get(assistant.id) ?? 0;
        lines.push(`---`);
        lines.push(`Match Score: ${(score * 100).toFixed(0)}%`);
        lines.push(formatAssistant(assistant));
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to query assistants: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry get tool - get details of a specific assistant
 */
export const registryGetTool: Tool = {
  name: 'registry_get',
  description: 'Get detailed information about a specific registered assistant by ID.',
  parameters: {
    type: 'object',
    properties: {
      assistantId: {
        type: 'string',
        description: 'The assistant ID to look up',
      },
    },
    required: ['assistantId'],
  },
};

/**
 * Create registry_get executor
 */
export function createRegistryGetExecutor(context: RegistryToolContext) {
  return async (input: Record<string, unknown>): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    const assistantId = input.assistantId as string;
    if (!assistantId) {
      return 'Assistant ID is required';
    }

    try {
      const assistant = service.get(assistantId);

      if (!assistant) {
        return `Assistant not found: ${assistantId}`;
      }

      return formatAssistant(assistant);
    } catch (error) {
      return `Failed to get assistant: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Registry stats tool - get registry statistics
 */
export const registryStatsTool: Tool = {
  name: 'registry_stats',
  description: 'Get statistics about the assistant registry, including counts by type and state.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Create registry_stats executor
 */
export function createRegistryStatsExecutor(context: RegistryToolContext) {
  return async (): Promise<string> => {
    const service = context.getRegistryService?.();
    if (!service) {
      return 'Registry service not available';
    }

    try {
      const stats = service.getStats();

      const lines: string[] = [];
      lines.push('Registry Statistics:');
      lines.push(`  Total Assistants: ${stats.totalAssistants}`);
      lines.push(`  Stale Count: ${stats.staleCount}`);
      lines.push(`  Average Load: ${(stats.averageLoad * 100).toFixed(1)}%`);
      lines.push(`  Uptime: ${Math.floor(stats.uptime)}s`);

      lines.push('\nBy Type:');
      for (const [type, count] of Object.entries(stats.byType)) {
        if (count > 0) {
          lines.push(`  ${type}: ${count}`);
        }
      }

      lines.push('\nBy State:');
      for (const [state, count] of Object.entries(stats.byState)) {
        if (count > 0) {
          lines.push(`  ${state}: ${count}`);
        }
      }

      return lines.join('\n');
    } catch (error) {
      return `Failed to get stats: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * All registry tools
 */
export const assistantRegistryTools: Tool[] = [
  registryListTool,
  registryQueryTool,
  registryGetTool,
  registryStatsTool,
];

/**
 * Create all registry tool executors
 */
export function createAssistantRegistryToolExecutors(context: RegistryToolContext) {
  return {
    registry_list: createRegistryListExecutor(context),
    registry_query: createRegistryQueryExecutor(context),
    registry_get: createRegistryGetExecutor(context),
    registry_stats: createRegistryStatsExecutor(context),
  };
}

/**
 * Register all registry tools with a tool registry
 */
export function registerAssistantRegistryTools(
  registry: ToolRegistry,
  context: RegistryToolContext
): void {
  const executors = createAssistantRegistryToolExecutors(context);

  registry.register(registryListTool, executors.registry_list);
  registry.register(registryQueryTool, executors.registry_query);
  registry.register(registryGetTool, executors.registry_get);
  registry.register(registryStatsTool, executors.registry_stats);
}
