import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { LocalWebhookStorage } from '../src/webhooks/storage/local-storage';
import type { WebhookRegistration, WebhookEvent, WebhookDelivery } from '../src/webhooks/types';
import { createTestDatabase } from './fixtures/test-db';

describe('LocalWebhookStorage', () => {
  let storage: LocalWebhookStorage;

  beforeEach(() => {
    const db = createTestDatabase();
    storage = new LocalWebhookStorage({ db });
  });

  describe('Registration Operations', () => {
    const testRegistration: WebhookRegistration = {
      id: 'whk_test123',
      name: 'Test Webhook',
      source: 'test',
      secret: 'whsec_abc123',
      eventsFilter: [],
      status: 'active',
      deliveryCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('should save and load a registration', async () => {
      await storage.saveRegistration(testRegistration);
      const loaded = await storage.loadRegistration('whk_test123');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('whk_test123');
      expect(loaded!.name).toBe('Test Webhook');
      expect(loaded!.source).toBe('test');
      expect(loaded!.secret).toBe('whsec_abc123');
    });

    it('should list registrations', async () => {
      await storage.saveRegistration(testRegistration);
      await storage.saveRegistration({
        ...testRegistration,
        id: 'whk_test456',
        name: 'Second Webhook',
      });

      const list = await storage.listRegistrations();
      expect(list.length).toBe(2);
    });

    it('should return null for non-existent registration', async () => {
      const loaded = await storage.loadRegistration('whk_nonexistent');
      expect(loaded).toBeNull();
    });

    it('should delete a registration', async () => {
      await storage.saveRegistration(testRegistration);
      const deleted = await storage.deleteRegistration('whk_test123');
      expect(deleted).toBe(true);

      const loaded = await storage.loadRegistration('whk_test123');
      expect(loaded).toBeNull();

      const list = await storage.listRegistrations();
      expect(list.length).toBe(0);
    });

    it('should return false when deleting non-existent registration', async () => {
      const deleted = await storage.deleteRegistration('whk_nonexistent');
      expect(deleted).toBe(false);
    });

    it('should update registration in index', async () => {
      await storage.saveRegistration(testRegistration);
      await storage.saveRegistration({
        ...testRegistration,
        name: 'Updated Name',
        deliveryCount: 5,
      });

      const list = await storage.listRegistrations();
      expect(list.length).toBe(1);
      expect(list[0].name).toBe('Updated Name');
      expect(list[0].deliveryCount).toBe(5);
    });
  });

  describe('Event Operations', () => {
    const testEvent: WebhookEvent = {
      id: 'evt_test123',
      webhookId: 'whk_test123',
      source: 'test',
      eventType: 'test.event',
      payload: { message: 'hello' },
      timestamp: new Date().toISOString(),
      signature: 'abc123',
      status: 'pending',
    };

    it('should save and load an event', async () => {
      await storage.saveEvent(testEvent);
      const loaded = await storage.loadEvent('whk_test123', 'evt_test123');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('evt_test123');
      expect(loaded!.eventType).toBe('test.event');
      expect(loaded!.payload).toEqual({ message: 'hello' });
    });

    it('should list events', async () => {
      await storage.saveEvent(testEvent);
      await storage.saveEvent({
        ...testEvent,
        id: 'evt_test456',
        eventType: 'test.event2',
      });

      const events = await storage.listEvents('whk_test123');
      expect(events.length).toBe(2);
    });

    it('should filter pending-only events', async () => {
      await storage.saveEvent(testEvent);
      await storage.saveEvent({
        ...testEvent,
        id: 'evt_test456',
        status: 'injected',
      });

      const pending = await storage.listEvents('whk_test123', { pendingOnly: true });
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe('evt_test123');
    });

    it('should update event status', async () => {
      await storage.saveEvent(testEvent);
      const now = new Date().toISOString();
      await storage.updateEventStatus('whk_test123', 'evt_test123', 'injected', now);

      const loaded = await storage.loadEvent('whk_test123', 'evt_test123');
      expect(loaded!.status).toBe('injected');
      expect(loaded!.injectedAt).toBe(now);
    });

    it('should limit events list', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.saveEvent({
          ...testEvent,
          id: `evt_test_${i}`,
        });
      }

      const events = await storage.listEvents('whk_test123', { limit: 5 });
      expect(events.length).toBe(5);
    });
  });

  describe('Delivery Operations', () => {
    const testDelivery: WebhookDelivery = {
      id: 'dlv_test123',
      webhookId: 'whk_test123',
      eventId: 'evt_test123',
      receivedAt: new Date().toISOString(),
      status: 'accepted',
      httpStatus: 200,
    };

    it('should save and list deliveries', async () => {
      await storage.saveDelivery(testDelivery);
      await storage.saveDelivery({
        ...testDelivery,
        id: 'dlv_test456',
      });

      const deliveries = await storage.listDeliveries('whk_test123');
      expect(deliveries.length).toBe(2);
    });

    it('should limit deliveries list', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.saveDelivery({
          ...testDelivery,
          id: `dlv_test_${i}`,
        });
      }

      const deliveries = await storage.listDeliveries('whk_test123', { limit: 3 });
      expect(deliveries.length).toBe(3);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old events', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      await storage.saveEvent({
        id: 'evt_old',
        webhookId: 'whk_test123',
        source: 'test',
        eventType: 'old',
        payload: {},
        timestamp: oldDate.toISOString(),
        signature: 'sig',
        status: 'processed',
      });

      await storage.saveEvent({
        id: 'evt_new',
        webhookId: 'whk_test123',
        source: 'test',
        eventType: 'new',
        payload: {},
        timestamp: new Date().toISOString(),
        signature: 'sig',
        status: 'pending',
      });

      const deleted = await storage.cleanupEvents('whk_test123', 30);
      expect(deleted).toBe(1);

      const events = await storage.listEvents('whk_test123');
      expect(events.length).toBe(1);
      expect(events[0].id).toBe('evt_new');
    });

    it('should enforce max events', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveEvent({
          id: `evt_${i}`,
          webhookId: 'whk_test123',
          source: 'test',
          eventType: 'test',
          payload: {},
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          signature: 'sig',
          status: 'processed',
        });
      }

      const deleted = await storage.enforceMaxEvents('whk_test123', 3);
      expect(deleted).toBe(2);

      const events = await storage.listEvents('whk_test123');
      expect(events.length).toBe(3);
    });
  });

  // Note: validateSafeId was removed after migration to SQLite storage.
  // Path traversal validation is no longer needed since IDs are database keys, not file paths.
});
