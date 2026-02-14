import type {
  GuardrailsPolicy,
  GuardrailsConfig,
  ToolPolicyRule,
  DataSensitivityRule,
  DepthPolicy,
  RateLimitPolicy,
} from './types';

/**
 * Default tool policy rules
 * These are sensible defaults that prevent dangerous operations
 */
export const DEFAULT_TOOL_RULES: ToolPolicyRule[] = [
  // Allow read-only filesystem operations
  {
    pattern: 'file:read',
    action: 'allow',
    reason: 'Read operations are generally safe',
  },
  {
    pattern: 'file:list',
    action: 'allow',
    reason: 'Listing files is safe',
  },
  // Require approval for write operations in sensitive locations
  {
    pattern: 'file:write',
    action: 'require_approval',
    reason: 'File writes should be reviewed',
    conditions: [
      { type: 'input_matches', value: '.*\\.(env|secret|key|pem|crt)$' },
    ],
  },
  // Allow general file writes
  {
    pattern: 'file:write',
    action: 'allow',
    reason: 'General file writes allowed',
  },
  // Warn on bash commands
  {
    pattern: 'bash',
    action: 'warn',
    reason: 'Shell commands should be reviewed',
  },
  // Deny dangerous bash patterns
  {
    pattern: 'bash',
    action: 'deny',
    reason: 'Dangerous command pattern detected',
    conditions: [
      { type: 'input_contains', value: 'rm -rf /' },
    ],
  },
  {
    pattern: 'bash',
    action: 'deny',
    reason: 'Dangerous command pattern detected',
    conditions: [
      { type: 'input_contains', value: ':(){:|:&};:' }, // Fork bomb
    ],
  },
  // Allow web fetch
  {
    pattern: 'web:fetch',
    action: 'allow',
    reason: 'Web fetching is allowed',
  },
  // Require approval for external API calls
  {
    pattern: 'connector:*',
    action: 'require_approval',
    reason: 'External service calls require approval',
  },
];

/**
 * Default data sensitivity rules
 */
export const DEFAULT_DATA_SENSITIVITY_RULES: DataSensitivityRule[] = [
  // Secrets and credentials
  {
    pattern: '\\.(env|secret|key|pem|crt|p12|pfx)$',
    level: 'restricted',
    action: 'deny',
    redact: true,
  },
  {
    pattern: 'credentials?\\.json$',
    level: 'restricted',
    action: 'deny',
    redact: true,
  },
  // Config files
  {
    pattern: 'config\\.json$',
    level: 'internal',
    action: 'warn',
  },
  // Source code
  {
    pattern: '\\.(ts|js|py|go|rs|java)$',
    level: 'internal',
    action: 'allow',
  },
  // Documentation
  {
    pattern: '\\.(md|txt|doc|pdf)$',
    level: 'public',
    action: 'allow',
  },
];

/**
 * Default depth policy
 */
export const DEFAULT_DEPTH_POLICY: DepthPolicy = {
  maxDepth: 5,
  onExceeded: 'deny',
};

/**
 * Default rate limit policy
 */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  toolCallsPerMinute: 60,
  llmCallsPerMinute: 30,
  externalRequestsPerMinute: 20,
  onExceeded: 'warn',
};

/**
 * Default system-level guardrails policy
 * This is the baseline policy that applies to all sessions
 */
export const DEFAULT_SYSTEM_POLICY: GuardrailsPolicy = {
  id: 'system-default',
  name: 'System Default Policy',
  scope: 'system',
  enabled: true,
  tools: {
    defaultAction: 'allow',
    rules: DEFAULT_TOOL_RULES,
  },
  dataSensitivity: {
    defaultLevel: 'internal',
    rules: DEFAULT_DATA_SENSITIVITY_RULES,
  },
  approvals: [
    {
      trigger: 'code_execution',
      patterns: ['eval', 'exec', 'spawn'],
      timeout: 300000, // 5 minutes
    },
    {
      trigger: 'file_write',
      patterns: ['.*\\.(sh|bash|zsh|ps1)$'],
      timeout: 300000,
    },
  ],
  depth: DEFAULT_DEPTH_POLICY,
  rateLimits: DEFAULT_RATE_LIMIT_POLICY,
};

/**
 * Permissive policy for trusted environments
 * Use with caution - allows most operations
 */
export const PERMISSIVE_POLICY: GuardrailsPolicy = {
  id: 'permissive',
  name: 'Permissive Policy',
  scope: 'session',
  enabled: true,
  tools: {
    defaultAction: 'allow',
    rules: [
      // Only deny truly dangerous operations
      {
        pattern: 'bash',
        action: 'deny',
        conditions: [
          { type: 'input_contains', value: 'rm -rf /' },
        ],
      },
    ],
  },
  depth: {
    maxDepth: 10,
    onExceeded: 'warn',
  },
};

/**
 * Restrictive policy for untrusted environments
 */
export const RESTRICTIVE_POLICY: GuardrailsPolicy = {
  id: 'restrictive',
  name: 'Restrictive Policy',
  scope: 'session',
  enabled: true,
  tools: {
    defaultAction: 'require_approval',
    rules: [
      // Only allow read operations without approval
      {
        pattern: 'file:read',
        action: 'allow',
      },
      {
        pattern: 'file:list',
        action: 'allow',
      },
      // Deny all shell commands
      {
        pattern: 'bash',
        action: 'deny',
        reason: 'Shell commands disabled in restrictive mode',
      },
    ],
  },
  depth: {
    maxDepth: 2,
    onExceeded: 'deny',
  },
  rateLimits: {
    toolCallsPerMinute: 20,
    llmCallsPerMinute: 10,
    externalRequestsPerMinute: 5,
    onExceeded: 'deny',
  },
};

/**
 * Default guardrails configuration
 */
export const DEFAULT_GUARDRAILS_CONFIG: GuardrailsConfig = {
  enabled: false, // Disabled by default
  policies: [DEFAULT_SYSTEM_POLICY],
  defaultAction: 'allow',
  logEvaluations: false,
  persist: false,
};

/**
 * Policy scope precedence (lower index = higher precedence)
 */
export const POLICY_SCOPE_PRECEDENCE: Record<string, number> = {
  system: 0,
  organization: 1,
  project: 2,
  session: 3,
};
