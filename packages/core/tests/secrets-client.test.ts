import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SecretScope } from '../src/secrets/types';

let lastSecretsConfig: any = null;
let lastFromIniInput: any = null;
let sendImpl: ((command: any) => Promise<any>) | null = null;
let sentCommands: any[] = [];

class ResourceNotFoundException extends Error {}

mock.module('@aws-sdk/credential-providers', () => ({
  fromIni: (input: any) => {
    lastFromIniInput = input;
    return { profile: input.profile, mocked: true };
  },
}));

mock.module('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class SecretsManagerClient {
    constructor(config: any) {
      lastSecretsConfig = config;
    }

    async send(command: any): Promise<any> {
      sentCommands.push(command);
      if (sendImpl) return await sendImpl(command);
      return {};
    }
  },
  CreateSecretCommand: class CreateSecretCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  GetSecretValueCommand: class GetSecretValueCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  UpdateSecretCommand: class UpdateSecretCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  DeleteSecretCommand: class DeleteSecretCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  ListSecretsCommand: class ListSecretsCommand {
    input: any;
    constructor(input: any) {
      this.input = input;
    }
  },
  ResourceNotFoundException,
}));

const { SecretsStorageClient } = await import('../src/secrets/secrets-client');

describe('SecretsStorageClient', () => {
  beforeEach(() => {
    lastSecretsConfig = null;
    lastFromIniInput = null;
    sendImpl = null;
    sentCommands = [];
  });

  afterAll(() => {
    mock.restore();
  });

  test('constructs with credentials profile', () => {
    const client = new SecretsStorageClient({ region: 'us-east-1', credentialsProfile: 'profile-1' });
    expect(lastSecretsConfig).toEqual({
      region: 'us-east-1',
      credentials: { profile: 'profile-1', mocked: true },
    });
    expect(lastFromIniInput).toEqual({ profile: 'profile-1' });
    expect(client).toBeDefined();
  });

  test('listSecrets returns parsed secrets for all scopes', async () => {
    const prefix = 'assistants/secrets/';
    sendImpl = async (command) => {
      const filter = command.input.Filters?.[0]?.Values?.[0] as string;
      if (filter === `${prefix}global/`) {
        return {
          SecretList: [
            { Name: `${prefix}global/alpha`, Description: 'Global', CreatedDate: new Date(1), LastChangedDate: new Date(2) },
          ],
        };
      }
      if (filter === `${prefix}assistant/assistant-1/`) {
        return {
          SecretList: [
            { Name: `${prefix}assistant/assistant-1/key/name`, Description: 'Assistant', CreatedDate: new Date(3), LastChangedDate: new Date(4) },
          ],
        };
      }
      return { SecretList: [] };
    };

    const client = new SecretsStorageClient({ region: 'us-east-1' });
    const results = await client.listSecrets('all', 'assistant-1');
    expect(results).toEqual([
      {
        name: 'alpha',
        description: 'Global',
        scope: 'global',
        createdAt: 1,
        updatedAt: 2,
        hasValue: true,
      },
      {
        name: 'key/name',
        description: 'Assistant',
        scope: 'assistant',
        createdAt: 3,
        updatedAt: 4,
        hasValue: true,
      },
    ]);
  });

  test('getSecret returns parsed secret or null', async () => {
    sendImpl = async (command) => {
      if (command.constructor.name === 'GetSecretValueCommand') {
        return {
          SecretString: JSON.stringify({ value: 'token', description: 'desc', createdAt: 10, updatedAt: 11 }),
        };
      }
      return {};
    };

    const client = new SecretsStorageClient({ region: 'us-east-1' });
    const secret = await client.getSecret('api_key', 'global');
    expect(secret).toEqual({
      name: 'api_key',
      value: 'token',
      description: 'desc',
      scope: 'global',
      createdAt: 10,
      updatedAt: 11,
    });

    sendImpl = async () => {
      throw new ResourceNotFoundException('missing');
    };
    const missing = await client.getSecret('missing', 'global');
    expect(missing).toBeNull();
  });

  test('setSecret updates when secret exists', async () => {
    const seen: any[] = [];
    sendImpl = async (command) => {
      seen.push(command.constructor.name);
      if (command.constructor.name === 'GetSecretValueCommand') {
        return { SecretString: JSON.stringify({ value: 'old', createdAt: 5, updatedAt: 6 }) };
      }
      if (command.constructor.name === 'CreateSecretCommand') {
        const error = new Error('exists');
        (error as any).name = 'ResourceExistsException';
        throw error;
      }
      return {};
    };

    const client = new SecretsStorageClient({ region: 'us-east-1' });
    await client.setSecret('name', 'value', 'global');

    expect(seen).toEqual(['GetSecretValueCommand', 'CreateSecretCommand', 'UpdateSecretCommand']);
  });

  test('deleteSecret sends delete with recovery window', async () => {
    sendImpl = async () => ({}) as any;
    const client = new SecretsStorageClient({ region: 'us-east-1' });
    await client.deleteSecret('name', 'global');

    const deleteCommand = sentCommands.find((command) => command.constructor.name === 'DeleteSecretCommand');
    expect(deleteCommand.input.RecoveryWindowInDays).toBe(7);
  });

  test('checkCredentials returns valid or error', async () => {
    const client = new SecretsStorageClient({ region: 'us-east-1' });

    sendImpl = async () => ({});
    await expect(client.checkCredentials()).resolves.toEqual({ valid: true });

    sendImpl = async () => {
      throw new Error('nope');
    };
    await expect(client.checkCredentials()).resolves.toEqual({ valid: false, error: 'nope' });
  });

  test('listSecrets with assistant scope requires assistantId to return results', async () => {
    sendImpl = async () => ({ SecretList: [] });
    const client = new SecretsStorageClient({ region: 'us-east-1' });
    const secrets = await client.listSecrets('assistant' as SecretScope);
    expect(secrets).toEqual([]);
  });
});
