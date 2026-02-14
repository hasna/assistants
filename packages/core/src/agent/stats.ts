import type { ToolCall, ToolResult, TokenUsage } from '@hasna/assistants-shared';

/**
 * Per-tool statistics
 */
export interface ToolStats {
  /** Tool name */
  name: string;
  /** Total number of calls */
  callCount: number;
  /** Number of successful calls */
  successCount: number;
  /** Number of failed calls */
  failureCount: number;
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Minimum execution time in milliseconds */
  minDurationMs: number;
  /** Maximum execution time in milliseconds */
  maxDurationMs: number;
  /** Average execution time in milliseconds */
  avgDurationMs: number;
  /** Median execution time in milliseconds (approximate) */
  medianDurationMs: number;
  /** Last execution time in milliseconds */
  lastDurationMs: number;
  /** Last execution timestamp */
  lastExecutedAt: string;
  /** Number of truncated outputs */
  truncatedCount: number;
}

/**
 * Session-level statistics
 */
export interface SessionStats {
  /** Session ID */
  sessionId: string;
  /** Session start time */
  startedAt: string;
  /** Total number of tool calls */
  totalToolCalls: number;
  /** Total successful tool calls */
  totalSuccessful: number;
  /** Total failed tool calls */
  totalFailed: number;
  /** Total execution time across all tools (ms) */
  totalExecutionTimeMs: number;
  /** Average time between tool calls (ms) */
  avgTimeBetweenCallsMs: number;
  /** Total LLM API calls */
  totalLlmCalls: number;
  /** Token usage totals */
  tokenUsage: TokenUsage;
  /** Per-tool statistics */
  toolStats: Record<string, ToolStats>;
}

/**
 * In-flight tool call tracking
 */
interface PendingToolCall {
  toolCall: ToolCall;
  startTime: number;
}

/**
 * Tool call stats tracker
 * Tracks per-session and per-tool statistics for tool calls
 */
export class StatsTracker {
  private sessionId: string;
  private startedAt: string;
  private toolStats: Map<string, ToolStats> = new Map();
  private pendingCalls: Map<string, PendingToolCall> = new Map();
  private durations: Map<string, number[]> = new Map();
  private lastCallEndTime: number | null = null;
  private timeBetweenCalls: number[] = [];
  private llmCallCount = 0;
  private tokenUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    maxContextTokens: 180000,
  };

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startedAt = new Date().toISOString();
  }

  /**
   * Called when a tool call starts
   */
  onToolStart(toolCall: ToolCall): void {
    const startTime = Date.now();

    // Track time between calls
    if (this.lastCallEndTime !== null) {
      const timeSinceLastCall = startTime - this.lastCallEndTime;
      this.timeBetweenCalls.push(timeSinceLastCall);
    }

    // Track pending call
    this.pendingCalls.set(toolCall.id, {
      toolCall,
      startTime,
    });

    // Initialize tool stats if needed
    if (!this.toolStats.has(toolCall.name)) {
      this.toolStats.set(toolCall.name, {
        name: toolCall.name,
        callCount: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0,
        avgDurationMs: 0,
        medianDurationMs: 0,
        lastDurationMs: 0,
        lastExecutedAt: '',
        truncatedCount: 0,
      });
      this.durations.set(toolCall.name, []);
    }
  }

  /**
   * Called when a tool call completes
   */
  onToolEnd(toolCall: ToolCall, result: ToolResult): void {
    const endTime = Date.now();
    const pending = this.pendingCalls.get(toolCall.id);

    if (!pending) {
      // Tool was started before this tracker existed, estimate duration as 0
      return;
    }

    const duration = endTime - pending.startTime;
    this.lastCallEndTime = endTime;
    this.pendingCalls.delete(toolCall.id);

    // Update tool stats
    const stats = this.toolStats.get(toolCall.name);
    if (stats) {
      stats.callCount++;
      stats.totalDurationMs += duration;
      stats.minDurationMs = Math.min(stats.minDurationMs, duration);
      stats.maxDurationMs = Math.max(stats.maxDurationMs, duration);
      stats.lastDurationMs = duration;
      stats.lastExecutedAt = new Date().toISOString();

      if (result.isError) {
        stats.failureCount++;
      } else {
        stats.successCount++;
      }

      if (result.truncated) {
        stats.truncatedCount++;
      }

      // Update average
      stats.avgDurationMs = Math.round(stats.totalDurationMs / stats.callCount);

      // Update durations array for median calculation
      const durationsArray = this.durations.get(toolCall.name);
      if (durationsArray) {
        durationsArray.push(duration);
        // Keep only last 100 durations for memory efficiency
        if (durationsArray.length > 100) {
          durationsArray.shift();
        }
        stats.medianDurationMs = this.calculateMedian(durationsArray);
      }
    }
  }

  /**
   * Called when an LLM API call is made
   */
  onLlmCall(): void {
    this.llmCallCount++;
  }

  /**
   * Update token usage
   */
  updateTokenUsage(usage: Partial<TokenUsage>): void {
    if (usage.inputTokens !== undefined) {
      this.tokenUsage.inputTokens = usage.inputTokens;
    }
    if (usage.outputTokens !== undefined) {
      this.tokenUsage.outputTokens = usage.outputTokens;
    }
    if (usage.totalTokens !== undefined) {
      this.tokenUsage.totalTokens = usage.totalTokens;
    }
    if (usage.maxContextTokens !== undefined) {
      this.tokenUsage.maxContextTokens = usage.maxContextTokens;
    }
    if (usage.cacheReadTokens !== undefined) {
      this.tokenUsage.cacheReadTokens = usage.cacheReadTokens;
    }
    if (usage.cacheWriteTokens !== undefined) {
      this.tokenUsage.cacheWriteTokens = usage.cacheWriteTokens;
    }
  }

  /**
   * Get statistics for a specific tool
   */
  getToolStats(toolName: string): ToolStats | null {
    return this.toolStats.get(toolName) || null;
  }

  /**
   * Get all tool statistics
   */
  getAllToolStats(): ToolStats[] {
    return Array.from(this.toolStats.values());
  }

  /**
   * Get session-level statistics
   */
  getSessionStats(): SessionStats {
    let totalToolCalls = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let totalExecutionTimeMs = 0;

    const toolStatsRecord: Record<string, ToolStats> = {};

    for (const [name, stats] of this.toolStats) {
      totalToolCalls += stats.callCount;
      totalSuccessful += stats.successCount;
      totalFailed += stats.failureCount;
      totalExecutionTimeMs += stats.totalDurationMs;
      toolStatsRecord[name] = { ...stats };
    }

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      totalToolCalls,
      totalSuccessful,
      totalFailed,
      totalExecutionTimeMs,
      avgTimeBetweenCallsMs: this.calculateAverage(this.timeBetweenCalls),
      totalLlmCalls: this.llmCallCount,
      tokenUsage: { ...this.tokenUsage },
      toolStats: toolStatsRecord,
    };
  }

  /**
   * Get summary statistics (compact format)
   */
  getSummary(): {
    totalToolCalls: number;
    successRate: number;
    avgDurationMs: number;
    topTools: { name: string; count: number; avgMs: number }[];
    totalLlmCalls: number;
    tokensUsed: number;
  } {
    const stats = this.getSessionStats();

    const successRate = stats.totalToolCalls > 0
      ? Math.round((stats.totalSuccessful / stats.totalToolCalls) * 100)
      : 100;

    const avgDurationMs = stats.totalToolCalls > 0
      ? Math.round(stats.totalExecutionTimeMs / stats.totalToolCalls)
      : 0;

    // Get top 5 most used tools
    const topTools = this.getAllToolStats()
      .sort((a, b) => b.callCount - a.callCount)
      .slice(0, 5)
      .map(t => ({
        name: t.name,
        count: t.callCount,
        avgMs: t.avgDurationMs,
      }));

    return {
      totalToolCalls: stats.totalToolCalls,
      successRate,
      avgDurationMs,
      topTools,
      totalLlmCalls: this.llmCallCount,
      tokensUsed: stats.tokenUsage.totalTokens,
    };
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.toolStats.clear();
    this.pendingCalls.clear();
    this.durations.clear();
    this.lastCallEndTime = null;
    this.timeBetweenCalls = [];
    this.llmCallCount = 0;
    this.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      maxContextTokens: 180000,
    };
    this.startedAt = new Date().toISOString();
  }

  /**
   * Calculate median of an array
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  }

  /**
   * Calculate average of an array
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.round(sum / values.length);
  }
}
