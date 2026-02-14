/**
 * Secrets module exports
 * Provides secure secrets storage for assistants using:
 * - Local .assistants storage
 * - AWS Secrets Manager
 */

// Core manager
export { SecretsManager, createSecretsManager, isValidSecretName } from './secrets-manager';
export type { SecretsManagerOptions } from './secrets-manager';

// Storage (AWS Secrets Manager)
export { SecretsStorageClient } from './secrets-client';
export type { SecretsStorageClientOptions } from './secrets-client';
export { LocalSecretsClient } from './storage/local-client';
export type { LocalSecretsClientOptions } from './storage/local-client';

// Tools
export {
  secretsTools,
  secretsListTool,
  secretsGetTool,
  secretsSetTool,
  secretsDeleteTool,
  createSecretsToolExecutors,
  registerSecretsTools,
} from './tools';

// Types
export type {
  Secret,
  SecretListItem,
  SecretScope,
  SecretFormat,
  SecretsRateLimitState,
  SecretsOperationResult,
  SetSecretInput,
} from './types';
