/**
 * Swarm Tools
 *
 * Tools for programmatic swarm execution from within assistant loops.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolRegistry } from './registry';
import type { SwarmCoordinator, SwarmInput, SwarmResult } from '../swarm';

/**
 * Context for swarm tools
 */
export interface SwarmToolContext {
  /** Get or create swarm coordinator */
  getSwarmCoordinator: () => SwarmCoordinator | null;
  /** Check if swarm is available */
  isSwarmEnabled: () => boolean;
}

/**
 * swarm_execute - Execute a multi-assistant swarm
 */
export const swarmExecuteTool: Tool = {
  name: 'swarm_execute',
  description: `Execute a multi-assistant swarm to accomplish a complex goal.
The swarm uses specialized assistants (planner, workers, critic) to break down and complete the goal.

Use for complex tasks that benefit from parallel processing or multiple perspectives.`,
  parameters: {
    type: 'object',
    required: ['goal'],
    properties: {
      goal: {
        type: 'string',
        description: 'The goal or task for the swarm to accomplish',
      },
      context: {
        type: 'string',
        description: 'Additional context or requirements',
      },
      maxConcurrent: {
        type: 'number',
        description: 'Maximum concurrent worker assistants (default: 3)',
      },
      maxTasks: {
        type: 'number',
        description: 'Maximum tasks in the plan (default: 20)',
      },
      enableCritic: {
        type: 'boolean',
        description: 'Enable critic review pass (default: true)',
      },
      autoApprove: {
        type: 'boolean',
        description: 'Auto-approve generated plan (default: true for tools)',
      },
    },
  },
};

/**
 * swarm_status - Get status of current swarm
 */
export const swarmStatusTool: Tool = {
  name: 'swarm_status',
  description: 'Get the status of the current swarm execution including task progress and metrics.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * swarm_stop - Stop current swarm execution
 */
export const swarmStopTool: Tool = {
  name: 'swarm_stop',
  description: 'Stop the current swarm execution.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * All swarm tools
 */
export const swarmTools: Tool[] = [
  swarmExecuteTool,
  swarmStatusTool,
  swarmStopTool,
];

/**
 * Create executor for swarm_execute tool
 */
export function createSwarmExecuteExecutor(context: SwarmToolContext) {
  return async (input: {
    goal: string;
    context?: string;
    maxConcurrent?: number;
    maxTasks?: number;
    enableCritic?: boolean;
    autoApprove?: boolean;
  }): Promise<string> => {
    if (!context.isSwarmEnabled()) {
      return 'Swarm mode is not enabled or available in this context.';
    }

    const coordinator = context.getSwarmCoordinator();
    if (!coordinator) {
      return 'Swarm coordinator not available. Swarm execution requires full assistant context.';
    }

    const swarmInput: SwarmInput = {
      goal: input.goal,
      context: input.context,
      config: {
        maxConcurrent: input.maxConcurrent,
        maxTasks: input.maxTasks,
        enableCritic: input.enableCritic,
        autoApprove: input.autoApprove !== false, // Default to true for tool invocation
      },
    };

    try {
      const result = await coordinator.execute(swarmInput);
      return formatSwarmResult(result);
    } catch (error) {
      return `Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
}

/**
 * Create executor for swarm_status tool
 */
export function createSwarmStatusExecutor(context: SwarmToolContext) {
  return async (): Promise<string> => {
    const coordinator = context.getSwarmCoordinator();
    if (!coordinator) {
      return 'No swarm coordinator available.';
    }

    const state = coordinator.getState();
    if (!state) {
      return 'No swarm currently running.';
    }

    const output = {
      id: state.id,
      status: state.status,
      metrics: state.metrics,
      errors: state.errors,
      plan: state.plan ? {
        id: state.plan.id,
        goal: state.plan.goal,
        taskCount: state.plan.tasks.length,
        approved: state.plan.approved,
      } : null,
    };

    return JSON.stringify(output, null, 2);
  };
}

/**
 * Create executor for swarm_stop tool
 */
export function createSwarmStopExecutor(context: SwarmToolContext) {
  return async (): Promise<string> => {
    const coordinator = context.getSwarmCoordinator();
    if (!coordinator) {
      return 'No swarm coordinator available.';
    }

    if (!coordinator.isRunning()) {
      return 'No swarm currently running.';
    }

    coordinator.stop();
    return 'Swarm execution stopped.';
  };
}

/**
 * Create all executors for swarm tools
 */
export function createSwarmToolExecutors(context: SwarmToolContext): Map<string, (input: Record<string, unknown>) => Promise<string>> {
  const executors = new Map<string, (input: Record<string, unknown>) => Promise<string>>();

  executors.set('swarm_execute', createSwarmExecuteExecutor(context) as (input: Record<string, unknown>) => Promise<string>);
  executors.set('swarm_status', createSwarmStatusExecutor(context) as (input: Record<string, unknown>) => Promise<string>);
  executors.set('swarm_stop', createSwarmStopExecutor(context) as (input: Record<string, unknown>) => Promise<string>);

  return executors;
}

/**
 * Register swarm tools with a registry
 */
export function registerSwarmTools(
  registry: ToolRegistry,
  context: SwarmToolContext
): void {
  const executors = createSwarmToolExecutors(context);

  for (const tool of swarmTools) {
    const executor = executors.get(tool.name);
    if (executor) {
      registry.register(tool, executor);
    }
  }
}

/**
 * Format swarm result as string output
 */
function formatSwarmResult(result: SwarmResult): string {
  if (result.success) {
    const lines: string[] = [];
    lines.push('**Swarm completed successfully**\n');

    if (result.result) {
      lines.push('**Result:**');
      lines.push(result.result);
      lines.push('');
    }

    lines.push('**Metrics:**');
    lines.push(`  Tasks: ${result.metrics.completedTasks}/${result.metrics.totalTasks} completed`);
    if (result.metrics.failedTasks > 0) {
      lines.push(`  Failed: ${result.metrics.failedTasks}`);
    }
    lines.push(`  Tool calls: ${result.metrics.toolCalls}`);
    lines.push(`  Duration: ${Math.round(result.durationMs / 1000)}s`);

    return lines.join('\n');
  } else {
    const lines: string[] = [];
    lines.push('**Swarm execution failed**\n');
    lines.push(`Error: ${result.error}`);

    if (Object.keys(result.taskResults).length > 0) {
      lines.push(`\nPartial results: ${Object.keys(result.taskResults).length} tasks completed before failure`);
    }

    lines.push('\n**Metrics:**');
    lines.push(`  Tasks: ${result.metrics.completedTasks}/${result.metrics.totalTasks}`);
    lines.push(`  Failed: ${result.metrics.failedTasks}`);

    return lines.join('\n');
  }
}
