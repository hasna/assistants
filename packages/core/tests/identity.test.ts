import { describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { IdentityManager } from '../src/identity/identity-manager';
import type { Assistant } from '../src/identity/types';
import { withTempDir } from './fixtures/helpers';

async function writeAssistantConfig(basePath: string, assistantId: string, assistant: Assistant): Promise<void> {
  const dir = join(basePath, 'assistants', assistantId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.json'), JSON.stringify(assistant, null, 2));
}

describe('IdentityManager', () => {
  test('creates default identity and sets active', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();

      const identity = await manager.createIdentity({
        name: 'Primary',
        contacts: {
          emails: [{ value: 'primary@example.com', isPrimary: true }],
        },
      });

      expect(identity.isDefault).toBe(true);
      expect(manager.getActive()?.id).toBe(identity.id);

      const secondary = await manager.createIdentity({ name: 'Secondary' });
      expect(secondary.isDefault).toBe(false);
      expect(manager.getActive()?.id).toBe(identity.id);
    });
  });

  test('updates identity and preserves nested fields', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();
      const identity = await manager.createIdentity({ name: 'Primary' });

      const updated = await manager.updateIdentity(identity.id, {
        profile: { title: 'Lead' },
        preferences: { responseLength: 'concise' },
      });

      expect(updated.profile.displayName).toBe('Primary');
      expect(updated.profile.title).toBe('Lead');
      expect(updated.preferences.responseLength).toBe('concise');
    });
  });

  test('switches and deletes active identity', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();
      const first = await manager.createIdentity({ name: 'First' });
      const second = await manager.createIdentity({ name: 'Second' });

      await manager.switchIdentity(second.id);
      expect(manager.getActive()?.id).toBe(second.id);

      await manager.deleteIdentity(second.id);
      expect(manager.getActive()?.id).toBe(first.id);
    });
  });

  test('buildSystemPromptContext uses assistant config and identity', async () => {
    await withTempDir(async (dir) => {
      const manager = new IdentityManager('assistant-1', dir);
      await manager.initialize();

      await writeAssistantConfig(dir, 'assistant-1', {
        id: 'assistant-1',
        name: 'TestBot',
        settings: { model: 'mock' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await manager.createIdentity({
        name: 'Primary',
        profile: {
          title: 'Ops Lead',
        },
        contacts: {
          emails: [{ value: 'primary@example.com', label: 'work', isPrimary: true }],
          phones: [{ value: '+1 555-0000', label: 'mobile', isPrimary: true }],
          addresses: [{
            street: '123 Main St',
            city: 'Springfield',
            state: 'IL',
            postalCode: '62701',
            country: 'USA',
            label: 'office',
          }],
          virtualAddresses: [{ value: 'matrix:@primary:server', label: 'matrix', isPrimary: true }],
        },
        context: 'Use terse replies.',
      });

      const prompt = await manager.buildSystemPromptContext();
      expect(prompt).toContain('TestBot');
      expect(prompt).toContain('Primary');
      expect(prompt).toContain('Ops Lead');
      expect(prompt).toContain('primary@example.com');
      expect(prompt).toContain('+1 555-0000');
      expect(prompt).toContain('123 Main St');
      expect(prompt).toContain('matrix:@primary:server');
      expect(prompt).toContain('Use terse replies');
    });
  });
});
