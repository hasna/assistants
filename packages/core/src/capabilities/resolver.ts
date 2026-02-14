/**
 * Capability Resolver
 *
 * Resolves capability chains by merging capabilities from different scopes.
 * Higher precedence scopes override lower precedence scopes.
 */

import type {
  AssistantCapabilitySet,
  CapabilityChain,
  CapabilityScope,
  ResolvedCapabilities,
  OrchestrationCapabilities,
  ToolCapability,
  SkillCapability,
  ModelCapability,
  BudgetCapabilities,
  ApprovalPolicy,
  CommunicationCapabilities,
  MemoryCapabilities,
} from './types';
import { DEFAULT_CAPABILITY_SET, ORCHESTRATION_DEFAULTS } from './types';

/**
 * Scope precedence (lower number = higher precedence)
 */
const SCOPE_PRECEDENCE: Record<CapabilityScope, number> = {
  system: 0,
  organization: 1,
  identity: 2,
  assistant: 3,
  session: 4,
  instance: 5,
};

/**
 * Merge two arrays, with later items overriding earlier by pattern
 */
function mergeByPattern<T extends { pattern: string }>(base: T[], override: T[]): T[] {
  const merged = new Map<string, T>();

  for (const item of base) {
    merged.set(item.pattern, item);
  }

  for (const item of override) {
    merged.set(item.pattern, item);
  }

  return Array.from(merged.values());
}

/**
 * Merge orchestration capabilities (most restrictive wins)
 */
function mergeOrchestration(
  base: OrchestrationCapabilities,
  override: Partial<OrchestrationCapabilities>
): OrchestrationCapabilities {
  return {
    level: override.level ?? base.level,
    canSpawnSubassistants: override.canSpawnSubassistants ?? base.canSpawnSubassistants,
    maxConcurrentSubassistants: Math.min(
      override.maxConcurrentSubassistants ?? base.maxConcurrentSubassistants,
      base.maxConcurrentSubassistants
    ),
    maxSubassistantDepth: Math.min(
      override.maxSubassistantDepth ?? base.maxSubassistantDepth,
      base.maxSubassistantDepth
    ),
    canCoordinateSwarms: (override.canCoordinateSwarms ?? base.canCoordinateSwarms) && base.canCoordinateSwarms,
    maxSwarmSize: Math.min(
      override.maxSwarmSize ?? base.maxSwarmSize,
      base.maxSwarmSize
    ),
    canDelegate: (override.canDelegate ?? base.canDelegate) && base.canDelegate,
    allowedDelegates: override.allowedDelegates ?? base.allowedDelegates,
  };
}

/**
 * Merge budget capabilities (most restrictive wins)
 */
function mergeBudget(
  base: BudgetCapabilities,
  override: Partial<BudgetCapabilities>
): BudgetCapabilities {
  const mergedLimits = { ...base.limits };

  if (override.limits) {
    for (const [key, value] of Object.entries(override.limits)) {
      if (value !== undefined) {
        const baseValue = (mergedLimits as Record<string, number | undefined>)[key];
        // Take the more restrictive (lower) limit
        (mergedLimits as Record<string, number | undefined>)[key] =
          baseValue !== undefined ? Math.min(baseValue, value as number) : value;
      }
    }
  }

  return {
    limits: mergedLimits,
    canOverrideBudget: (override.canOverrideBudget ?? base.canOverrideBudget) && base.canOverrideBudget,
    maxSubassistantBudget: override.maxSubassistantBudget ?? base.maxSubassistantBudget,
    sharedBudget: override.sharedBudget ?? base.sharedBudget,
  };
}

/**
 * Merge approval policies (more restrictive wins)
 */
function mergeApproval(
  base: ApprovalPolicy,
  override: Partial<ApprovalPolicy>
): ApprovalPolicy {
  // Default level: use the more restrictive
  const levelOrder = ['none', 'warn', 'require', 'require_explicit'];
  const baseIdx = levelOrder.indexOf(base.defaultLevel);
  const overrideIdx = override.defaultLevel ? levelOrder.indexOf(override.defaultLevel) : -1;

  return {
    defaultLevel: overrideIdx > baseIdx ? override.defaultLevel! : base.defaultLevel,
    requireApproval: [...base.requireApproval, ...(override.requireApproval || [])],
    warnOn: [...base.warnOn, ...(override.warnOn || [])],
    autoApprove: base.autoApprove.filter(
      (p) => !(override.requireApproval || []).includes(p)
    ),
    approvalTimeout: override.approvalTimeout ?? base.approvalTimeout,
  };
}

/**
 * Merge communication capabilities (most restrictive wins)
 */
function mergeCommunication(
  base: CommunicationCapabilities,
  override: Partial<CommunicationCapabilities>
): CommunicationCapabilities {
  return {
    canSendMessages: (override.canSendMessages ?? base.canSendMessages) && base.canSendMessages,
    canReceiveMessages: (override.canReceiveMessages ?? base.canReceiveMessages) && base.canReceiveMessages,
    canBroadcast: (override.canBroadcast ?? base.canBroadcast) && base.canBroadcast,
    allowedRecipients: override.allowedRecipients ?? base.allowedRecipients,
    messageRateLimit: override.messageRateLimit !== undefined
      ? Math.min(override.messageRateLimit, base.messageRateLimit || Infinity)
      : base.messageRateLimit,
  };
}

/**
 * Merge memory capabilities (most restrictive wins)
 */
function mergeMemory(
  base: MemoryCapabilities,
  override: Partial<MemoryCapabilities>
): MemoryCapabilities {
  // For scopes, intersect if override is more restrictive
  let scopes = base.allowedMemoryScopes;
  if (override.allowedMemoryScopes?.length) {
    if (base.allowedMemoryScopes.includes('*')) {
      scopes = override.allowedMemoryScopes;
    } else {
      scopes = base.allowedMemoryScopes.filter(
        (s) => override.allowedMemoryScopes!.includes(s) || override.allowedMemoryScopes!.includes('*')
      );
    }
  }

  return {
    canAccessGlobalMemory: (override.canAccessGlobalMemory ?? base.canAccessGlobalMemory) && base.canAccessGlobalMemory,
    allowedMemoryScopes: scopes,
    canWriteMemory: (override.canWriteMemory ?? base.canWriteMemory) && base.canWriteMemory,
    memoryQuota: override.memoryQuota !== undefined
      ? Math.min(override.memoryQuota, base.memoryQuota || Infinity)
      : base.memoryQuota,
  };
}

/**
 * Merge two capability sets
 */
function mergeCapabilitySets(
  base: AssistantCapabilitySet,
  override: Partial<AssistantCapabilitySet>,
  overrideScope: CapabilityScope
): { merged: AssistantCapabilitySet; sources: Record<string, CapabilityScope> } {
  const sources: Record<string, CapabilityScope> = {};

  // Start with base
  const merged: AssistantCapabilitySet = { ...base };

  // Merge enabled (if disabled at any level, disabled)
  if (override.enabled === false) {
    merged.enabled = false;
    sources['enabled'] = overrideScope;
  }

  // Merge orchestration
  if (override.orchestration) {
    merged.orchestration = mergeOrchestration(base.orchestration, override.orchestration);
    sources['orchestration'] = overrideScope;
  }

  // Merge tools
  if (override.tools) {
    merged.tools = {
      policy: override.tools.policy ?? base.tools.policy,
      capabilities: mergeByPattern(base.tools.capabilities, override.tools.capabilities || []),
    };
    sources['tools'] = overrideScope;
  }

  // Merge skills
  if (override.skills) {
    merged.skills = {
      policy: override.skills.policy ?? base.skills.policy,
      capabilities: mergeByPattern(base.skills.capabilities, override.skills.capabilities || []),
    };
    sources['skills'] = overrideScope;
  }

  // Merge models
  if (override.models) {
    merged.models = {
      allowed: mergeByPattern(base.models.allowed, override.models.allowed || []),
      defaultModel: override.models.defaultModel ?? base.models.defaultModel,
    };
    sources['models'] = overrideScope;
  }

  // Merge budget
  if (override.budget) {
    merged.budget = mergeBudget(base.budget, override.budget);
    sources['budget'] = overrideScope;
  }

  // Merge approval
  if (override.approval) {
    merged.approval = mergeApproval(base.approval, override.approval);
    sources['approval'] = overrideScope;
  }

  // Merge communication
  if (override.communication) {
    merged.communication = mergeCommunication(base.communication, override.communication);
    sources['communication'] = overrideScope;
  }

  // Merge memory
  if (override.memory) {
    merged.memory = mergeMemory(base.memory, override.memory);
    sources['memory'] = overrideScope;
  }

  // Merge metadata
  if (override.metadata) {
    merged.metadata = { ...base.metadata, ...override.metadata };
    sources['metadata'] = overrideScope;
  }

  return { merged, sources };
}

/**
 * Resolve a capability chain into a single capability set
 */
export function resolveCapabilityChain(chain: CapabilityChain): ResolvedCapabilities {
  // Get scopes in precedence order (highest first)
  const scopes: [CapabilityScope, Partial<AssistantCapabilitySet> | undefined][] = [
    ['system', chain.system],
    ['organization', chain.organization],
    ['identity', chain.identity],
    ['assistant', chain.assistant],
    ['session', chain.session],
    ['instance', chain.instance],
  ];

  // Start with defaults
  let current: AssistantCapabilitySet = { ...DEFAULT_CAPABILITY_SET };
  let allSources: Record<string, CapabilityScope> = {};

  // Apply each scope in order (highest precedence last to override)
  // But for restrictive merging, we go from lowest to highest
  for (const [scope, capabilities] of scopes.reverse()) {
    if (capabilities) {
      const { merged, sources } = mergeCapabilitySets(current, capabilities, scope);
      current = merged;
      allSources = { ...allSources, ...sources };
    }
  }

  return {
    ...current,
    sources: allSources,
    resolvedAt: new Date().toISOString(),
  };
}

/**
 * Create a capability chain with just one scope
 */
export function createCapabilityChain(
  scope: CapabilityScope,
  capabilities: Partial<AssistantCapabilitySet>
): CapabilityChain {
  return {
    [scope]: capabilities,
  };
}

/**
 * Extend a capability chain with additional capabilities
 */
export function extendCapabilityChain(
  chain: CapabilityChain,
  scope: CapabilityScope,
  capabilities: Partial<AssistantCapabilitySet>
): CapabilityChain {
  return {
    ...chain,
    [scope]: capabilities,
  };
}
