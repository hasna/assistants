/**
 * Swarm Assistant Selector
 *
 * Selects assistants for swarm tasks based on capability, heartbeat status,
 * tool scopes, and load. Produces assignment plans with fallback handling.
 */

import type { AssistantRegistryService, RegisteredAssistant } from '../registry';
import type { SwarmTask, SwarmRole } from './types';

/**
 * Assistant assignment for a task
 */
export interface TaskAssistantAssignment {
  /** Task ID */
  taskId: string;
  /** Assigned assistant ID (null if using fallback) */
  assistantId: string | null;
  /** Assigned assistant (null if using fallback) */
  assistant: RegisteredAssistant | null;
  /** Whether this is a fallback assignment */
  isFallback: boolean;
  /** Fallback reason if applicable */
  fallbackReason?: string;
  /** Match score (0-1) */
  matchScore: number;
  /** Requirements used for matching */
  requirements: AssistantRequirements;
}

/**
 * Assistant requirements for matching
 */
export interface AssistantRequirements {
  /** Required tools */
  requiredTools?: string[];
  /** Preferred tools */
  preferredTools?: string[];
  /** Required skills */
  requiredSkills?: string[];
  /** Required tags */
  requiredTags?: string[];
  /** Role preference */
  rolePreference?: SwarmRole;
  /** Maximum acceptable load factor */
  maxLoadFactor?: number;
}

/**
 * Assignment plan for a swarm
 */
export interface AssignmentPlan {
  /** Task assignments */
  assignments: Map<string, TaskAssistantAssignment>;
  /** Unassigned task IDs (need fallback) */
  unassignedTasks: string[];
  /** Statistics */
  stats: AssignmentStats;
  /** Warnings */
  warnings: string[];
  /** Timestamp */
  createdAt: number;
}

/**
 * Assignment statistics
 */
export interface AssignmentStats {
  /** Total tasks */
  totalTasks: number;
  /** Assigned tasks */
  assignedTasks: number;
  /** Fallback tasks */
  fallbackTasks: number;
  /** Unique assistants used */
  uniqueAssistants: number;
  /** Average match score */
  averageMatchScore: number;
  /** Distribution by assistant */
  tasksByAssistant: Map<string, number>;
}

/**
 * Selector configuration
 */
export interface AssistantSelectorConfig {
  /** Enable registry-based selection */
  enabled: boolean;
  /** Maximum load factor for assistant selection */
  maxLoadFactor: number;
  /** Minimum match score to accept */
  minMatchScore: number;
  /** Prefer assistants with matching skills */
  preferSkillMatch: boolean;
  /** Prefer assistants with lower load */
  preferLowLoad: boolean;
  /** Enable load balancing across assistants */
  enableLoadBalancing: boolean;
  /** Maximum tasks per assistant */
  maxTasksPerAssistant: number;
  /** Role-based tool preferences */
  roleToolPreferences: Record<SwarmRole, string[]>;
}

/**
 * Default selector configuration
 */
export const DEFAULT_SELECTOR_CONFIG: AssistantSelectorConfig = {
  enabled: true,
  maxLoadFactor: 0.9,
  minMatchScore: 0.3,
  preferSkillMatch: true,
  preferLowLoad: true,
  enableLoadBalancing: true,
  maxTasksPerAssistant: 5,
  roleToolPreferences: {
    planner: ['tasks_create', 'tasks_list', 'plan_create'],
    worker: ['bash', 'read', 'write', 'edit', 'glob', 'grep'],
    critic: ['read', 'grep', 'tasks_list'],
    aggregator: ['tasks_list', 'read'],
  },
};

/**
 * Swarm Assistant Selector
 *
 * Selects assistants for swarm tasks based on capabilities and availability.
 */
export class SwarmAssistantSelector {
  private config: AssistantSelectorConfig;
  private registry: AssistantRegistryService | null;

  constructor(
    registry?: AssistantRegistryService,
    config?: Partial<AssistantSelectorConfig>
  ) {
    this.registry = registry || null;
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  /**
   * Check if registry-based selection is available
   */
  isEnabled(): boolean {
    return this.config.enabled && this.registry !== null;
  }

  /**
   * Create assignment plan for a list of tasks
   */
  createAssignmentPlan(tasks: SwarmTask[]): AssignmentPlan {
    const assignments = new Map<string, TaskAssistantAssignment>();
    const warnings: string[] = [];
    const tasksByAssistant = new Map<string, number>();
    let totalMatchScore = 0;
    let fallbackCount = 0;

    // Process tasks in priority order
    const sortedTasks = [...tasks].sort((a, b) => a.priority - b.priority);

    for (const task of sortedTasks) {
      const requirements = this.buildRequirements(task);
      const assignment = this.selectAssistantForTask(task, requirements, tasksByAssistant);

      assignments.set(task.id, assignment);
      totalMatchScore += assignment.matchScore;

      if (assignment.isFallback) {
        fallbackCount++;
        if (assignment.fallbackReason) {
          warnings.push(`Task ${task.id}: ${assignment.fallbackReason}`);
        }
      } else if (assignment.assistantId) {
        const count = tasksByAssistant.get(assignment.assistantId) || 0;
        tasksByAssistant.set(assignment.assistantId, count + 1);
      }
    }

    // Identify unassigned tasks
    const unassignedTasks = Array.from(assignments.entries())
      .filter(([_, a]) => a.isFallback)
      .map(([id]) => id);

    // Build stats
    const stats: AssignmentStats = {
      totalTasks: tasks.length,
      assignedTasks: tasks.length - fallbackCount,
      fallbackTasks: fallbackCount,
      uniqueAssistants: tasksByAssistant.size,
      averageMatchScore: tasks.length > 0 ? totalMatchScore / tasks.length : 0,
      tasksByAssistant,
    };

    return {
      assignments,
      unassignedTasks,
      stats,
      warnings,
      createdAt: Date.now(),
    };
  }

  /**
   * Select single best assistant for a task
   */
  selectAssistantForTask(
    task: SwarmTask,
    requirements: AssistantRequirements,
    currentAssignments?: Map<string, number>
  ): TaskAssistantAssignment {
    // If registry not available, use fallback
    if (!this.registry || !this.config.enabled) {
      return this.createFallbackAssignment(task, requirements, 'Registry not available');
    }

    // Build match criteria
    const matchCriteria = this.buildMatchCriteria(requirements, currentAssignments);

    // Find best match
    const bestAssistant = this.registry.findBestMatch(matchCriteria);

    if (!bestAssistant) {
      return this.createFallbackAssignment(task, requirements, 'No matching assistants available');
    }

    // Calculate match score
    const matchScore = this.calculateMatchScore(bestAssistant, requirements);

    // Check if match score meets minimum threshold
    if (matchScore < this.config.minMatchScore) {
      return this.createFallbackAssignment(
        task,
        requirements,
        `Match score ${matchScore.toFixed(2)} below threshold ${this.config.minMatchScore}`
      );
    }

    // Check load balancing constraints
    if (this.config.enableLoadBalancing && currentAssignments) {
      const currentLoad = currentAssignments.get(bestAssistant.id) || 0;
      if (currentLoad >= this.config.maxTasksPerAssistant) {
        // Try to find alternative assistant
        const alternativeAssistant = this.findAlternativeAssistant(
          bestAssistant.id,
          requirements,
          currentAssignments
        );

        if (alternativeAssistant) {
          return {
            taskId: task.id,
            assistantId: alternativeAssistant.id,
            assistant: alternativeAssistant,
            isFallback: false,
            matchScore: this.calculateMatchScore(alternativeAssistant, requirements),
            requirements,
          };
        }
      }
    }

    return {
      taskId: task.id,
      assistantId: bestAssistant.id,
      assistant: bestAssistant,
      isFallback: false,
      matchScore,
      requirements,
    };
  }

  /**
   * Find assistants by capability
   */
  findAssistantsByCapability(requirements: AssistantRequirements): RegisteredAssistant[] {
    if (!this.registry) {
      return [];
    }

    return this.registry.findByCapability({
      tools: requirements.requiredTools,
      skills: requirements.requiredSkills,
      tags: requirements.requiredTags,
    });
  }

  /**
   * Find available assistants (idle, low load)
   */
  findAvailableAssistants(options?: {
    maxLoadFactor?: number;
    limit?: number;
  }): RegisteredAssistant[] {
    if (!this.registry) {
      return [];
    }

    return this.registry.findAvailable({
      maxLoadFactor: options?.maxLoadFactor ?? this.config.maxLoadFactor,
      limit: options?.limit,
    });
  }

  /**
   * Get assistant by ID
   */
  getAssistant(id: string): RegisteredAssistant | null {
    return this.registry?.get(id) || null;
  }

  /**
   * Rebalance assignments to distribute load more evenly
   */
  rebalanceAssignments(plan: AssignmentPlan): AssignmentPlan {
    if (!this.config.enableLoadBalancing || plan.stats.uniqueAssistants <= 1) {
      return plan;
    }

    const newAssignments = new Map(plan.assignments);
    const newTasksByAssistant = new Map(plan.stats.tasksByAssistant);
    const warnings = [...plan.warnings];

    // Find overloaded assistants
    const avgTasksPerAssistant = plan.stats.assignedTasks / Math.max(plan.stats.uniqueAssistants, 1);
    const overloadThreshold = Math.ceil(avgTasksPerAssistant * 1.5);

    for (const [assistantId, taskCount] of newTasksByAssistant) {
      if (taskCount <= overloadThreshold) continue;

      // Find tasks to reassign
      const assistantTasks = Array.from(newAssignments.entries())
        .filter(([_, a]) => a.assistantId === assistantId && !a.isFallback);

      // Try to reassign excess tasks
      const excessCount = taskCount - overloadThreshold;
      let reassigned = 0;

      for (const [taskId, assignment] of assistantTasks.slice(0, excessCount)) {
        const alternativeAssistant = this.findAlternativeAssistant(
          assistantId,
          assignment.requirements,
          newTasksByAssistant
        );

        if (alternativeAssistant) {
          const newMatchScore = this.calculateMatchScore(alternativeAssistant, assignment.requirements);

          newAssignments.set(taskId, {
            ...assignment,
            assistantId: alternativeAssistant.id,
            assistant: alternativeAssistant,
            matchScore: newMatchScore,
          });

          // Update counts
          newTasksByAssistant.set(assistantId, (newTasksByAssistant.get(assistantId) || 1) - 1);
          newTasksByAssistant.set(
            alternativeAssistant.id,
            (newTasksByAssistant.get(alternativeAssistant.id) || 0) + 1
          );

          reassigned++;
        }
      }

      if (reassigned > 0) {
        warnings.push(`Rebalanced ${reassigned} tasks from assistant ${assistantId}`);
      }
    }

    // Recalculate average match score
    let totalMatchScore = 0;
    for (const assignment of newAssignments.values()) {
      totalMatchScore += assignment.matchScore;
    }

    return {
      assignments: newAssignments,
      unassignedTasks: plan.unassignedTasks,
      stats: {
        ...plan.stats,
        averageMatchScore: newAssignments.size > 0
          ? totalMatchScore / newAssignments.size
          : 0,
        tasksByAssistant: newTasksByAssistant,
      },
      warnings,
      createdAt: Date.now(),
    };
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Build requirements from task
   */
  private buildRequirements(task: SwarmTask): AssistantRequirements {
    const roleTools = this.config.roleToolPreferences[task.role] || [];

    return {
      requiredTools: task.requiredTools || [],
      preferredTools: roleTools,
      rolePreference: task.role,
      maxLoadFactor: this.config.maxLoadFactor,
    };
  }

  /**
   * Build match criteria for registry query
   */
  private buildMatchCriteria(
    requirements: AssistantRequirements,
    currentAssignments?: Map<string, number>
  ): Parameters<AssistantRegistryService['findBestMatch']>[0] {
    // Adjust max load factor based on current assignments
    let adjustedMaxLoadFactor = requirements.maxLoadFactor ?? this.config.maxLoadFactor;

    if (this.config.enableLoadBalancing && currentAssignments && currentAssignments.size > 0) {
      // Slightly reduce acceptable load factor if assistants are already assigned
      const totalAssignments = Array.from(currentAssignments.values())
        .reduce((sum, count) => sum + count, 0);
      if (totalAssignments > 5) {
        adjustedMaxLoadFactor = Math.max(0.5, adjustedMaxLoadFactor - 0.1);
      }
    }

    return {
      required: {
        tools: requirements.requiredTools,
        skills: requirements.requiredSkills,
        tags: requirements.requiredTags,
      },
      preferred: {
        tools: requirements.preferredTools,
      },
      maxLoadFactor: adjustedMaxLoadFactor,
    };
  }

  /**
   * Calculate match score for an assistant
   */
  private calculateMatchScore(assistant: RegisteredAssistant, requirements: AssistantRequirements): number {
    let score = 0;
    let totalWeight = 0;

    // Tool match (weight: 0.4)
    if (requirements.requiredTools && requirements.requiredTools.length > 0) {
      const assistantTools = assistant.capabilities.tools || [];
      const matchedTools = requirements.requiredTools.filter(t => assistantTools.includes(t));
      const toolScore = matchedTools.length / requirements.requiredTools.length;
      score += toolScore * 0.4;
      totalWeight += 0.4;
    }

    // Skill match (weight: 0.2)
    if (requirements.requiredSkills && requirements.requiredSkills.length > 0) {
      const assistantSkills = assistant.capabilities.skills || [];
      const matchedSkills = requirements.requiredSkills.filter(s => assistantSkills.includes(s));
      const skillScore = matchedSkills.length / requirements.requiredSkills.length;
      score += skillScore * 0.2;
      totalWeight += 0.2;
    }

    // Load factor (weight: 0.2) - prefer lower load
    // Calculate load factor from available properties
    const loadFactor = this.calculateLoadFactor(assistant.load);
    const loadScore = 1 - loadFactor;
    score += loadScore * 0.2;
    totalWeight += 0.2;

    // Health (weight: 0.2) - prefer healthy assistants
    const isHealthy = !assistant.heartbeat.isStale && assistant.status.state !== 'error';
    score += (isHealthy ? 1 : 0) * 0.2;
    totalWeight += 0.2;

    // Normalize
    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * Calculate load factor (0-1) from assistant load info
   */
  private calculateLoadFactor(load: RegisteredAssistant['load']): number {
    // Calculate based on active/queued tasks and token usage
    const taskLoad = Math.min((load.activeTasks + load.queuedTasks * 0.5) / 5, 1);

    // Token load (if limit is set)
    const tokenLoad = load.tokenLimit
      ? Math.min(load.tokensUsed / load.tokenLimit, 1)
      : 0;

    // LLM call load (if limit is set)
    const llmLoad = load.llmCallLimit
      ? Math.min(load.llmCalls / load.llmCallLimit, 1)
      : 0;

    // Combine with weights: task load is most important
    return taskLoad * 0.6 + tokenLoad * 0.25 + llmLoad * 0.15;
  }

  /**
   * Find alternative assistant excluding specified assistant
   */
  private findAlternativeAssistant(
    excludeAssistantId: string,
    requirements: AssistantRequirements,
    currentAssignments: Map<string, number>
  ): RegisteredAssistant | null {
    if (!this.registry) return null;

    // Find all available assistants
    const availableAssistants = this.findAvailableAssistants({
      maxLoadFactor: requirements.maxLoadFactor,
    });

    // Filter out excluded assistant and overloaded assistants
    const candidates = availableAssistants.filter(assistant => {
      if (assistant.id === excludeAssistantId) return false;

      const currentLoad = currentAssignments.get(assistant.id) || 0;
      return currentLoad < this.config.maxTasksPerAssistant;
    });

    if (candidates.length === 0) return null;

    // Score and sort candidates
    const scoredCandidates = candidates.map(assistant => ({
      assistant,
      score: this.calculateMatchScore(assistant, requirements),
    }));

    scoredCandidates.sort((a, b) => b.score - a.score);

    // Return best candidate above threshold
    const best = scoredCandidates[0];
    return best && best.score >= this.config.minMatchScore ? best.assistant : null;
  }

  /**
   * Create fallback assignment
   */
  private createFallbackAssignment(
    task: SwarmTask,
    requirements: AssistantRequirements,
    reason: string
  ): TaskAssistantAssignment {
    return {
      taskId: task.id,
      assistantId: null,
      assistant: null,
      isFallback: true,
      fallbackReason: reason,
      matchScore: 0,
      requirements,
    };
  }
}

/**
 * Create a selector with default configuration
 */
export function createSwarmAssistantSelector(
  registry?: AssistantRegistryService,
  config?: Partial<AssistantSelectorConfig>
): SwarmAssistantSelector {
  return new SwarmAssistantSelector(registry, config);
}
