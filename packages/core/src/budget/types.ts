import type { BudgetLimits, BudgetUsage } from '@hasna/assistants-shared';

/**
 * Budget scope for tracking
 */
export type BudgetScope = 'session' | 'assistant' | 'swarm' | 'project';

/**
 * Budget check result
 */
export interface BudgetCheckResult {
  /** Whether the budget is exceeded */
  exceeded: boolean;
  /** Which limit was exceeded (if any) */
  limitExceeded?: keyof BudgetLimits;
  /** Current usage value */
  currentValue?: number;
  /** Limit value */
  limitValue?: number;
  /** Percentage of limit used */
  percentUsed?: number;
  /** Warning message if approaching limit */
  warning?: string;
}

/**
 * Budget status for display
 */
export interface BudgetStatus {
  scope: BudgetScope;
  limits: BudgetLimits;
  usage: BudgetUsage;
  checks: {
    inputTokens?: BudgetCheckResult;
    outputTokens?: BudgetCheckResult;
    totalTokens?: BudgetCheckResult;
    llmCalls?: BudgetCheckResult;
    toolCalls?: BudgetCheckResult;
    durationMs?: BudgetCheckResult;
  };
  overallExceeded: boolean;
  warningsCount: number;
}

/**
 * Budget summary across tracked scopes
 */
export interface BudgetSummary {
  enabled: boolean;
  session: BudgetStatus;
  swarm: BudgetStatus;
  project: BudgetStatus | null;
  assistantCount: number;
  anyExceeded: boolean;
  totalWarnings: number;
}

/**
 * Budget update input
 */
export interface BudgetUpdate {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  llmCalls?: number;
  toolCalls?: number;
  durationMs?: number;
}
