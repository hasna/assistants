/**
 * Tests for message context injection
 * Verifies messages are properly injected into assistant context at turn start
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createMessagesManager } from '../index';
import { AssistantContext } from '../../agent/context';
import { generateId } from '@hasna/assistants-shared';
import { join } from 'path';
import { rm, mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { closeDatabase, resetDatabaseSingleton } from '../../database';

// Test configuration
let testBasePath = '';
let tempDir = '';
let originalAssistantsDir: string | undefined;
let testConfig: {
  enabled: boolean;
  injection: {
    enabled: boolean;
    maxPerTurn: number;
    minPriority: 'low';
  };
  storage: {
    basePath: string;
    maxMessages: number;
    maxAgeDays: number;
  };
};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'assistants-messages-'));
  testBasePath = join(tempDir, '__injection_test__');
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  process.env.ASSISTANTS_DIR = tempDir;
  resetDatabaseSingleton();
  testConfig = {
    enabled: true,
    injection: {
      enabled: true,
      maxPerTurn: 3,
      minPriority: 'low' as const,
    },
    storage: {
      basePath: testBasePath,
      maxMessages: 100,
      maxAgeDays: 30,
    },
  };
  await rm(testBasePath, { recursive: true, force: true });
  await mkdir(testBasePath, { recursive: true });
});

afterEach(async () => {
  closeDatabase();
  resetDatabaseSingleton();
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe('Context Injection Integration', () => {
  test('injectPendingMessages adds messages to context', async () => {
    // Setup: Create sender and receiver
    const senderId = `inj-sender-${generateId().slice(0, 8)}`;
    const receiverId = `inj-receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(senderId, 'InjectionSender', testConfig);
    const receiver = createMessagesManager(receiverId, 'InjectionReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send a message
    await sender.send({
      to: 'InjectionReceiver',
      body: 'This should be injected into context',
      subject: 'Injection Test',
      priority: 'high',
    });

    // Simulate what happens in AssistantLoop.injectPendingMessages
    const pending = await receiver.getUnreadForInjection();
    expect(pending.length).toBe(1);

    const context = new AssistantContext();
    const injectionContext = receiver.buildInjectionContext(pending);

    // Verify context contains expected content
    expect(injectionContext).toContain('## Pending Assistant Messages');
    expect(injectionContext).toContain('1 unread message');
    expect(injectionContext).toContain('InjectionSender');
    expect(injectionContext).toContain('Injection Test');
    expect(injectionContext).toContain('This should be injected into context');

    // Add to context as system message
    context.addSystemMessage(injectionContext);

    // Verify message is in context
    const messages = context.getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Pending Assistant Messages');

    // Mark as injected
    await receiver.markInjected(pending.map(m => m.id));

    // Verify no more unread for injection
    const pending2 = await receiver.getUnreadForInjection();
    expect(pending2.length).toBe(0);
  });

  test('respects maxPerTurn limit', async () => {
    const senderId = `limit-sender-${generateId().slice(0, 8)}`;
    const receiverId = `limit-receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(senderId, 'LimitSender', testConfig);
    const receiver = createMessagesManager(receiverId, 'LimitReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send 5 messages (more than maxPerTurn of 3)
    for (let i = 0; i < 5; i++) {
      await sender.send({
        to: 'LimitReceiver',
        body: `Message ${i + 1}`,
        priority: 'normal',
      });
    }

    // Should only get maxPerTurn (3) messages
    const pending = await receiver.getUnreadForInjection();
    expect(pending.length).toBe(3);
  });

  test('prioritizes high priority messages', async () => {
    const senderId = `pri-sender-${generateId().slice(0, 8)}`;
    const receiverId = `pri-receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(senderId, 'PrioritySender', testConfig);
    const receiver = createMessagesManager(receiverId, 'PriorityReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send messages with different priorities
    await sender.send({ to: 'PriorityReceiver', body: 'Low priority', priority: 'low' });
    await sender.send({ to: 'PriorityReceiver', body: 'Normal priority', priority: 'normal' });
    await sender.send({ to: 'PriorityReceiver', body: 'Urgent priority', priority: 'urgent' });
    await sender.send({ to: 'PriorityReceiver', body: 'High priority', priority: 'high' });

    // Get pending - should be sorted by priority (urgent, high, normal, low)
    const pending = await receiver.getUnreadForInjection();

    expect(pending[0].priority).toBe('urgent');
    expect(pending[1].priority).toBe('high');
    expect(pending[2].priority).toBe('normal');
    // Fourth message might not be included due to maxPerTurn
  });

  test('injection can be disabled', async () => {
    const senderId = `dis-sender-${generateId().slice(0, 8)}`;
    const receiverId = `dis-receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(senderId, 'DisabledSender', testConfig);

    // Receiver with injection disabled
    const disabledConfig = {
      ...testConfig,
      injection: {
        ...testConfig.injection,
        enabled: false,
      },
    };
    const receiver = createMessagesManager(receiverId, 'DisabledReceiver', disabledConfig);

    await sender.initialize();
    await receiver.initialize();

    await sender.send({ to: 'DisabledReceiver', body: 'Test message' });

    // Should return empty array when injection is disabled
    const pending = await receiver.getUnreadForInjection();
    expect(pending.length).toBe(0);
  });

  test('buildInjectionContext handles empty array', async () => {
    const assistantId = `empty-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(assistantId, 'EmptyAssistant', testConfig);
    await manager.initialize();

    const context = manager.buildInjectionContext([]);
    expect(context).toBe('');
  });

  test('messages marked as read are not injected', async () => {
    const senderId = `read-sender-${generateId().slice(0, 8)}`;
    const receiverId = `read-receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(senderId, 'ReadSender', testConfig);
    const receiver = createMessagesManager(receiverId, 'ReadReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message
    const result = await sender.send({ to: 'ReadReceiver', body: 'Will be read' });

    // Read the message (marks as read)
    await receiver.read(result.messageId!);

    // Should not appear in injection queue
    const pending = await receiver.getUnreadForInjection();
    expect(pending.length).toBe(0);
  });
});
