import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WebhooksManager, createWebhooksManager } from '../src/webhooks/manager';
import { signPayload, generateWebhookSecret } from '../src/webhooks/crypto';
import type { WebhooksConfig } from '../src/webhooks/types';
import { createTestDatabase } from './fixtures/test-db';
import type { DatabaseConnection } from '../src/runtime';

describe('WebhooksManager', () => {
  let tempDir: string;
  let manager: WebhooksManager;
  let db: DatabaseConnection;
  const config: WebhooksConfig = {
    enabled: true,
    injection: { enabled: true, maxPerTurn: 5 },
    storage: { maxEvents: 100, maxAgeDays: 30 },
    security: { maxTimestampAgeMs: 300_000, rateLimitPerMinute: 60 },
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'webhook-manager-test-'));
    db = createTestDatabase();
    manager = new WebhooksManager({
      assistantId: 'test-assistant',
      config: { ...config, storage: { ...config.storage, basePath: tempDir } },
      db,
    });
    await manager.initialize();
  });

  afterEach(async () => {
    manager.stopWatching();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a webhook with secret and URL', async () => {
      const result = await manager.create({
        name: 'Test Hook',
        source: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.webhookId).toStartWith('whk_');
      expect(result.secret).toStartWith('whsec_');
      expect(result.url).toContain('/api/v1/webhooks/receive/');
    });

    it('should persist the webhook', async () => {
      const result = await manager.create({ name: 'Test', source: 'test' });
      const webhook = await manager.get(result.webhookId!);

      expect(webhook).not.toBeNull();
      expect(webhook!.name).toBe('Test');
      expect(webhook!.source).toBe('test');
      expect(webhook!.status).toBe('active');
    });
  });

  describe('list', () => {
    it('should list created webhooks', async () => {
      await manager.create({ name: 'Hook 1', source: 'gmail' });
      await manager.create({ name: 'Hook 2', source: 'notion' });

      const list = await manager.list();
      expect(list.length).toBe(2);
    });

    it('should return empty list when no webhooks', async () => {
      const list = await manager.list();
      expect(list.length).toBe(0);
    });
  });

  describe('update', () => {
    it('should update webhook properties', async () => {
      const { webhookId } = await manager.create({ name: 'Old Name', source: 'test' });
      const result = await manager.update({
        id: webhookId!,
        name: 'New Name',
        status: 'paused',
      });

      expect(result.success).toBe(true);

      const webhook = await manager.get(webhookId!);
      expect(webhook!.name).toBe('New Name');
      expect(webhook!.status).toBe('paused');
    });

    it('should fail for non-existent webhook', async () => {
      const result = await manager.update({ id: 'whk_nonexistent', name: 'test' });
      expect(result.success).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a webhook', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await manager.delete(webhookId!);
      expect(result.success).toBe(true);

      const webhook = await manager.get(webhookId!);
      expect(webhook).toBeNull();
    });

    it('should fail for non-existent webhook', async () => {
      const result = await manager.delete('whk_nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('receiveEvent', () => {
    it('should accept a valid signed event', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { action: 'test', data: { foo: 'bar' } };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);
      const timestamp = new Date().toISOString();

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp,
        eventType: 'test.event',
      });

      expect(result.success).toBe(true);
      expect(result.eventId).toStartWith('evt_');
      expect(result.deliveryId).toStartWith('dlv_');
    });

    it('should validate signature using raw body when provided', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { a: 1, b: 2 };
      const rawBody = '{"b":2,"a":1}';
      const signature = signPayload(rawBody, secret!);

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        rawBody,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'test.event',
      });

      expect(result.success).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        payload: { test: true },
        signature: 'invalid_signature',
        timestamp: new Date().toISOString(),
        eventType: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid signature');
    });

    it('should reject old timestamps', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { test: true };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);
      const oldTimestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: oldTimestamp,
        eventType: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Timestamp');
    });

    it('should reject events for non-existent webhook', async () => {
      const result = await manager.receiveEvent({
        webhookId: 'whk_nonexistent',
        payload: {},
        signature: 'sig',
        timestamp: new Date().toISOString(),
        eventType: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should reject events for paused webhook', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      await manager.update({ id: webhookId!, status: 'paused' });

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        payload: {},
        signature: 'sig',
        timestamp: new Date().toISOString(),
        eventType: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not active');
    });

    it('should filter by events filter', async () => {
      const { webhookId, secret } = await manager.create({
        name: 'Test',
        source: 'test',
        eventsFilter: ['allowed.event'],
      });

      const payload = { test: true };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);
      const timestamp = new Date().toISOString();

      const result = await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp,
        eventType: 'disallowed.event',
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not accepted');
    });

    it('should increment delivery count', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { test: true };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);

      await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'test',
      });

      const webhook = await manager.get(webhookId!);
      expect(webhook!.deliveryCount).toBe(1);
    });
  });

  describe('sendTestEvent', () => {
    it('should send a test event', async () => {
      const { webhookId } = await manager.create({ name: 'Test', source: 'test' });
      const result = await manager.sendTestEvent(webhookId!);

      expect(result.success).toBe(true);
      expect(result.eventId).toStartWith('evt_');
    });

    it('should fail for non-existent webhook', async () => {
      const result = await manager.sendTestEvent('whk_nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('Context Injection', () => {
    it('should return pending events for injection', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { msg: 'hello' };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);

      await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'message',
      });

      const pending = await manager.getPendingForInjection();
      expect(pending.length).toBe(1);
      expect(pending[0].eventType).toBe('message');
    });

    it('should mark events as injected', async () => {
      const { webhookId, secret } = await manager.create({ name: 'Test', source: 'test' });
      const payload = { msg: 'hello' };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);

      const { eventId } = await manager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'message',
      });

      await manager.markInjected([{ webhookId: webhookId!, eventId: eventId! }]);

      const pending = await manager.getPendingForInjection();
      expect(pending.length).toBe(0);
    });

    it('should build injection context', () => {
      const events = [
        {
          id: 'evt_1',
          webhookId: 'whk_1',
          source: 'gmail',
          eventType: 'email.received',
          payload: { subject: 'Test Email' },
          timestamp: new Date().toISOString(),
          signature: 'sig',
          status: 'pending' as const,
        },
      ];

      const context = manager.buildInjectionContext(events);
      expect(context).toContain('Pending Webhook Events');
      expect(context).toContain('gmail');
      expect(context).toContain('email.received');
      expect(context).toContain('Test Email');
    });

    it('should return empty string for no events', () => {
      const context = manager.buildInjectionContext([]);
      expect(context).toBe('');
    });

    it('should respect maxPerTurn config', async () => {
      const limitedDb = createTestDatabase();
      const limitedManager = new WebhooksManager({
        assistantId: 'test',
        config: {
          ...config,
          injection: { enabled: true, maxPerTurn: 2 },
          storage: { ...config.storage, basePath: tempDir },
        },
        db: limitedDb,
      });
      await limitedManager.initialize();

      const { webhookId, secret } = await limitedManager.create({ name: 'Test', source: 'test' });

      for (let i = 0; i < 5; i++) {
        const payload = { index: i };
        const payloadStr = JSON.stringify(payload);
        const signature = signPayload(payloadStr, secret!);
        await limitedManager.receiveEvent({
          webhookId: webhookId!,
          payload,
          signature,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          eventType: 'test',
        });
      }

      const pending = await limitedManager.getPendingForInjection();
      expect(pending.length).toBe(2);
    });

    it('should return no events when injection is disabled', async () => {
      const disabledDb = createTestDatabase();
      const disabledManager = new WebhooksManager({
        assistantId: 'test',
        config: {
          ...config,
          injection: { enabled: false },
          storage: { ...config.storage, basePath: tempDir },
        },
        db: disabledDb,
      });
      await disabledManager.initialize();

      const { webhookId, secret } = await disabledManager.create({ name: 'Test', source: 'test' });
      const payload = { test: true };
      const payloadStr = JSON.stringify(payload);
      const signature = signPayload(payloadStr, secret!);
      await disabledManager.receiveEvent({
        webhookId: webhookId!,
        payload,
        signature,
        timestamp: new Date().toISOString(),
        eventType: 'test',
      });

      const pending = await disabledManager.getPendingForInjection();
      expect(pending.length).toBe(0);
    });
  });

  describe('createWebhooksManager factory', () => {
    it('should create a manager with factory function', () => {
      const m = createWebhooksManager('test-id', config);
      expect(m).toBeInstanceOf(WebhooksManager);
    });
  });
});
