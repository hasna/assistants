/**
 * Secrets tools for assistant use
 * Native tools that allow assistants to manage and retrieve secrets
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { SecretsManager } from './secrets-manager';
import type { SecretScope, SecretFormat, Secret } from './types';

/**
 * secrets_list - List all secrets (safe summaries only)
 */
export const secretsListTool: Tool = {
  name: 'secrets_list',
  description: 'List all secrets (names only, no values). Returns secret names, descriptions, and scopes. Use to see what secrets are available.',
  parameters: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'Filter by scope: "global" for shared secrets, "assistant" for assistant-specific secrets, or "all" for both. Default: all',
        enum: ['global', 'assistant', 'all'],
      },
    },
  },
};

/**
 * secrets_get - Get a secret value (rate limited)
 */
export const secretsGetTool: Tool = {
  name: 'secrets_get',
  description: 'Get a secret value. Rate limited for security. If scope is not specified, checks assistant scope first, then falls back to global.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Secret name (e.g., "GITHUB_TOKEN", "STRIPE_API_KEY")',
      },
      scope: {
        type: 'string',
        description: 'Secret scope: "global" or "assistant". Default: tries assistant first, then global',
        enum: ['global', 'assistant'],
      },
      format: {
        type: 'string',
        description: 'Output format: "plain" returns just the value, "metadata" returns full secret info, "env" returns NAME=value format. Default: plain',
        enum: ['plain', 'metadata', 'env'],
      },
    },
    required: ['name'],
  },
};

/**
 * secrets_set - Create or update a secret
 */
export const secretsSetTool: Tool = {
  name: 'secrets_set',
  description: 'Create or update a secret. Use for storing API keys, passwords, tokens, and other sensitive data. Stored in the configured secrets backend.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Secret name (alphanumeric, underscores, hyphens). Must start with letter or underscore. E.g., "GITHUB_TOKEN", "my_api_key"',
      },
      value: {
        type: 'string',
        description: 'Secret value (API key, password, token, etc.)',
      },
      description: {
        type: 'string',
        description: 'Optional description of what this secret is for',
      },
      scope: {
        type: 'string',
        description: 'Secret scope: "global" for shared across all assistants, "assistant" for this assistant only. Default: assistant',
        enum: ['global', 'assistant'],
      },
    },
    required: ['name', 'value'],
  },
};

/**
 * secrets_delete - Delete a secret
 */
export const secretsDeleteTool: Tool = {
  name: 'secrets_delete',
  description: 'Delete a secret. AWS backend supports a 7-day recovery window.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Secret name to delete',
      },
      scope: {
        type: 'string',
        description: 'Secret scope: "global" or "assistant". Default: assistant',
        enum: ['global', 'assistant'],
      },
    },
    required: ['name'],
  },
};

/**
 * Create executors for secrets tools
 */
export function createSecretsToolExecutors(
  getSecretsManager: () => SecretsManager | null
): Record<string, ToolExecutor> {
  return {
    secrets_list: async (input) => {
      const manager = getSecretsManager();
      if (!manager) {
        return 'Error: Secrets management is not enabled or configured. Set secrets.enabled=true and set secrets.storage.provider to "local", or configure secrets.storage.region for AWS.';
      }

      if (!manager.isConfigured()) {
        return 'Error: Secrets management is not fully configured. Set secrets.storage.provider to "local", or configure secrets.storage.region for AWS.';
      }

      try {
        const scopeInput = String(input.scope || 'all').toLowerCase();
        const scope = scopeInput as SecretScope | 'all';
        const secrets = await manager.list(scope);

        if (secrets.length === 0) {
          return 'No secrets stored. Use secrets_set to store a secret.';
        }

        const lines: string[] = [];
        lines.push(`## Secrets (${secrets.length} secret${secrets.length === 1 ? '' : 's'})`);
        lines.push('');

        // Group by scope
        const globalSecrets = secrets.filter(s => s.scope === 'global');
        const assistantSecrets = secrets.filter(s => s.scope === 'assistant');

        if (globalSecrets.length > 0) {
          lines.push('### Global Secrets');
          for (const secret of globalSecrets) {
            lines.push(`- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}`);
          }
          lines.push('');
        }

        if (assistantSecrets.length > 0) {
          lines.push('### Assistant Secrets');
          for (const secret of assistantSecrets) {
            lines.push(`- **${secret.name}**${secret.description ? ` - ${secret.description}` : ''}`);
          }
          lines.push('');
        }

        // Add rate limit status
        const rateStatus = manager.getRateLimitStatus();
        lines.push(`---`);
        lines.push(`Rate limit: ${rateStatus.readsUsed}/${rateStatus.maxReads} reads this hour`);

        return lines.join('\n');
      } catch (error) {
        return `Error listing secrets: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    secrets_get: async (input) => {
      const manager = getSecretsManager();
      if (!manager) {
        return 'Error: Secrets management is not enabled or configured.';
      }

      const name = String(input.name || '').trim();
      if (!name) {
        return 'Error: Secret name is required.';
      }

      const scope = input.scope ? String(input.scope).toLowerCase() as SecretScope : undefined;
      const format = (String(input.format || 'plain').toLowerCase() as SecretFormat);

      try {
        const result = await manager.get(name, scope, format);

        if (result === null) {
          const scopeMsg = scope ? ` in ${scope} scope` : '';
          return `Secret "${name}" not found${scopeMsg}.`;
        }

        if (format === 'metadata' && typeof result === 'object') {
          const secret = result as Secret;
          return JSON.stringify({
            name: secret.name,
            value: secret.value,
            description: secret.description,
            scope: secret.scope,
            createdAt: new Date(secret.createdAt).toISOString(),
            updatedAt: new Date(secret.updatedAt).toISOString(),
          }, null, 2);
        }

        return String(result);
      } catch (error) {
        return `Error retrieving secret: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    secrets_set: async (input) => {
      const manager = getSecretsManager();
      if (!manager) {
        return 'Error: Secrets management is not enabled or configured.';
      }

      const name = String(input.name || '').trim();
      const value = String(input.value || '');
      const description = input.description ? String(input.description).trim() : undefined;
      const scope = input.scope ? String(input.scope).toLowerCase() as SecretScope : 'assistant';

      if (!name) {
        return 'Error: Secret name is required.';
      }

      if (!value) {
        return 'Error: Secret value is required.';
      }

      try {
        const result = await manager.set({
          name,
          value,
          description,
          scope,
        });

        if (result.success) {
          return `Secret "${name}" saved successfully (scope: ${scope}).`;
        }
        return `Error: ${result.message}`;
      } catch (error) {
        return `Error saving secret: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    secrets_delete: async (input) => {
      const manager = getSecretsManager();
      if (!manager) {
        return 'Error: Secrets management is not enabled or configured.';
      }

      const name = String(input.name || '').trim();
      const scope = (String(input.scope || 'assistant').toLowerCase() as SecretScope);

      if (!name) {
        return 'Error: Secret name is required.';
      }

      try {
        const result = await manager.delete(name, scope);

        if (result.success) {
          return result.message;
        }
        return `Error: ${result.message}`;
      } catch (error) {
        return `Error deleting secret: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

/**
 * All secrets tools
 */
export const secretsTools: Tool[] = [
  secretsListTool,
  secretsGetTool,
  secretsSetTool,
  secretsDeleteTool,
];

/**
 * Register secrets tools with a tool registry
 */
export function registerSecretsTools(
  registry: ToolRegistry,
  getSecretsManager: () => SecretsManager | null
): void {
  const executors = createSecretsToolExecutors(getSecretsManager);

  for (const tool of secretsTools) {
    registry.register(tool, executors[tool.name]);
  }
}
