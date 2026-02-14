/**
 * AWS Secrets Manager client for secrets storage
 * Handles encryption, storage, and retrieval of secrets (API keys, tokens, passwords)
 */

import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  UpdateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { fromIni } from '@aws-sdk/credential-providers';
import type { Secret, SecretListItem, SecretScope } from './types';

export interface SecretsStorageClientOptions {
  /** AWS region */
  region: string;
  /** Secret path prefix (default: "assistants/secrets/") */
  prefix?: string;
  /** AWS credentials profile name (optional) */
  credentialsProfile?: string;
}

/**
 * AWS Secrets Manager client for secure secrets storage
 */
export class SecretsStorageClient {
  private client: SecretsManagerClient;
  private prefix: string;

  constructor(options: SecretsStorageClientOptions) {
    const credentials = options.credentialsProfile
      ? fromIni({ profile: options.credentialsProfile })
      : undefined;

    this.client = new SecretsManagerClient({
      region: options.region,
      credentials,
    });

    this.prefix = options.prefix || 'assistants/secrets/';
  }

  /**
   * Build the full secret name based on scope
   * Global: {prefix}global/{name}
   * Assistant: {prefix}assistant/{assistantId}/{name}
   */
  private buildSecretName(name: string, scope: SecretScope, assistantId?: string): string {
    if (scope === 'global') {
      return `${this.prefix}global/${name}`;
    }
    if (!assistantId) {
      throw new Error('Assistant ID required for assistant-scoped secrets');
    }
    return `${this.prefix}assistant/${assistantId}/${name}`;
  }

  /**
   * Parse a secret name to extract scope and name
   */
  private parseSecretName(fullName: string): { name: string; scope: SecretScope } | null {
    if (!fullName.startsWith(this.prefix)) {
      return null;
    }

    const path = fullName.slice(this.prefix.length);

    if (path.startsWith('global/')) {
      return {
        name: path.slice('global/'.length),
        scope: 'global',
      };
    }

    if (path.startsWith('assistant/')) {
      // assistant/{assistantId}/{name}
      const parts = path.slice('assistant/'.length).split('/');
      if (parts.length >= 2) {
        return {
          name: parts.slice(1).join('/'),
          scope: 'assistant',
        };
      }
    }

    return null;
  }

  /**
   * List all secrets for a given scope
   * @param scope - 'global', 'assistant', or 'all'
   * @param assistantId - Required for 'assistant' and 'all' scopes
   */
  async listSecrets(
    scope: SecretScope | 'all',
    assistantId?: string
  ): Promise<SecretListItem[]> {
    const secrets: SecretListItem[] = [];
    const prefixes: string[] = [];

    if (scope === 'global' || scope === 'all') {
      prefixes.push(`${this.prefix}global/`);
    }

    if ((scope === 'assistant' || scope === 'all') && assistantId) {
      prefixes.push(`${this.prefix}assistant/${assistantId}/`);
    }

    for (const secretPrefix of prefixes) {
      let nextToken: string | undefined;

      do {
        const response = await this.client.send(
          new ListSecretsCommand({
            NextToken: nextToken,
            Filters: [
              {
                Key: 'name',
                Values: [secretPrefix],
              },
            ],
          })
        );

        if (response.SecretList) {
          for (const awsSecret of response.SecretList) {
            if (!awsSecret.Name?.startsWith(secretPrefix)) continue;

            const parsed = this.parseSecretName(awsSecret.Name);
            if (!parsed) continue;

            secrets.push({
              name: parsed.name,
              description: awsSecret.Description,
              scope: parsed.scope,
              createdAt: awsSecret.CreatedDate?.getTime() || Date.now(),
              updatedAt: awsSecret.LastChangedDate?.getTime() || Date.now(),
              hasValue: true,
            });
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);
    }

    return secrets;
  }

  /**
   * Get a secret by name and scope
   */
  async getSecret(
    name: string,
    scope: SecretScope,
    assistantId?: string
  ): Promise<Secret | null> {
    const secretName = this.buildSecretName(name, scope, assistantId);

    try {
      const response = await this.client.send(
        new GetSecretValueCommand({
          SecretId: secretName,
        })
      );

      if (!response.SecretString) {
        return null;
      }

      // Parse stored secret data
      const data = JSON.parse(response.SecretString) as {
        value: string;
        description?: string;
        createdAt: number;
        updatedAt: number;
      };

      return {
        name,
        value: data.value,
        description: data.description,
        scope,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Create or update a secret
   */
  async setSecret(
    name: string,
    value: string,
    scope: SecretScope,
    assistantId?: string,
    description?: string
  ): Promise<void> {
    const secretName = this.buildSecretName(name, scope, assistantId);
    const now = Date.now();

    // Try to get existing secret to preserve createdAt
    let createdAt = now;
    try {
      const existing = await this.getSecret(name, scope, assistantId);
      if (existing) {
        createdAt = existing.createdAt;
      }
    } catch {
      // Ignore errors, use current time
    }

    const secretData = JSON.stringify({
      value,
      description,
      createdAt,
      updatedAt: now,
    });

    try {
      await this.client.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: secretData,
          Description: description || `Secret: ${name}`,
          Tags: [
            { Key: 'type', Value: 'assistant-secret' },
            { Key: 'scope', Value: scope },
            { Key: 'assistantId', Value: assistantId || 'global' },
          ],
        })
      );
    } catch (error: unknown) {
      // If secret already exists, update it
      if ((error as { name?: string }).name === 'ResourceExistsException') {
        await this.client.send(
          new UpdateSecretCommand({
            SecretId: secretName,
            SecretString: secretData,
            Description: description || `Secret: ${name}`,
          })
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Delete a secret (soft delete with 7-day recovery window)
   */
  async deleteSecret(
    name: string,
    scope: SecretScope,
    assistantId?: string
  ): Promise<void> {
    const secretName = this.buildSecretName(name, scope, assistantId);

    await this.client.send(
      new DeleteSecretCommand({
        SecretId: secretName,
        RecoveryWindowInDays: 7, // 7-day recovery window
      })
    );
  }

  /**
   * Check if AWS credentials are configured and valid
   */
  async checkCredentials(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Try to list secrets with a minimal request
      await this.client.send(
        new ListSecretsCommand({
          MaxResults: 1,
          Filters: [
            {
              Key: 'name',
              Values: [this.prefix],
            },
          ],
        })
      );
      return { valid: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { valid: false, error: message };
    }
  }
}
