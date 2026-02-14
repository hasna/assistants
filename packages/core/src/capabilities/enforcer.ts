/**
 * Capability Enforcer
 *
 * Enforces capability policies and permissions for assistants.
 * Checks orchestration rights, tool access, and approval requirements.
 */

import type { CapabilitiesConfigShared } from '@hasna/assistants-shared';
import type {
  AssistantCapabilitySet,
  ResolvedCapabilities,
  CapabilityCheckResult,
  OrchestrationCapabilities,
  ToolCapability,
  ApprovalLevel,
  ToolAccessPolicy,
} from './types';
import { DEFAULT_CAPABILITY_SET, ORCHESTRATION_DEFAULTS } from './types';
import { resolveCapabilityChain, createCapabilityChain } from './resolver';
import { configToCapabilities } from './storage';

/**
 * Context for capability checks
 */
export interface CapabilityCheckContext {
  /** Current depth in subassistant hierarchy */
  depth: number;
  /** Session ID */
  sessionId?: string;
  /** Assistant ID */
  assistantId?: string;
  /** Parent assistant ID (for subassistants) */
  parentId?: string;
  /** Current token usage */
  tokensUsed?: number;
  /** Active subassistant count */
  activeSubassistants?: number;
}

/**
 * Capability enforcement result
 */
export interface CapabilityEnforcementResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Whether approval is required */
  requiresApproval: boolean;
  /** Approval level if required */
  approvalLevel?: ApprovalLevel;
  /** Warnings to display */
  warnings: string[];
}

/**
 * Capability Enforcer class
 */
export class CapabilityEnforcer {
  private enabled: boolean;
  private capabilities: ResolvedCapabilities;
  private config: CapabilitiesConfigShared;

  constructor(config?: CapabilitiesConfigShared) {
    this.config = config || {};
    this.enabled = config?.enabled ?? false;

    // Build resolved capabilities from config
    if (config) {
      const chain = createCapabilityChain('assistant', configToCapabilities(config));
      this.capabilities = resolveCapabilityChain(chain);
    } else {
      this.capabilities = resolveCapabilityChain({});
    }
  }

  /**
   * Check if enforcer is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable enforcement
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Update configuration
   */
  updateConfig(config: CapabilitiesConfigShared): void {
    this.config = config;
    this.enabled = config.enabled ?? this.enabled;

    // Rebuild resolved capabilities
    const chain = createCapabilityChain('assistant', configToCapabilities(config));
    this.capabilities = resolveCapabilityChain(chain);
  }

  /**
   * Get current configuration
   */
  getConfig(): CapabilitiesConfigShared {
    return this.config;
  }

  /**
   * Get resolved capabilities
   */
  getResolvedCapabilities(): ResolvedCapabilities {
    return this.capabilities;
  }

  /**
   * Check if assistant can spawn a subassistant
   */
  canSpawnSubassistant(context: CapabilityCheckContext): CapabilityEnforcementResult {
    if (!this.enabled) {
      return { allowed: true, reason: 'Capability enforcement disabled', requiresApproval: false, warnings: [] };
    }

    const orch = this.capabilities.orchestration;

    // Check if spawning is allowed at all
    if (!orch.canSpawnSubassistants) {
      return {
        allowed: false,
        reason: `Subassistant spawning not allowed (orchestration level: ${orch.level})`,
        requiresApproval: false,
        warnings: [],
      };
    }

    // Check depth limit
    if (context.depth >= orch.maxSubassistantDepth) {
      return {
        allowed: false,
        reason: `Maximum subassistant depth (${orch.maxSubassistantDepth}) reached`,
        requiresApproval: false,
        warnings: [],
      };
    }

    // Check concurrent subassistant limit
    if (context.activeSubassistants !== undefined && context.activeSubassistants >= orch.maxConcurrentSubassistants) {
      return {
        allowed: false,
        reason: `Maximum concurrent subassistants (${orch.maxConcurrentSubassistants}) reached`,
        requiresApproval: false,
        warnings: [],
      };
    }

    // Build warnings for near-limit conditions
    const warnings: string[] = [];
    if (context.activeSubassistants !== undefined && context.activeSubassistants >= orch.maxConcurrentSubassistants - 1) {
      warnings.push(`Approaching concurrent subassistant limit (${context.activeSubassistants + 1}/${orch.maxConcurrentSubassistants})`);
    }
    if (context.depth >= orch.maxSubassistantDepth - 1) {
      warnings.push(`Approaching maximum depth (${context.depth + 1}/${orch.maxSubassistantDepth})`);
    }

    return {
      allowed: true,
      reason: 'Subassistant spawning allowed',
      requiresApproval: false,
      warnings,
    };
  }

  /**
   * Check if assistant can use a specific tool
   */
  canUseTool(toolName: string, context: CapabilityCheckContext): CapabilityEnforcementResult {
    if (!this.enabled) {
      return { allowed: true, reason: 'Capability enforcement disabled', requiresApproval: false, warnings: [] };
    }

    const tools = this.capabilities.tools;

    // Find matching capability rule
    const matchingRule = this.findMatchingToolRule(toolName, tools.capabilities);

    // Apply policy
    switch (tools.policy) {
      case 'allow_all':
        // Allow all unless explicitly denied
        if (matchingRule && !matchingRule.allowed) {
          return {
            allowed: false,
            reason: `Tool '${toolName}' is explicitly denied`,
            requiresApproval: false,
            warnings: [],
          };
        }
        break;

      case 'allow_list':
        // Deny unless explicitly allowed
        if (!matchingRule || !matchingRule.allowed) {
          return {
            allowed: false,
            reason: `Tool '${toolName}' is not in the allowed list`,
            requiresApproval: false,
            warnings: [],
          };
        }
        break;

      case 'deny_list':
        // Allow unless explicitly denied
        if (matchingRule && !matchingRule.allowed) {
          return {
            allowed: false,
            reason: `Tool '${toolName}' is in the deny list`,
            requiresApproval: false,
            warnings: [],
          };
        }
        break;

      case 'require_approval':
        // All tools require approval
        return {
          allowed: true,
          reason: `Tool '${toolName}' requires approval`,
          requiresApproval: true,
          approvalLevel: 'require',
          warnings: [],
        };
    }

    // Check for approval requirement on specific tool
    if (matchingRule?.approval && matchingRule.approval !== 'none') {
      return {
        allowed: true,
        reason: `Tool '${toolName}' requires approval`,
        requiresApproval: matchingRule.approval === 'require' || matchingRule.approval === 'require_explicit',
        approvalLevel: matchingRule.approval,
        warnings: matchingRule.approval === 'warn' ? [`Tool '${toolName}' usage will be logged`] : [],
      };
    }

    // Check rate limit if specified
    if (matchingRule?.rateLimit !== undefined) {
      // Rate limiting would be tracked externally, just return a warning
      return {
        allowed: true,
        reason: 'Tool allowed with rate limit',
        requiresApproval: false,
        warnings: [`Tool '${toolName}' has rate limit: ${matchingRule.rateLimit} calls/minute`],
      };
    }

    return {
      allowed: true,
      reason: 'Tool allowed',
      requiresApproval: false,
      warnings: [],
    };
  }

  /**
   * Check if assistant can delegate to another assistant
   */
  canDelegate(targetAssistantId: string, context: CapabilityCheckContext): CapabilityEnforcementResult {
    if (!this.enabled) {
      return { allowed: true, reason: 'Capability enforcement disabled', requiresApproval: false, warnings: [] };
    }

    const orch = this.capabilities.orchestration;

    if (!orch.canDelegate) {
      return {
        allowed: false,
        reason: 'Delegation not allowed for this assistant',
        requiresApproval: false,
        warnings: [],
      };
    }

    // Check allowed delegates if specified
    if (orch.allowedDelegates && orch.allowedDelegates.length > 0) {
      const isAllowed = orch.allowedDelegates.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern.endsWith('*')) {
          return targetAssistantId.startsWith(pattern.slice(0, -1));
        }
        return targetAssistantId === pattern;
      });

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Delegation to '${targetAssistantId}' not in allowed delegates list`,
          requiresApproval: false,
          warnings: [],
        };
      }
    }

    return {
      allowed: true,
      reason: 'Delegation allowed',
      requiresApproval: false,
      warnings: [],
    };
  }

  /**
   * Check if assistant can coordinate swarms
   */
  canCoordinateSwarm(context: CapabilityCheckContext): CapabilityEnforcementResult {
    if (!this.enabled) {
      return { allowed: true, reason: 'Capability enforcement disabled', requiresApproval: false, warnings: [] };
    }

    const orch = this.capabilities.orchestration;

    if (!orch.canCoordinateSwarms) {
      return {
        allowed: false,
        reason: `Swarm coordination not allowed (orchestration level: ${orch.level})`,
        requiresApproval: false,
        warnings: [],
      };
    }

    return {
      allowed: true,
      reason: 'Swarm coordination allowed',
      requiresApproval: false,
      warnings: [],
    };
  }

  /**
   * Find matching tool capability rule
   */
  private findMatchingToolRule(toolName: string, capabilities: ToolCapability[]): ToolCapability | null {
    // Find the most specific matching rule
    let bestMatch: ToolCapability | null = null;
    let bestSpecificity = -1;

    for (const cap of capabilities) {
      const specificity = this.matchPattern(toolName, cap.pattern);
      if (specificity > bestSpecificity) {
        bestMatch = cap;
        bestSpecificity = specificity;
      }
    }

    return bestMatch;
  }

  /**
   * Match a tool name against a pattern
   * Returns -1 if no match, otherwise returns specificity score (higher = more specific)
   */
  private matchPattern(toolName: string, pattern: string): number {
    // Exact match has highest specificity
    if (pattern === toolName) {
      return 1000;
    }

    // Wildcard match: 'bash:*' matches 'bash:execute', 'bash:run', etc.
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (toolName.startsWith(prefix)) {
        return prefix.length; // Longer prefix = higher specificity
      }
    }

    // Category match: 'bash' matches 'bash_execute' (underscore as separator)
    if (pattern.indexOf('*') === -1 && pattern.indexOf(':') === -1) {
      if (toolName.startsWith(pattern + '_') || toolName.startsWith(pattern + ':')) {
        return pattern.length;
      }
    }

    return -1;
  }
}

// Singleton instance
let globalEnforcer: CapabilityEnforcer | null = null;

/**
 * Get or create the global capability enforcer
 */
export function getGlobalCapabilityEnforcer(config?: CapabilitiesConfigShared): CapabilityEnforcer {
  if (!globalEnforcer) {
    globalEnforcer = new CapabilityEnforcer(config);
  } else if (config) {
    globalEnforcer.updateConfig(config);
  }
  return globalEnforcer;
}

/**
 * Reset the global capability enforcer (for testing)
 */
export function resetGlobalCapabilityEnforcer(): void {
  globalEnforcer = null;
}
