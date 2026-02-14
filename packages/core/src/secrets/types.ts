/**
 * Secrets Types
 * Types for the assistant secrets management system (API keys, tokens, passwords)
 */

/**
 * Secret scope - determines where the secret is accessible
 */
export type SecretScope = 'global' | 'assistant';

/**
 * Secret retrieval format
 */
export type SecretFormat = 'plain' | 'metadata' | 'env';

/**
 * Full secret data stored in configured backend
 */
export interface Secret {
  /** Secret name (alphanumeric, underscores, hyphens) */
  name: string;
  /** Secret value */
  value: string;
  /** Optional description */
  description?: string;
  /** Scope: 'global' or 'assistant' */
  scope: SecretScope;
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

/**
 * Secret list item - safe summary for display (no value)
 */
export interface SecretListItem {
  /** Secret name */
  name: string;
  /** Optional description */
  description?: string;
  /** Scope: 'global' or 'assistant' */
  scope: SecretScope;
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
  /** Whether secret has a value (always true, for consistency) */
  hasValue: boolean;
}

/**
 * Rate limit tracking for secrets
 */
export interface SecretsRateLimitState {
  /** Secret reads in the current hour window */
  reads: number;
  /** Start of current window (timestamp) */
  windowStart: number;
}

/**
 * Secrets operation result
 */
export interface SecretsOperationResult {
  success: boolean;
  message: string;
  /** The secret name if operation was on a specific secret */
  secretName?: string;
}

/**
 * Input for setting a secret
 */
export interface SetSecretInput {
  /** Secret name (alphanumeric, underscores, hyphens) */
  name: string;
  /** Secret value */
  value: string;
  /** Optional description */
  description?: string;
  /** Scope: 'global' or 'assistant' (default: 'assistant') */
  scope?: SecretScope;
}
