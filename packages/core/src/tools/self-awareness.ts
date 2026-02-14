/**
 * Self-Awareness Tools
 *
 * Tools that allow assistants to understand their context, identity, and resources.
 * These enable assistants to make informed decisions about expensive operations,
 * adjust behavior based on remaining resources, and identify themselves.
 */

import type { Tool, EnergyState } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { ContextManager, ContextInfo, ContextConfig, ContextState } from '../context';
import type { EnergyManager, EnergyEffects, EnergyLevel } from '../energy';
import type { AssistantManager, IdentityManager, Assistant, Identity } from '../identity';
import type { WalletManager } from '../wallet';
import type { StatsTracker, SessionStats, ToolStats } from '../agent/stats';

// ============================================
// Types
// ============================================

export interface SelfAwarenessContext {
  getContextManager?: () => ContextManager | null;
  getContextInfo?: () => ContextInfo | null;
  getAssistantManager?: () => AssistantManager | null;
  getIdentityManager?: () => IdentityManager | null;
  getEnergyManager?: () => EnergyManager | null;
  getEnergyState?: () => EnergyState | null;
  getWalletManager?: () => WalletManager | null;
  getStatsTracker?: () => StatsTracker | null;
  // Session state getters
  isProcessing?: () => boolean;
  getQueueLength?: () => number;
  getPendingToolCalls?: () => Map<string, string> | null;
  getLastError?: () => { message: string; timestamp: string } | null;
  getCwd?: () => string;
  getStartedAt?: () => string;
  // Message access
  getMessages?: () => Array<{ id: string; role: string; content: string; timestamp: number }>;
  // UI state access (web only)
  getUiState?: () => {
    route?: string;
    panels?: string[];
    selectedItems?: Record<string, string | string[]>;
    filters?: Record<string, unknown>;
    scrollPosition?: { x: number; y: number };
  } | null;
  sessionId: string;
  model?: string;
}

// ============================================
// Tool Definitions
// ============================================

export const contextGetTool: Tool = {
  name: 'context_get',
  description:
    'Get current conversation context state including token count, message count, and summarization status. Use this to understand how much context space is used.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const contextStatsTool: Tool = {
  name: 'context_stats',
  description:
    'Get detailed statistics about context management including compression history, limits, and configuration.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const whoamiTool: Tool = {
  name: 'whoami',
  description:
    'Get current assistant identity - name, model, session ID, and active identity. Quick way to identify yourself.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const identityGetTool: Tool = {
  name: 'identity_get',
  description:
    'Get full identity information including profile, preferences, and communication style. Returns detailed identity data.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const energyStatusTool: Tool = {
  name: 'energy_status',
  description:
    'Get current energy state, level, and any effects (like response modifications). Check before expensive operations.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const resourceLimitsTool: Tool = {
  name: 'resource_limits',
  description:
    'Get current resource limits including context window, energy thresholds, and wallet rate limits. Use for planning multi-step operations.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const sessionStatsTool: Tool = {
  name: 'session_stats',
  description:
    'Get comprehensive session statistics including tool call counts, success rates, durations, and token usage. Use to understand overall session performance.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const toolStatsTool: Tool = {
  name: 'tool_stats',
  description:
    'Get detailed statistics for a specific tool or all tools including call counts, success/failure rates, and execution timings.',
  parameters: {
    type: 'object',
    properties: {
      tool_name: {
        type: 'string',
        description:
          'Name of the tool to get stats for. If not provided, returns stats for all tools.',
      },
    },
    required: [],
  },
};

export const statsSummaryTool: Tool = {
  name: 'stats_summary',
  description:
    'Get a compact summary of session statistics: total tool calls, success rate, average duration, and top tools used.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const sessionStateTool: Tool = {
  name: 'session_state',
  description:
    'Get current session state including processing status, queue length, pending tool calls, model, working directory, and timing. Use to understand what the assistant is currently doing.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const workspaceMapTool: Tool = {
  name: 'workspace_map',
  description:
    'Get a map of the current workspace including directory tree, git status, recent files, and project info. Use for spatial awareness and understanding the project structure.',
  parameters: {
    type: 'object',
    properties: {
      depth: {
        type: 'number',
        description: 'Maximum directory depth to traverse (default: 3)',
      },
      include_git_status: {
        type: 'boolean',
        description: 'Include git status information (default: true)',
      },
      include_recent_files: {
        type: 'boolean',
        description: 'Include recently modified files (default: true)',
      },
      max_files: {
        type: 'number',
        description: 'Maximum number of files to list per directory (default: 20)',
      },
    },
    required: [],
  },
};

export const messageIndexTool: Tool = {
  name: 'message_index',
  description:
    'Get an index of conversation messages with IDs, timestamps, roles, and short topics. Use for precise message referencing, partial summarization, and targeted retrieval.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of messages to return (default: 50)',
      },
      offset: {
        type: 'number',
        description: 'Number of messages to skip from the start (default: 0)',
      },
      role: {
        type: 'string',
        description: 'Filter by message role (user, assistant, system)',
        enum: ['user', 'assistant', 'system'],
      },
    },
    required: [],
  },
};

export const uiStateTool: Tool = {
  name: 'ui_state',
  description:
    'Get current UI state including active view, open panels, selected items, and scroll position. Use for spatial awareness when guiding users through UI interactions. Only available in web/GUI contexts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================
// Tool array for convenience
// ============================================

export const selfAwarenessTools: Tool[] = [
  contextGetTool,
  contextStatsTool,
  whoamiTool,
  identityGetTool,
  energyStatusTool,
  resourceLimitsTool,
  sessionStatsTool,
  toolStatsTool,
  statsSummaryTool,
  sessionStateTool,
  workspaceMapTool,
  messageIndexTool,
  uiStateTool,
];

// ============================================
// Response Types
// ============================================

interface ContextGetResponse {
  totalTokens: number;
  maxContextTokens: number;
  usagePercent: number;
  messageCount: number;
  summaryCount: number;
  lastSummaryAt?: string;
}

interface ContextStatsResponse {
  current: {
    totalTokens: number;
    messageCount: number;
    summaryCount: number;
  };
  limits: {
    maxContextTokens: number;
    targetContextTokens: number;
    summaryTriggerRatio: number;
    maxMessages: number;
  };
  lastSummary?: {
    at: string;
    messageCount: number;
    tokensBefore: number;
    tokensAfter: number;
    strategy: string;
  };
  config: {
    enabled: boolean;
    keepRecentMessages: number;
    summaryStrategy: string;
  };
}

interface WhoamiResponse {
  sessionId: string;
  model?: string;
  assistant?: {
    id: string;
    name: string;
    description?: string;
  };
  identity?: {
    id: string;
    name: string;
    displayName: string;
    communicationStyle: string;
  };
}

interface IdentityGetResponse {
  assistant?: {
    id: string;
    name: string;
    description?: string;
    settings: {
      model: string;
      maxTokens?: number;
      temperature?: number;
      enabledTools?: string[];
      disabledTools?: string[];
    };
    createdAt: string;
    updatedAt: string;
  };
  identity?: {
    id: string;
    name: string;
    isDefault: boolean;
    profile: {
      displayName: string;
      title?: string;
      company?: string;
      timezone: string;
      locale: string;
    };
    preferences: {
      language: string;
      dateFormat: string;
      communicationStyle: string;
      responseLength: string;
    };
    context?: string;
    createdAt: string;
    updatedAt: string;
  };
}

interface EnergyStatusResponse {
  current: number;
  max: number;
  percentage: number;
  level: EnergyLevel;
  regenRate: number;
  effects: {
    promptModifier: string | null;
    responseLengthFactor: number;
    processingDelayMs: number;
  };
}

interface ResourceLimitsResponse {
  context: {
    maxTokens: number;
    targetTokens: number;
    triggerRatio: number;
    maxMessages: number;
    keepRecentMessages: number;
  };
  energy: {
    enabled: boolean;
    maxEnergy: number;
    lowThreshold: number;
    criticalThreshold: number;
    costs: {
      message: number;
      toolCall: number;
      llmCall: number;
      longContext: number;
    };
  };
  wallet: {
    configured: boolean;
    rateLimit?: {
      readsUsed: number;
      maxReads: number;
      windowResetMinutes: number;
    };
  };
}

// ============================================
// Tool Executors Factory
// ============================================

export function createSelfAwarenessToolExecutors(
  context: SelfAwarenessContext
): Record<string, ToolExecutor> {
  return {
    context_get: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();

      if (!contextInfo) {
        return JSON.stringify({
          error: 'Context management not available',
          totalTokens: 0,
          maxContextTokens: 0,
          usagePercent: 0,
          messageCount: 0,
          summaryCount: 0,
        });
      }

      const { config, state } = contextInfo;
      const usagePercent = config.maxContextTokens > 0
        ? Math.round((state.totalTokens / config.maxContextTokens) * 10000) / 100
        : 0;

      const response: ContextGetResponse = {
        totalTokens: state.totalTokens,
        maxContextTokens: config.maxContextTokens,
        usagePercent,
        messageCount: state.messageCount,
        summaryCount: state.summaryCount,
        lastSummaryAt: state.lastSummaryAt,
      };

      return JSON.stringify(response, null, 2);
    },

    context_stats: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();

      if (!contextInfo) {
        return JSON.stringify({
          error: 'Context management not available',
        });
      }

      const { config, state } = contextInfo;

      const response: ContextStatsResponse = {
        current: {
          totalTokens: state.totalTokens,
          messageCount: state.messageCount,
          summaryCount: state.summaryCount,
        },
        limits: {
          maxContextTokens: config.maxContextTokens,
          targetContextTokens: config.targetContextTokens,
          summaryTriggerRatio: config.summaryTriggerRatio,
          maxMessages: config.maxMessages,
        },
        config: {
          enabled: config.enabled,
          keepRecentMessages: config.keepRecentMessages,
          summaryStrategy: config.summaryStrategy,
        },
      };

      if (state.lastSummaryAt) {
        response.lastSummary = {
          at: state.lastSummaryAt,
          messageCount: state.lastSummaryMessageCount ?? 0,
          tokensBefore: state.lastSummaryTokensBefore ?? 0,
          tokensAfter: state.lastSummaryTokensAfter ?? 0,
          strategy: state.lastSummaryStrategy ?? 'unknown',
        };
      }

      return JSON.stringify(response, null, 2);
    },

    whoami: async (): Promise<string> => {
      const assistantManager = context.getAssistantManager?.();
      const identityManager = context.getIdentityManager?.();

      const assistant = assistantManager?.getActive();
      const identity = identityManager?.getActive();

      const response: WhoamiResponse = {
        sessionId: context.sessionId,
        model: context.model,
      };

      if (assistant) {
        response.assistant = {
          id: assistant.id,
          name: assistant.name,
          description: assistant.description,
        };
      }

      if (identity) {
        response.identity = {
          id: identity.id,
          name: identity.name,
          displayName: identity.profile.displayName,
          communicationStyle: identity.preferences.communicationStyle,
        };
      }

      return JSON.stringify(response, null, 2);
    },

    identity_get: async (): Promise<string> => {
      const assistantManager = context.getAssistantManager?.();
      const identityManager = context.getIdentityManager?.();

      const assistant = assistantManager?.getActive();
      const identity = identityManager?.getActive();

      const response: IdentityGetResponse = {};

      if (assistant) {
        response.assistant = {
          id: assistant.id,
          name: assistant.name,
          description: assistant.description,
          settings: {
            model: assistant.settings.model,
            maxTokens: assistant.settings.maxTokens,
            temperature: assistant.settings.temperature,
            enabledTools: assistant.settings.enabledTools,
            disabledTools: assistant.settings.disabledTools,
          },
          createdAt: assistant.createdAt,
          updatedAt: assistant.updatedAt,
        };
      }

      if (identity) {
        response.identity = {
          id: identity.id,
          name: identity.name,
          isDefault: identity.isDefault,
          profile: {
            displayName: identity.profile.displayName,
            title: identity.profile.title,
            company: identity.profile.company,
            timezone: identity.profile.timezone,
            locale: identity.profile.locale,
          },
          preferences: {
            language: identity.preferences.language,
            dateFormat: identity.preferences.dateFormat,
            communicationStyle: identity.preferences.communicationStyle,
            responseLength: identity.preferences.responseLength,
          },
          context: identity.context,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        };
      }

      return JSON.stringify(response, null, 2);
    },

    energy_status: async (): Promise<string> => {
      const energyManager = context.getEnergyManager?.();
      const energyState = context.getEnergyState?.();

      if (!energyManager || !energyState) {
        return JSON.stringify({
          error: 'Energy system not available',
          current: 0,
          max: 0,
          percentage: 0,
          level: 'energetic',
          regenRate: 0,
          effects: {
            promptModifier: null,
            responseLengthFactor: 1.0,
            processingDelayMs: 0,
          },
        });
      }

      const effects = energyManager.getEffects();
      const percentage = energyState.max > 0
        ? Math.round((energyState.current / energyState.max) * 100)
        : 0;

      const response: EnergyStatusResponse = {
        current: energyState.current,
        max: energyState.max,
        percentage,
        level: effects.level,
        regenRate: energyState.regenRate,
        effects: {
          promptModifier: effects.promptModifier ?? null,
          responseLengthFactor: effects.responseLengthFactor,
          processingDelayMs: effects.processingDelayMs,
        },
      };

      return JSON.stringify(response, null, 2);
    },

    resource_limits: async (): Promise<string> => {
      const contextInfo = context.getContextInfo?.();
      const walletManager = context.getWalletManager?.();

      // Default context limits if not available
      const contextConfig = contextInfo?.config ?? {
        maxContextTokens: 200000,
        targetContextTokens: 150000,
        summaryTriggerRatio: 0.85,
        maxMessages: 500,
        keepRecentMessages: 10,
      };

      // Default energy config values
      const defaultEnergyCosts = {
        message: 200,
        toolCall: 500,
        llmCall: 300,
        longContext: 1000,
      };

      const response: ResourceLimitsResponse = {
        context: {
          maxTokens: contextConfig.maxContextTokens,
          targetTokens: contextConfig.targetContextTokens,
          triggerRatio: contextConfig.summaryTriggerRatio,
          maxMessages: contextConfig.maxMessages,
          keepRecentMessages: contextConfig.keepRecentMessages,
        },
        energy: {
          enabled: true,
          maxEnergy: 10000,
          lowThreshold: 3000,
          criticalThreshold: 1000,
          costs: defaultEnergyCosts,
        },
        wallet: {
          configured: walletManager?.isConfigured() ?? false,
        },
      };

      // Add wallet rate limit info if available
      if (walletManager?.isConfigured()) {
        const rateLimitStatus = walletManager.getRateLimitStatus();
        response.wallet.rateLimit = {
          readsUsed: rateLimitStatus.readsUsed,
          maxReads: rateLimitStatus.maxReads,
          windowResetMinutes: rateLimitStatus.windowResetMinutes,
        };
      }

      return JSON.stringify(response, null, 2);
    },

    session_stats: async (): Promise<string> => {
      const statsTracker = context.getStatsTracker?.();

      if (!statsTracker) {
        return JSON.stringify({
          error: 'Stats tracking not available',
          sessionId: context.sessionId,
          totalToolCalls: 0,
          totalSuccessful: 0,
          totalFailed: 0,
          totalExecutionTimeMs: 0,
          avgTimeBetweenCallsMs: 0,
          totalLlmCalls: 0,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            maxContextTokens: 0,
          },
          toolStats: {},
        });
      }

      const stats = statsTracker.getSessionStats();
      return JSON.stringify(stats, null, 2);
    },

    tool_stats: async (input: { tool_name?: string }): Promise<string> => {
      const statsTracker = context.getStatsTracker?.();

      if (!statsTracker) {
        return JSON.stringify({
          error: 'Stats tracking not available',
          tools: [],
        });
      }

      if (input.tool_name) {
        const toolStats = statsTracker.getToolStats(input.tool_name);
        if (!toolStats) {
          return JSON.stringify({
            error: `No stats found for tool: ${input.tool_name}`,
            tool: input.tool_name,
          });
        }
        return JSON.stringify(toolStats, null, 2);
      }

      const allStats = statsTracker.getAllToolStats();
      return JSON.stringify({ tools: allStats }, null, 2);
    },

    stats_summary: async (): Promise<string> => {
      const statsTracker = context.getStatsTracker?.();

      if (!statsTracker) {
        return JSON.stringify({
          error: 'Stats tracking not available',
          totalToolCalls: 0,
          successRate: 100,
          avgDurationMs: 0,
          topTools: [],
          totalLlmCalls: 0,
          tokensUsed: 0,
        });
      }

      const summary = statsTracker.getSummary();
      return JSON.stringify(summary, null, 2);
    },

    session_state: async (): Promise<string> => {
      const assistantManager = context.getAssistantManager?.();
      const identityManager = context.getIdentityManager?.();
      const pendingToolCalls = context.getPendingToolCalls?.();
      const lastError = context.getLastError?.();

      const isProcessing = context.isProcessing?.() ?? false;
      const queueLength = context.getQueueLength?.() ?? 0;
      const cwd = context.getCwd?.() ?? process.cwd();
      const startedAt = context.getStartedAt?.() ?? new Date().toISOString();

      // Calculate uptime
      const startTime = new Date(startedAt).getTime();
      const uptimeMs = Date.now() - startTime;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);

      // Get pending tool call info
      const pendingTools: { id: string; name: string }[] = [];
      if (pendingToolCalls) {
        for (const [id, name] of pendingToolCalls) {
          pendingTools.push({ id, name });
        }
      }

      const assistant = assistantManager?.getActive();
      const identity = identityManager?.getActive();

      const response = {
        sessionId: context.sessionId,
        status: isProcessing ? 'processing' : 'idle',
        queueLength,
        model: context.model,
        cwd,
        startedAt,
        uptimeSeconds,
        assistant: assistant ? {
          id: assistant.id,
          name: assistant.name,
        } : null,
        identity: identity ? {
          id: identity.id,
          name: identity.name,
          displayName: identity.profile.displayName,
        } : null,
        pendingToolCalls: pendingTools,
        lastError: lastError ? {
          message: lastError.message,
          timestamp: lastError.timestamp,
        } : null,
      };

      return JSON.stringify(response, null, 2);
    },

    workspace_map: async (input: {
      depth?: number;
      include_git_status?: boolean;
      include_recent_files?: boolean;
      max_files?: number;
    }): Promise<string> => {
      const { readdir, stat, access } = await import('fs/promises');
      const { execSync } = await import('child_process');
      const { join, basename } = await import('path');

      const depth = input.depth ?? 3;
      const includeGitStatus = input.include_git_status !== false;
      const includeRecentFiles = input.include_recent_files !== false;
      const maxFiles = input.max_files ?? 20;

      const cwd = context.getCwd?.() ?? process.cwd();

      // Default ignore patterns
      const ignorePatterns = [
        'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
        '__pycache__', '.venv', 'venv', '.cache', 'coverage',
        '.DS_Store', 'Thumbs.db', '*.log',
      ];

      const shouldIgnore = (name: string): boolean => {
        return ignorePatterns.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(name);
          }
          return name === pattern;
        });
      };

      // Build directory tree
      interface TreeNode {
        name: string;
        type: 'file' | 'directory';
        children?: TreeNode[];
      }

      const buildTree = async (dir: string, currentDepth: number): Promise<TreeNode[]> => {
        if (currentDepth > depth) return [];

        try {
          const entries = await readdir(dir, { withFileTypes: true });
          const nodes: TreeNode[] = [];
          let fileCount = 0;

          for (const entry of entries) {
            if (shouldIgnore(entry.name)) continue;
            if (fileCount >= maxFiles) {
              nodes.push({ name: `... and more files`, type: 'file' });
              break;
            }

            if (entry.isDirectory()) {
              const children = await buildTree(join(dir, entry.name), currentDepth + 1);
              nodes.push({
                name: entry.name,
                type: 'directory',
                children: children.length > 0 ? children : undefined,
              });
            } else {
              nodes.push({ name: entry.name, type: 'file' });
              fileCount++;
            }
          }

          return nodes.sort((a, b) => {
            // Directories first
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        } catch {
          return [];
        }
      };

      // Get git status
      let gitStatus: { branch?: string; status: string[]; isRepo: boolean } = {
        isRepo: false,
        status: [],
      };

      if (includeGitStatus) {
        try {
          await access(join(cwd, '.git'));
          gitStatus.isRepo = true;

          try {
            const branch = execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim();
            gitStatus.branch = branch || 'HEAD detached';
          } catch {
            gitStatus.branch = 'unknown';
          }

          try {
            const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });
            gitStatus.status = status.split('\n').filter(Boolean).slice(0, 20);
            if (status.split('\n').filter(Boolean).length > 20) {
              gitStatus.status.push('... and more changes');
            }
          } catch {
            gitStatus.status = [];
          }
        } catch {
          // Not a git repo
        }
      }

      // Get recent files
      interface RecentFile {
        path: string;
        mtime: string;
      }

      const recentFiles: RecentFile[] = [];

      if (includeRecentFiles) {
        const collectFiles = async (dir: string, relativePath: string = ''): Promise<void> => {
          if (recentFiles.length >= 10) return;

          try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (shouldIgnore(entry.name)) continue;

              const fullPath = join(dir, entry.name);
              const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

              if (entry.isFile()) {
                try {
                  const stats = await stat(fullPath);
                  recentFiles.push({
                    path: relPath,
                    mtime: stats.mtime.toISOString(),
                  });
                } catch {
                  // Skip files we can't stat
                }
              } else if (entry.isDirectory() && recentFiles.length < 10) {
                await collectFiles(fullPath, relPath);
              }
            }
          } catch {
            // Skip directories we can't read
          }
        };

        await collectFiles(cwd);
        recentFiles.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
        recentFiles.splice(10); // Keep only top 10
      }

      // Detect project type
      const projectIndicators: { type: string; file: string }[] = [
        { type: 'node', file: 'package.json' },
        { type: 'python', file: 'pyproject.toml' },
        { type: 'python', file: 'setup.py' },
        { type: 'rust', file: 'Cargo.toml' },
        { type: 'go', file: 'go.mod' },
        { type: 'ruby', file: 'Gemfile' },
        { type: 'java', file: 'pom.xml' },
        { type: 'java', file: 'build.gradle' },
      ];

      let projectType = 'unknown';
      let projectName = basename(cwd);

      for (const indicator of projectIndicators) {
        try {
          await access(join(cwd, indicator.file));
          projectType = indicator.type;

          if (indicator.file === 'package.json') {
            try {
              const { readFile } = await import('fs/promises');
              const pkg = JSON.parse(await readFile(join(cwd, indicator.file), 'utf-8'));
              projectName = pkg.name || projectName;
            } catch {
              // Ignore parse errors
            }
          }
          break;
        } catch {
          // File doesn't exist
        }
      }

      const tree = await buildTree(cwd, 1);

      const response = {
        projectRoot: cwd,
        projectName,
        projectType,
        git: gitStatus,
        tree,
        recentFiles: includeRecentFiles ? recentFiles : undefined,
      };

      return JSON.stringify(response, null, 2);
    },

    message_index: async (input: {
      limit?: number;
      offset?: number;
      role?: 'user' | 'assistant' | 'system';
    }): Promise<string> => {
      const messages = context.getMessages?.() ?? [];
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;

      // Extract topic from content (first 8-12 words)
      const extractTopic = (content: string): string => {
        if (!content) return '(empty)';

        // Remove markdown formatting
        const cleaned = content
          .replace(/```[\s\S]*?```/g, '[code block]')
          .replace(/`[^`]+`/g, '[code]')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/#{1,6}\s/g, '')
          .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
          .trim();

        const words = cleaned.split(/\s+/).slice(0, 10);
        const topic = words.join(' ');

        return topic.length > 60 ? topic.slice(0, 57) + '...' : topic;
      };

      // Filter by role if specified
      let filtered = messages;
      if (input.role) {
        filtered = messages.filter(m => m.role === input.role);
      }

      // Apply pagination
      const paginated = filtered.slice(offset, offset + limit);

      // Build index
      const index = paginated.map((msg, idx) => ({
        index: offset + idx,
        id: msg.id,
        role: msg.role,
        timestamp: new Date(msg.timestamp).toISOString(),
        topic: extractTopic(msg.content),
        contentLength: msg.content.length,
      }));

      return JSON.stringify({
        total: filtered.length,
        offset,
        limit,
        count: index.length,
        messages: index,
      }, null, 2);
    },

    ui_state: async (): Promise<string> => {
      const uiState = context.getUiState?.();

      if (!uiState) {
        return JSON.stringify({
          available: false,
          message: 'UI state not available (terminal/CLI context)',
          context: 'terminal',
        }, null, 2);
      }

      return JSON.stringify({
        available: true,
        context: 'web',
        route: uiState.route ?? 'unknown',
        panels: uiState.panels ?? [],
        selectedItems: uiState.selectedItems ?? {},
        filters: uiState.filters ?? {},
        scrollPosition: uiState.scrollPosition ?? { x: 0, y: 0 },
      }, null, 2);
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerSelfAwarenessTools(
  registry: ToolRegistry,
  context: SelfAwarenessContext
): void {
  const executors = createSelfAwarenessToolExecutors(context);

  for (const tool of selfAwarenessTools) {
    registry.register(tool, executors[tool.name]);
  }
}
