/**
 * Assistant Capability Model Types
 *
 * Defines the comprehensive capability schema for assistants, including
 * orchestration rights, tool access, budget limits, and approval policies.
 */

import type { BudgetLimits } from '@hasna/assistants-shared';

/**
 * Capability scope levels (for inheritance)
 */
export type CapabilityScope = 'system' | 'organization' | 'identity' | 'assistant' | 'session' | 'instance';

/**
 * Orchestration capability level
 */
export type OrchestrationLevel =
  | 'none'        // Cannot spawn any subassistants
  | 'limited'     // Can spawn limited subassistants
  | 'standard'    // Can spawn subassistants normally
  | 'full'        // Can orchestrate swarms
  | 'coordinator'; // Full swarm coordinator capabilities

/**
 * Tool access policy
 */
export type ToolAccessPolicy = 'allow_all' | 'allow_list' | 'deny_list' | 'require_approval';

/**
 * Approval requirement level
 */
export type ApprovalLevel = 'none' | 'warn' | 'require' | 'require_explicit';

/**
 * Tool capability definition
 */
export interface ToolCapability {
  /** Tool name or pattern (supports glob: bash:*, file:read) */
  pattern: string;
  /** Whether this tool is allowed */
  allowed: boolean;
  /** Approval requirement for this tool */
  approval?: ApprovalLevel;
  /** Rate limit for this tool (calls per minute) */
  rateLimit?: number;
  /** Additional conditions for access */
  conditions?: CapabilityCondition[];
}

/**
 * Capability condition
 */
export interface CapabilityCondition {
  type: 'depth_max' | 'time_limit' | 'token_limit' | 'context_has' | 'parent_allows';
  value: string | number | boolean;
  negate?: boolean;
}

/**
 * Skill capability definition
 */
export interface SkillCapability {
  /** Skill name or pattern */
  pattern: string;
  /** Whether this skill is allowed */
  allowed: boolean;
  /** Approval requirement */
  approval?: ApprovalLevel;
}

/**
 * Model capability definition
 */
export interface ModelCapability {
  /** Model ID or pattern */
  pattern: string;
  /** Whether this model can be used */
  allowed: boolean;
  /** Priority for auto-selection */
  priority?: number;
}

/**
 * Orchestration capabilities
 */
export interface OrchestrationCapabilities {
  /** Orchestration level */
  level: OrchestrationLevel;
  /** Can spawn subassistants */
  canSpawnSubassistants: boolean;
  /** Maximum concurrent subassistants */
  maxConcurrentSubassistants: number;
  /** Maximum subassistant depth */
  maxSubassistantDepth: number;
  /** Can coordinate swarms */
  canCoordinateSwarms: boolean;
  /** Maximum swarm size */
  maxSwarmSize: number;
  /** Can delegate to other assistants */
  canDelegate: boolean;
  /** Allowed assistant IDs for delegation */
  allowedDelegates?: string[];
}

/**
 * Budget capabilities
 */
export interface BudgetCapabilities {
  /** Budget limits for this assistant */
  limits: BudgetLimits;
  /** Can override parent budget */
  canOverrideBudget: boolean;
  /** Maximum budget allocation to subassistants */
  maxSubassistantBudget?: Partial<BudgetLimits>;
  /** Share budget with children */
  sharedBudget: boolean;
}

/**
 * Approval policy
 */
export interface ApprovalPolicy {
  /** Default approval level for unmatched operations */
  defaultLevel: ApprovalLevel;
  /** Operations requiring explicit approval */
  requireApproval: string[];
  /** Operations that trigger warnings */
  warnOn: string[];
  /** Auto-approve patterns */
  autoApprove: string[];
  /** Approval timeout in milliseconds */
  approvalTimeout?: number;
}

/**
 * Communication capabilities
 */
export interface CommunicationCapabilities {
  /** Can send messages to other assistants */
  canSendMessages: boolean;
  /** Can receive messages */
  canReceiveMessages: boolean;
  /** Can broadcast to multiple assistants */
  canBroadcast: boolean;
  /** Allowed recipient patterns */
  allowedRecipients?: string[];
  /** Message rate limit */
  messageRateLimit?: number;
}

/**
 * Memory/storage capabilities
 */
export interface MemoryCapabilities {
  /** Can access global memory */
  canAccessGlobalMemory: boolean;
  /** Memory scopes this assistant can access */
  allowedMemoryScopes: string[];
  /** Can write to memory */
  canWriteMemory: boolean;
  /** Memory quota (number of entries) */
  memoryQuota?: number;
}

/**
 * Full capability definition
 */
export interface AssistantCapabilitySet {
  /** Unique capability set ID */
  id?: string;
  /** Human-readable name */
  name?: string;
  /** Description */
  description?: string;
  /** Scope level */
  scope: CapabilityScope;
  /** Whether this capability set is enabled */
  enabled: boolean;

  // Orchestration
  orchestration: OrchestrationCapabilities;

  // Tool access
  tools: {
    policy: ToolAccessPolicy;
    capabilities: ToolCapability[];
  };

  // Skill access
  skills: {
    policy: ToolAccessPolicy;
    capabilities: SkillCapability[];
  };

  // Model access
  models: {
    allowed: ModelCapability[];
    defaultModel?: string;
  };

  // Budget
  budget: BudgetCapabilities;

  // Approval
  approval: ApprovalPolicy;

  // Communication
  communication: CommunicationCapabilities;

  // Memory
  memory: MemoryCapabilities;

  // Metadata
  metadata?: Record<string, unknown>;
}

/**
 * Capability inheritance chain
 */
export interface CapabilityChain {
  /** System-level capabilities (highest priority) */
  system?: Partial<AssistantCapabilitySet>;
  /** Organization-level capabilities */
  organization?: Partial<AssistantCapabilitySet>;
  /** Identity-level capabilities */
  identity?: Partial<AssistantCapabilitySet>;
  /** Assistant-level capabilities */
  assistant?: Partial<AssistantCapabilitySet>;
  /** Session-level capabilities */
  session?: Partial<AssistantCapabilitySet>;
  /** Instance-level capabilities (lowest priority) */
  instance?: Partial<AssistantCapabilitySet>;
}

/**
 * Resolved/merged capability set
 */
export interface ResolvedCapabilities extends AssistantCapabilitySet {
  /** Sources of each capability (for debugging) */
  sources: Record<string, CapabilityScope>;
  /** When capabilities were resolved */
  resolvedAt: string;
}

/**
 * Capability check result
 */
export interface CapabilityCheckResult {
  /** Whether the capability is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Which scope granted/denied */
  decidingScope?: CapabilityScope;
  /** Approval required */
  approvalRequired: boolean;
  /** Approval level if required */
  approvalLevel?: ApprovalLevel;
  /** Warnings to surface */
  warnings: string[];
}

/**
 * Default orchestration capabilities by level
 */
export const ORCHESTRATION_DEFAULTS: Record<OrchestrationLevel, OrchestrationCapabilities> = {
  none: {
    level: 'none',
    canSpawnSubassistants: false,
    maxConcurrentSubassistants: 0,
    maxSubassistantDepth: 0,
    canCoordinateSwarms: false,
    maxSwarmSize: 0,
    canDelegate: false,
  },
  limited: {
    level: 'limited',
    canSpawnSubassistants: true,
    maxConcurrentSubassistants: 2,
    maxSubassistantDepth: 1,
    canCoordinateSwarms: false,
    maxSwarmSize: 0,
    canDelegate: false,
  },
  standard: {
    level: 'standard',
    canSpawnSubassistants: true,
    maxConcurrentSubassistants: 5,
    maxSubassistantDepth: 3,
    canCoordinateSwarms: false,
    maxSwarmSize: 0,
    canDelegate: true,
  },
  full: {
    level: 'full',
    canSpawnSubassistants: true,
    maxConcurrentSubassistants: 10,
    maxSubassistantDepth: 5,
    canCoordinateSwarms: true,
    maxSwarmSize: 10,
    canDelegate: true,
  },
  coordinator: {
    level: 'coordinator',
    canSpawnSubassistants: true,
    maxConcurrentSubassistants: 20,
    maxSubassistantDepth: 10,
    canCoordinateSwarms: true,
    maxSwarmSize: 50,
    canDelegate: true,
  },
};

/**
 * Default capability set for new assistants
 */
export const DEFAULT_CAPABILITY_SET: AssistantCapabilitySet = {
  scope: 'instance',
  enabled: true,

  orchestration: ORCHESTRATION_DEFAULTS.standard,

  tools: {
    policy: 'allow_all',
    capabilities: [],
  },

  skills: {
    policy: 'allow_all',
    capabilities: [],
  },

  models: {
    allowed: [{ pattern: '*', allowed: true }],
  },

  budget: {
    limits: {},
    canOverrideBudget: false,
    sharedBudget: true,
  },

  approval: {
    defaultLevel: 'none',
    requireApproval: [],
    warnOn: [],
    autoApprove: [],
  },

  communication: {
    canSendMessages: true,
    canReceiveMessages: true,
    canBroadcast: false,
  },

  memory: {
    canAccessGlobalMemory: true,
    allowedMemoryScopes: ['*'],
    canWriteMemory: true,
  },
};

/**
 * Restricted capability set (for untrusted/sandboxed assistants)
 */
export const RESTRICTED_CAPABILITY_SET: Partial<AssistantCapabilitySet> = {
  orchestration: ORCHESTRATION_DEFAULTS.none,

  tools: {
    policy: 'allow_list',
    capabilities: [
      { pattern: 'file:read', allowed: true },
      { pattern: 'file:list', allowed: true },
    ],
  },

  skills: {
    policy: 'deny_list',
    capabilities: [],
  },

  budget: {
    limits: {
      maxTotalTokens: 50000,
      maxLlmCalls: 10,
      maxToolCalls: 20,
      maxDurationMs: 5 * 60 * 1000,
    },
    canOverrideBudget: false,
    sharedBudget: false,
  },

  approval: {
    defaultLevel: 'require',
    requireApproval: ['*'],
    warnOn: [],
    autoApprove: ['file:read', 'file:list'],
  },

  communication: {
    canSendMessages: false,
    canReceiveMessages: true,
    canBroadcast: false,
  },

  memory: {
    canAccessGlobalMemory: false,
    allowedMemoryScopes: [],
    canWriteMemory: false,
  },
};

/**
 * Coordinator capability set (for swarm coordinators)
 */
export const COORDINATOR_CAPABILITY_SET: Partial<AssistantCapabilitySet> = {
  orchestration: ORCHESTRATION_DEFAULTS.coordinator,

  tools: {
    policy: 'allow_all',
    capabilities: [],
  },

  budget: {
    limits: {
      maxTotalTokens: 2000000,
      maxLlmCalls: 500,
      maxToolCalls: 1000,
      maxDurationMs: 60 * 60 * 1000,
    },
    canOverrideBudget: true,
    sharedBudget: true,
  },

  communication: {
    canSendMessages: true,
    canReceiveMessages: true,
    canBroadcast: true,
  },
};
