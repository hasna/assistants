import type {
  GuardrailsConfig,
  GuardrailsPolicy,
  PolicyEvaluationResult,
  ToolPolicyRule,
  PolicyCondition,
  PolicyAction,
  PolicyScope,
} from './types';
import { POLICY_SCOPE_PRECEDENCE, DEFAULT_GUARDRAILS_CONFIG } from './defaults';

/**
 * Context for policy evaluation
 */
export interface EvaluationContext {
  /** Tool name being evaluated */
  toolName: string;
  /** Tool input parameters */
  toolInput?: Record<string, unknown>;
  /** Current assistant depth */
  depth?: number;
  /** Session duration in ms */
  sessionDuration?: number;
  /** Additional context data */
  context?: Record<string, unknown>;
}

/**
 * Match a pattern against a value
 * Supports glob patterns (* and **) and regex
 */
function matchPattern(pattern: string, value: string): boolean {
  // Check if pattern is a regex (starts and ends with /)
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      const regexStr = pattern.slice(1, -1);
      // Reject overly complex patterns to prevent ReDoS
      if (regexStr.length > 500) return false;
      const regex = new RegExp(regexStr);
      return regex.test(value.slice(0, 10000));
    } catch {
      return false;
    }
  }

  // Convert glob to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
    .replace(/\*\*/g, '{{GLOBSTAR}}') // Preserve **
    .replace(/\*/g, '[^:]*') // * matches within segment
    .replace(/{{GLOBSTAR}}/g, '.*'); // ** matches across segments

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(value);
}

/**
 * Evaluate a condition
 */
function evaluateCondition(
  condition: PolicyCondition,
  context: EvaluationContext
): boolean {
  let result = false;

  switch (condition.type) {
    case 'input_contains': {
      const input = JSON.stringify(context.toolInput || {});
      result = input.includes(String(condition.value));
      break;
    }
    case 'input_matches': {
      const input = JSON.stringify(context.toolInput || {});
      try {
        const regexStr = String(condition.value);
        if (regexStr.length > 500) { result = false; break; }
        const regex = new RegExp(regexStr);
        result = regex.test(input.slice(0, 10000));
      } catch {
        result = false;
      }
      break;
    }
    case 'context_has': {
      result = context.context?.[String(condition.value)] !== undefined;
      break;
    }
    case 'depth_exceeds': {
      result = (context.depth || 0) > Number(condition.value);
      break;
    }
    case 'time_exceeds': {
      result = (context.sessionDuration || 0) > Number(condition.value);
      break;
    }
    case 'custom': {
      // Custom conditions would need external evaluation
      result = false;
      break;
    }
  }

  return condition.negate ? !result : result;
}

/**
 * Evaluate all conditions for a rule (AND logic)
 */
function evaluateConditions(
  conditions: PolicyCondition[] | undefined,
  context: EvaluationContext
): boolean {
  if (!conditions || conditions.length === 0) {
    return true; // No conditions = always applies
  }
  return conditions.every((cond) => evaluateCondition(cond, context));
}

/**
 * Find matching rule in a policy
 */
function findMatchingRule(
  policy: GuardrailsPolicy,
  context: EvaluationContext
): ToolPolicyRule | null {
  if (!policy.tools?.rules) return null;

  for (const rule of policy.tools.rules) {
    if (matchPattern(rule.pattern, context.toolName)) {
      if (evaluateConditions(rule.conditions, context)) {
        return rule;
      }
    }
  }

  return null;
}

/**
 * Sort policies by scope precedence
 */
function sortPoliciesByPrecedence(policies: GuardrailsPolicy[]): GuardrailsPolicy[] {
  return [...policies].sort((a, b) => {
    const precA = POLICY_SCOPE_PRECEDENCE[a.scope] ?? 99;
    const precB = POLICY_SCOPE_PRECEDENCE[b.scope] ?? 99;
    return precA - precB;
  });
}

/**
 * Policy evaluator class
 */
export class PolicyEvaluator {
  private config: GuardrailsConfig;

  constructor(config?: Partial<GuardrailsConfig>) {
    this.config = { ...DEFAULT_GUARDRAILS_CONFIG, ...config };
  }

  /**
   * Check if guardrails are enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable or disable guardrails
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Get current config
   */
  getConfig(): GuardrailsConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<GuardrailsConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Add a policy
   */
  addPolicy(policy: GuardrailsPolicy): void {
    this.config.policies.push(policy);
  }

  /**
   * Remove a policy by ID
   */
  removePolicy(policyId: string): boolean {
    const index = this.config.policies.findIndex((p) => p.id === policyId);
    if (index >= 0) {
      this.config.policies.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all policies
   */
  getPolicies(): GuardrailsPolicy[] {
    return [...this.config.policies];
  }

  /**
   * Evaluate a tool use against all policies
   */
  evaluateToolUse(context: EvaluationContext): PolicyEvaluationResult {
    const result: PolicyEvaluationResult = {
      allowed: true,
      action: this.config.defaultAction,
      matchedRules: [],
      reasons: [],
      requiresApproval: false,
      warnings: [],
    };

    // If guardrails are disabled, allow everything
    if (!this.config.enabled) {
      result.reasons.push('Guardrails disabled');
      return result;
    }

    // Sort policies by precedence
    const sortedPolicies = sortPoliciesByPrecedence(
      this.config.policies.filter((p) => p.enabled)
    );

    // Evaluate each policy in order
    for (const policy of sortedPolicies) {
      const matchedRule = findMatchingRule(policy, context);

      if (matchedRule) {
        result.matchedRules.push({
          policyId: policy.id,
          policyScope: policy.scope,
          rule: matchedRule,
        });

        // Apply the action based on precedence
        // Higher precedence policies override lower ones
        result.action = matchedRule.action;

        if (matchedRule.reason) {
          result.reasons.push(matchedRule.reason);
        }

        // Handle different actions
        switch (matchedRule.action) {
          case 'deny':
            result.allowed = false;
            break;
          case 'require_approval':
            result.allowed = false;
            result.requiresApproval = true;
            // Check for approval requirements
            const approval = policy.approvals?.find((a) =>
              a.patterns.some((p) => matchPattern(p, context.toolName))
            );
            if (approval) {
              result.approvalDetails = {
                approvers: approval.approvers,
                timeout: approval.timeout,
              };
            }
            break;
          case 'warn':
            result.warnings.push(
              matchedRule.reason || `Warning: ${context.toolName} may require caution`
            );
            break;
          case 'allow':
            result.allowed = true;
            break;
        }

        // For deny, stop processing immediately (highest precedence)
        if (matchedRule.action === 'deny') {
          break;
        }
      } else if (policy.tools?.defaultAction) {
        // No matching rule, use default action
        if (result.matchedRules.length === 0) {
          result.action = policy.tools.defaultAction;
          if (policy.tools.defaultAction === 'deny') {
            result.allowed = false;
            result.reasons.push('No matching rule, default action is deny');
          } else if (policy.tools.defaultAction === 'require_approval') {
            result.allowed = false;
            result.requiresApproval = true;
            result.reasons.push('No matching rule, default requires approval');
          }
        }
      }
    }

    // Check depth limits
    if (context.depth !== undefined) {
      for (const policy of sortedPolicies) {
        if (policy.depth && context.depth > policy.depth.maxDepth) {
          result.matchedRules.push({
            policyId: policy.id,
            policyScope: policy.scope,
            rule: { pattern: 'depth', action: policy.depth.onExceeded },
          });
          result.reasons.push(`Max depth ${policy.depth.maxDepth} exceeded`);

          if (policy.depth.onExceeded === 'deny') {
            result.allowed = false;
            result.action = 'deny';
            break;
          } else if (policy.depth.onExceeded === 'require_approval') {
            result.allowed = false;
            result.requiresApproval = true;
            result.action = 'require_approval';
          } else if (policy.depth.onExceeded === 'warn') {
            result.warnings.push(`Assistant depth ${context.depth} exceeds limit ${policy.depth.maxDepth}`);
          }
        }
      }
    }

    return result;
  }

  /**
   * Quick check if a tool is allowed
   */
  isToolAllowed(toolName: string, input?: Record<string, unknown>): boolean {
    const result = this.evaluateToolUse({
      toolName,
      toolInput: input,
    });
    return result.allowed;
  }

  /**
   * Check if a tool requires approval
   */
  requiresApproval(toolName: string, input?: Record<string, unknown>): boolean {
    const result = this.evaluateToolUse({
      toolName,
      toolInput: input,
    });
    return result.requiresApproval;
  }

  /**
   * Get warnings for a tool use
   */
  getWarnings(toolName: string, input?: Record<string, unknown>): string[] {
    const result = this.evaluateToolUse({
      toolName,
      toolInput: input,
    });
    return result.warnings;
  }
}
