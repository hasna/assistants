/**
 * Budget tools for assistant use
 * Native tools that allow assistants to check and manage resource budgets
 */

import type { BudgetLimits, Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { BudgetTracker } from './tracker';

type BudgetToolScope = 'session' | 'swarm' | 'project';
type BudgetResetScope = BudgetToolScope | 'all';

const BUDGET_TOOL_SCOPES: BudgetToolScope[] = ['session', 'swarm', 'project'];
const LIMIT_FIELDS: Array<keyof BudgetLimits> = [
  'maxInputTokens',
  'maxOutputTokens',
  'maxTotalTokens',
  'maxLlmCalls',
  'maxToolCalls',
  'maxDurationMs',
];

function normalizeScope(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isBudgetToolScope(value: string): value is BudgetToolScope {
  return BUDGET_TOOL_SCOPES.includes(value as BudgetToolScope);
}

function isBudgetResetScope(value: string): value is BudgetResetScope {
  return value === 'all' || isBudgetToolScope(value);
}

function parseLimitValue(value: unknown): number | undefined | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null;
  }
  // `0` means "unlimited", represented as `undefined` in config.
  return numeric === 0 ? undefined : numeric;
}

/**
 * budget_status - Get current budget status
 */
export const budgetStatusTool: Tool = {
  name: 'budget_status',
  description: 'Get current budget status showing usage vs limits for the specified scope (session, swarm, or project).',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to check: "session" (default), "swarm", or "project"',
        enum: ['session', 'swarm', 'project'],
      },
    },
    required: [],
  },
};

/**
 * budget_get - Get budget configuration
 */
export const budgetGetTool: Tool = {
  name: 'budget_get',
  description: 'Get current budget configuration including limits, thresholds, and actions for all scopes.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * budget_set - Update budget limits
 */
export const budgetSetTool: Tool = {
  name: 'budget_set',
  description: 'Update budget limits for a specific scope. Set individual limits like maxTotalTokens, maxLlmCalls, etc.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to update: "session", "swarm", or "project"',
        enum: ['session', 'swarm', 'project'],
      },
      maxInputTokens: {
        type: 'number',
        description: 'Maximum input tokens allowed (0 = unlimited)',
      },
      maxOutputTokens: {
        type: 'number',
        description: 'Maximum output tokens allowed (0 = unlimited)',
      },
      maxTotalTokens: {
        type: 'number',
        description: 'Maximum total tokens allowed (0 = unlimited)',
      },
      maxLlmCalls: {
        type: 'number',
        description: 'Maximum LLM API calls allowed (0 = unlimited)',
      },
      maxToolCalls: {
        type: 'number',
        description: 'Maximum tool calls allowed (0 = unlimited)',
      },
      maxDurationMs: {
        type: 'number',
        description: 'Maximum duration in milliseconds (0 = unlimited)',
      },
    },
    required: ['scope'],
  },
};

/**
 * budget_reset - Reset budget counters
 */
export const budgetResetTool: Tool = {
  name: 'budget_reset',
  description: 'Reset budget usage counters for a specific scope back to zero.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Budget scope to reset: "session", "swarm", "project", or "all"',
        enum: ['session', 'swarm', 'project', 'all'],
      },
    },
    required: ['scope'],
  },
};

/**
 * Create executors for budget tools
 */
export function createBudgetToolExecutors(
  getBudgetTracker: () => BudgetTracker | null
): Record<string, ToolExecutor> {
  return {
    budget_status: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scopeInput = normalizeScope(input.scope || 'session');
      if (!isBudgetToolScope(scopeInput)) {
        return `Invalid scope: ${scopeInput || '(empty)'}. Use "session", "swarm", or "project".`;
      }
      const scope: BudgetToolScope = scopeInput;
      const status = tracker.checkBudget(scope);

      const lines: string[] = [];
      lines.push(`## Budget Status (${scope})`);
      lines.push('');

      // Usage summary
      const u = status.usage;
      lines.push(`**Usage:**`);
      lines.push(`  Input tokens: ${u.inputTokens.toLocaleString()}`);
      lines.push(`  Output tokens: ${u.outputTokens.toLocaleString()}`);
      lines.push(`  Total tokens: ${u.totalTokens.toLocaleString()}`);
      lines.push(`  LLM calls: ${u.llmCalls}`);
      lines.push(`  Tool calls: ${u.toolCalls}`);
      lines.push(`  Duration: ${Math.round(u.durationMs / 1000)}s`);
      lines.push('');

      // Limits
      const l = status.limits;
      lines.push(`**Limits:**`);
      if (l.maxInputTokens) lines.push(`  Input tokens: ${l.maxInputTokens.toLocaleString()}`);
      if (l.maxOutputTokens) lines.push(`  Output tokens: ${l.maxOutputTokens.toLocaleString()}`);
      if (l.maxTotalTokens) lines.push(`  Total tokens: ${l.maxTotalTokens.toLocaleString()}`);
      if (l.maxLlmCalls) lines.push(`  LLM calls: ${l.maxLlmCalls}`);
      if (l.maxToolCalls) lines.push(`  Tool calls: ${l.maxToolCalls}`);
      if (l.maxDurationMs) lines.push(`  Duration: ${Math.round(l.maxDurationMs / 1000)}s`);
      if (!l.maxInputTokens && !l.maxOutputTokens && !l.maxTotalTokens && !l.maxLlmCalls && !l.maxToolCalls && !l.maxDurationMs) {
        lines.push('  (no limits set)');
      }
      lines.push('');

      // Warnings
      if (status.overallExceeded) {
        lines.push('**STATUS: BUDGET EXCEEDED**');
      } else if (status.warningsCount > 0) {
        lines.push(`**STATUS: ${status.warningsCount} warning(s) - approaching limits**`);
      } else {
        lines.push('**STATUS: OK**');
      }

      return lines.join('\n');
    },

    budget_get: async () => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const config = tracker.getConfig();
      return JSON.stringify(config, null, 2);
    },

    budget_set: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scopeInput = normalizeScope(input.scope || 'session');
      if (!isBudgetToolScope(scopeInput)) {
        return `Invalid scope: ${scopeInput || '(empty)'}. Use "session", "swarm", or "project".`;
      }
      const scope: BudgetToolScope = scopeInput;
      const config = tracker.getConfig();

      const updates: Record<string, number | undefined> = {};
      const providedFields: Array<keyof BudgetLimits> = [];
      const invalidFields: string[] = [];
      for (const field of LIMIT_FIELDS) {
        if (input[field] === undefined) continue;
        providedFields.push(field);
        const parsed = parseLimitValue(input[field]);
        if (parsed === null) {
          invalidFields.push(field);
          continue;
        }
        updates[field] = parsed;
      }

      if (providedFields.length === 0) {
        return 'No limits specified. Provide at least one limit to update.';
      }
      if (invalidFields.length > 0) {
        return `Invalid limit values for: ${invalidFields.join(', ')}. Values must be numbers >= 0 (0 = unlimited).`;
      }

      tracker.updateConfig({
        [scope]: {
          ...(config[scope] || {}),
          ...updates,
        },
      });

      const applied = Object.fromEntries(
        providedFields.map((field) => [field, updates[field] ?? 'unlimited'])
      );
      return `Budget limits updated for ${scope} scope:\n${JSON.stringify(applied, null, 2)}`;
    },

    budget_reset: async (input) => {
      const tracker = getBudgetTracker();
      if (!tracker) {
        return 'Budget tracking is not enabled.';
      }

      const scope = normalizeScope(input.scope || 'session');
      if (!isBudgetResetScope(scope)) {
        return `Invalid scope: ${scope || '(empty)'}. Use "session", "swarm", "project", or "all".`;
      }

      if (scope === 'all') {
        tracker.resetAll();
        return 'All budget counters have been reset.';
      }

      tracker.resetUsage(scope);
      return `Budget counters reset for ${scope} scope.`;
    },
  };
}

/**
 * All budget tools
 */
export const budgetTools: Tool[] = [
  budgetStatusTool,
  budgetGetTool,
  budgetSetTool,
  budgetResetTool,
];

/**
 * Register budget tools with a tool registry
 */
export function registerBudgetTools(
  registry: ToolRegistry,
  getBudgetTracker: () => BudgetTracker | null
): void {
  const executors = createBudgetToolExecutors(getBudgetTracker);

  for (const tool of budgetTools) {
    registry.register(tool, executors[tool.name]);
  }
}
