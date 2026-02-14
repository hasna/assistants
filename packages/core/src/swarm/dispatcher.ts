/**
 * Swarm Dispatcher
 *
 * Handles parallel task execution with backpressure, timeouts, and retries.
 * Tracks status per task and surfaces failures.
 */

import { generateId } from '@hasna/assistants-shared';
import type { SubassistantManager, SubassistantConfig, SubassistantResult } from '../agent/subagent-manager';
import type { SwarmTask, SwarmRole } from './types';
import { ROLE_SYSTEM_PROMPTS } from './types';

/**
 * Dispatch task status
 */
export type DispatchTaskStatus =
  | 'queued'
  | 'waiting_deps'
  | 'dispatching'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled'
  | 'retrying';

/**
 * Dispatch task record
 */
export interface DispatchTask {
  /** Task ID */
  id: string;
  /** Original swarm task */
  task: SwarmTask;
  /** Current status */
  status: DispatchTaskStatus;
  /** Number of attempts made */
  attempts: number;
  /** Assistant ID (if assigned) */
  assistantId?: string;
  /** Result (if completed) */
  result?: SubassistantResult;
  /** Error message (if failed) */
  error?: string;
  /** When task was queued */
  queuedAt: number;
  /** When task started executing */
  startedAt?: number;
  /** When task finished */
  finishedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Retry history */
  retryHistory: Array<{
    attempt: number;
    error: string;
    timestamp: number;
  }>;
}

/**
 * Dispatcher event types
 */
export type DispatcherEventType =
  | 'task:queued'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:timeout'
  | 'task:retry'
  | 'task:cancelled'
  | 'dispatcher:started'
  | 'dispatcher:stopped'
  | 'dispatcher:paused'
  | 'dispatcher:resumed';

/**
 * Dispatcher event
 */
export interface DispatcherEvent {
  type: DispatcherEventType;
  taskId?: string;
  task?: DispatchTask;
  data?: unknown;
  timestamp: number;
}

/**
 * Dispatcher event listener
 */
export type DispatcherEventListener = (event: DispatcherEvent) => void;

/**
 * Dispatcher configuration
 */
export interface DispatcherConfig {
  /** Maximum concurrent task executions */
  maxConcurrent: number;
  /** Default timeout per task in milliseconds */
  defaultTimeoutMs: number;
  /** Maximum retries per task */
  maxRetries: number;
  /** Retry delay in milliseconds */
  retryDelayMs: number;
  /** Exponential backoff multiplier */
  backoffMultiplier: number;
  /** Maximum backoff delay in milliseconds */
  maxBackoffMs: number;
  /** Timeout for waiting on dependencies */
  depTimeoutMs: number;
  /** Queue size limit (backpressure) */
  maxQueueSize: number;
  /** Forbidden tools that cannot be used */
  forbiddenTools: string[];
  /** Default tools for workers */
  defaultWorkerTools: string[];
  /** Maximum turns per subassistant */
  maxTurnsPerTask: number;
}

/**
 * Default dispatcher configuration
 */
export const DEFAULT_DISPATCHER_CONFIG: DispatcherConfig = {
  maxConcurrent: 3,
  defaultTimeoutMs: 120000, // 2 minutes
  maxRetries: 2,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
  depTimeoutMs: 300000, // 5 minutes
  maxQueueSize: 50,
  forbiddenTools: ['swarm_execute', 'assistant_spawn'],
  defaultWorkerTools: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
  maxTurnsPerTask: 15,
};

/**
 * Dispatcher statistics
 */
export interface DispatcherStats {
  totalTasks: number;
  queuedTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  timedOutTasks: number;
  cancelledTasks: number;
  totalRetries: number;
  averageDurationMs: number;
  throughput: number; // tasks per second
}

/**
 * Dispatch result
 */
export interface DispatchResult {
  /** Whether all tasks completed successfully */
  success: boolean;
  /** Tasks by ID */
  tasks: Map<string, DispatchTask>;
  /** Completed task IDs */
  completed: string[];
  /** Failed task IDs */
  failed: string[];
  /** Statistics */
  stats: DispatcherStats;
  /** Total duration */
  durationMs: number;
}

/**
 * Swarm Dispatcher
 *
 * Manages parallel task execution with backpressure, timeouts, and retries.
 */
export class SwarmDispatcher {
  private config: DispatcherConfig;
  private subassistantManager: SubassistantManager;
  private sessionId: string;
  private cwd: string;
  private depth: number;

  private tasks: Map<string, DispatchTask> = new Map();
  private running: Map<string, Promise<void>> = new Map();
  private listeners: Set<DispatcherEventListener> = new Set();

  private isRunning = false;
  private isPaused = false;
  private isStopped = false;
  private startTime: number = 0;

  constructor(
    config: Partial<DispatcherConfig>,
    subassistantManager: SubassistantManager,
    context: { sessionId: string; cwd: string; depth: number }
  ) {
    this.config = { ...DEFAULT_DISPATCHER_CONFIG, ...config };
    this.subassistantManager = subassistantManager;
    this.sessionId = context.sessionId;
    this.cwd = context.cwd;
    this.depth = context.depth;
  }

  /**
   * Get current configuration
   */
  getConfig(): DispatcherConfig {
    return { ...this.config };
  }

  /**
   * Check if dispatcher is running
   */
  isActive(): boolean {
    return this.isRunning && !this.isStopped;
  }

  /**
   * Add event listener
   */
  addEventListener(listener: DispatcherEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit event
   */
  private emit(type: DispatcherEventType, taskId?: string, data?: unknown): void {
    const task = taskId ? this.tasks.get(taskId) : undefined;

    const event: DispatcherEvent = {
      type,
      taskId,
      task,
      data,
      timestamp: Date.now(),
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
   * Dispatch tasks for execution
   */
  async dispatch(tasks: SwarmTask[]): Promise<DispatchResult> {
    if (this.isRunning) {
      throw new Error('Dispatcher is already running');
    }

    // Validate queue size
    if (tasks.length > this.config.maxQueueSize) {
      throw new Error(
        `Too many tasks (${tasks.length}), maximum queue size is ${this.config.maxQueueSize}`
      );
    }

    this.isRunning = true;
    this.isStopped = false;
    this.isPaused = false;
    this.startTime = Date.now();

    this.emit('dispatcher:started');

    // Initialize task records
    for (const task of tasks) {
      this.tasks.set(task.id, this.createDispatchTask(task));
      this.emit('task:queued', task.id);
    }

    // Execute until all tasks are done
    await this.executeLoop();

    const result = this.buildResult();

    this.isRunning = false;
    this.emit('dispatcher:stopped');

    return result;
  }

  /**
   * Pause execution (allows running tasks to complete)
   */
  pause(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.emit('dispatcher:paused');
    }
  }

  /**
   * Resume execution
   */
  resume(): void {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      this.emit('dispatcher:resumed');
    }
  }

  /**
   * Stop execution (cancels queued tasks)
   */
  stop(): void {
    this.isStopped = true;

    // Cancel all queued/waiting tasks
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'queued' || task.status === 'waiting_deps') {
        task.status = 'cancelled';
        task.finishedAt = Date.now();
        this.emit('task:cancelled', taskId);
      }
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): DispatchTask | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Get all tasks
   */
  getTasks(): DispatchTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get current statistics
   */
  getStats(): DispatcherStats {
    const tasks = Array.from(this.tasks.values());

    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');
    const timedOut = tasks.filter(t => t.status === 'timeout');
    const cancelled = tasks.filter(t => t.status === 'cancelled');

    const totalDuration = completed
      .filter(t => t.durationMs !== undefined)
      .reduce((sum, t) => sum + (t.durationMs || 0), 0);

    const totalRetries = tasks.reduce((sum, t) => sum + t.retryHistory.length, 0);

    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const throughput = elapsedSeconds > 0 ? completed.length / elapsedSeconds : 0;

    return {
      totalTasks: tasks.length,
      queuedTasks: tasks.filter(t => t.status === 'queued' || t.status === 'waiting_deps').length,
      runningTasks: this.running.size,
      completedTasks: completed.length,
      failedTasks: failed.length,
      timedOutTasks: timedOut.length,
      cancelledTasks: cancelled.length,
      totalRetries,
      averageDurationMs: completed.length > 0 ? totalDuration / completed.length : 0,
      throughput,
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Main execution loop
   */
  private async executeLoop(): Promise<void> {
    while (!this.isStopped) {
      // Wait if paused
      while (this.isPaused && !this.isStopped) {
        await this.sleep(100);
      }

      if (this.isStopped) break;

      // Find ready tasks
      const readyTasks = this.getReadyTasks();

      // Check if we're done
      const pendingCount = this.countPending();
      if (pendingCount === 0 && this.running.size === 0) {
        break;
      }

      // Dispatch tasks up to concurrency limit
      const availableSlots = this.config.maxConcurrent - this.running.size;
      const tasksToDispatch = readyTasks.slice(0, availableSlots);

      for (const dispatchTask of tasksToDispatch) {
        this.dispatchTask(dispatchTask);
      }

      // Wait for at least one task to complete
      if (this.running.size > 0) {
        await Promise.race(Array.from(this.running.values()));
      } else if (readyTasks.length === 0 && pendingCount > 0) {
        // Check for deadlock
        const waitingTasks = Array.from(this.tasks.values())
          .filter(t => t.status === 'waiting_deps');

        // Check if any waiting task has timed out on dependencies
        const now = Date.now();
        for (const task of waitingTasks) {
          if (now - task.queuedAt > this.config.depTimeoutMs) {
            task.status = 'timeout';
            task.error = 'Dependency timeout';
            task.finishedAt = now;
            this.emit('task:timeout', task.id, { reason: 'dependency_timeout' });
          }
        }

        // If all waiting tasks timed out, we're done
        if (this.countPending() === 0 && this.running.size === 0) {
          break;
        }

        // Small delay to avoid busy loop
        await this.sleep(50);
      }
    }
  }

  /**
   * Get tasks that are ready to execute
   */
  private getReadyTasks(): DispatchTask[] {
    const completed = new Set(
      Array.from(this.tasks.values())
        .filter(t => t.status === 'completed')
        .map(t => t.id)
    );

    const failed = new Set(
      Array.from(this.tasks.values())
        .filter(t => ['failed', 'timeout', 'cancelled'].includes(t.status))
        .map(t => t.id)
    );

    const ready: DispatchTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.status !== 'queued' && task.status !== 'waiting_deps') continue;

      // Check dependencies
      const deps = task.task.dependsOn || [];
      const depsCompleted = deps.every(depId => completed.has(depId));
      const depsFailed = deps.some(depId => failed.has(depId));

      if (depsFailed) {
        // Mark as failed due to dependency
        task.status = 'failed';
        task.error = 'Dependency failed';
        task.finishedAt = Date.now();
        this.emit('task:failed', task.id, { reason: 'dependency_failed' });
        continue;
      }

      if (depsCompleted) {
        ready.push(task);
      } else {
        task.status = 'waiting_deps';
      }
    }

    // Sort by priority
    return ready.sort((a, b) => a.task.priority - b.task.priority);
  }

  /**
   * Dispatch a single task for execution
   */
  private dispatchTask(dispatchTask: DispatchTask): void {
    dispatchTask.status = 'dispatching';

    const promise = this.executeTask(dispatchTask)
      .catch(() => {
        // Error already handled in executeTask
      })
      .finally(() => {
        this.running.delete(dispatchTask.id);
      });

    this.running.set(dispatchTask.id, promise);
  }

  /**
   * Execute a task with timeout and retry handling
   */
  private async executeTask(dispatchTask: DispatchTask): Promise<void> {
    const { task } = dispatchTask;
    const maxAttempts = this.config.maxRetries + 1;

    while (dispatchTask.attempts < maxAttempts && !this.isStopped) {
      dispatchTask.attempts++;
      dispatchTask.status = 'running';
      dispatchTask.startedAt = Date.now();

      this.emit('task:started', task.id);

      try {
        // Execute with timeout
        const result = await this.executeWithTimeout(dispatchTask);

        // Success
        dispatchTask.status = 'completed';
        dispatchTask.result = result;
        dispatchTask.finishedAt = Date.now();
        dispatchTask.durationMs = dispatchTask.finishedAt - dispatchTask.startedAt;

        this.emit('task:completed', task.id);
        return;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isTimeout = errorMessage === 'Task execution timeout';

        // Record retry history
        dispatchTask.retryHistory.push({
          attempt: dispatchTask.attempts,
          error: errorMessage,
          timestamp: Date.now(),
        });

        // Check if we should retry
        if (dispatchTask.attempts < maxAttempts && !this.isStopped && !isTimeout) {
          dispatchTask.status = 'retrying';
          this.emit('task:retry', task.id, {
            attempt: dispatchTask.attempts,
            error: errorMessage,
          });

          // Calculate backoff delay
          const delay = this.calculateBackoffDelay(dispatchTask.attempts);
          await this.sleep(delay);
          continue;
        }

        // Final failure
        dispatchTask.status = isTimeout ? 'timeout' : 'failed';
        dispatchTask.error = errorMessage;
        dispatchTask.finishedAt = Date.now();
        dispatchTask.durationMs = dispatchTask.finishedAt - (dispatchTask.startedAt || 0);

        const eventType = isTimeout ? 'task:timeout' : 'task:failed';
        this.emit(eventType, task.id, { error: errorMessage });
        return;
      }
    }
  }

  /**
   * Execute task with timeout
   */
  private async executeWithTimeout(dispatchTask: DispatchTask): Promise<SubassistantResult> {
    const { task } = dispatchTask;

    // Build subassistant config
    const systemPrompt = ROLE_SYSTEM_PROMPTS[task.role];
    const tools = (task.requiredTools || this.config.defaultWorkerTools)
      .filter(t => !this.config.forbiddenTools.includes(t));

    const config: SubassistantConfig = {
      task: `${systemPrompt}\n\n---\n\n${task.description}`,
      tools,
      maxTurns: this.config.maxTurnsPerTask,
      parentSessionId: this.sessionId,
      depth: this.depth + 1,
      cwd: this.cwd,
    };

    // Create timeout promise
    const timeoutMs = this.config.defaultTimeoutMs;
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Task execution timeout'));
      }, timeoutMs);
    });

    // Execute with race against timeout
    try {
      const result = await Promise.race([
        this.subassistantManager.spawn(config),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId!);

      if (!result.success) {
        throw new Error(result.error || 'Task failed');
      }

      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Calculate backoff delay for retries
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.config.retryDelayMs;
    const multiplier = Math.pow(this.config.backoffMultiplier, attempt - 1);
    const delay = baseDelay * multiplier;
    return Math.min(delay, this.config.maxBackoffMs);
  }

  /**
   * Count pending tasks
   */
  private countPending(): number {
    return Array.from(this.tasks.values())
      .filter(t =>
        t.status === 'queued' ||
        t.status === 'waiting_deps' ||
        t.status === 'dispatching' ||
        t.status === 'running' ||
        t.status === 'retrying'
      ).length;
  }

  /**
   * Create dispatch task from swarm task
   */
  private createDispatchTask(task: SwarmTask): DispatchTask {
    return {
      id: task.id,
      task,
      status: 'queued',
      attempts: 0,
      queuedAt: Date.now(),
      retryHistory: [],
    };
  }

  /**
   * Build final result
   */
  private buildResult(): DispatchResult {
    const tasks = this.tasks;
    const completed: string[] = [];
    const failed: string[] = [];

    for (const [id, task] of tasks) {
      if (task.status === 'completed') {
        completed.push(id);
      } else if (['failed', 'timeout', 'cancelled'].includes(task.status)) {
        failed.push(id);
      }
    }

    return {
      success: failed.length === 0 && completed.length === tasks.size,
      tasks,
      completed,
      failed,
      stats: this.getStats(),
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a dispatcher with default configuration
 */
export function createSwarmDispatcher(
  subassistantManager: SubassistantManager,
  context: { sessionId: string; cwd: string; depth: number },
  config?: Partial<DispatcherConfig>
): SwarmDispatcher {
  return new SwarmDispatcher(config || {}, subassistantManager, context);
}
