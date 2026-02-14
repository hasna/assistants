import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Card } from '../src/wallet/types';

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

const { SecretsClient } = await import('../src/wallet/storage/secrets-client?wallet-secrets-client');

const buildCard = (overrides?: Partial<Card>): Card => ({
  id: 'card-1',
  name: 'Personal',
  cardNumber: '4242424242424242',
  expiryMonth: '12',
  expiryYear: '2030',
  cardType: 'visa',
  createdAt: Date.now(),
  ...overrides,
});

describe('Wallet SecretsClient', () => {
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
    const client = new SecretsClient({ region: 'us-east-1', credentialsProfile: 'profile-1' });
    expect(lastSecretsConfig).toEqual({
      region: 'us-east-1',
      credentials: { profile: 'profile-1', mocked: true },
    });
    expect(lastFromIniInput).toEqual({ profile: 'profile-1' });
    expect(client).toBeDefined();
  });

  test('listCards returns safe summaries and skips failures', async () => {
    const card = buildCard({ id: 'card-1' });
    sendImpl = async (command) => {
      if (command.constructor.name === 'ListSecretsCommand') {
        return {
          SecretList: [
            { Name: 'assistants/wallet/assistant-1/card-1' },
            { Name: 'assistants/wallet/assistant-1/bad' },
          ],
        };
      }
      if (command.constructor.name === 'GetSecretValueCommand') {
        if (command.input.SecretId.endsWith('/bad')) {
          throw new Error('boom');
        }
        return { SecretString: JSON.stringify(card) };
      }
      return {};
    };

    const client = new SecretsClient({ region: 'us-east-1' });
    const cards = await client.listCards('assistant-1');
    expect(cards).toEqual([
      {
        id: 'card-1',
        name: 'Personal',
        last4: '4242',
        expiry: '12/30',
        cardType: 'visa',
        createdAt: card.createdAt,
      },
    ]);
  });

  test('getCard returns parsed data or null', async () => {
    sendImpl = async (command) => {
      if (command.constructor.name === 'GetSecretValueCommand') {
        return { SecretString: JSON.stringify(buildCard()) };
      }
      return {};
    };

    const client = new SecretsClient({ region: 'us-east-1' });
    const card = await client.getCard('assistant-1', 'card-1');
    expect(card?.id).toBe('card-1');

    sendImpl = async () => {
      throw new ResourceNotFoundException('missing');
    };
    const missing = await client.getCard('assistant-1', 'missing');
    expect(missing).toBeNull();
  });

  test('createCard updates on ResourceExistsException', async () => {
    const seen: string[] = [];
    sendImpl = async (command) => {
      seen.push(command.constructor.name);
      if (command.constructor.name === 'CreateSecretCommand') {
        const error = new Error('exists');
        (error as any).name = 'ResourceExistsException';
        throw error;
      }
      return {};
    };

    const client = new SecretsClient({ region: 'us-east-1' });
    await client.createCard('assistant-1', buildCard());
    expect(seen).toEqual(['CreateSecretCommand', 'UpdateSecretCommand']);
  });

  test('updateCard and deleteCard send correct commands', async () => {
    sendImpl = async () => ({}) as any;
    const client = new SecretsClient({ region: 'us-east-1' });

    await client.updateCard('assistant-1', buildCard({ id: 'card-2' }));
    await client.deleteCard('assistant-1', 'card-2');

    const updateCommand = sentCommands.find((command) => command.constructor.name === 'UpdateSecretCommand');
    const deleteCommand = sentCommands.find((command) => command.constructor.name === 'DeleteSecretCommand');

    expect(updateCommand.input.SecretId).toContain('assistants/wallet/assistant-1/card-2');
    expect(deleteCommand.input.RecoveryWindowInDays).toBe(30);
  });

  test('checkCredentials returns valid or error', async () => {
    const client = new SecretsClient({ region: 'us-east-1' });

    sendImpl = async () => ({});
    await expect(client.checkCredentials()).resolves.toEqual({ valid: true });

    sendImpl = async () => {
      throw new Error('nope');
    };
    await expect(client.checkCredentials()).resolves.toEqual({ valid: false, error: 'nope' });
  });
});
