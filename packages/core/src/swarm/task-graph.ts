/**
 * Swarm Task Graph
 *
 * Manages task dependencies, scheduling, and execution order.
 * Implements topological sorting for dependency resolution and
 * parallel execution of independent tasks.
 */

import { generateId } from '@hasna/assistants-shared';
import type { SwarmTask, SwarmTaskStatus, SwarmRole } from './types';
import type { SubassistantResult } from '../agent/subagent-manager';

/**
 * Task definition for graph construction
 */
export interface TaskDefinition {
  id?: string;
  description: string;
  role?: SwarmRole;
  priority?: number;
  dependsOn?: string[];
  requiredTools?: string[];
  maxRetries?: number;
  input?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  result?: SubassistantResult;
  error?: string;
  retryCount: number;
  durationMs: number;
}

/**
 * Scheduler options
 */
export interface SchedulerOptions {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** Maximum retries per task */
  maxRetries: number;
  /** Retry delay in ms */
  retryDelayMs: number;
  /** Whether to fail fast on first error */
  failFast: boolean;
  /** Callback when task starts */
  onTaskStart?: (task: SwarmTask) => void;
  /** Callback when task completes */
  onTaskComplete?: (task: SwarmTask, result: TaskExecutionResult) => void;
  /** Callback when task fails */
  onTaskFail?: (task: SwarmTask, error: string, retriesLeft: number) => void;
}

/**
 * Default scheduler options
 */
export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  maxConcurrent: 3,
  maxRetries: 2,
  retryDelayMs: 1000,
  failFast: false,
};

/**
 * Task Graph
 *
 * Manages a directed acyclic graph (DAG) of tasks with dependencies.
 */
export class TaskGraph {
  private tasks: Map<string, SwarmTask> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map(); // task -> tasks that depend on it
  private reverseAdjList: Map<string, Set<string>> = new Map(); // task -> tasks it depends on

  constructor() {}

  /**
   * Add a task to the graph
   */
  addTask(definition: TaskDefinition): SwarmTask {
    const id = definition.id || generateId();

    if (this.tasks.has(id)) {
      throw new Error(`Task with id ${id} already exists`);
    }

    const task: SwarmTask = {
      id,
      description: definition.description,
      status: 'pending',
      role: definition.role || 'worker',
      priority: definition.priority || 3,
      dependsOn: definition.dependsOn || [],
      createdAt: Date.now(),
      requiredTools: definition.requiredTools,
      input: definition.input,
      metadata: {
        ...definition.metadata,
        maxRetries: definition.maxRetries ?? DEFAULT_SCHEDULER_OPTIONS.maxRetries,
        retryCount: 0,
      },
    };

    this.tasks.set(id, task);
    this.adjacencyList.set(id, new Set());
    this.reverseAdjList.set(id, new Set(task.dependsOn));

    // Update adjacency lists for dependencies
    for (const depId of task.dependsOn) {
      if (!this.adjacencyList.has(depId)) {
        this.adjacencyList.set(depId, new Set());
      }
      this.adjacencyList.get(depId)!.add(id);
    }

    return task;
  }

  /**
   * Add multiple tasks at once
   */
  addTasks(definitions: TaskDefinition[]): SwarmTask[] {
    return definitions.map(def => this.addTask(def));
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): SwarmTask | null {
    return this.tasks.get(id) || null;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): SwarmTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: SwarmTaskStatus): SwarmTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === status);
  }

  /**
   * Check if a task has all dependencies satisfied
   */
  isDependenciesSatisfied(taskId: string): boolean {
    const deps = this.reverseAdjList.get(taskId);
    if (!deps || deps.size === 0) return true;

    for (const depId of deps) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if a task is blocked by failed dependencies
   */
  isBlockedByFailure(taskId: string): boolean {
    const deps = this.reverseAdjList.get(taskId);
    if (!deps || deps.size === 0) return false;

    for (const depId of deps) {
      const depTask = this.tasks.get(depId);
      if (!depTask) {
        return true;
      }
      if (depTask.status === 'failed' || depTask.status === 'blocked' || depTask.status === 'cancelled') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get tasks that are ready to execute (all deps satisfied, status pending)
   */
  getReadyTasks(): SwarmTask[] {
    const ready: SwarmTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && this.isDependenciesSatisfied(task.id)) {
        ready.push(task);
      }
    }

    // Sort by priority (lower number = higher priority)
    return ready.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Update task status
   */
  updateTaskStatus(taskId: string, status: SwarmTaskStatus): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      if (status === 'running') {
        task.startedAt = Date.now();
      } else if (status === 'completed' || status === 'failed') {
        task.completedAt = Date.now();
      }
    }
  }

  /**
   * Set task result
   */
  setTaskResult(taskId: string, result: SubassistantResult): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.result = result;
      task.output = result.result;
    }
  }

  /**
   * Mark blocked tasks (tasks whose dependencies have failed)
   */
  markBlockedTasks(): string[] {
    const blocked: string[] = [];

    for (const task of this.tasks.values()) {
      if (task.status === 'pending' && this.isBlockedByFailure(task.id)) {
        task.status = 'blocked';
        blocked.push(task.id);
      }
    }

    return blocked;
  }

  /**
   * Check if graph has cycles (invalid state)
   */
  hasCycles(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (taskId: string): boolean => {
      visited.add(taskId);
      recStack.add(taskId);

      const dependents = this.adjacencyList.get(taskId) || new Set();
      for (const depId of dependents) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recStack.has(depId)) {
          return true;
        }
      }

      recStack.delete(taskId);
      return false;
    };

    for (const taskId of this.tasks.keys()) {
      if (!visited.has(taskId)) {
        if (dfs(taskId)) return true;
      }
    }

    return false;
  }

  /**
   * Get topological order of tasks
   */
  getTopologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    const order: string[] = [];
    const queue: string[] = [];

    // Initialize in-degrees
    for (const taskId of this.tasks.keys()) {
      const deps = this.reverseAdjList.get(taskId);
      inDegree.set(taskId, deps?.size || 0);
      if (!deps || deps.size === 0) {
        queue.push(taskId);
      }
    }

    // Process queue
    while (queue.length > 0) {
      const taskId = queue.shift()!;
      order.push(taskId);

      const dependents = this.adjacencyList.get(taskId) || new Set();
      for (const depId of dependents) {
        const newDegree = (inDegree.get(depId) || 0) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) {
          queue.push(depId);
        }
      }
    }

    return order;
  }

  /**
   * Get execution levels (tasks that can run in parallel)
   */
  getExecutionLevels(): string[][] {
    const levels: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(this.tasks.keys());

    while (remaining.size > 0) {
      const level: string[] = [];

      for (const taskId of remaining) {
        const deps = this.reverseAdjList.get(taskId) || new Set();
        let allDepsSatisfied = true;
        for (const depId of deps) {
          if (!completed.has(depId)) {
            allDepsSatisfied = false;
            break;
          }
        }
        if (allDepsSatisfied) {
          level.push(taskId);
        }
      }

      if (level.length === 0) {
        // Cycle detected or invalid state
        break;
      }

      for (const taskId of level) {
        remaining.delete(taskId);
        completed.add(taskId);
      }

      levels.push(level);
    }

    return levels;
  }

  /**
   * Get graph statistics
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
    levels: number;
    maxParallelism: number;
  } {
    const levels = this.getExecutionLevels();
    const byStatus = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      blocked: 0,
      assigned: 0,
      cancelled: 0,
    };

    for (const task of this.tasks.values()) {
      byStatus[task.status]++;
    }

    return {
      total: this.tasks.size,
      pending: byStatus.pending,
      running: byStatus.running,
      completed: byStatus.completed,
      failed: byStatus.failed,
      blocked: byStatus.blocked,
      levels: levels.length,
      maxParallelism: Math.max(0, ...levels.map(l => l.length)),
    };
  }

  /**
   * Clear the graph
   */
  clear(): void {
    this.tasks.clear();
    this.adjacencyList.clear();
    this.reverseAdjList.clear();
  }
}

/**
 * Task Graph Scheduler
 *
 * Executes tasks in a graph respecting dependencies and concurrency limits.
 */
export class TaskGraphScheduler {
  private graph: TaskGraph;
  private options: SchedulerOptions;
  private running: Map<string, Promise<TaskExecutionResult>> = new Map();
  private stopped = false;

  constructor(graph: TaskGraph, options: Partial<SchedulerOptions> = {}) {
    this.graph = graph;
    const merged = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
    const maxConcurrent = Number.isFinite(merged.maxConcurrent) ? merged.maxConcurrent : DEFAULT_SCHEDULER_OPTIONS.maxConcurrent;
    this.options = {
      ...merged,
      maxConcurrent: Math.max(1, maxConcurrent),
    };
  }

  /**
   * Execute all tasks in the graph
   */
  async execute(
    executor: (task: SwarmTask) => Promise<SubassistantResult>
  ): Promise<Map<string, TaskExecutionResult>> {
    const results = new Map<string, TaskExecutionResult>();
    this.stopped = false;

    // Validate graph
    if (this.graph.hasCycles()) {
      throw new Error('Task graph has cycles - cannot execute');
    }

    while (!this.stopped) {
      // Mark blocked tasks
      this.graph.markBlockedTasks();

      // Get ready tasks
      const ready = this.graph.getReadyTasks();
      const availableSlots = this.options.maxConcurrent - this.running.size;

      // Check if we're done
      const stats = this.graph.getStats();
      if (stats.pending === 0 && stats.running === 0 && this.running.size === 0) {
        break;
      }

      // No ready tasks and nothing running - we might be stuck
      if (ready.length === 0 && this.running.size === 0) {
        if (stats.pending > 0 || stats.blocked > 0) {
          // Tasks are blocked by failures
          break;
        }
      }

      // Start new tasks
      const toStart = ready.slice(0, availableSlots);
      for (const task of toStart) {
        this.graph.updateTaskStatus(task.id, 'running');
        this.options.onTaskStart?.(task);

        const promise = this.executeTask(task, executor)
          .then(result => {
            results.set(task.id, result);
            return result;
          })
          .finally(() => {
            this.running.delete(task.id);
          });

        this.running.set(task.id, promise);
      }

      // Wait for at least one task to complete
      if (this.running.size > 0) {
        await Promise.race(Array.from(this.running.values()));
      }

      // Fail fast check
      if (this.options.failFast) {
        const failedCount = this.graph.getTasksByStatus('failed').length;
        if (failedCount > 0) {
          this.stop();
          break;
        }
      }
    }

    // Wait for all running tasks to complete
    await Promise.all(Array.from(this.running.values()));

    return results;
  }

  /**
   * Execute a single task with retries
   */
  private async executeTask(
    task: SwarmTask,
    executor: (task: SwarmTask) => Promise<SubassistantResult>
  ): Promise<TaskExecutionResult> {
    const maxRetries = (task.metadata?.maxRetries as number) ?? this.options.maxRetries;
    let retryCount = 0;
    const startTime = Date.now();

    while (retryCount <= maxRetries) {
      try {
        const result = await executor(task);

        if (result.success) {
          this.graph.setTaskResult(task.id, result);
          this.graph.updateTaskStatus(task.id, 'completed');
          this.options.onTaskComplete?.(task, {
            taskId: task.id,
            success: true,
            result,
            retryCount,
            durationMs: Date.now() - startTime,
          });

          return {
            taskId: task.id,
            success: true,
            result,
            retryCount,
            durationMs: Date.now() - startTime,
          };
        } else {
          // Task returned failure
          if (retryCount < maxRetries) {
            retryCount++;
            this.options.onTaskFail?.(task, result.error || 'Task failed', maxRetries - retryCount);
            await this.sleep(this.options.retryDelayMs * retryCount);
            continue;
          }

          this.graph.setTaskResult(task.id, result);
          this.graph.updateTaskStatus(task.id, 'failed');
          this.options.onTaskComplete?.(task, {
            taskId: task.id,
            success: false,
            result,
            error: result.error,
            retryCount,
            durationMs: Date.now() - startTime,
          });

          return {
            taskId: task.id,
            success: false,
            result,
            error: result.error,
            retryCount,
            durationMs: Date.now() - startTime,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (retryCount < maxRetries) {
          retryCount++;
          this.options.onTaskFail?.(task, errorMessage, maxRetries - retryCount);
          await this.sleep(this.options.retryDelayMs * retryCount);
          continue;
        }

        this.graph.updateTaskStatus(task.id, 'failed');

        return {
          taskId: task.id,
          success: false,
          error: errorMessage,
          retryCount,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // Should not reach here
    return {
      taskId: task.id,
      success: false,
      error: 'Max retries exceeded',
      retryCount,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Stop execution
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Aggregate results from completed tasks
 */
export function aggregateTaskResults(
  graph: TaskGraph,
  aggregationStrategy: 'concatenate' | 'json' | 'last' = 'concatenate'
): string {
  const completed = graph.getTasksByStatus('completed');

  if (completed.length === 0) {
    return 'No tasks completed';
  }

  switch (aggregationStrategy) {
    case 'concatenate': {
      const parts: string[] = [];
      for (const task of completed) {
        if (task.result?.result) {
          parts.push(`## ${task.description}\n${task.result.result}`);
        }
      }
      return parts.join('\n\n---\n\n');
    }

    case 'json': {
      const results: Record<string, unknown> = {};
      for (const task of completed) {
        results[task.id] = {
          description: task.description,
          result: task.result?.result,
          success: task.result?.success,
        };
      }
      return JSON.stringify(results, null, 2);
    }

    case 'last': {
      // Return the result of the last completed task (by completion time)
      const sorted = [...completed].sort((a, b) =>
        (b.completedAt || 0) - (a.completedAt || 0)
      );
      return sorted[0]?.result?.result || 'No result';
    }

    default:
      return 'Unknown aggregation strategy';
  }
}
