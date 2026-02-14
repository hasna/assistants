import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { setRuntime } from '../src/runtime';
import { bunRuntime } from '@hasna/runtime-bun';
import { WebhooksManager } from '../src/webhooks/manager';
import { createWebhookToolExecutors } from '../src/webhooks/tools';
import { signPayload } from '../src/webhooks/crypto';
import type { WebhooksConfig } from '../src/webhooks/types';
import { createTestDatabase } from './fixtures/test-db';
import type { DatabaseConnection } from '../src/runtime';

// Set up Bun runtime for tests
setRuntime(bunRuntime);

describe('Webhook Tools', () => {
  let tempDir: string;
  let manager: WebhooksManager;
  let executors: Record<string, (input: Record<string, unknown>) => Promise<string>>;
  const config: WebhooksConfig = {
    enabled: true,
    injection: { enabled: true, maxPerTurn: 5 },
    storage: { maxEvents: 100, maxAgeDays: 30 },
    security: { maxTimestampAgeMs: 300_000, rateLimitPerMinute: 60 },
  };

  let db: DatabaseConnection;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webhook-tools-test-'));
    db = createTestDatabase();
    manager = new WebhooksManager({
      assistantId: 'test-assistant',
      config: { ...config, storage: { ...config.storage, basePath: tempDir } },
      db,
    });
    await manager.initialize();
    executors = createWebhookToolExecutors(() => manager);
  });

  afterEach(async () => {
    manager.stopWatching();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('webhook_create', () => {
    it('should create a webhook and return details', async () => {
      const result = await executors.webhook_create({
        name: 'Gmail Hook',
        source: 'gmail',
      });

      expect(result).toContain('Webhook created successfully');
      expect(result).toContain('whk_');
      expect(result).toContain('whsec_');
      expect(result).toContain('/api/v1/webhooks/receive/');
    });

    it('should require name', async () => {
      const result = await executors.webhook_create({ source: 'test' });
      expect(result).toContain('Error');
    });

    it('should require source', async () => {
      const result = await executors.webhook_create({ name: 'test' });
      expect(result).toContain('Error');
    });
  });

  describe('webhook_list', () => {
    it('should list webhooks', async () => {
      await manager.create({ name: 'Hook 1', source: 'gmail' });
      await manager.create({ name: 'Hook 2', source: 'notion' });

      const result = await executors.webhook_list({});
      expect(result).toContain('Webhooks (2)');
      expect(result).toContain('Hook 1');
      expect(result).toContain('Hook 2');
    });

    it('should show message when no webhooks', async () => {
      const result = await executors.webhook_list({});
      expect(result).toContain('No webhooks registered');
    });
  });

  describe('webhook_get', () => {
    it('should get webhook details', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await executors.webhook_get({ id: webhookId });

      expect(result).toContain('Webhook: Test');
      expect(result).toContain(webhookId!);
      expect(result).toContain('whsec_');
      expect(result).toContain('/api/v1/webhooks/receive/');
    });

    it('should return not found for non-existent webhook', async () => {
      const result = await executors.webhook_get({ id: 'whk_nonexistent' });
      expect(result).toContain('not found');
    });
  });

  describe('webhook_update', () => {
    it('should update webhook', async () => {
      const { webhookId } = await manager.create({ name: 'Old', source: 'test' });
      const result = await executors.webhook_update({
        id: webhookId,
        name: 'New Name',
        status: 'paused',
      });

      expect(result).toContain('updated');
    });
  });

  describe('webhook_delete', () => {
    it('should delete webhook', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await executors.webhook_delete({ id: webhookId });

      expect(result).toContain('deleted');
    });
  });

  describe('webhook_events', () => {
    it('should list events', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { msg: 'hello' };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);

      await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'message.received',
      });

      const result = await executors.webhook_events({ webhookId });
      expect(result).toContain('Events for');
      expect(result).toContain('message.received');
    });

    it('should show no events message', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await executors.webhook_events({ webhookId });
      expect(result).toContain('No events received');
    });
  });

  describe('webhook_test', () => {
    it('should send a test event', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await executors.webhook_test({ id: webhookId });

      expect(result).toContain('Test event sent successfully');
      expect(result).toContain('evt_');
    });
  });

  describe('when manager is null', () => {
    it('should return error for all tools', async () => {
      const nullExecutors = createWebhookToolExecutors(() => null);

      const results = await Promise.all([
        nullExecutors.webhook_create({ name: 'test', source: 'test' }),
        nullExecutors.webhook_list({}),
        nullExecutors.webhook_get({ id: 'test' }),
        nullExecutors.webhook_update({ id: 'test' }),
        nullExecutors.webhook_delete({ id: 'test' }),
        nullExecutors.webhook_events({ webhookId: 'test' }),
        nullExecutors.webhook_test({ id: 'test' }),
      ]);

      for (const result of results) {
        expect(result).toContain('not enabled');
      }
    });
  });
});
