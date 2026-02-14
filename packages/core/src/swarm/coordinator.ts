/**
 * Swarm Coordinator
 *
 * Orchestrates multi-assistant swarm execution using SubassistantManager.
 * Implements the planner -> workers -> critic -> aggregator pattern.
 */

import { generateId } from '@hasna/assistants-shared';
import type { StreamChunk } from '@hasna/assistants-shared';
import type {
  SubassistantManager,
  SubassistantConfig,
  SubassistantResult,
} from '../agent/subagent-manager';
import type { AssistantRegistryService, RegisteredAssistant } from '../registry';
import type {
  SwarmConfig,
  SwarmState,
  SwarmTask,
  SwarmPlan,
  SwarmResult,
  SwarmInput,
  SwarmEvent,
  SwarmEventListener,
  SwarmTaskStatus,
  SwarmStatus,
  SwarmRole,
  SwarmMetrics,
  SerializableSwarmState,
} from './types';
import { DEFAULT_SWARM_CONFIG, ROLE_SYSTEM_PROMPTS, serializeSwarmState } from './types';
import { SwarmMemory } from './memory';
import type { BudgetTracker } from '../budget';

/**
 * Approval decision from user
 */
export type ApprovalDecision = 'approve' | 'abort' | 'edit';

/**
 * Context required by the SwarmCoordinator
 */
export interface SwarmCoordinatorContext {
  /** SubassistantManager for spawning assistants */
  subassistantManager: SubassistantManager;
  /** Assistant registry for assistant selection */
  registry?: AssistantRegistryService;
  /** Parent session ID */
  sessionId: string;
  /** Working directory */
  cwd: string;
  /** Current depth (0 = root) */
  depth: number;
  /** Stream chunk callback */
  onChunk?: (chunk: StreamChunk) => void;
  /** Handler for plan approval (required when autoApprove=false) */
  onPlanApproval?: (plan: SwarmPlan) => Promise<{ decision: ApprovalDecision; editedPlan?: SwarmPlan }>;
  /** Get available tool names (for config validation) */
  getAvailableTools?: () => string[];
  /** Parent's budget tracker for persistent budget tracking */
  budgetTracker?: BudgetTracker;
}

/**
 * Swarm Coordinator
 */
export class SwarmCoordinator {
  private config: SwarmConfig;
  private context: SwarmCoordinatorContext;
  private state: SwarmState | null = null;
  private listeners: Set<SwarmEventListener> = new Set();
  private stopped = false;
  private swarmTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private budgetExceeded = false;
  private timeoutExceeded = false;
  private memory: SwarmMemory | null = null;

  constructor(
    config: Partial<SwarmConfig>,
    context: SwarmCoordinatorContext
  ) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.context = context;
  }

  /**
   * Check if token budget is exceeded
   */
  private checkTokenBudget(): boolean {
    if (this.config.tokenBudget <= 0 || !this.state) return false;
    return this.state.metrics.tokensUsed >= this.config.tokenBudget;
  }

  /**
   * Get remaining token budget
   */
  private getRemainingBudget(): number {
    if (this.config.tokenBudget <= 0 || !this.state) return Infinity;
    return Math.max(0, this.config.tokenBudget - this.state.metrics.tokensUsed);
  }

  /**
   * Handle budget exceeded
   */
  private handleBudgetExceeded(): void {
    if (this.budgetExceeded) return;
    this.budgetExceeded = true;
    this.streamText(`\n⚠️ Token budget exceeded (${this.state?.metrics.tokensUsed} / ${this.config.tokenBudget})\n`);
    this.stop();
  }

  /**
   * Handle timeout exceeded
   */
  private handleTimeoutExceeded(): void {
    if (this.timeoutExceeded) return;
    this.timeoutExceeded = true;
    const elapsed = this.state ? Date.now() - this.state.startedAt : 0;
    this.streamText(`\n⚠️ Swarm timeout exceeded after ${Math.round(elapsed / 1000)}s (limit: ${Math.round(this.config.swarmTimeoutMs / 1000)}s)\n`);
    this.stop();
  }

  /**
   * Start the swarm timeout timer
   */
  private startTimeoutTimer(): void {
    if (this.config.swarmTimeoutMs <= 0) return;
    this.swarmTimeoutTimer = setTimeout(() => {
      this.handleTimeoutExceeded();
    }, this.config.swarmTimeoutMs);
  }

  /**
   * Clear the swarm timeout timer
   */
  private clearTimeoutTimer(): void {
    if (this.swarmTimeoutTimer) {
      clearTimeout(this.swarmTimeoutTimer);
      this.swarmTimeoutTimer = null;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): SwarmConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): SwarmState | null {
    return this.state ? { ...this.state } : null;
  }

  /**
   * Get current state in JSON-serializable form (for API/UI consumers)
   */
  getSerializableState(): SerializableSwarmState | null {
    return this.state ? serializeSwarmState(this.state) : null;
  }

  /**
   * Check if swarm is running
   */
  isRunning(): boolean {
    return this.state !== null && !['completed', 'failed', 'cancelled'].includes(this.state.status);
  }

  /**
   * Add event listener
   */
  addEventListener(listener: SwarmEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit event
   */
  private emit(type: SwarmEvent['type'], taskId?: string, data?: unknown): void {
    if (!this.state) return;

    const event: SwarmEvent = {
      type,
      swarmId: this.state.id,
      taskId,
      timestamp: Date.now(),
      data,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Stream text to parent
   */
  private streamText(text: string): void {
    if (this.context.onChunk) {
      this.context.onChunk({ type: 'text', content: text });
    }
  }

  /**
   * Execute swarm for a goal
   */
  async execute(input: SwarmInput): Promise<SwarmResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        error: 'Swarm mode is disabled',
        taskResults: {},
        metrics: this.createEmptyMetrics(),
        durationMs: 0,
      };
    }

    if (this.isRunning()) {
      return {
        success: false,
        error: 'Swarm is already running',
        taskResults: {},
        metrics: this.createEmptyMetrics(),
        durationMs: 0,
      };
    }

    // Apply input config overrides
    const config = { ...this.config, ...input.config };
    this.config = config;

    if (!Number.isFinite(config.maxConcurrent) || config.maxConcurrent < 1) {
      this.streamText(`\n⚠️ Invalid swarm config: maxConcurrent=${config.maxConcurrent}. Using 1.\n`);
      this.config.maxConcurrent = 1;
    }

    // Validate tool name lists (warn about unknown tools)
    this.validateToolLists(config);

    // Initialize state
    const swarmId = generateId();
    this.state = {
      id: swarmId,
      status: 'idle',
      plan: null,
      sessionId: this.context.sessionId,
      taskResults: new Map(),
      activeAssistants: new Set(),
      errors: [],
      startedAt: Date.now(),
      metrics: this.createEmptyMetrics(),
    };
    this.stopped = false;
    this.budgetExceeded = false;
    this.timeoutExceeded = false;

    // Initialize shared memory if enabled
    if (config.enableSharedMemory) {
      this.memory = new SwarmMemory(swarmId);
    } else {
      this.memory = null;
    }

    // Start timeout timer
    this.startTimeoutTimer();

    this.emit('swarm:started');
    this.streamText(`\n🐝 Starting swarm for: ${input.goal}\n`);

    // Show budget/timeout info if configured
    if (config.tokenBudget > 0) {
      this.streamText(`📊 Token budget: ${config.tokenBudget}\n`);
    }
    if (config.swarmTimeoutMs > 0) {
      this.streamText(`⏱️ Timeout: ${Math.round(config.swarmTimeoutMs / 1000)}s\n`);
    }

    const startTime = Date.now();

    try {
      // Phase 1: Planning
      let plan: SwarmPlan;
      if (input.tasks && input.tasks.length > 0) {
        // Use pre-defined tasks
        plan = this.createPlanFromTasks(input.goal, input.tasks);
      } else {
        // Run planner assistant
        this.updateStatus('planning');
        plan = await this.runPlanner(input.goal, input.context);
      }

      this.state.plan = plan;
      this.state.metrics.totalTasks = plan.tasks.length;
      this.emit('swarm:plan_created', undefined, plan);

      if (plan.tasks.length === 0) {
        throw new Error('Planner produced no tasks');
      }

      this.streamText(`\n📋 Plan created with ${plan.tasks.length} tasks\n`);

      // Display plan summary
      for (const task of plan.tasks) {
        this.streamText(`  ${task.priority}. ${task.description}\n`);
      }

      // Phase 2: Approval (unless auto-approve)
      if (!config.autoApprove) {
        if (this.context.onPlanApproval) {
          this.streamText('\n⏳ Waiting for plan approval...\n');
          const { decision, editedPlan } = await this.context.onPlanApproval(plan);

          if (decision === 'abort') {
            this.updateStatus('cancelled');
            this.emit('swarm:cancelled');
            this.streamText('\n🛑 Plan aborted by user\n');
            return {
              success: false,
              error: 'Plan aborted by user',
              taskResults: {},
              metrics: this.state.metrics,
              durationMs: Date.now() - startTime,
            };
          }

          if (decision === 'edit' && editedPlan) {
            plan = editedPlan;
            this.state.plan = plan;
            this.state.metrics.totalTasks = plan.tasks.length;
            this.state.metrics.replans++;
            this.streamText('\n📝 Plan updated with edits\n');
          }

          plan.approved = true;
          plan.approvedAt = Date.now();
          this.streamText('\n✓ Plan approved\n');
        } else {
          // No approval handler, auto-approve with warning
          this.streamText('\n⚠️ No approval handler set, auto-approving plan\n');
          plan.approved = true;
          plan.approvedAt = Date.now();
        }
      } else {
        plan.approved = true;
        plan.approvedAt = Date.now();
      }

      this.emit('swarm:plan_approved');

      // Phase 3: Execution
      this.updateStatus('executing');
      await this.executeTaskGraph(plan);

      // Phase 4: Critic review (optional)
      if (config.enableCritic && !this.stopped) {
        this.updateStatus('reviewing');
        await this.runCriticReview();
      }

      // Phase 5: Aggregation
      if (!this.stopped) {
        this.updateStatus('aggregating');
        const finalResult = await this.runAggregator(input.goal);
        this.state.finalResult = finalResult;
      }

      // Complete
      // Clear timeout timer
      this.clearTimeoutTimer();

      // Set end timestamp
      this.state.endedAt = Date.now();

      // Determine final status based on task results
      const hasFailedTasks = this.state.metrics.failedTasks > 0;
      const hasBlockedTasks = this.state.plan?.tasks.some(t => t.status === 'blocked') ?? false;

      if (!this.stopped) {
        if (hasFailedTasks || hasBlockedTasks) {
          this.updateStatus('failed');
          this.emit('swarm:failed');
        } else {
          this.updateStatus('completed');
          this.emit('swarm:completed');
        }
      }

      const result = this.buildResult(startTime);

      // Show appropriate completion message
      if (this.budgetExceeded) {
        this.streamText(`\n⚠️ Swarm stopped: Token budget exceeded (${result.metrics.tokensUsed} / ${this.config.tokenBudget})\n`);
      } else if (this.timeoutExceeded) {
        this.streamText(`\n⚠️ Swarm stopped: Timeout exceeded after ${Math.round(result.durationMs / 1000)}s\n`);
      } else if (this.stopped) {
        this.streamText(`\n🛑 Swarm cancelled\n`);
      } else if (hasFailedTasks || hasBlockedTasks) {
        this.streamText(`\n❌ Swarm failed with ${result.metrics.failedTasks} failed task(s) in ${Math.round(result.durationMs / 1000)}s\n`);
      } else {
        this.streamText(`\n✅ Swarm completed in ${Math.round(result.durationMs / 1000)}s\n`);
      }

      // Show final metrics
      if (this.config.tokenBudget > 0) {
        this.streamText(`📊 Tokens used: ${result.metrics.tokensUsed} / ${this.config.tokenBudget}\n`);
      }

      return result;

    } catch (error) {
      // Clear timeout timer on error
      this.clearTimeoutTimer();

      // Set end timestamp
      if (this.state) {
        this.state.endedAt = Date.now();
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.state.errors.push(errorMessage);
      this.updateStatus('failed');
      this.emit('swarm:failed', undefined, { error: errorMessage });

      this.streamText(`\n❌ Swarm failed: ${errorMessage}\n`);

      return {
        success: false,
        error: errorMessage,
        taskResults: this.getTaskResultsRecord(),
        metrics: this.state.metrics,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Stop swarm execution
   */
  stop(): void {
    this.stopped = true;
    this.clearTimeoutTimer();

    // Stop all active subassistants
    const stoppedCount = this.context.subassistantManager.stopAll();
    if (stoppedCount > 0) {
      this.streamText(`\nStopping ${stoppedCount} active subassistant(s)...\n`);
    }

    if (this.state && this.isRunning()) {
      this.state.endedAt = Date.now();
      this.updateStatus('cancelled');
      this.emit('swarm:cancelled');
      this.streamText('\n🛑 Swarm cancelled\n');
    }
  }

  // ============================================
  // Planning Phase
  // ============================================

  private async runPlanner(goal: string, context?: string): Promise<SwarmPlan> {
    const prompt = this.buildPlannerPrompt(goal, context);

    const result = await this.spawnAssistant({
      role: 'planner',
      task: prompt,
      tools: this.config.plannerTools,
      trackInternal: true,
    });

    if (!result.success || !result.result) {
      throw new Error(`Planner failed: ${result.error || 'No result'}`);
    }

    // Parse planner output into tasks
    const tasks = this.parsePlannerOutput(result.result);

    return {
      id: generateId(),
      goal,
      tasks,
      createdAt: Date.now(),
      approved: false,
      version: 1,
    };
  }

  private buildPlannerPrompt(goal: string, context?: string): string {
    let prompt = `Goal: ${goal}\n\n`;
    if (context) {
      prompt += `Context:\n${context}\n\n`;
    }
    prompt += `Create a plan to achieve this goal. Output a JSON array of tasks.
Each task should have:
- "description": Clear task description
- "dependsOn": Array of task indices this depends on (use 0-based indices)
- "priority": Number 1-5 (1 = highest)
- "requiredTools": Array of tool names needed

Maximum ${this.config.maxTasks} tasks.`;

    return prompt;
  }

  private parsePlannerOutput(output: string): SwarmTask[] {
    // Extract JSON from output
    const jsonMatch = output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // Fallback: create single task from output
      return [{
        id: generateId(),
        description: output.trim(),
        status: 'pending',
        role: 'worker',
        priority: 1,
        dependsOn: [],
        createdAt: Date.now(),
      }];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        description: string;
        dependsOn?: number[];
        priority?: number;
        requiredTools?: string[];
      }>;

      // Create task IDs first
      const taskIds = parsed.map(() => generateId());

      return parsed.slice(0, this.config.maxTasks).map((item, index) => ({
        id: taskIds[index],
        description: item.description || `Task ${index + 1}`,
        status: 'pending' as SwarmTaskStatus,
        role: 'worker' as SwarmRole,
        priority: item.priority ?? 3,
        dependsOn: (item.dependsOn || []).map(i => taskIds[i]).filter(Boolean),
        createdAt: Date.now(),
        requiredTools: item.requiredTools,
      }));
    } catch {
      // JSON parse failed, create single task
      return [{
        id: generateId(),
        description: output.trim(),
        status: 'pending',
        role: 'worker',
        priority: 1,
        dependsOn: [],
        createdAt: Date.now(),
      }];
    }
  }

  private createPlanFromTasks(goal: string, tasks: SwarmInput['tasks']): SwarmPlan {
    // Enforce maxTasks limit
    const limitedTasks = (tasks || []).slice(0, this.config.maxTasks);
    if (tasks && tasks.length > this.config.maxTasks) {
      this.streamText(`\n⚠️ Task list truncated from ${tasks.length} to ${this.config.maxTasks} (maxTasks limit)\n`);
    }

    const taskIds = limitedTasks.map(() => generateId());

    // Map dependency references:
    // - Numeric index strings ("0", "1", "2") -> mapped to generated task IDs
    // - Non-numeric strings -> preserved as-is (assumed to be existing task IDs)
    const mapDependency = (dep: string): string => {
      // Check if it's a valid numeric index
      const index = parseInt(dep, 10);
      if (!isNaN(index) && index >= 0 && index < taskIds.length && String(index) === dep) {
        return taskIds[index];
      }
      // Not a numeric index - preserve the original string ID
      return dep;
    };

    return {
      id: generateId(),
      goal,
      tasks: limitedTasks.map((t, index) => ({
        id: taskIds[index],
        description: t.description,
        status: 'pending' as SwarmTaskStatus,
        role: t.role || 'worker',
        priority: t.priority || 3,
        dependsOn: (t.dependsOn || []).map(mapDependency),
        createdAt: Date.now(),
        requiredTools: t.requiredTools,
      })),
      createdAt: Date.now(),
      approved: true,
      approvedAt: Date.now(),
      version: 1,
    };
  }

  // ============================================
  // Execution Phase
  // ============================================

  private async executeTaskGraph(plan: SwarmPlan): Promise<void> {
    const completed = new Set<string>();
    const failed = new Set<string>();
    const blocked = new Set<string>();
    const running = new Map<string, Promise<void>>();

    while (!this.stopped) {
      // Find ready tasks
      const readyTasks = plan.tasks.filter(task =>
        task.status === 'pending' &&
        task.dependsOn.every(dep => completed.has(dep))
      );

      // Update blocked tasks
      plan.tasks.forEach(task => {
        if (task.status === 'pending' &&
            task.dependsOn.some(dep => failed.has(dep) || blocked.has(dep))) {
          task.status = 'blocked';
          blocked.add(task.id);
        }
      });

      // Check if done
      const pendingCount = plan.tasks.filter(t =>
        t.status === 'pending' || t.status === 'running'
      ).length;

      if (pendingCount === 0 && running.size === 0) {
        break;
      }

      // Spawn tasks up to concurrency limit
      const availableSlots = this.config.maxConcurrent - running.size;
      const tasksToSpawn = readyTasks
        .sort((a, b) => a.priority - b.priority)
        .slice(0, availableSlots);

      for (const task of tasksToSpawn) {
        task.status = 'running';
        task.startedAt = Date.now();
        this.state!.metrics.runningTasks++;

        const promise = this.executeTask(task)
          .then(() => {
            task.status = 'completed';
            task.completedAt = Date.now();
            completed.add(task.id);
            this.state!.metrics.completedTasks++;
            this.state!.metrics.runningTasks--;

            // Extract findings into shared memory
            if (this.memory && task.result?.result) {
              this.extractToMemory(task);
            }

            this.emit('swarm:task_completed', task.id);
          })
          .catch((error) => {
            task.status = 'failed';
            task.completedAt = Date.now();
            failed.add(task.id);
            this.state!.metrics.failedTasks++;
            this.state!.metrics.runningTasks--;
            this.state!.errors.push(`Task ${task.id}: ${error.message || error}`);
            this.emit('swarm:task_failed', task.id, { error: error.message });
          })
          .finally(() => {
            running.delete(task.id);
          });

        running.set(task.id, promise);
        this.emit('swarm:task_started', task.id);
      }

      // Wait for at least one task to complete
      if (running.size > 0) {
        await Promise.race(Array.from(running.values()));
      } else if (readyTasks.length === 0 && pendingCount > 0) {
        // Deadlock - remaining tasks cannot proceed (failed/blocked/missing deps)
        const stillPending = plan.tasks.filter(t => t.status === 'pending');
        for (const task of stillPending) {
          task.status = 'blocked';
          blocked.add(task.id);
        }
        const blockedTasks = plan.tasks.filter(t => t.status === 'blocked');
        const blockedIds = blockedTasks.map(t => t.id).join(', ');
        const error = `Deadlock detected: ${blockedTasks.length} task(s) cannot proceed due to failed or blocked dependencies (${blockedIds})`;
        this.state!.errors.push(error);
        this.streamText(`\n⚠️ ${error}\n`);
        break;
      }
    }

    // Ensure all running tasks have settled before returning
    if (running.size > 0) {
      await Promise.allSettled(Array.from(running.values()));
    }

    if (this.stopped) {
      for (const task of plan.tasks) {
        if (task.status === 'pending' || task.status === 'running') {
          task.status = 'cancelled';
        }
      }
    }
  }

  private async executeTask(task: SwarmTask): Promise<void> {
    // Check if we should stop due to budget/timeout before starting
    if (this.stopped || this.budgetExceeded || this.timeoutExceeded) {
      throw new Error('Swarm execution stopped');
    }

    // Build task prompt with context from dependencies and shared memory
    const dependencyContext = this.buildDependencyContext(task);
    const memoryContext = this.memory
      ? this.memory.buildContextInjection({ maxEntries: 10 })
      : '';
    const taskPrompt = `${task.description}\n\n${dependencyContext}${memoryContext ? `\n\nShared Knowledge:\n${memoryContext}` : ''}`;

    // Select tools
    const tools = task.requiredTools || this.config.workerTools;

    // Track the real subassistant ID once we have it from spawn result
    let realSubassistantId: string | undefined;

    try {
      const result = await this.spawnAssistant({
        role: task.role,
        task: taskPrompt,
        tools,
      });

      // Use the real subassistant ID from the spawn result for tracking
      realSubassistantId = result.subassistantId;
      if (realSubassistantId) {
        task.assignedAssistantId = realSubassistantId;
        if (this.state) {
          this.state.activeAssistants.add(realSubassistantId);
        }
      }

      // Store result
      task.result = result;
      if (this.state) {
        this.state.taskResults.set(task.id, result);
      }

      // Update metrics
      if (this.state) {
        this.state.metrics.tokensUsed += result.tokensUsed || 0;
        this.state.metrics.toolCalls += result.toolCalls;
        this.state.metrics.llmCalls++;

        // Record to parent's budget tracker if available
        if (this.context.budgetTracker && result.tokensUsed) {
          this.context.budgetTracker.recordUsage({
            totalTokens: result.tokensUsed,
            llmCalls: 1,
            toolCalls: result.toolCalls,
          }, 'swarm');
        }

        // Check token budget after each task (use both internal and external budget)
        if (this.checkTokenBudget()) {
          this.handleBudgetExceeded();
        } else if (this.context.budgetTracker?.isExceeded('swarm')) {
          this.handleBudgetExceeded();
        }
      }

      if (!result.success) {
        throw new Error(result.error || 'Task failed');
      }
    } finally {
      // Remove from active assistants when done (but keep assignedAssistantId for history)
      if (realSubassistantId && this.state) {
        this.state.activeAssistants.delete(realSubassistantId);
      }
      // Note: We intentionally keep task.assignedAssistantId so status displays can show
      // which assistant executed the task even after completion
    }
  }

  private buildDependencyContext(task: SwarmTask): string {
    if (task.dependsOn.length === 0) return '';

    const parts: string[] = ['Previous task results:'];

    for (const depId of task.dependsOn) {
      const result = this.state?.taskResults.get(depId);
      if (result?.result) {
        const depTask = this.state?.plan?.tasks.find(t => t.id === depId);
        parts.push(`\n[${depTask?.description || depId}]:\n${result.result}`);
      }
    }

    return parts.length > 1 ? parts.join('\n') : '';
  }

  /**
   * Extract findings from a completed task into shared memory
   */
  private extractToMemory(task: SwarmTask): void {
    if (!this.memory || !task.result?.result) return;

    // Store the task result as a finding
    const resultText = task.result.result;
    const truncated = resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText;

    this.memory.add({
      category: 'finding',
      content: truncated,
      sourceAssistantId: task.assignedAssistantId || undefined,
      sourceTaskId: task.id,
      tags: ['task-result', task.role],
      relevance: 0.7,
    });

    // If the result mentions errors, store those separately
    if (resultText.toLowerCase().includes('error') || resultText.toLowerCase().includes('failed')) {
      this.memory.add({
        category: 'error',
        content: `Task "${task.description}" encountered issues: ${truncated}`,
        sourceAssistantId: task.assignedAssistantId || undefined,
        sourceTaskId: task.id,
        tags: ['error', 'task-issue'],
        relevance: 0.9,
      });
    }
  }

  /**
   * Get the shared memory instance (if enabled)
   */
  getMemory(): SwarmMemory | null {
    return this.memory;
  }

  // ============================================
  // Critic Phase
  // ============================================

  private async runCriticReview(): Promise<void> {
    const completedTasks = this.state?.plan?.tasks.filter(t => t.status === 'completed') || [];
    if (completedTasks.length === 0) return;

    this.emit('swarm:review_started');

    let iteration = 0;
    let unresolvedIssues: string[] = [];

    while (iteration < this.config.maxCriticIterations && !this.stopped) {
      iteration++;
      this.streamText(`\n🔍 Running critic review (iteration ${iteration}/${this.config.maxCriticIterations})...\n`);

      const reviewPrompt = this.buildCriticPrompt(completedTasks, unresolvedIssues);

      const result = await this.spawnAssistant({
        role: 'critic',
        task: reviewPrompt,
        tools: this.config.criticTools,
        trackInternal: true,
      });

      if (result.success && result.result) {
        try {
          const review = this.parseCriticOutput(result.result);
          if (review.approved || review.issues.length === 0) {
            this.streamText('\n✅ Critic approved the work\n');
            unresolvedIssues = [];
            break; // Exit loop on approval
          } else {
            unresolvedIssues = review.issues;
            this.streamText(`\n⚠️ Critic found ${review.issues.length} issues:\n`);
            review.issues.forEach(issue => this.streamText(`  - ${issue}\n`));

            if (iteration < this.config.maxCriticIterations) {
              this.streamText('\nRetrying with critic feedback...\n');
            }
          }
        } catch {
          // Couldn't parse, log the raw result and break
          this.streamText(`\nCritic review: ${result.result}\n`);
          break;
        }
      } else {
        // Critic failed, exit loop
        break;
      }
    }

    // Report unresolved issues if any remain after all iterations
    if (unresolvedIssues.length > 0) {
      this.streamText(`\n⚠️ ${unresolvedIssues.length} unresolved issues after ${iteration} critic iterations:\n`);
      unresolvedIssues.forEach(issue => this.streamText(`  - ${issue}\n`));

      // Store unresolved issues in state for final result
      if (this.state) {
        this.state.unresolvedIssues = unresolvedIssues;
      }
    }

    this.emit('swarm:review_completed');
  }

  private buildCriticPrompt(tasks: SwarmTask[], previousIssues: string[] = []): string {
    const taskSummaries = tasks.map(task => {
      const result = this.state?.taskResults.get(task.id);
      return `Task: ${task.description}\nResult: ${result?.result || 'No result'}`;
    }).join('\n\n---\n\n');

    let prompt = `Review the following completed work:\n\n${taskSummaries}\n\n`;

    if (previousIssues.length > 0) {
      prompt += `PREVIOUS ISSUES TO ADDRESS:\n${previousIssues.map(i => `- ${i}`).join('\n')}\n\n`;
      prompt += `Please verify if these issues have been addressed in the current work.\n\n`;
    }

    prompt += `Provide your assessment as JSON with "approved", "issues", and "suggestions" fields.`;
    return prompt;
  }

  private parseCriticOutput(output: string): { approved: boolean; issues: string[]; suggestions: string[] } {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: parsed.approved ?? true,
        issues: parsed.issues || [],
        suggestions: parsed.suggestions || [],
      };
    }
    return { approved: true, issues: [], suggestions: [] };
  }

  // ============================================
  // Aggregation Phase
  // ============================================

  private async runAggregator(goal: string): Promise<string> {
    const allTasks = this.state?.plan?.tasks || [];
    const completedTasks = allTasks.filter(t => t.status === 'completed');
    const failedTasks = allTasks.filter(t => t.status === 'failed');
    const blockedTasks = allTasks.filter(t => t.status === 'blocked');

    if (completedTasks.length === 0 && failedTasks.length === 0) {
      return 'No tasks were executed';
    }

    const aggregatePrompt = this.buildAggregatorPrompt(goal, completedTasks, failedTasks, blockedTasks);

    const result = await this.spawnAssistant({
      role: 'aggregator',
      task: aggregatePrompt,
      tools: [], // Aggregator typically doesn't need tools
      trackInternal: true,
    });

    return result.result || 'Failed to aggregate results';
  }

  private buildAggregatorPrompt(
    goal: string,
    completedTasks: SwarmTask[],
    failedTasks: SwarmTask[],
    blockedTasks: SwarmTask[]
  ): string {
    let prompt = `Original goal: ${goal}\n\n`;

    // Add completed task results
    if (completedTasks.length > 0) {
      const completedSummaries = completedTasks.map(task => {
        const result = this.state?.taskResults.get(task.id);
        return `[${task.description}]\n${result?.result || 'No result'}`;
      }).join('\n\n---\n\n');

      prompt += `COMPLETED TASKS (${completedTasks.length}):\n\n${completedSummaries}\n\n`;
    }

    // Add failed task information
    if (failedTasks.length > 0) {
      const failedSummaries = failedTasks.map(task => {
        const result = this.state?.taskResults.get(task.id);
        return `[${task.description}]\nError: ${result?.error || 'Unknown error'}`;
      }).join('\n\n');

      prompt += `FAILED TASKS (${failedTasks.length}):\n\n${failedSummaries}\n\n`;
    }

    // Add blocked task information
    if (blockedTasks.length > 0) {
      const blockedSummaries = blockedTasks.map(task =>
        `[${task.description}] - Blocked by dependencies`
      ).join('\n');

      prompt += `BLOCKED TASKS (${blockedTasks.length}):\n\n${blockedSummaries}\n\n`;
    }

    prompt += `Synthesize these results into a comprehensive final answer. `;
    if (failedTasks.length > 0 || blockedTasks.length > 0) {
      prompt += `Note the tasks that failed or were blocked and explain how this affects the overall result.`;
    }

    return prompt;
  }

  // ============================================
  // Assistant Spawning
  // ============================================

  private async spawnAssistant(params: {
    role: SwarmRole;
    task: string;
    tools: string[];
    /** If true, track this assistant in activeAssistants (for internal planner/critic/aggregator assistants) */
    trackInternal?: boolean;
  }): Promise<SubassistantResult> {
    const { role, task, tools, trackInternal } = params;

    const targetDepth = this.context.depth + 1;
    if (this.config.maxDepth > 0 && targetDepth > this.config.maxDepth) {
      return {
        success: false,
        error: `Swarm maxDepth (${this.config.maxDepth}) exceeded`,
        turns: 0,
        toolCalls: 0,
      };
    }

    // Build system prompt
    const systemPrompt = ROLE_SYSTEM_PROMPTS[role];
    const fullTask = `${systemPrompt}\n\n---\n\n${task}`;

    // Filter forbidden tools
    const filteredTools = tools.filter(t =>
      !this.config.forbiddenTools.includes(t)
    );

    // Check registry for matching assistants
    // Note: True delegation to existing assistants would require an RPC mechanism.
    // For now, we use the registry primarily for discovery and informational purposes.
    // When a match is found, we still spawn a new subassistant but inform the user.
    if (this.context.registry && role === 'worker') {
      const bestMatch = this.context.registry.findBestMatch({
        required: { tools: filteredTools },
        maxLoadFactor: 0.9,
      });

      if (bestMatch && bestMatch.status.state === 'idle') {
        // A matching idle assistant exists - note this for potential future delegation
        this.streamText(`[Note: Found matching assistant "${bestMatch.name}" with required tools]\n`);
      }
    }

    const config: SubassistantConfig = {
      task: fullTask,
      tools: filteredTools,
      maxTurns: 15,
      parentSessionId: this.context.sessionId,
      depth: this.context.depth + 1,
      cwd: this.context.cwd,
      timeoutMs: this.config.taskTimeoutMs,
    };

    const result = await this.context.subassistantManager.spawn(config);

    // Track internal assistants using the real subassistantId from spawn result
    if (trackInternal && result.subassistantId && this.state) {
      this.state.activeAssistants.add(result.subassistantId);
      // Note: Internal assistants complete synchronously, so remove immediately after spawn returns
      this.state.activeAssistants.delete(result.subassistantId);
    }

    return result;
  }

  // ============================================
  // Helpers
  // ============================================

  /**
   * Validate tool name lists in config and warn about unknown tools
   */
  private validateToolLists(config: SwarmConfig): void {
    if (!this.context.getAvailableTools) {
      return; // Skip validation if no tool info available
    }

    const availableTools = new Set(this.context.getAvailableTools());
    const warnings: string[] = [];

    const validateList = (tools: string[], listName: string) => {
      const unknown = tools.filter(t => !availableTools.has(t));
      if (unknown.length > 0) {
        warnings.push(`${listName}: ${unknown.join(', ')}`);
      }
    };

    validateList(config.plannerTools, 'plannerTools');
    validateList(config.workerTools, 'workerTools');
    validateList(config.criticTools, 'criticTools');
    // Note: forbiddenTools might intentionally list tools that don't exist yet, so don't warn

    if (warnings.length > 0) {
      this.streamText(`⚠️ Unknown tool names in config (will be filtered out):\n`);
      for (const warning of warnings) {
        this.streamText(`  - ${warning}\n`);
      }
    }
  }

  private updateStatus(status: SwarmStatus): void {
    if (this.state) {
      this.state.status = status;
    }
  }

  private createEmptyMetrics(): SwarmMetrics {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      tokensUsed: 0,
      llmCalls: 0,
      toolCalls: 0,
      replans: 0,
    };
  }

  private getTaskResultsRecord(): Record<string, SubassistantResult> {
    const record: Record<string, SubassistantResult> = {};
    if (this.state) {
      for (const [id, result] of this.state.taskResults) {
        record[id] = result;
      }
    }
    return record;
  }

  private buildResult(startTime: number): SwarmResult {
    const success = this.state?.status === 'completed' &&
                   this.state.metrics.failedTasks === 0;

    return {
      success,
      result: this.state?.finalResult,
      error: success ? undefined : this.state?.errors.join('; '),
      taskResults: this.getTaskResultsRecord(),
      metrics: this.state?.metrics || this.createEmptyMetrics(),
      durationMs: Date.now() - startTime,
    };
  }
}
