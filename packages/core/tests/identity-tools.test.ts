import { describe, expect, test } from 'bun:test';
import { IdentityManager } from '../src/identity/identity-manager';
import { createIdentityToolExecutors } from '../src/tools/identity';
import { withTempDir } from './fixtures/helpers';

describe('identity tools', () => {
  test('create and get identity with extended contacts', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();

      const executors = createIdentityToolExecutors({ getIdentityManager: () => manager });
      const createRaw = await executors.identity_create({
        name: 'Primary',
        email: 'primary@example.com',
        phone: '+1 555-0000',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          state: 'IL',
          postalCode: '62701',
          country: 'USA',
          label: 'office',
        },
        virtualAddress: 'matrix:@primary:server',
      });

      const created = JSON.parse(createRaw);
      expect(created.success).toBe(true);
      const id = created.identity.id as string;

      const getRaw = await executors.identity_get({ id });
      const fetched = JSON.parse(getRaw);

      expect(fetched.success).toBe(true);
      expect(fetched.identity.contacts.emails[0].value).toBe('primary@example.com');
      expect(fetched.identity.contacts.phones[0].value).toBe('+1 555-0000');
      expect(fetched.identity.contacts.addresses[0].street).toBe('123 Main St');
      expect(fetched.identity.contacts.virtualAddresses[0].value).toBe('matrix:@primary:server');
    });
  });

  test('updates identity contact fields', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();

      const executors = createIdentityToolExecutors({ getIdentityManager: () => manager });
      const createRaw = await executors.identity_create({ name: 'Primary' });
      const created = JSON.parse(createRaw);
      const id = created.identity.id as string;

      const updateRaw = await executors.identity_update({
        id,
        phone: '+1 555-9999',
        virtualAddress: 'did:example:123',
      });
      const updated = JSON.parse(updateRaw);

      expect(updated.success).toBe(true);

      const getRaw = await executors.identity_get({ id });
      const fetched = JSON.parse(getRaw);

      expect(fetched.identity.contacts.phones[0].value).toBe('+1 555-9999');
      expect(fetched.identity.contacts.virtualAddresses[0].value).toBe('did:example:123');
    });
  });
});
