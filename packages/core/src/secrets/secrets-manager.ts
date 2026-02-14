/**
 * SecretsManager - Core class for managing assistant secrets
 * Handles secret storage, rate limiting, and retrieval
 *
 * Storage backends:
 * - Local filesystem under .assistants (default)
 * - AWS Secrets Manager (optional)
 */

import type { SecretsConfig } from '@hasna/assistants-shared';
import { SecretsStorageClient } from './secrets-client';
import { LocalSecretsClient } from './storage/local-client';
import type {
  Secret,
  SecretListItem,
  SecretScope,
  SecretFormat,
  SecretsRateLimitState,
  SecretsOperationResult,
  SetSecretInput,
} from './types';

export interface SecretsManagerOptions {
  /** Assistant ID for scoping secrets */
  assistantId: string;
  /** Secrets configuration */
  config: SecretsConfig;
  /** Base assistants storage directory for local secrets backend */
  baseDir?: string;
}

type SecretsStorageMode = 'aws' | 'local';

interface SecretsStorageBackend {
  listSecrets(scope: SecretScope | 'all', assistantId?: string): Promise<SecretListItem[]>;
  getSecret(name: string, scope: SecretScope, assistantId?: string): Promise<Secret | null>;
  setSecret(
    name: string,
    value: string,
    scope: SecretScope,
    assistantId?: string,
    description?: string
  ): Promise<void>;
  deleteSecret(name: string, scope: SecretScope, assistantId?: string): Promise<void>;
  checkCredentials(): Promise<{ valid: boolean; error?: string }>;
}

/**
 * Validate secret name format
 * Must start with letter or underscore, followed by alphanumeric, underscores, or hyphens
 */
export function isValidSecretName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/**
 * SecretsManager handles all secrets operations for an assistant
 */
export class SecretsManager {
  private assistantId: string;
  private config: SecretsConfig;
  private storageClient: SecretsStorageBackend | null = null;
  private storageMode: SecretsStorageMode | null = null;
  private rateLimit: SecretsRateLimitState;
  private maxReadsPerHour: number;

  constructor(options: SecretsManagerOptions) {
    this.assistantId = options.assistantId;
    this.config = options.config;
    this.maxReadsPerHour = options.config.security?.maxReadsPerHour ?? 100;
    this.rateLimit = {
      reads: 0,
      windowStart: Date.now(),
    };

    const provider = this.config.storage?.provider
      || (this.config.storage?.region ? 'aws' : 'local');

    if (provider === 'aws') {
      if (this.config.storage?.region) {
        this.storageClient = new SecretsStorageClient({
          region: this.config.storage.region,
          prefix: this.config.storage.prefix,
          credentialsProfile: this.config.storage.credentialsProfile,
        });
        this.storageMode = 'aws';
      }
      return;
    }

    this.storageClient = new LocalSecretsClient();
    this.storageMode = 'local';
  }

  /**
   * Check if secrets management is properly configured
   */
  isConfigured(): boolean {
    return this.storageClient !== null;
  }

  /**
   * Get currently active storage mode
   */
  getStorageMode(): SecretsStorageMode | 'unconfigured' {
    return this.storageMode || 'unconfigured';
  }

  /**
   * List all secrets (safe summaries only, no values)
   * @param scope - 'global', 'assistant', or 'all' (default: 'all')
   */
  async list(scope: SecretScope | 'all' = 'all'): Promise<SecretListItem[]> {
    if (!this.storageClient) {
      return [];
    }

    try {
      return await this.storageClient.listSecrets(scope, this.assistantId);
    } catch (error) {
      this.logError('list', error);
      throw error;
    }
  }

  /**
   * Get a secret value
   * @param name - Secret name
   * @param scope - 'global' or 'assistant'. If not specified, tries assistant first, then global
   * @param format - Output format: 'plain', 'metadata', or 'env'
   */
  async get(
    name: string,
    scope?: SecretScope,
    format: SecretFormat = 'plain'
  ): Promise<string | Secret | null> {
    if (!this.storageClient) {
      throw new Error('Secrets management is not configured.');
    }

    // Check rate limit
    const rateLimitCheck = this.checkRateLimit();
    if (!rateLimitCheck.allowed) {
      throw new Error(
        `Rate limit exceeded. Maximum ${this.maxReadsPerHour} secret reads per hour. ` +
        `Try again in ${rateLimitCheck.retryAfterMinutes} minutes.`
      );
    }

    let secret: Secret | null = null;

    if (scope) {
      // If scope specified, use that scope
      secret = await this.storageClient.getSecret(name, scope, this.assistantId);
    } else {
      // If scope not specified, try assistant scope first, then global
      secret = await this.storageClient.getSecret(name, 'assistant', this.assistantId);
      if (!secret) {
        secret = await this.storageClient.getSecret(name, 'global');
      }
    }

    if (!secret) {
      return null;
    }

    // Increment rate limit on successful read
    this.incrementRateLimit();
    this.logOperation('get', name, true);

    // Return in requested format
    switch (format) {
      case 'plain':
        return secret.value;
      case 'metadata':
        return secret;
      case 'env':
        return `${name}=${secret.value}`;
      default:
        return secret.value;
    }
  }

  /**
   * Set (create or update) a secret
   */
  async set(input: SetSecretInput): Promise<SecretsOperationResult> {
    if (!this.storageClient) {
      return {
        success: false,
        message: 'Secrets management is not configured. Set secrets.storage.provider to "local" or configure secrets.storage.region for AWS.',
      };
    }

    // Validate secret name
    if (!isValidSecretName(input.name)) {
      return {
        success: false,
        message: 'Invalid secret name. Must start with letter or underscore, ' +
          'followed by alphanumeric characters, underscores, or hyphens.',
        secretName: input.name,
      };
    }

    // Validate value is not empty
    if (!input.value || input.value.length === 0) {
      return {
        success: false,
        message: 'Secret value cannot be empty.',
        secretName: input.name,
      };
    }

    const scope = input.scope || 'assistant';

    try {
      await this.storageClient.setSecret(
        input.name,
        input.value,
        scope,
        this.assistantId,
        input.description
      );

      this.logOperation('set', input.name, true);

      return {
        success: true,
        message: `Secret "${input.name}" saved successfully (scope: ${scope}).`,
        secretName: input.name,
      };
    } catch (error) {
      this.logError('set', error);
      return {
        success: false,
        message: `Failed to save secret: ${error instanceof Error ? error.message : String(error)}`,
        secretName: input.name,
      };
    }
  }

  /**
   * Delete a secret
   */
  async delete(name: string, scope: SecretScope = 'assistant'): Promise<SecretsOperationResult> {
    if (!this.storageClient) {
      return {
        success: false,
        message: 'Secrets management is not configured.',
      };
    }

    try {
      // Verify secret exists
      const secret = await this.storageClient.getSecret(name, scope, this.assistantId);
      if (!secret) {
        return {
          success: false,
          message: `Secret "${name}" not found in ${scope} scope.`,
          secretName: name,
        };
      }

      await this.storageClient.deleteSecret(name, scope, this.assistantId);
      this.logOperation('delete', name, true);

      return {
        success: true,
        message: this.storageMode === 'aws'
          ? `Secret "${name}" deleted. Recovery available for 7 days.`
          : `Secret "${name}" deleted.`,
        secretName: name,
      };
    } catch (error) {
      this.logError('delete', error);
      return {
        success: false,
        message: `Failed to delete secret: ${error instanceof Error ? error.message : String(error)}`,
        secretName: name,
      };
    }
  }

  /**
   * Export secrets in environment format
   * @param scope - 'global', 'assistant', or 'all'
   */
  async export(scope: SecretScope | 'all' = 'all'): Promise<string[]> {
    if (!this.storageClient) {
      return [];
    }

    const secrets = await this.list(scope);
    const envLines: string[] = [];

    for (const secretItem of secrets) {
      try {
        const value = await this.get(secretItem.name, secretItem.scope, 'plain');
        if (value && typeof value === 'string') {
          // Escape special characters in value
          const escapedValue = value.replace(/"/g, '\\"');
          envLines.push(`${secretItem.name}="${escapedValue}"`);
        }
      } catch {
        // Skip secrets that can't be read (rate limit, etc.)
      }
    }

    return envLines;
  }

  /**
   * Check if storage credentials are configured and valid
   */
  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    if (!this.storageClient) {
      return {
        valid: false,
        error: 'Secrets storage is not configured.',
      };
    }

    return this.storageClient.checkCredentials();
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    readsUsed: number;
    maxReads: number;
    windowResetMinutes: number;
  } {
    this.maybeResetRateLimit();
    const elapsed = Date.now() - this.rateLimit.windowStart;
    const remaining = Math.max(0, 60 - Math.floor(elapsed / 60000));

    return {
      readsUsed: this.rateLimit.reads,
      maxReads: this.maxReadsPerHour,
      windowResetMinutes: remaining,
    };
  }

  // ============================================
  // Private helper methods
  // ============================================

  private checkRateLimit(): { allowed: boolean; retryAfterMinutes?: number } {
    this.maybeResetRateLimit();

    if (this.rateLimit.reads >= this.maxReadsPerHour) {
      const elapsed = Date.now() - this.rateLimit.windowStart;
      const retryAfter = Math.max(1, Math.ceil((3600000 - elapsed) / 60000));
      return { allowed: false, retryAfterMinutes: retryAfter };
    }

    return { allowed: true };
  }

  private incrementRateLimit(): void {
    this.maybeResetRateLimit();
    this.rateLimit.reads++;
  }

  private maybeResetRateLimit(): void {
    const elapsed = Date.now() - this.rateLimit.windowStart;
    if (elapsed >= 3600000) { // 1 hour in ms
      this.rateLimit = {
        reads: 0,
        windowStart: Date.now(),
      };
    }
  }

  private logOperation(operation: string, secretName: string, success: boolean): void {
    // Log operation without sensitive data
    const logEntry = {
      timestamp: new Date().toISOString(),
      assistantId: this.assistantId,
      operation,
      secretName,
      success,
    };

    // For now, just log to stderr in debug mode
    if (process.env.DEBUG) {
      console.error('[secrets]', JSON.stringify(logEntry));
    }
  }

  private logError(operation: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const logEntry = {
      timestamp: new Date().toISOString(),
      assistantId: this.assistantId,
      operation,
      error: message,
    };

    console.error('[secrets error]', JSON.stringify(logEntry));
  }
}

/**
 * Create a SecretsManager from config
 */
export function createSecretsManager(
  assistantId: string,
  config: SecretsConfig,
  baseDir?: string
): SecretsManager {
  return new SecretsManager({
    assistantId,
    config,
    baseDir,
  });
}
