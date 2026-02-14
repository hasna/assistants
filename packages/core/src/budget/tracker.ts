import type { BudgetConfig, BudgetLimits, BudgetUsage } from '@hasna/assistants-shared';
import type { BudgetScope, BudgetCheckResult, BudgetStatus, BudgetSummary, BudgetUpdate } from './types';
import { DEFAULT_BUDGET_CONFIG, WARNING_THRESHOLD } from './defaults';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

/**
 * Creates a fresh usage object
 */
function createEmptyUsage(): BudgetUsage {
  const now = new Date().toISOString();
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    llmCalls: 0,
    toolCalls: 0,
    durationMs: 0,
    periodStartedAt: now,
    lastUpdatedAt: now,
  };
}

/**
 * Budget tracker for monitoring resource usage against limits
 */
export class BudgetTracker {
  private config: BudgetConfig;
  private sessionUsage: BudgetUsage;
  private assistantUsages: Map<string, BudgetUsage> = new Map();
  private swarmUsage: BudgetUsage;
  private projectUsages: Map<string, BudgetUsage> = new Map();
  private sessionId: string;
  private activeProjectId: string | null = null;
  private db: DatabaseConnection | null = null;

  constructor(sessionId: string, config?: Partial<BudgetConfig>, db?: DatabaseConnection) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.sessionUsage = createEmptyUsage();
    this.swarmUsage = createEmptyUsage();

    // Set up DB connection if persistence is enabled
    if (this.config.persist) {
      try {
        this.db = db || getDb();
      } catch {
        // Fall back to in-memory only
      }
    }

    // Load persisted state if enabled
    if (this.config.persist && this.db) {
      this.loadState();
    }
  }

  private loadState(): void {
    if (!this.db) return;
    try {
      // Load session usage
      const sessionRow = this.db.query<{ input_tokens: number; output_tokens: number; total_tokens: number; api_calls: number; tool_calls: number; estimated_cost_usd: number; updated_at: string }>(
        "SELECT * FROM budget_usage WHERE scope = 'session' AND scope_id = ?"
      ).get(this.sessionId);

      if (sessionRow) {
        this.sessionUsage = {
          ...this.sessionUsage,
          inputTokens: sessionRow.input_tokens,
          outputTokens: sessionRow.output_tokens,
          totalTokens: sessionRow.total_tokens,
          llmCalls: sessionRow.api_calls,
          toolCalls: sessionRow.tool_calls,
          lastUpdatedAt: sessionRow.updated_at,
        };
      }

      // Load swarm usage
      const swarmRow = this.db.query<{ input_tokens: number; output_tokens: number; total_tokens: number; api_calls: number; tool_calls: number; updated_at: string }>(
        "SELECT * FROM budget_usage WHERE scope = 'swarm' AND scope_id = ?"
      ).get(this.sessionId);

      if (swarmRow) {
        this.swarmUsage = {
          ...this.swarmUsage,
          inputTokens: swarmRow.input_tokens,
          outputTokens: swarmRow.output_tokens,
          totalTokens: swarmRow.total_tokens,
          llmCalls: swarmRow.api_calls,
          toolCalls: swarmRow.tool_calls,
          lastUpdatedAt: swarmRow.updated_at,
        };
      }

      // Load assistant usages
      const assistantRows = this.db.query<{ scope_id: string; input_tokens: number; output_tokens: number; total_tokens: number; api_calls: number; tool_calls: number; updated_at: string }>(
        "SELECT * FROM budget_usage WHERE scope = 'assistant' AND scope_id LIKE ?"
      ).all(`${this.sessionId}:%`);

      for (const row of assistantRows) {
        const assistantId = row.scope_id.replace(`${this.sessionId}:`, '');
        this.assistantUsages.set(assistantId, {
          ...createEmptyUsage(),
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          totalTokens: row.total_tokens,
          llmCalls: row.api_calls,
          toolCalls: row.tool_calls,
          lastUpdatedAt: row.updated_at,
        });
      }

      // Load project usages
      const projectRows = this.db.query<{ scope_id: string; input_tokens: number; output_tokens: number; total_tokens: number; api_calls: number; tool_calls: number; updated_at: string }>(
        "SELECT * FROM budget_usage WHERE scope = 'project'"
      ).all();

      for (const row of projectRows) {
        this.projectUsages.set(row.scope_id, {
          ...createEmptyUsage(),
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          totalTokens: row.total_tokens,
          llmCalls: row.api_calls,
          toolCalls: row.tool_calls,
          lastUpdatedAt: row.updated_at,
        });
      }
    } catch {
      // Failed to load state, start fresh
    }
  }

  private saveUsageRow(scope: string, scopeId: string, usage: BudgetUsage): void {
    if (!this.db || !this.config.persist) return;
    try {
      this.db.prepare(
        `INSERT OR REPLACE INTO budget_usage (scope, scope_id, input_tokens, output_tokens, total_tokens, api_calls, tool_calls, estimated_cost_usd, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scope,
        scopeId,
        usage.inputTokens,
        usage.outputTokens,
        usage.totalTokens,
        usage.llmCalls,
        usage.toolCalls,
        0,
        usage.lastUpdatedAt,
      );
    } catch {
      // Non-critical
    }
  }

  private saveState(): void {
    if (!this.db || !this.config.persist) return;
    this.saveUsageRow('session', this.sessionId, this.sessionUsage);
    this.saveUsageRow('swarm', this.sessionId, this.swarmUsage);
  }

  private saveProjectState(projectId: string, usage: BudgetUsage): void {
    this.saveUsageRow('project', projectId, usage);
  }

  /**
   * Check if budget enforcement is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled ?? false;
  }

  /**
   * Enable or disable budget enforcement
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Set the active project for automatic project budget tracking
   */
  setActiveProject(projectId: string | null): void {
    this.activeProjectId = projectId;
    if (projectId && !this.projectUsages.has(projectId)) {
      // Load from DB or create new
      if (this.db && this.config.persist) {
        const row = this.db.query<{ input_tokens: number; output_tokens: number; total_tokens: number; api_calls: number; tool_calls: number; updated_at: string }>(
          "SELECT * FROM budget_usage WHERE scope = 'project' AND scope_id = ?"
        ).get(projectId);
        if (row) {
          this.projectUsages.set(projectId, {
            ...createEmptyUsage(),
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            llmCalls: row.api_calls,
            toolCalls: row.tool_calls,
            lastUpdatedAt: row.updated_at,
          });
        } else {
          this.projectUsages.set(projectId, createEmptyUsage());
        }
      } else {
        this.projectUsages.set(projectId, createEmptyUsage());
      }
    }
  }

  /**
   * Get the active project ID
   */
  getActiveProject(): string | null {
    return this.activeProjectId;
  }

  /**
   * Get the current configuration
   */
  getConfig(): BudgetConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Check a single limit
   */
  private checkLimit(
    current: number,
    limit: number | undefined,
    name: string
  ): BudgetCheckResult {
    if (limit === undefined) {
      return { exceeded: false };
    }

    const percentUsed = (current / limit) * 100;
    const exceeded = current >= limit;
    const result: BudgetCheckResult = {
      exceeded,
      currentValue: current,
      limitValue: limit,
      percentUsed: Math.round(percentUsed * 10) / 10,
    };

    if (exceeded) {
      result.limitExceeded = name as keyof BudgetLimits;
    } else if (percentUsed >= WARNING_THRESHOLD * 100) {
      result.warning = `Approaching ${name} limit: ${Math.round(percentUsed)}% used`;
    }

    return result;
  }

  /**
   * Check budget for a scope
   */
  checkBudget(scope: BudgetScope, idOrAssistant?: string): BudgetStatus {
    let limits: BudgetLimits;
    let usage: BudgetUsage;

    switch (scope) {
      case 'session':
        limits = this.config.session || {};
        usage = this.sessionUsage;
        break;
      case 'assistant':
        limits = this.config.assistant || {};
        usage = idOrAssistant
          ? (this.assistantUsages.get(idOrAssistant) || createEmptyUsage())
          : createEmptyUsage();
        break;
      case 'swarm':
        limits = this.config.swarm || {};
        usage = this.swarmUsage;
        break;
      case 'project':
        limits = this.config.project || {};
        usage = idOrAssistant
          ? (this.projectUsages.get(idOrAssistant) || createEmptyUsage())
          : (this.activeProjectId
            ? (this.projectUsages.get(this.activeProjectId) || createEmptyUsage())
            : createEmptyUsage());
        break;
    }

    const checks = {
      inputTokens: this.checkLimit(usage.inputTokens, limits.maxInputTokens, 'inputTokens'),
      outputTokens: this.checkLimit(usage.outputTokens, limits.maxOutputTokens, 'outputTokens'),
      totalTokens: this.checkLimit(usage.totalTokens, limits.maxTotalTokens, 'totalTokens'),
      llmCalls: this.checkLimit(usage.llmCalls, limits.maxLlmCalls, 'llmCalls'),
      toolCalls: this.checkLimit(usage.toolCalls, limits.maxToolCalls, 'toolCalls'),
      durationMs: this.checkLimit(usage.durationMs, limits.maxDurationMs, 'durationMs'),
    };

    const overallExceeded = Object.values(checks).some((c) => c.exceeded);
    const warningsCount = Object.values(checks).filter((c) => c.warning).length;

    return {
      scope,
      limits,
      usage,
      checks,
      overallExceeded,
      warningsCount,
    };
  }

  /**
   * Quick check if any budget is exceeded
   */
  isExceeded(scope: BudgetScope = 'session', idOrAssistant?: string): boolean {
    if (!this.config.enabled) return false;
    return this.checkBudget(scope, idOrAssistant).overallExceeded;
  }

  /**
   * Check if any active scope budget is exceeded (session + project)
   */
  isAnyExceeded(): boolean {
    if (!this.config.enabled) return false;
    if (this.isExceeded('session')) return true;
    if (this.activeProjectId && this.isExceeded('project', this.activeProjectId)) return true;
    return false;
  }

  /**
   * Record usage
   */
  recordUsage(update: BudgetUpdate, scope: BudgetScope = 'session', idOrAssistant?: string): void {
    const now = new Date().toISOString();

    // Update session usage (always)
    this.sessionUsage = {
      ...this.sessionUsage,
      inputTokens: this.sessionUsage.inputTokens + (update.inputTokens || 0),
      outputTokens: this.sessionUsage.outputTokens + (update.outputTokens || 0),
      totalTokens: this.sessionUsage.totalTokens + (update.totalTokens || 0),
      llmCalls: this.sessionUsage.llmCalls + (update.llmCalls || 0),
      toolCalls: this.sessionUsage.toolCalls + (update.toolCalls || 0),
      durationMs: this.sessionUsage.durationMs + (update.durationMs || 0),
      lastUpdatedAt: now,
    };

    // Update assistant usage if specified
    if (scope === 'assistant' && idOrAssistant) {
      const assistantUsage = this.assistantUsages.get(idOrAssistant) || createEmptyUsage();
      const updatedAssistant = {
        ...assistantUsage,
        inputTokens: assistantUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: assistantUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: assistantUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: assistantUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: assistantUsage.toolCalls + (update.toolCalls || 0),
        durationMs: assistantUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      };
      this.assistantUsages.set(idOrAssistant, updatedAssistant);
      this.saveUsageRow('assistant', `${this.sessionId}:${idOrAssistant}`, updatedAssistant);
    }

    // Update swarm usage if in swarm scope
    if (scope === 'swarm') {
      this.swarmUsage = {
        ...this.swarmUsage,
        inputTokens: this.swarmUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: this.swarmUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: this.swarmUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: this.swarmUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: this.swarmUsage.toolCalls + (update.toolCalls || 0),
        durationMs: this.swarmUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      };
    }

    // Update project usage if active
    if (this.activeProjectId) {
      const projectId = (scope === 'project' && idOrAssistant) ? idOrAssistant : this.activeProjectId;
      const projectUsage = this.projectUsages.get(projectId) || createEmptyUsage();
      const updatedProject = {
        ...projectUsage,
        inputTokens: projectUsage.inputTokens + (update.inputTokens || 0),
        outputTokens: projectUsage.outputTokens + (update.outputTokens || 0),
        totalTokens: projectUsage.totalTokens + (update.totalTokens || 0),
        llmCalls: projectUsage.llmCalls + (update.llmCalls || 0),
        toolCalls: projectUsage.toolCalls + (update.toolCalls || 0),
        durationMs: projectUsage.durationMs + (update.durationMs || 0),
        lastUpdatedAt: now,
      };
      this.projectUsages.set(projectId, updatedProject);
      this.saveProjectState(projectId, updatedProject);
    }

    // Persist if enabled
    this.saveState();
  }

  /**
   * Record an LLM call
   */
  recordLlmCall(inputTokens: number, outputTokens: number, durationMs: number, assistantId?: string): void {
    this.recordUsage(
      {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        llmCalls: 1,
        durationMs,
      },
      assistantId ? 'assistant' : 'session',
      assistantId
    );
  }

  /**
   * Record a tool call
   */
  recordToolCall(durationMs: number, assistantId?: string): void {
    this.recordUsage(
      {
        toolCalls: 1,
        durationMs,
      },
      assistantId ? 'assistant' : 'session',
      assistantId
    );
  }

  /**
   * Get usage for a scope
   */
  getUsage(scope: BudgetScope = 'session', idOrAssistant?: string): BudgetUsage {
    switch (scope) {
      case 'session':
        return { ...this.sessionUsage };
      case 'assistant':
        return idOrAssistant
          ? { ...(this.assistantUsages.get(idOrAssistant) || createEmptyUsage()) }
          : createEmptyUsage();
      case 'swarm':
        return { ...this.swarmUsage };
      case 'project':
        const projectId = idOrAssistant || this.activeProjectId;
        return projectId
          ? { ...(this.projectUsages.get(projectId) || createEmptyUsage()) }
          : createEmptyUsage();
    }
  }

  /**
   * Get all assistant usages
   */
  getAssistantUsages(): Map<string, BudgetUsage> {
    return new Map(this.assistantUsages);
  }

  /**
   * Get all project usages
   */
  getProjectUsages(): Map<string, BudgetUsage> {
    return new Map(this.projectUsages);
  }

  /**
   * Reset usage for a scope
   */
  resetUsage(scope: BudgetScope = 'session', idOrAssistant?: string): void {
    const newUsage = createEmptyUsage();

    switch (scope) {
      case 'session':
        this.sessionUsage = newUsage;
        break;
      case 'assistant':
        if (idOrAssistant) {
          this.assistantUsages.set(idOrAssistant, newUsage);
        } else {
          this.assistantUsages.clear();
        }
        break;
      case 'swarm':
        this.swarmUsage = newUsage;
        break;
      case 'project':
        if (idOrAssistant) {
          this.projectUsages.set(idOrAssistant, newUsage);
          this.saveProjectState(idOrAssistant, newUsage);
          break;
        }
        if (this.activeProjectId) {
          this.projectUsages.set(this.activeProjectId, newUsage);
          this.saveProjectState(this.activeProjectId, newUsage);
          break;
        }
        for (const projectId of this.projectUsages.keys()) {
          const resetProjectUsage = createEmptyUsage();
          this.projectUsages.set(projectId, resetProjectUsage);
          this.saveProjectState(projectId, resetProjectUsage);
        }
        break;
    }

    this.saveState();
  }

  /**
   * Reset all usage
   */
  resetAll(): void {
    this.sessionUsage = createEmptyUsage();
    this.assistantUsages.clear();
    this.swarmUsage = createEmptyUsage();
    for (const projectId of this.projectUsages.keys()) {
      this.saveProjectState(projectId, createEmptyUsage());
    }
    this.projectUsages.clear();
    this.saveState();
  }

  /**
   * Extend budget limits for a scope (increase without resetting)
   */
  extendLimits(scope: BudgetScope, additionalTokens: number): void {
    let limits: BudgetLimits | undefined;
    switch (scope) {
      case 'session': limits = this.config.session; break;
      case 'assistant': limits = this.config.assistant; break;
      case 'swarm': limits = this.config.swarm; break;
      case 'project': limits = this.config.project; break;
    }
    if (limits && limits.maxTotalTokens) {
      limits.maxTotalTokens += additionalTokens;
    }
  }

  /**
   * Get summary for display
   */
  getSummary(): BudgetSummary {
    const session = this.checkBudget('session');
    const swarm = this.checkBudget('swarm');
    const project = this.activeProjectId
      ? this.checkBudget('project', this.activeProjectId)
      : null;

    let totalWarnings = session.warningsCount + swarm.warningsCount;
    let anyExceeded = session.overallExceeded || swarm.overallExceeded;

    if (project) {
      totalWarnings += project.warningsCount;
      if (project.overallExceeded) anyExceeded = true;
    }

    for (const assistantId of this.assistantUsages.keys()) {
      const assistantStatus = this.checkBudget('assistant', assistantId);
      totalWarnings += assistantStatus.warningsCount;
      if (assistantStatus.overallExceeded) {
        anyExceeded = true;
      }
    }

    return {
      enabled: this.config.enabled ?? false,
      session,
      swarm,
      project,
      assistantCount: this.assistantUsages.size,
      anyExceeded,
      totalWarnings,
    };
  }

  /**
   * Format usage for display
   */
  formatUsage(scope: BudgetScope = 'session', idOrAssistant?: string): string {
    const status = this.checkBudget(scope, idOrAssistant);
    const lines: string[] = [];

    lines.push(`Budget Status (${scope}${idOrAssistant ? `: ${idOrAssistant}` : ''}):`);
    lines.push(`  Enabled: ${this.config.enabled ? 'Yes' : 'No'}`);
    lines.push('');

    if (status.limits.maxTotalTokens) {
      const pct = status.checks.totalTokens?.percentUsed || 0;
      lines.push(`  Tokens: ${status.usage.totalTokens.toLocaleString()} / ${status.limits.maxTotalTokens.toLocaleString()} (${pct}%)`);
    } else {
      lines.push(`  Tokens: ${status.usage.totalTokens.toLocaleString()} (no limit)`);
    }

    if (status.limits.maxLlmCalls) {
      const pct = status.checks.llmCalls?.percentUsed || 0;
      lines.push(`  LLM Calls: ${status.usage.llmCalls} / ${status.limits.maxLlmCalls} (${pct}%)`);
    } else {
      lines.push(`  LLM Calls: ${status.usage.llmCalls} (no limit)`);
    }

    if (status.limits.maxToolCalls) {
      const pct = status.checks.toolCalls?.percentUsed || 0;
      lines.push(`  Tool Calls: ${status.usage.toolCalls} / ${status.limits.maxToolCalls} (${pct}%)`);
    } else {
      lines.push(`  Tool Calls: ${status.usage.toolCalls} (no limit)`);
    }

    const durationMin = Math.round(status.usage.durationMs / 60000);
    if (status.limits.maxDurationMs) {
      const limitMin = Math.round(status.limits.maxDurationMs / 60000);
      const pct = status.checks.durationMs?.percentUsed || 0;
      lines.push(`  Duration: ${durationMin}min / ${limitMin}min (${pct}%)`);
    } else {
      lines.push(`  Duration: ${durationMin}min (no limit)`);
    }

    if (status.overallExceeded) {
      lines.push('');
      lines.push('  \u26a0\ufe0f  BUDGET EXCEEDED');
    }

    return lines.join('\n');
  }
}
