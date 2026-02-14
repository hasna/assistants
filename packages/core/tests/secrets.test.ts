import { describe, expect, test, beforeEach, mock, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SecretsManager,
  createSecretsManager,
  isValidSecretName,
  type SecretsManagerOptions,
} from '../src/secrets/secrets-manager';
import type { SecretsConfig } from '@hasna/assistants-shared';
import type { Secret, SecretListItem, SecretScope } from '../src/secrets/types';
import {
  secretsTools,
  createSecretsToolExecutors,
  secretsListTool,
  secretsGetTool,
  secretsSetTool,
  secretsDeleteTool,
} from '../src/secrets/tools';

// Mock data for testing
const mockSecrets: Map<string, { value: string; description?: string; createdAt: number; updatedAt: number }> = new Map();

// Mock SecretsStorageClient
const mockStorageClient = {
  listSecrets: mock(async (scope: SecretScope | 'all', assistantId?: string): Promise<SecretListItem[]> => {
    const items: SecretListItem[] = [];
    for (const [name, data] of mockSecrets.entries()) {
      const [secretScope] = name.split(':');
      if (scope === 'all' || scope === secretScope) {
        items.push({
          name: name.split(':')[1],
          description: data.description,
          scope: secretScope as SecretScope,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          hasValue: true,
        });
      }
    }
    return items;
  }),
  getSecret: mock(async (name: string, scope: SecretScope, assistantId?: string): Promise<Secret | null> => {
    const key = `${scope}:${name}`;
    const data = mockSecrets.get(key);
    if (!data) return null;
    return {
      name,
      value: data.value,
      description: data.description,
      scope,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }),
  setSecret: mock(async (name: string, value: string, scope: SecretScope, assistantId?: string, description?: string): Promise<void> => {
    const key = `${scope}:${name}`;
    const now = Date.now();
    const existing = mockSecrets.get(key);
    mockSecrets.set(key, {
      value,
      description,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }),
  deleteSecret: mock(async (name: string, scope: SecretScope, assistantId?: string): Promise<void> => {
    const key = `${scope}:${name}`;
    mockSecrets.delete(key);
  }),
  checkCredentials: mock(async (): Promise<{ valid: boolean; error?: string }> => {
    return { valid: true };
  }),
};

describe('Secrets Management', () => {
  beforeEach(() => {
    // Clear mock data before each test
    mockSecrets.clear();
    // Reset mock call counts
    mockStorageClient.listSecrets.mockClear();
    mockStorageClient.getSecret.mockClear();
    mockStorageClient.setSecret.mockClear();
    mockStorageClient.deleteSecret.mockClear();
    mockStorageClient.checkCredentials.mockClear();
  });

  describe('isValidSecretName', () => {
    test('accepts valid secret names', () => {
      expect(isValidSecretName('GITHUB_TOKEN')).toBe(true);
      expect(isValidSecretName('my_api_key')).toBe(true);
      expect(isValidSecretName('_private')).toBe(true);
      expect(isValidSecretName('Secret123')).toBe(true);
      expect(isValidSecretName('API_KEY_V2')).toBe(true);
      expect(isValidSecretName('a')).toBe(true);
      expect(isValidSecretName('my-secret-key')).toBe(true);
    });

    test('rejects invalid secret names', () => {
      expect(isValidSecretName('')).toBe(false);
      expect(isValidSecretName('123start')).toBe(false);
      expect(isValidSecretName('-invalid')).toBe(false);
      expect(isValidSecretName('has space')).toBe(false);
      expect(isValidSecretName('has.dot')).toBe(false);
      expect(isValidSecretName('has/slash')).toBe(false);
      expect(isValidSecretName('has@symbol')).toBe(false);
    });
  });

  describe('SecretsManager', () => {
    test('isConfigured returns false when aws provider is selected without region', () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);
      expect(manager.isConfigured()).toBe(false);
    });

    test('isConfigured returns true with aws storage config', () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { provider: 'aws', region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      expect(manager.isConfigured()).toBe(true);
    });

    test('uses local storage by default and persists under base dir', async () => {
      const secretsBaseDir = mkdtempSync(join(tmpdir(), 'secrets-test-'));

      try {
        const manager = new SecretsManager({
          assistantId: 'assistant-local',
          config: { enabled: true },
          baseDir: secretsBaseDir,
        });

        expect(manager.isConfigured()).toBe(true);
        expect(manager.getStorageMode()).toBe('local');

        const setResult = await manager.set({
          name: 'LOCAL_KEY',
          value: 'local-value',
          scope: 'assistant',
          description: 'local secret',
        });
        expect(setResult.success).toBe(true);

        const listed = await manager.list('assistant');
        expect(listed).toHaveLength(1);
        expect(listed[0].name).toBe('LOCAL_KEY');

        const reloaded = new SecretsManager({
          assistantId: 'assistant-local',
          config: { enabled: true },
          baseDir: secretsBaseDir,
        });

        const value = await reloaded.get('LOCAL_KEY', 'assistant', 'plain');
        expect(value).toBe('local-value');
      } finally {
        rmSync(secretsBaseDir, { recursive: true, force: true });
      }
    });

    test('getRateLimitStatus returns correct initial state', () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
        security: { maxReadsPerHour: 50 },
      };
      const manager = createSecretsManager('assistant-123', config);
      const status = manager.getRateLimitStatus();

      expect(status.readsUsed).toBe(0);
      expect(status.maxReads).toBe(50);
      expect(status.windowResetMinutes).toBeLessThanOrEqual(60);
    });

    test('uses default maxReadsPerHour if not specified', () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      const status = manager.getRateLimitStatus();

      expect(status.maxReads).toBe(100); // default value
    });
  });

  describe('Secrets Tools', () => {
    test('all tools are defined with correct structure', () => {
      expect(secretsTools).toHaveLength(4);

      expect(secretsListTool.name).toBe('secrets_list');
      expect(secretsListTool.parameters.type).toBe('object');

      expect(secretsGetTool.name).toBe('secrets_get');
      expect(secretsGetTool.parameters.required).toContain('name');

      expect(secretsSetTool.name).toBe('secrets_set');
      expect(secretsSetTool.parameters.required).toContain('name');
      expect(secretsSetTool.parameters.required).toContain('value');

      expect(secretsDeleteTool.name).toBe('secrets_delete');
      expect(secretsDeleteTool.parameters.required).toContain('name');
    });

    test('secrets_list executor handles no manager', async () => {
      const executors = createSecretsToolExecutors(() => null);
      const result = await executors.secrets_list({});

      expect(result).toContain('not enabled or configured');
    });

    test('secrets_get executor handles no manager', async () => {
      const executors = createSecretsToolExecutors(() => null);
      const result = await executors.secrets_get({ name: 'TEST' });

      expect(result).toContain('not enabled or configured');
    });

    test('secrets_set executor handles no manager', async () => {
      const executors = createSecretsToolExecutors(() => null);
      const result = await executors.secrets_set({ name: 'TEST', value: 'value' });

      expect(result).toContain('not enabled or configured');
    });

    test('secrets_delete executor handles no manager', async () => {
      const executors = createSecretsToolExecutors(() => null);
      const result = await executors.secrets_delete({ name: 'TEST' });

      expect(result).toContain('not enabled or configured');
    });

    test('secrets_get executor requires name parameter', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      const executors = createSecretsToolExecutors(() => manager);

      const result = await executors.secrets_get({});
      expect(result).toContain('Secret name is required');
    });

    test('secrets_set executor requires name parameter', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      const executors = createSecretsToolExecutors(() => manager);

      const result = await executors.secrets_set({ value: 'test' });
      expect(result).toContain('Secret name is required');
    });

    test('secrets_set executor requires value parameter', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      const executors = createSecretsToolExecutors(() => manager);

      const result = await executors.secrets_set({ name: 'TEST' });
      expect(result).toContain('Secret value is required');
    });

    test('secrets_delete executor requires name parameter', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);
      const executors = createSecretsToolExecutors(() => manager);

      const result = await executors.secrets_delete({});
      expect(result).toContain('Secret name is required');
    });
  });

  describe('Secret Types', () => {
    test('SecretScope type accepts valid values', () => {
      const globalScope: SecretScope = 'global';
      const assistantScope: SecretScope = 'assistant';

      expect(globalScope).toBe('global');
      expect(assistantScope).toBe('assistant');
    });

    test('Secret interface has all required fields', () => {
      const secret: Secret = {
        name: 'TEST_SECRET',
        value: 'secret-value',
        scope: 'assistant',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(secret.name).toBe('TEST_SECRET');
      expect(secret.value).toBe('secret-value');
      expect(secret.scope).toBe('assistant');
      expect(typeof secret.createdAt).toBe('number');
      expect(typeof secret.updatedAt).toBe('number');
    });

    test('SecretListItem interface has hasValue field', () => {
      const item: SecretListItem = {
        name: 'TEST_SECRET',
        scope: 'global',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        hasValue: true,
      };

      expect(item.hasValue).toBe(true);
    });
  });

  describe('SecretsManager validation', () => {
    test('set rejects invalid secret names', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.set({
        name: '123invalid',
        value: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid secret name');
    });

    test('set rejects empty values', async () => {
      const config: SecretsConfig = {
        enabled: true,
        storage: { region: 'us-east-1' },
      };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.set({
        name: 'VALID_NAME',
        value: '',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('cannot be empty');
    });

    test('list returns empty array when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.list();
      expect(result).toEqual([]);
    });

    test('get throws error when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      await expect(manager.get('TEST')).rejects.toThrow('not configured');
    });

    test('delete returns error when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.delete('TEST');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });

    test('set returns error when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.set({ name: 'TEST', value: 'value' });
      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
    });

    test('checkCredentials returns error when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.checkCredentials();
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not configured');
    });

    test('export returns empty array when not configured', async () => {
      const config: SecretsConfig = { enabled: true, storage: { provider: 'aws' } };
      const manager = createSecretsManager('assistant-123', config);

      const result = await manager.export();
      expect(result).toEqual([]);
    });
  });

  describe('Tool descriptions', () => {
    test('secrets_list has appropriate description', () => {
      expect(secretsListTool.description).toContain('List');
      expect(secretsListTool.description).toContain('no values');
    });

    test('secrets_get has appropriate description', () => {
      expect(secretsGetTool.description).toContain('Get');
      expect(secretsGetTool.description).toContain('Rate limited');
    });

    test('secrets_set has appropriate description', () => {
      expect(secretsSetTool.description).toContain('Create or update');
      expect(secretsSetTool.description).toContain('API keys');
    });

    test('secrets_delete has appropriate description', () => {
      expect(secretsDeleteTool.description).toContain('Delete');
      expect(secretsDeleteTool.description).toContain('7-day');
    });
  });

  describe('Tool parameters', () => {
    test('secrets_list has scope parameter', () => {
      const scopeProp = secretsListTool.parameters.properties.scope;
      expect(scopeProp).toBeDefined();
      expect(scopeProp.enum).toContain('global');
      expect(scopeProp.enum).toContain('assistant');
      expect(scopeProp.enum).toContain('all');
    });

    test('secrets_get has format parameter', () => {
      const formatProp = secretsGetTool.parameters.properties.format;
      expect(formatProp).toBeDefined();
      expect(formatProp.enum).toContain('plain');
      expect(formatProp.enum).toContain('metadata');
      expect(formatProp.enum).toContain('env');
    });

    test('secrets_set has description parameter', () => {
      const descProp = secretsSetTool.parameters.properties.description;
      expect(descProp).toBeDefined();
      expect(descProp.type).toBe('string');
    });
  });
});
