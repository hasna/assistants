/**
 * Capability Tools
 *
 * Tools for querying and managing assistant capabilities.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolRegistry } from './registry';
import type {
  ResolvedCapabilities,
  CapabilityScope,
  OrchestrationLevel,
  ToolAccessPolicy,
} from '../capabilities';

/**
 * Context for capability tools
 */
export interface CapabilityToolContext {
  /** Get current resolved capabilities */
  getCapabilities: () => ResolvedCapabilities | null;
  /** Check if capabilities are enabled */
  isEnabled: () => boolean;
  /** Get current orchestration level */
  getOrchestrationLevel?: () => OrchestrationLevel | null;
  /** Get tool policy */
  getToolPolicy?: () => ToolAccessPolicy | null;
  /** Get allowed tools */
  getAllowedTools?: () => string[] | null;
  /** Get denied tools */
  getDeniedTools?: () => string[] | null;
}

/**
 * capabilities_get - Get current capability settings
 */
export const capabilitiesGetTool: Tool = {
  name: 'capabilities_get',
  description: 'Get the current capability settings and resolved permissions for this assistant.',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        enum: ['all', 'orchestration', 'tools', 'skills', 'models', 'budget', 'approval', 'communication', 'memory'],
        description: 'Which section of capabilities to retrieve (default: all)',
      },
    },
  },
};

/**
 * Create capabilities_get executor
 */
export function createCapabilitiesGetExecutor(context: CapabilityToolContext) {
  return async (input: Record<string, unknown>): Promise<string> => {
    const section = (input.section as string) || 'all';

    if (!context.isEnabled()) {
      return 'Capability enforcement is disabled.';
    }

    const capabilities = context.getCapabilities();
    if (!capabilities) {
      return 'No capabilities configured.';
    }

    const lines: string[] = [];

    if (section === 'all' || section === 'orchestration') {
      lines.push('## Orchestration');
      lines.push(`Level: ${capabilities.orchestration.level}`);
      lines.push(`Can spawn subassistants: ${capabilities.orchestration.canSpawnSubassistants}`);
      lines.push(`Max concurrent subassistants: ${capabilities.orchestration.maxConcurrentSubassistants}`);
      lines.push(`Max subassistant depth: ${capabilities.orchestration.maxSubassistantDepth}`);
      lines.push(`Can coordinate swarms: ${capabilities.orchestration.canCoordinateSwarms}`);
      lines.push(`Can delegate: ${capabilities.orchestration.canDelegate}`);
      lines.push('');
    }

    if (section === 'all' || section === 'tools') {
      lines.push('## Tools');
      lines.push(`Policy: ${capabilities.tools.policy}`);
      if (capabilities.tools.capabilities.length > 0) {
        lines.push('Rules:');
        for (const cap of capabilities.tools.capabilities.slice(0, 10)) {
          lines.push(`  - ${cap.pattern}: ${cap.allowed ? 'allowed' : 'denied'}${cap.approval ? ` (${cap.approval})` : ''}`);
        }
        if (capabilities.tools.capabilities.length > 10) {
          lines.push(`  ... and ${capabilities.tools.capabilities.length - 10} more`);
        }
      }
      lines.push('');
    }

    if (section === 'all' || section === 'skills') {
      lines.push('## Skills');
      lines.push(`Policy: ${capabilities.skills.policy}`);
      if (capabilities.skills.capabilities.length > 0) {
        lines.push('Rules:');
        for (const cap of capabilities.skills.capabilities.slice(0, 5)) {
          lines.push(`  - ${cap.pattern}: ${cap.allowed ? 'allowed' : 'denied'}`);
        }
        if (capabilities.skills.capabilities.length > 5) {
          lines.push(`  ... and ${capabilities.skills.capabilities.length - 5} more`);
        }
      }
      lines.push('');
    }

    if (section === 'all' || section === 'models') {
      lines.push('## Models');
      if (capabilities.models.defaultModel) {
        lines.push(`Default: ${capabilities.models.defaultModel}`);
      }
      if (capabilities.models.allowed.length > 0) {
        lines.push('Allowed:');
        for (const model of capabilities.models.allowed.slice(0, 5)) {
          lines.push(`  - ${model.pattern}${model.priority ? ` (priority: ${model.priority})` : ''}`);
        }
      }
      lines.push('');
    }

    if (section === 'all' || section === 'budget') {
      lines.push('## Budget');
      lines.push(`Can override budget: ${capabilities.budget.canOverrideBudget}`);
      lines.push(`Shared budget: ${capabilities.budget.sharedBudget}`);
      if (Object.keys(capabilities.budget.limits).length > 0) {
        lines.push('Limits:');
        for (const [key, value] of Object.entries(capabilities.budget.limits)) {
          if (value !== undefined) {
            lines.push(`  ${key}: ${value}`);
          }
        }
      }
      lines.push('');
    }

    if (section === 'all' || section === 'approval') {
      lines.push('## Approval');
      lines.push(`Default level: ${capabilities.approval.defaultLevel}`);
      if (capabilities.approval.requireApproval.length > 0) {
        lines.push(`Require approval: ${capabilities.approval.requireApproval.join(', ')}`);
      }
      if (capabilities.approval.autoApprove.length > 0) {
        lines.push(`Auto-approve: ${capabilities.approval.autoApprove.join(', ')}`);
      }
      lines.push('');
    }

    if (section === 'all' || section === 'communication') {
      lines.push('## Communication');
      lines.push(`Can send messages: ${capabilities.communication.canSendMessages}`);
      lines.push(`Can receive messages: ${capabilities.communication.canReceiveMessages}`);
      lines.push(`Can broadcast: ${capabilities.communication.canBroadcast}`);
      lines.push('');
    }

    if (section === 'all' || section === 'memory') {
      lines.push('## Memory');
      lines.push(`Can access global memory: ${capabilities.memory.canAccessGlobalMemory}`);
      lines.push(`Can write memory: ${capabilities.memory.canWriteMemory}`);
      lines.push(`Allowed scopes: ${capabilities.memory.allowedMemoryScopes.join(', ')}`);
      if (capabilities.memory.memoryQuota) {
        lines.push(`Quota: ${capabilities.memory.memoryQuota} entries`);
      }
      lines.push('');
    }

    // Add sources if available
    if (section === 'all' && Object.keys(capabilities.sources).length > 0) {
      lines.push('## Sources');
      for (const [key, scope] of Object.entries(capabilities.sources)) {
        lines.push(`  ${key}: from ${scope}`);
      }
    }

    return lines.join('\n');
  };
}

/**
 * capabilities_status - Get capability enforcement status
 */
export const capabilitiesStatusTool: Tool = {
  name: 'capabilities_status',
  description: 'Get the current capability enforcement status and statistics.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

/**
 * Create capabilities_status executor
 */
export function createCapabilitiesStatusExecutor(context: CapabilityToolContext) {
  return async (): Promise<string> => {
    const enabled = context.isEnabled();
    const capabilities = context.getCapabilities();

    const lines: string[] = [];
    lines.push(`Capability Enforcement: ${enabled ? 'ENABLED' : 'DISABLED'}`);

    if (capabilities) {
      lines.push(`Resolved at: ${capabilities.resolvedAt}`);
      lines.push(`Orchestration level: ${capabilities.orchestration.level}`);
      lines.push(`Tool policy: ${capabilities.tools.policy}`);

      // Summary
      const totalToolRules = capabilities.tools.capabilities.length;
      const totalSkillRules = capabilities.skills.capabilities.length;
      const totalModelRules = capabilities.models.allowed.length;

      lines.push('');
      lines.push('Summary:');
      lines.push(`  Tool rules: ${totalToolRules}`);
      lines.push(`  Skill rules: ${totalSkillRules}`);
      lines.push(`  Model rules: ${totalModelRules}`);
    } else {
      lines.push('No capabilities configured.');
    }

    return lines.join('\n');
  };
}

/**
 * capabilities_check - Check if a specific action is allowed
 */
export const capabilitiesCheckTool: Tool = {
  name: 'capabilities_check',
  description: 'Check if a specific action is allowed by capabilities.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['tool', 'skill', 'spawn', 'delegate', 'swarm'],
        description: 'Type of action to check',
      },
      target: {
        type: 'string',
        description: 'Target of the action (tool name, skill name, assistant ID, etc.)',
      },
    },
    required: ['action'],
  },
};

/**
 * Create capabilities_check executor
 */
export function createCapabilitiesCheckExecutor(context: CapabilityToolContext) {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = input.action as string;
    const target = (input.target as string) || '';

    if (!context.isEnabled()) {
      return `Action '${action}' would be allowed (capability enforcement is disabled).`;
    }

    const capabilities = context.getCapabilities();
    if (!capabilities) {
      return `Action '${action}' would be allowed (no capabilities configured).`;
    }

    switch (action) {
      case 'spawn':
        if (!capabilities.orchestration.canSpawnSubassistants) {
          return `Action 'spawn' is NOT allowed: Subassistant spawning is disabled (level: ${capabilities.orchestration.level}).`;
        }
        return `Action 'spawn' is allowed. Max depth: ${capabilities.orchestration.maxSubassistantDepth}, Max concurrent: ${capabilities.orchestration.maxConcurrentSubassistants}.`;

      case 'delegate':
        if (!capabilities.orchestration.canDelegate) {
          return `Action 'delegate' is NOT allowed: Delegation is disabled.`;
        }
        if (target && capabilities.orchestration.allowedDelegates?.length) {
          const allowed = capabilities.orchestration.allowedDelegates.some(
            (p) => p === '*' || p === target || (p.endsWith('*') && target.startsWith(p.slice(0, -1)))
          );
          if (!allowed) {
            return `Action 'delegate' to '${target}' is NOT allowed: Not in allowed delegates list.`;
          }
        }
        return `Action 'delegate'${target ? ` to '${target}'` : ''} is allowed.`;

      case 'swarm':
        if (!capabilities.orchestration.canCoordinateSwarms) {
          return `Action 'swarm' is NOT allowed: Swarm coordination is disabled (level: ${capabilities.orchestration.level}).`;
        }
        return `Action 'swarm' is allowed. Max swarm size: ${capabilities.orchestration.maxSwarmSize}.`;

      case 'tool':
        if (!target) {
          return `Please specify a tool name with the 'target' parameter.`;
        }
        return checkToolAccess(target, capabilities);

      case 'skill':
        if (!target) {
          return `Please specify a skill name with the 'target' parameter.`;
        }
        return checkSkillAccess(target, capabilities);

      default:
        return `Unknown action: ${action}`;
    }
  };
}

/**
 * Check tool access
 */
function checkToolAccess(toolName: string, capabilities: ResolvedCapabilities): string {
  const { policy, capabilities: rules } = capabilities.tools;

  // Find matching rule
  let bestMatch: (typeof rules)[0] | null = null;
  for (const rule of rules) {
    if (rule.pattern === toolName) {
      bestMatch = rule;
      break;
    }
    if (rule.pattern.endsWith('*') && toolName.startsWith(rule.pattern.slice(0, -1))) {
      if (!bestMatch || rule.pattern.length > bestMatch.pattern.length) {
        bestMatch = rule;
      }
    }
  }

  switch (policy) {
    case 'allow_all':
      if (bestMatch && !bestMatch.allowed) {
        return `Tool '${toolName}' is NOT allowed: Explicitly denied.`;
      }
      return `Tool '${toolName}' is allowed (policy: allow_all).`;

    case 'allow_list':
      if (!bestMatch || !bestMatch.allowed) {
        return `Tool '${toolName}' is NOT allowed: Not in allow list (policy: allow_list).`;
      }
      return `Tool '${toolName}' is allowed (matched rule: ${bestMatch.pattern}).`;

    case 'deny_list':
      if (bestMatch && !bestMatch.allowed) {
        return `Tool '${toolName}' is NOT allowed: In deny list (matched rule: ${bestMatch.pattern}).`;
      }
      return `Tool '${toolName}' is allowed (not in deny list).`;

    case 'require_approval':
      return `Tool '${toolName}' requires approval (policy: require_approval).`;

    default:
      return `Tool '${toolName}' access unknown (policy: ${policy}).`;
  }
}

/**
 * Check skill access
 */
function checkSkillAccess(skillName: string, capabilities: ResolvedCapabilities): string {
  const { policy, capabilities: rules } = capabilities.skills;

  // Find matching rule
  let bestMatch: (typeof rules)[0] | null = null;
  for (const rule of rules) {
    if (rule.pattern === skillName) {
      bestMatch = rule;
      break;
    }
    if (rule.pattern.endsWith('*') && skillName.startsWith(rule.pattern.slice(0, -1))) {
      if (!bestMatch || rule.pattern.length > bestMatch.pattern.length) {
        bestMatch = rule;
      }
    }
  }

  switch (policy) {
    case 'allow_all':
      if (bestMatch && !bestMatch.allowed) {
        return `Skill '${skillName}' is NOT allowed: Explicitly denied.`;
      }
      return `Skill '${skillName}' is allowed (policy: allow_all).`;

    case 'allow_list':
      if (!bestMatch || !bestMatch.allowed) {
        return `Skill '${skillName}' is NOT allowed: Not in allow list.`;
      }
      return `Skill '${skillName}' is allowed (matched rule: ${bestMatch.pattern}).`;

    case 'deny_list':
      if (bestMatch && !bestMatch.allowed) {
        return `Skill '${skillName}' is NOT allowed: In deny list.`;
      }
      return `Skill '${skillName}' is allowed (not in deny list).`;

    default:
      return `Skill '${skillName}' access unknown (policy: ${policy}).`;
  }
}

/**
 * All capability tools
 */
export const capabilityTools: Tool[] = [
  capabilitiesGetTool,
  capabilitiesStatusTool,
  capabilitiesCheckTool,
];

/**
 * Create all capability tool executors
 */
export function createCapabilityToolExecutors(context: CapabilityToolContext) {
  return {
    capabilities_get: createCapabilitiesGetExecutor(context),
    capabilities_status: createCapabilitiesStatusExecutor(context),
    capabilities_check: createCapabilitiesCheckExecutor(context),
  };
}

/**
 * Register all capability tools
 */
export function registerCapabilityTools(
  registry: ToolRegistry,
  context: CapabilityToolContext
): void {
  const executors = createCapabilityToolExecutors(context);

  registry.register(capabilitiesGetTool, executors.capabilities_get);
  registry.register(capabilitiesStatusTool, executors.capabilities_status);
  registry.register(capabilitiesCheckTool, executors.capabilities_check);
}
