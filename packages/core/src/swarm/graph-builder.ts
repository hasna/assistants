/**
 * Task Graph Builder
 *
 * Constructs task DAGs from user requests and planner output.
 * Maps swarm tasks to the /tasks model format for execution.
 */

import { generateId } from '@hasna/assistants-shared';
import { TaskGraph, type TaskDefinition } from './task-graph';
import type { SwarmRole } from './types';

/**
 * Task output specification
 */
export interface TaskOutput {
  /** Output type */
  type: 'text' | 'code' | 'file' | 'data' | 'mixed';
  /** Expected format */
  format?: string;
  /** File path if type is file */
  path?: string;
  /** Description of expected output */
  description?: string;
}

/**
 * Extended task definition with output specification
 */
export interface ExtendedTaskDefinition extends TaskDefinition {
  /** Expected output from this task */
  output?: TaskOutput;
  /** Human-readable name */
  name?: string;
  /** Estimated complexity (0-1) */
  complexity?: number;
  /** Whether this is a checkpoint task (needs verification) */
  isCheckpoint?: boolean;
  /** Whether task can be parallelized with others */
  parallelizable?: boolean;
}

/**
 * Planner output format
 */
export interface PlannerOutput {
  /** List of tasks */
  tasks: Array<{
    id?: string;
    name?: string;
    description: string;
    dependsOn?: (string | number)[];
    priority?: number;
    requiredTools?: string[];
    expectedOutput?: TaskOutput;
    complexity?: number;
    parallelizable?: boolean;
    isCheckpoint?: boolean;
  }>;
  /** Overall goal summary */
  summary?: string;
  /** Estimated total complexity */
  totalComplexity?: number;
}

/**
 * Builder options
 */
export interface GraphBuilderOptions {
  /** Auto-add aggregation task at the end */
  autoAddAggregation?: boolean;
  /** Auto-add critic task for checkpoints */
  autoAddCriticForCheckpoints?: boolean;
  /** Default priority for tasks */
  defaultPriority?: number;
  /** Default role for tasks */
  defaultRole?: SwarmRole;
  /** Maximum tasks allowed */
  maxTasks?: number;
}

/**
 * Default builder options
 */
export const DEFAULT_BUILDER_OPTIONS: GraphBuilderOptions = {
  autoAddAggregation: true,
  autoAddCriticForCheckpoints: false,
  defaultPriority: 3,
  defaultRole: 'worker',
  maxTasks: 20,
};

/**
 * Task Graph Builder
 *
 * Builds TaskGraph instances from various input formats.
 */
export class TaskGraphBuilder {
  private options: GraphBuilderOptions;

  constructor(options: Partial<GraphBuilderOptions> = {}) {
    this.options = { ...DEFAULT_BUILDER_OPTIONS, ...options };
  }

  /**
   * Build graph from planner output
   */
  buildFromPlannerOutput(output: PlannerOutput): TaskGraph {
    const graph = new TaskGraph();

    // Validate task count
    if (output.tasks.length > (this.options.maxTasks || 20)) {
      throw new Error(`Too many tasks: ${output.tasks.length} exceeds limit of ${this.options.maxTasks}`);
    }

    // Generate IDs for tasks that don't have them
    const taskIds = output.tasks.map(t => t.id || generateId());

    // Create tasks with resolved dependencies
    for (let i = 0; i < output.tasks.length; i++) {
      const task = output.tasks[i];
      const taskId = taskIds[i];

      // Resolve dependency references (can be indices or IDs)
      const resolvedDeps: string[] = [];
      if (task.dependsOn) {
        for (const dep of task.dependsOn) {
          if (typeof dep === 'number') {
            // Index-based reference
            if (dep >= 0 && dep < taskIds.length) {
              resolvedDeps.push(taskIds[dep]);
            }
          } else {
            // ID-based reference
            if (taskIds.includes(dep)) {
              resolvedDeps.push(dep);
            }
          }
        }
      }

      graph.addTask({
        id: taskId,
        description: task.description,
        role: this.options.defaultRole,
        priority: task.priority ?? this.options.defaultPriority,
        dependsOn: resolvedDeps,
        requiredTools: task.requiredTools,
        metadata: {
          name: task.name,
          expectedOutput: task.expectedOutput,
          complexity: task.complexity,
          parallelizable: task.parallelizable ?? true,
          isCheckpoint: task.isCheckpoint ?? false,
        },
      });
    }

    // Add critic tasks for checkpoints if enabled
    if (this.options.autoAddCriticForCheckpoints) {
      const checkpoints = graph.getAllTasks().filter(t => t.metadata?.isCheckpoint);
      for (const checkpoint of checkpoints) {
        const criticId = `critic-${checkpoint.id}`;
        graph.addTask({
          id: criticId,
          description: `Review and verify: ${checkpoint.description}`,
          role: 'critic',
          priority: (checkpoint.priority || 3) + 1, // Lower priority than the task itself
          dependsOn: [checkpoint.id],
          metadata: {
            isCriticTask: true,
            reviewsTaskId: checkpoint.id,
          },
        });
      }
    }

    // Add aggregation task if enabled
    if (this.options.autoAddAggregation && graph.getAllTasks().length > 0) {
      const leafTasks = this.findLeafTasks(graph);
      if (leafTasks.length > 0) {
        graph.addTask({
          id: 'aggregation',
          description: 'Aggregate results from all completed tasks',
          role: 'aggregator',
          priority: 5, // Lowest priority
          dependsOn: leafTasks.map(t => t.id),
          metadata: {
            isAggregation: true,
          },
        });
      }
    }

    return graph;
  }

  /**
   * Build graph from a simple task list (no dependencies)
   */
  buildFromTaskList(tasks: string[]): TaskGraph {
    const graph = new TaskGraph();

    for (let i = 0; i < Math.min(tasks.length, this.options.maxTasks || 20); i++) {
      graph.addTask({
        description: tasks[i],
        role: this.options.defaultRole,
        priority: this.options.defaultPriority,
        dependsOn: [],
      });
    }

    if (this.options.autoAddAggregation && tasks.length > 1) {
      const allTasks = graph.getAllTasks();
      graph.addTask({
        id: 'aggregation',
        description: 'Aggregate results from all tasks',
        role: 'aggregator',
        priority: 5,
        dependsOn: allTasks.map(t => t.id),
      });
    }

    return graph;
  }

  /**
   * Build graph from a sequential pipeline (each task depends on previous)
   */
  buildPipeline(tasks: string[]): TaskGraph {
    const graph = new TaskGraph();

    const taskIds: string[] = [];
    for (let i = 0; i < Math.min(tasks.length, this.options.maxTasks || 20); i++) {
      const task = graph.addTask({
        description: tasks[i],
        role: this.options.defaultRole,
        priority: i + 1, // Earlier tasks have higher priority
        dependsOn: taskIds.length > 0 ? [taskIds[taskIds.length - 1]] : [],
      });
      taskIds.push(task.id);
    }

    return graph;
  }

  /**
   * Build graph with fan-out pattern (one task produces input for many)
   */
  buildFanOut(rootTask: string, parallelTasks: string[], mergeTask?: string): TaskGraph {
    const graph = new TaskGraph();

    // Root task
    const root = graph.addTask({
      description: rootTask,
      role: this.options.defaultRole,
      priority: 1,
      dependsOn: [],
    });

    // Parallel tasks
    const parallelIds: string[] = [];
    for (const task of parallelTasks) {
      const t = graph.addTask({
        description: task,
        role: this.options.defaultRole,
        priority: 2,
        dependsOn: [root.id],
        metadata: { parallelizable: true },
      });
      parallelIds.push(t.id);
    }

    // Merge task
    if (mergeTask) {
      graph.addTask({
        description: mergeTask,
        role: 'aggregator',
        priority: 3,
        dependsOn: parallelIds,
      });
    }

    return graph;
  }

  /**
   * Build graph with fan-in pattern (many tasks merge into one)
   */
  buildFanIn(parallelTasks: string[], mergeTask: string): TaskGraph {
    const graph = new TaskGraph();

    // Parallel tasks
    const parallelIds: string[] = [];
    for (const task of parallelTasks) {
      const t = graph.addTask({
        description: task,
        role: this.options.defaultRole,
        priority: 1,
        dependsOn: [],
        metadata: { parallelizable: true },
      });
      parallelIds.push(t.id);
    }

    // Merge task
    graph.addTask({
      description: mergeTask,
      role: 'aggregator',
      priority: 2,
      dependsOn: parallelIds,
    });

    return graph;
  }

  /**
   * Parse planner JSON output
   */
  parsePlannerOutput(jsonString: string): PlannerOutput {
    // Try to extract JSON from the string
    const jsonMatch = jsonString.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No valid JSON found in planner output');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Handle array format (just tasks)
    if (Array.isArray(parsed)) {
      return { tasks: parsed };
    }

    // Handle object format (tasks with metadata)
    if (parsed.tasks && Array.isArray(parsed.tasks)) {
      return parsed as PlannerOutput;
    }

    throw new Error('Invalid planner output format');
  }

  /**
   * Convert task graph to /tasks compatible format
   */
  toTasksFormat(graph: TaskGraph): Array<{
    subject: string;
    description: string;
    status: string;
    blockedBy?: string[];
    blocks?: string[];
    priority?: number;
    metadata?: Record<string, unknown>;
  }> {
    const tasks = graph.getAllTasks();
    const result: Array<{
      subject: string;
      description: string;
      status: string;
      blockedBy?: string[];
      blocks?: string[];
      priority?: number;
      metadata?: Record<string, unknown>;
    }> = [];

    // Build reverse dependency map
    const blocksMap = new Map<string, string[]>();
    for (const task of tasks) {
      for (const depId of task.dependsOn) {
        if (!blocksMap.has(depId)) {
          blocksMap.set(depId, []);
        }
        blocksMap.get(depId)!.push(task.id);
      }
    }

    for (const task of tasks) {
      result.push({
        subject: (task.metadata?.name as string) || task.description.slice(0, 60),
        description: task.description,
        status: task.status === 'pending' ? 'pending' : task.status,
        blockedBy: task.dependsOn.length > 0 ? task.dependsOn : undefined,
        blocks: blocksMap.get(task.id),
        priority: task.priority,
        metadata: {
          swarmTaskId: task.id,
          role: task.role,
          requiredTools: task.requiredTools,
          ...task.metadata,
        },
      });
    }

    return result;
  }

  /**
   * Find leaf tasks (tasks with no dependents)
   */
  private findLeafTasks(graph: TaskGraph): ReturnType<TaskGraph['getAllTasks']> {
    const tasks = graph.getAllTasks();
    const hasDependent = new Set<string>();

    for (const task of tasks) {
      for (const depId of task.dependsOn) {
        hasDependent.add(depId);
      }
    }

    return tasks.filter(t => !hasDependent.has(t.id));
  }
}
