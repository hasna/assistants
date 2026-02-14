/**
 * Swarm Status Provider
 *
 * Provides status information for swarm execution UI.
 * Supports terminal and web display with real-time updates.
 */

import type { SwarmState, SwarmTask, SwarmMetrics, SwarmStatus } from './types';
import type { DispatchTask, DispatcherStats } from './dispatcher';

/**
 * Assistant status for display
 */
export interface SwarmAssistantStatus {
  /** Assistant ID */
  id: string;
  /** Assistant name/role */
  name: string;
  /** Current state */
  state: 'idle' | 'running' | 'completed' | 'failed';
  /** Current task (if running) */
  currentTask?: {
    id: string;
    description: string;
    progress?: number;
  };
  /** Tasks completed */
  tasksCompleted: number;
  /** Duration active */
  durationMs: number;
}

/**
 * Task status for display
 */
export interface SwarmTaskDisplayStatus {
  /** Task ID */
  id: string;
  /** Task description */
  description: string;
  /** Task role */
  role: string;
  /** Current status */
  status: 'pending' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Progress (0-100) */
  progress: number;
  /** Assigned assistant ID */
  assistantId?: string;
  /** Duration (if completed or running) */
  durationMs?: number;
  /** Error message (if failed) */
  error?: string;
  /** Dependencies */
  dependsOn: string[];
  /** Dependents */
  blockedBy: string[];
  /** Attempt number */
  attempt: number;
  /** Max attempts */
  maxAttempts: number;
}

/**
 * Progress bar style
 */
export type ProgressBarStyle = 'bar' | 'percent' | 'fraction' | 'spinner';

/**
 * Swarm status summary
 */
export interface SwarmStatusSummary {
  /** Swarm ID */
  swarmId: string;
  /** Session ID */
  sessionId: string;
  /** Current phase */
  phase: SwarmStatus;
  /** Phase description */
  phaseDescription: string;
  /** Overall progress (0-100) */
  progress: number;
  /** Active assistants */
  activeAssistants: SwarmAssistantStatus[];
  /** Task statuses */
  tasks: SwarmTaskDisplayStatus[];
  /** Metrics */
  metrics: SwarmMetrics;
  /** Dispatcher stats */
  dispatcherStats?: DispatcherStats;
  /** Start time */
  startedAt: number;
  /** Elapsed time */
  elapsedMs: number;
  /** Estimated remaining (if calculable) */
  estimatedRemainingMs?: number;
  /** Errors */
  errors: string[];
  /** Warnings */
  warnings: string[];
  /** Last update */
  updatedAt: number;
}

/**
 * Task log entry
 */
export interface TaskLogEntry {
  /** Timestamp */
  timestamp: number;
  /** Log level */
  level: 'info' | 'warn' | 'error' | 'debug';
  /** Log message */
  message: string;
  /** Associated data */
  data?: Record<string, unknown>;
}

/**
 * Task detail (for drill-down)
 */
export interface TaskDetail {
  /** Task ID */
  taskId: string;
  /** Full task info */
  task: SwarmTaskDisplayStatus;
  /** Task logs */
  logs: TaskLogEntry[];
  /** Result (if available) */
  result?: string;
  /** Retry history */
  retryHistory: Array<{
    attempt: number;
    error: string;
    timestamp: number;
  }>;
}

/**
 * Status update event
 */
export interface StatusUpdateEvent {
  type: 'task_update' | 'phase_change' | 'assistant_update' | 'progress' | 'error' | 'complete';
  swarmId: string;
  data: unknown;
  timestamp: number;
}

/**
 * Status update listener
 */
export type StatusUpdateListener = (event: StatusUpdateEvent) => void;

/**
 * Status provider configuration
 */
export interface StatusProviderConfig {
  /** Update interval (ms) */
  updateInterval: number;
  /** Keep log history count */
  maxLogEntries: number;
  /** Track per-task progress */
  trackTaskProgress: boolean;
  /** Estimate remaining time */
  estimateRemaining: boolean;
}

/**
 * Default status provider configuration
 */
export const DEFAULT_STATUS_CONFIG: StatusProviderConfig = {
  updateInterval: 500,
  maxLogEntries: 100,
  trackTaskProgress: true,
  estimateRemaining: true,
};

/**
 * Swarm Status Provider
 *
 * Tracks and provides swarm execution status.
 */
export class SwarmStatusProvider {
  private config: StatusProviderConfig;
  private swarmId: string;
  private sessionId: string;
  private state: SwarmState | null = null;
  private tasks: Map<string, SwarmTaskDisplayStatus> = new Map();
  private assistants: Map<string, SwarmAssistantStatus> = new Map();
  private logs: Map<string, TaskLogEntry[]> = new Map();
  private listeners: Set<StatusUpdateListener> = new Set();
  private startTime: number = 0;
  private completedTimes: number[] = [];

  constructor(
    swarmId: string,
    sessionId: string,
    config?: Partial<StatusProviderConfig>
  ) {
    this.config = { ...DEFAULT_STATUS_CONFIG, ...config };
    this.swarmId = swarmId;
    this.sessionId = sessionId;
    this.startTime = Date.now();
  }

  /**
   * Get swarm ID
   */
  getSwarmId(): string {
    return this.swarmId;
  }

  /**
   * Add status update listener
   */
  addListener(listener: StatusUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit status update
   */
  private emit(type: StatusUpdateEvent['type'], data: unknown): void {
    const event: StatusUpdateEvent = {
      type,
      swarmId: this.swarmId,
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
   * Update from swarm state
   */
  updateFromState(state: SwarmState): void {
    this.state = state;

    if (state.plan) {
      for (const task of state.plan.tasks) {
        this.updateTask(task);
      }
    }

    this.emit('progress', this.getProgress());
  }

  /**
   * Update task status
   */
  updateTask(task: SwarmTask | DispatchTask): void {
    const isDispatchTask = 'attempts' in task;

    const taskStatus: SwarmTaskDisplayStatus = {
      id: isDispatchTask ? task.id : task.id,
      description: isDispatchTask
        ? (task as DispatchTask).task.description
        : task.description,
      role: isDispatchTask
        ? (task as DispatchTask).task.role
        : task.role,
      status: this.mapStatus(isDispatchTask ? (task as DispatchTask).status : task.status),
      progress: this.calculateTaskProgress(task),
      assistantId: isDispatchTask ? (task as DispatchTask).assistantId : task.assignedAssistantId,
      durationMs: this.calculateDuration(task),
      error: isDispatchTask ? (task as DispatchTask).error : task.result?.error,
      dependsOn: isDispatchTask
        ? (task as DispatchTask).task.dependsOn
        : task.dependsOn,
      blockedBy: [],
      attempt: isDispatchTask ? (task as DispatchTask).attempts : 1,
      maxAttempts: 3,
    };

    const prevStatus = this.tasks.get(taskStatus.id);
    this.tasks.set(taskStatus.id, taskStatus);

    // Track completion time for ETA
    if (prevStatus?.status !== 'completed' && taskStatus.status === 'completed') {
      if (taskStatus.durationMs) {
        this.completedTimes.push(taskStatus.durationMs);
      }
    }

    this.emit('task_update', taskStatus);
  }

  /**
   * Update assistant status
   */
  updateAssistant(assistant: SwarmAssistantStatus): void {
    this.assistants.set(assistant.id, assistant);
    this.emit('assistant_update', assistant);
  }

  /**
   * Add task log entry
   */
  addLog(taskId: string, level: TaskLogEntry['level'], message: string, data?: Record<string, unknown>): void {
    if (!this.logs.has(taskId)) {
      this.logs.set(taskId, []);
    }

    const logs = this.logs.get(taskId)!;
    logs.push({
      timestamp: Date.now(),
      level,
      message,
      data,
    });

    // Trim to max entries
    while (logs.length > this.config.maxLogEntries) {
      logs.shift();
    }
  }

  /**
   * Get current status summary
   */
  getSummary(): SwarmStatusSummary {
    const elapsedMs = Date.now() - this.startTime;
    const progress = this.getProgress();

    return {
      swarmId: this.swarmId,
      sessionId: this.sessionId,
      phase: this.state?.status || 'idle',
      phaseDescription: this.getPhaseDescription(this.state?.status || 'idle'),
      progress,
      activeAssistants: Array.from(this.assistants.values()).filter(a => a.state === 'running'),
      tasks: Array.from(this.tasks.values()),
      metrics: this.state?.metrics || this.getDefaultMetrics(),
      startedAt: this.startTime,
      elapsedMs,
      estimatedRemainingMs: this.config.estimateRemaining
        ? this.estimateRemaining(progress, elapsedMs)
        : undefined,
      errors: this.state?.errors || [],
      warnings: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * Get task detail (for drill-down)
   */
  getTaskDetail(taskId: string): TaskDetail | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    return {
      taskId,
      task,
      logs: this.logs.get(taskId) || [],
      result: this.state?.taskResults.get(taskId)?.result,
      retryHistory: [],
    };
  }

  /**
   * Get overall progress (0-100)
   */
  getProgress(): number {
    if (this.tasks.size === 0) return 0;

    const completed = Array.from(this.tasks.values()).filter(
      t => t.status === 'completed'
    ).length;

    return Math.round((completed / this.tasks.size) * 100);
  }

  /**
   * Format progress for display
   */
  formatProgress(style: ProgressBarStyle = 'bar', width: number = 20): string {
    const progress = this.getProgress();

    switch (style) {
      case 'percent':
        return `${progress}%`;

      case 'fraction': {
        const completed = Array.from(this.tasks.values()).filter(
          t => t.status === 'completed'
        ).length;
        return `${completed}/${this.tasks.size}`;
      }

      case 'spinner': {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const index = Math.floor(Date.now() / 100) % frames.length;
        return frames[index];
      }

      case 'bar':
      default: {
        const filled = Math.round((progress / 100) * width);
        const empty = width - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        return `[${bar}] ${progress}%`;
      }
    }
  }

  /**
   * Format status for terminal display
   */
  formatForTerminal(): string {
    const summary = this.getSummary();
    const lines: string[] = [];

    // Header
    lines.push(`🐝 Swarm: ${summary.phase}`);
    lines.push(this.formatProgress('bar', 30));
    lines.push('');

    // Active assistants
    if (summary.activeAssistants.length > 0) {
      lines.push('Active Assistants:');
      for (const assistant of summary.activeAssistants) {
        const taskInfo = assistant.currentTask
          ? ` → ${assistant.currentTask.description.slice(0, 30)}...`
          : '';
        lines.push(`  ${assistant.name}${taskInfo}`);
      }
      lines.push('');
    }

    // Tasks by status
    const completed = summary.tasks.filter(t => t.status === 'completed').length;
    const running = summary.tasks.filter(t => t.status === 'running').length;
    const pending = summary.tasks.filter(t => t.status === 'pending' || t.status === 'waiting').length;
    const failed = summary.tasks.filter(t => t.status === 'failed').length;

    lines.push(`Tasks: ✅ ${completed} | ⏳ ${running} | 📋 ${pending} | ❌ ${failed}`);

    // Time
    const elapsed = this.formatDuration(summary.elapsedMs);
    if (summary.estimatedRemainingMs !== undefined) {
      const remaining = this.formatDuration(summary.estimatedRemainingMs);
      lines.push(`Time: ${elapsed} elapsed, ~${remaining} remaining`);
    } else {
      lines.push(`Time: ${elapsed}`);
    }

    // Errors
    if (summary.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const error of summary.errors.slice(-3)) {
        lines.push(`  ❌ ${error}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get status as JSON (for web)
   */
  toJSON(): SwarmStatusSummary {
    return this.getSummary();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Map task status
   */
  private mapStatus(status: string): SwarmTaskDisplayStatus['status'] {
    switch (status) {
      case 'pending':
      case 'queued':
        return 'pending';
      case 'waiting_deps':
        return 'waiting';
      case 'running':
      case 'dispatching':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
      case 'timeout':
        return 'failed';
      case 'cancelled':
      case 'blocked':
        return 'cancelled';
      default:
        return 'pending';
    }
  }

  /**
   * Calculate task progress
   */
  private calculateTaskProgress(task: SwarmTask | DispatchTask): number {
    const isDispatchTask = 'attempts' in task;
    const status = isDispatchTask
      ? (task as DispatchTask).status
      : task.status;

    switch (status) {
      case 'completed':
        return 100;
      case 'running':
      case 'dispatching':
        return 50;
      case 'waiting_deps':
        return 10;
      case 'failed':
      case 'timeout':
      case 'cancelled':
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Calculate task duration
   */
  private calculateDuration(task: SwarmTask | DispatchTask): number | undefined {
    const isDispatchTask = 'queuedAt' in task;

    if (isDispatchTask) {
      const dt = task as DispatchTask;
      if (dt.durationMs) return dt.durationMs;
      if (dt.startedAt) return Date.now() - dt.startedAt;
      return undefined;
    }

    const st = task as SwarmTask;
    if (st.completedAt && st.startedAt) {
      return st.completedAt - st.startedAt;
    }
    if (st.startedAt) {
      return Date.now() - st.startedAt;
    }
    return undefined;
  }

  /**
   * Estimate remaining time
   */
  private estimateRemaining(progress: number, elapsedMs: number): number | undefined {
    if (progress === 0 || progress >= 100) return undefined;
    if (this.completedTimes.length < 2) return undefined;

    // Use average completion time
    const avgTime = this.completedTimes.reduce((a, b) => a + b, 0) / this.completedTimes.length;

    const remaining = this.tasks.size - Array.from(this.tasks.values()).filter(
      t => t.status === 'completed'
    ).length;

    return Math.round(avgTime * remaining);
  }

  /**
   * Get phase description
   */
  private getPhaseDescription(phase: SwarmStatus): string {
    switch (phase) {
      case 'idle':
        return 'Initializing...';
      case 'planning':
        return 'Creating execution plan...';
      case 'executing':
        return 'Executing tasks...';
      case 'reviewing':
        return 'Running critic review...';
      case 'aggregating':
        return 'Aggregating results...';
      case 'completed':
        return 'Completed';
      case 'failed':
        return 'Failed';
      case 'cancelled':
        return 'Cancelled';
      default:
        return phase;
    }
  }

  /**
   * Get default metrics
   */
  private getDefaultMetrics(): SwarmMetrics {
    return {
      totalTasks: this.tasks.size,
      completedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'completed').length,
      failedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'failed').length,
      runningTasks: Array.from(this.tasks.values()).filter(t => t.status === 'running').length,
      tokensUsed: 0,
      llmCalls: 0,
      toolCalls: 0,
      replans: 0,
    };
  }

  /**
   * Format duration
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Create a status provider
 */
export function createSwarmStatusProvider(
  swarmId: string,
  sessionId: string,
  config?: Partial<StatusProviderConfig>
): SwarmStatusProvider {
  return new SwarmStatusProvider(swarmId, sessionId, config);
}
