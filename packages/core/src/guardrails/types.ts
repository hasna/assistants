/**
 * Guardrails policy types
 * Defines security and safety policies for assistant behavior
 */

/**
 * Policy scope/level - determines precedence
 * Lower = higher precedence (system overrides all, session overrides project)
 */
export type PolicyScope = 'system' | 'organization' | 'project' | 'session';

/**
 * Policy action - what to do when a rule matches
 */
export type PolicyAction = 'allow' | 'deny' | 'require_approval' | 'warn';

/**
 * Tool policy rule
 */
export interface ToolPolicyRule {
  /** Tool name pattern (supports glob patterns like bash:*, file:write) */
  pattern: string;
  /** Action to take */
  action: PolicyAction;
  /** Optional reason for this rule */
  reason?: string;
  /** Conditions that must be met for this rule to apply */
  conditions?: PolicyCondition[];
}

/**
 * Policy condition
 */
export interface PolicyCondition {
  /** Type of condition */
  type: 'input_contains' | 'input_matches' | 'context_has' | 'depth_exceeds' | 'time_exceeds' | 'custom';
  /** Value to check against */
  value: string | number | boolean;
  /** Negate the condition */
  negate?: boolean;
}

/**
 * Data sensitivity level
 */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Data sensitivity rule
 */
export interface DataSensitivityRule {
  /** Pattern to match (file path, content, etc.) */
  pattern: string;
  /** Sensitivity level */
  level: SensitivityLevel;
  /** What to do with this data */
  action: PolicyAction;
  /** Whether to redact content matching this pattern */
  redact?: boolean;
}

/**
 * Approval requirement
 */
export interface ApprovalRequirement {
  /** What triggers approval */
  trigger: 'tool_use' | 'data_access' | 'external_call' | 'code_execution' | 'file_write';
  /** Patterns that require approval */
  patterns: string[];
  /** Who can approve */
  approvers?: string[];
  /** Timeout for approval (ms) */
  timeout?: number;
}

/**
 * Assistant depth policy
 */
export interface DepthPolicy {
  /** Maximum subassistant depth */
  maxDepth: number;
  /** Action when max depth exceeded */
  onExceeded: PolicyAction;
}

/**
 * Rate limit policy
 */
export interface RateLimitPolicy {
  /** Maximum tool calls per minute */
  toolCallsPerMinute?: number;
  /** Maximum LLM calls per minute */
  llmCallsPerMinute?: number;
  /** Maximum external requests per minute */
  externalRequestsPerMinute?: number;
  /** Action when rate limit exceeded */
  onExceeded: PolicyAction;
}

/**
 * Full guardrails policy
 */
export interface GuardrailsPolicy {
  /** Policy ID */
  id?: string;
  /** Policy name */
  name?: string;
  /** Policy scope */
  scope: PolicyScope;
  /** Whether this policy is enabled */
  enabled: boolean;
  /** Tool policies */
  tools?: {
    /** Default action for tools not matching any rule */
    defaultAction: PolicyAction;
    /** Tool-specific rules (evaluated in order) */
    rules: ToolPolicyRule[];
  };
  /** Data sensitivity rules */
  dataSensitivity?: {
    /** Default sensitivity level */
    defaultLevel: SensitivityLevel;
    /** Rules for specific patterns */
    rules: DataSensitivityRule[];
  };
  /** Approval requirements */
  approvals?: ApprovalRequirement[];
  /** Assistant depth limits */
  depth?: DepthPolicy;
  /** Rate limits */
  rateLimits?: RateLimitPolicy;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Policy evaluation result
 */
export interface PolicyEvaluationResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Required action */
  action: PolicyAction;
  /** Which rule(s) matched */
  matchedRules: Array<{
    policyId?: string;
    policyScope: PolicyScope;
    rule: ToolPolicyRule | DataSensitivityRule | ApprovalRequirement;
  }>;
  /** Reasons for the decision */
  reasons: string[];
  /** Whether approval is required */
  requiresApproval: boolean;
  /** Approval details if required */
  approvalDetails?: {
    approvers?: string[];
    timeout?: number;
  };
  /** Warnings (if action was 'warn') */
  warnings: string[];
}

/**
 * Policy override
 */
export interface PolicyOverride {
  /** Override ID */
  id: string;
  /** Which policy to override */
  policyId?: string;
  /** Which rule to override (by pattern) */
  rulePattern?: string;
  /** New action to apply */
  newAction: PolicyAction;
  /** Reason for override */
  reason: string;
  /** Who approved this override */
  approvedBy?: string;
  /** When the override expires */
  expiresAt?: string;
  /** Override scope */
  scope: PolicyScope;
}

/**
 * Guardrails configuration
 */
export interface GuardrailsConfig {
  /** Whether guardrails are enabled */
  enabled: boolean;
  /** Policies to apply (in order of precedence) */
  policies: GuardrailsPolicy[];
  /** Active overrides */
  overrides?: PolicyOverride[];
  /** Default action when no policy matches */
  defaultAction: PolicyAction;
  /** Whether to log all evaluations */
  logEvaluations?: boolean;
  /** Whether to persist policy state */
  persist?: boolean;
}
