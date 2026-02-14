import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { TelephonyStore } from '../src/telephony/store';
import { createTestDatabase } from './fixtures/test-db';

function setFakeDate(iso: string): () => void {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  class MockDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof RealDate>) {
      if (args.length === 0) {
        super(fixed);
      } else {
        super(...args);
      }
    }
    static now(): number {
      return fixed;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = MockDate;
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = RealDate;
  };
}

describe('TelephonyStore', () => {
  let store: TelephonyStore;

  beforeEach(() => {
    const db = createTestDatabase();
    store = new TelephonyStore(db);
  });

  afterEach(() => {
    store.close();
  });

  test('phone numbers CRUD and status filtering', async () => {
    const first = store.addPhoneNumber('+10000000001', 'Primary', 'sid-1', {
      voice: true,
      sms: true,
      whatsapp: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = store.addPhoneNumber('+10000000002', 'Backup', 'sid-2', {
      voice: false,
      sms: true,
      whatsapp: true,
    });

    expect(first.number).toBe('+10000000001');
    expect(second.capabilities.whatsapp).toBe(true);

    const updated = store.updatePhoneNumberStatus(second.id, 'inactive');
    expect(updated).toBe(true);

    const active = store.listPhoneNumbers('active');
    const inactive = store.listPhoneNumbers('inactive');

    expect(active.map((p) => p.number)).toContain('+10000000001');
    expect(inactive.map((p) => p.number)).toContain('+10000000002');
  });

  test('call logs update and filtered listing', async () => {
    const call = store.createCallLog({
      fromNumber: '+1999',
      toNumber: '+1888',
      direction: 'inbound',
      assistantId: 'assistant-1',
    });

    const updated = store.updateCallLog(call.id, {
      status: 'completed',
      duration: 42,
      recordingUrl: 'https://example.com/rec.mp3',
    });
    expect(updated).toBe(true);

    const byAssistant = store.listCallLogs({ assistantId: 'assistant-1' });
    expect(byAssistant.length).toBe(1);
    expect(byAssistant[0].status).toBe('completed');

    const byDirection = store.listCallLogs({ direction: 'inbound' });
    expect(byDirection.length).toBe(1);
  });

  test('sms logs update status and unread inbound filtering', async () => {
    const received = store.createSmsLog({
      fromNumber: '+1777',
      toNumber: '+1666',
      direction: 'inbound',
      body: 'hello',
      status: 'received',
      assistantId: 'assistant-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 2));
    store.createSmsLog({
      fromNumber: '+1777',
      toNumber: '+1666',
      direction: 'inbound',
      body: 'second',
      status: 'received',
      assistantId: 'assistant-1',
    });

    const sent = store.createSmsLog({
      fromNumber: '+1666',
      toNumber: '+1777',
      direction: 'outbound',
      body: 'outbound',
      status: 'sent',
      assistantId: 'assistant-1',
    });

    const updated = store.updateSmsStatus(sent.id, 'delivered');
    expect(updated).toBe(true);

    const unread = store.getUnreadInboundSms('assistant-1');
    expect(unread.length).toBe(2);
    expect(unread[0].id).toBe(received.id);
  });

  test('routing resolves by priority and matching rules', () => {
    store.createRoutingRule({
      name: 'low-priority',
      priority: 10,
      fromPattern: '+1*',
      messageType: 'sms',
      targetAssistantId: 'assistant-low',
      targetAssistantName: 'Low',
    });

    store.createRoutingRule({
      name: 'high-priority',
      priority: 1,
      fromPattern: '+1*',
      messageType: 'sms',
      keyword: 'urgent',
      targetAssistantId: 'assistant-high',
      targetAssistantName: 'High',
    });

    const noKeyword = store.resolveRouting({
      fromNumber: '+1555',
      toNumber: '+1666',
      messageType: 'sms',
      body: 'hello',
    });
    expect(noKeyword?.assistantId).toBe('assistant-low');

    const withKeyword = store.resolveRouting({
      fromNumber: '+1555',
      toNumber: '+1666',
      messageType: 'sms',
      body: 'urgent please',
    });
    expect(withKeyword?.assistantId).toBe('assistant-high');
  });

  test('routing respects toPattern and keyword requirements', () => {
    store.createRoutingRule({
      name: 'requires-keyword',
      priority: 1,
      toPattern: '+1666',
      messageType: 'sms',
      keyword: 'ping',
      targetAssistantId: 'assistant-keyword',
      targetAssistantName: 'Keyword',
    });

    store.createRoutingRule({
      name: 'fallback',
      priority: 10,
      toPattern: '+1666',
      messageType: 'sms',
      targetAssistantId: 'assistant-fallback',
      targetAssistantName: 'Fallback',
    });

    const noBody = store.resolveRouting({
      fromNumber: '+1555',
      toNumber: '+1666',
      messageType: 'sms',
    });
    expect(noBody?.assistantId).toBe('assistant-fallback');

    const noMatchTo = store.resolveRouting({
      fromNumber: '+1555',
      toNumber: '+1777',
      messageType: 'sms',
      body: 'ping',
    });
    expect(noMatchTo).toBeNull();

    const withBody = store.resolveRouting({
      fromNumber: '+1555',
      toNumber: '+1666',
      messageType: 'sms',
      body: 'ping now',
    });
    expect(withBody?.assistantId).toBe('assistant-keyword');
  });

  test('updates and deletes routing rules', async () => {
    const rule = store.createRoutingRule({
      name: 'base',
      priority: 5,
      targetAssistantId: 'assistant-a',
      targetAssistantName: 'A',
    });

    const noUpdates = store.updateRoutingRule(rule.id, {});
    expect(noUpdates).toBe(false);

    const updated = store.updateRoutingRule(rule.id, {
      name: 'updated',
      priority: 1,
      enabled: false,
    });
    expect(updated).toBe(true);

    const updatedRule = store.getRoutingRule(rule.id);
    expect(updatedRule?.name).toBe('updated');
    expect(updatedRule?.priority).toBe(1);
    expect(updatedRule?.enabled).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 2));
    store.createRoutingRule({
      name: 'later',
      priority: 1,
      targetAssistantId: 'assistant-b',
      targetAssistantName: 'B',
    });

    const list = store.listRoutingRules();
    expect(list[0].priority).toBe(1);
    expect(list.length).toBe(2);

    const deleted = store.deleteRoutingRule(rule.id);
    expect(deleted).toBe(true);
    expect(store.getRoutingRule(rule.id)).toBeNull();
  });

  test('routing respects time-of-day and day-of-week filters', () => {
    const restore = setFakeDate('2024-06-03T10:30:00.000Z'); // Monday
    try {
      store.createRoutingRule({
        name: 'time-gated',
        priority: 1,
        messageType: 'sms',
        timeOfDay: '09:00-11:00',
        dayOfWeek: 'mon,tue',
        targetAssistantId: 'assistant-time',
        targetAssistantName: 'Time',
      });

      const match = store.resolveRouting({
        fromNumber: '+1555',
        toNumber: '+1666',
        messageType: 'sms',
        body: 'anything',
      });
      expect(match?.assistantId).toBe('assistant-time');
    } finally {
      restore();
    }
  });

  test('persists default phone number setting', () => {
    expect(store.getDefaultPhoneNumber()).toBeNull();

    store.setDefaultPhoneNumber('+15550001111');
    expect(store.getDefaultPhoneNumber()).toBe('+15550001111');

    store.setDefaultPhoneNumber('+15550002222');
    expect(store.getDefaultPhoneNumber()).toBe('+15550002222');
  });

  test('routing skips rules outside time-of-day window', () => {
    const restore = setFakeDate('2024-06-03T12:30:00.000Z'); // Monday noon
    try {
      store.createRoutingRule({
        name: 'time-gated',
        priority: 1,
        messageType: 'sms',
        timeOfDay: '09:00-11:00',
        dayOfWeek: 'mon',
        targetAssistantId: 'assistant-time',
        targetAssistantName: 'Time',
      });

      const match = store.resolveRouting({
        fromNumber: '+1555',
        toNumber: '+1666',
        messageType: 'sms',
        body: 'anything',
      });
      expect(match).toBeNull();
    } finally {
      restore();
    }
  });

  test('routing handles overnight time ranges', () => {
    const restore = setFakeDate('2024-06-04T01:30:00.000Z'); // Tuesday
    try {
      store.createRoutingRule({
        name: 'overnight',
        priority: 1,
        messageType: 'sms',
        timeOfDay: '22:00-06:00',
        dayOfWeek: 'tue',
        targetAssistantId: 'assistant-overnight',
        targetAssistantName: 'Overnight',
      });

      const match = store.resolveRouting({
        fromNumber: '+1555',
        toNumber: '+1666',
        messageType: 'sms',
        body: 'ping',
      });
      expect(match?.assistantId).toBe('assistant-overnight');
    } finally {
      restore();
    }
  });

  test('cleanup enforces log limits', async () => {
    store.createCallLog({
      fromNumber: '+1222',
      toNumber: '+1333',
      direction: 'inbound',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.createCallLog({
      fromNumber: '+1222',
      toNumber: '+1333',
      direction: 'inbound',
    });

    store.createSmsLog({
      fromNumber: '+1444',
      toNumber: '+1555',
      direction: 'inbound',
      body: 'one',
      status: 'received',
      assistantId: 'assistant-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.createSmsLog({
      fromNumber: '+1444',
      toNumber: '+1555',
      direction: 'inbound',
      body: 'two',
      status: 'received',
      assistantId: 'assistant-1',
    });

    const deleted = store.cleanup(3650, 1, 1);
    expect(deleted).toBeGreaterThanOrEqual(2);

    expect(store.listCallLogs().length).toBe(1);
    expect(store.listSmsLogs().length).toBe(1);
  });
});
