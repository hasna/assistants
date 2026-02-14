/**
 * Integration tests for assistant-to-assistant messaging system
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createMessagesManager, LocalMessagesStorage } from '../index';
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

// Clean up test data before and after each test
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'assistants-messages-'));
  testBasePath = join(tempDir, '__test__');
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  process.env.ASSISTANTS_DIR = tempDir;
  resetDatabaseSingleton();
  testConfig = {
    enabled: true,
    injection: {
      enabled: true,
      maxPerTurn: 5,
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

describe('MessagesManager', () => {
  test('creates manager and initializes successfully', async () => {
    const assistantId = `test-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(assistantId, 'TestAssistant', testConfig);

    await manager.initialize();

    const stats = await manager.getStats();
    expect(stats.totalMessages).toBe(0);
    expect(stats.unreadCount).toBe(0);
    expect(stats.threadCount).toBe(0);
  });

  test('registers assistant in registry on initialize', async () => {
    const storage = new LocalMessagesStorage();
    const assistantId = `test-${generateId().slice(0, 8)}`;
    const assistantName = 'RegisterTestAssistant';

    const manager = createMessagesManager(assistantId, assistantName, testConfig);
    await manager.initialize();

    const registry = await storage.loadRegistry();
    expect(registry.assistants[assistantId]).toBeDefined();
    expect(registry.assistants[assistantId].name).toBe(assistantName);
  });

  test('sends message between assistants successfully', async () => {
    // Create two assistants
    const assistant1Id = `sender-${generateId().slice(0, 8)}`;
    const assistant2Id = `receiver-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'SenderAssistant', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'ReceiverAssistant', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message from sender to receiver
    const result = await sender.send({
      to: 'ReceiverAssistant',
      body: 'Hello from sender!',
      subject: 'Test Subject',
      priority: 'normal',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();
    expect(result.threadId).toBeDefined();

    // Verify message is in receiver's inbox
    const messages = await receiver.list({ limit: 10 });
    expect(messages.length).toBe(1);
    expect(messages[0].fromAssistantName).toBe('SenderAssistant');
    expect(messages[0].subject).toBe('Test Subject');
    expect(messages[0].status).toBe('unread');
  });

  test('reads message and marks as read', async () => {
    const assistant1Id = `sender2-${generateId().slice(0, 8)}`;
    const assistant2Id = `receiver2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'Sender2', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'Receiver2', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message
    const sendResult = await sender.send({
      to: 'Receiver2',
      body: 'Message to read',
      subject: 'Read Test',
    });

    // Read message
    const message = await receiver.read(sendResult.messageId!);

    expect(message).not.toBeNull();
    expect(message?.body).toBe('Message to read');
    expect(message?.status).toBe('read');

    // Verify status updated in list
    const messages = await receiver.list({ limit: 10 });
    expect(messages[0].status).toBe('read');
  });

  test('replies create proper thread', async () => {
    const assistant1Id = `thread1-${generateId().slice(0, 8)}`;
    const assistant2Id = `thread2-${generateId().slice(0, 8)}`;

    const assistant1 = createMessagesManager(assistant1Id, 'ThreadAssistant1', testConfig);
    const assistant2 = createMessagesManager(assistant2Id, 'ThreadAssistant2', testConfig);

    await assistant1.initialize();
    await assistant2.initialize();

    // Assistant1 sends initial message
    const msg1 = await assistant1.send({
      to: 'ThreadAssistant2',
      body: 'Initial message',
      subject: 'Thread Test',
    });

    // Assistant2 replies
    const reply1 = await assistant2.send({
      to: 'ThreadAssistant1',
      body: 'Reply from assistant2',
      replyTo: msg1.messageId,
    });

    // Verify same thread
    expect(reply1.threadId).toBe(msg1.threadId);

    // Assistant1 replies back
    const reply2 = await assistant1.send({
      to: 'ThreadAssistant2',
      body: 'Reply from assistant1',
      replyTo: reply1.messageId,
    });

    expect(reply2.threadId).toBe(msg1.threadId);

    // Read thread from assistant2's perspective
    const threadMessages = await assistant2.readThread(msg1.threadId!);
    expect(threadMessages.length).toBeGreaterThanOrEqual(2);
  });

  test('deletes message successfully', async () => {
    const assistant1Id = `del1-${generateId().slice(0, 8)}`;
    const assistant2Id = `del2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'DelSender', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'DelReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send and then delete
    const result = await sender.send({
      to: 'DelReceiver',
      body: 'Message to delete',
    });

    // Verify message exists
    let messages = await receiver.list({ limit: 10 });
    const initialCount = messages.length;
    expect(initialCount).toBeGreaterThan(0);

    // Delete message
    const deleteResult = await receiver.delete(result.messageId!);
    expect(deleteResult.success).toBe(true);

    // Verify message gone
    messages = await receiver.list({ limit: 10 });
    expect(messages.length).toBe(initialCount - 1);
  });

  test('lists known assistants correctly', async () => {
    const assistant1Id = `list1-${generateId().slice(0, 8)}`;
    const assistant2Id = `list2-${generateId().slice(0, 8)}`;

    const assistant1 = createMessagesManager(assistant1Id, 'ListAssistant1', testConfig);
    const assistant2 = createMessagesManager(assistant2Id, 'ListAssistant2', testConfig);

    await assistant1.initialize();
    await assistant2.initialize();

    // Exchange messages to ensure both are in registry
    await assistant1.send({ to: 'ListAssistant2', body: 'Hello' });

    // List assistants from assistant1's perspective (should see assistant2)
    const assistants = await assistant1.listAssistants();
    const assistant2Entry = assistants.find(a => a.name === 'ListAssistant2');
    expect(assistant2Entry).toBeDefined();
    expect(assistant2Entry?.id).toBe(assistant2Id);
  });

  test('lists threads correctly', async () => {
    const assistant1Id = `thr1-${generateId().slice(0, 8)}`;
    const assistant2Id = `thr2-${generateId().slice(0, 8)}`;

    const assistant1 = createMessagesManager(assistant1Id, 'ThrAssistant1', testConfig);
    const assistant2 = createMessagesManager(assistant2Id, 'ThrAssistant2', testConfig);

    await assistant1.initialize();
    await assistant2.initialize();

    // Create a conversation
    await assistant1.send({ to: 'ThrAssistant2', body: 'Thread starter', subject: 'Test Thread' });

    // List threads
    const threads = await assistant2.listThreads();
    expect(threads.length).toBeGreaterThan(0);
    expect(threads[0].subject).toBe('Test Thread');
  });
});

describe('Message Injection', () => {
  test('gets unread messages for injection', async () => {
    const assistant1Id = `inj1-${generateId().slice(0, 8)}`;
    const assistant2Id = `inj2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'InjSender', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'InjReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send message
    await sender.send({
      to: 'InjReceiver',
      body: 'Message for injection',
      priority: 'high',
    });

    // Get unread for injection
    const unread = await receiver.getUnreadForInjection();
    expect(unread.length).toBe(1);
    expect(unread[0].priority).toBe('high');
  });

  test('builds injection context correctly', async () => {
    const assistant1Id = `ctx1-${generateId().slice(0, 8)}`;
    const assistant2Id = `ctx2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'CtxSender', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'CtxReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    await sender.send({
      to: 'CtxReceiver',
      body: 'Test message content',
      subject: 'Context Test',
    });

    const unread = await receiver.getUnreadForInjection();
    const context = receiver.buildInjectionContext(unread);

    expect(context).toContain('## Pending Assistant Messages');
    expect(context).toContain('CtxSender');
    expect(context).toContain('Context Test');
    expect(context).toContain('Test message content');
  });

  test('marks messages as injected', async () => {
    const assistant1Id = `mark1-${generateId().slice(0, 8)}`;
    const assistant2Id = `mark2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'MarkSender', testConfig);
    const receiver = createMessagesManager(assistant2Id, 'MarkReceiver', testConfig);

    await sender.initialize();
    await receiver.initialize();

    await sender.send({ to: 'MarkReceiver', body: 'Mark test' });

    const unread1 = await receiver.getUnreadForInjection();
    expect(unread1.length).toBe(1);

    // Mark as injected
    await receiver.markInjected(unread1.map(m => m.id));

    // Should not appear in unread for injection again
    const unread2 = await receiver.getUnreadForInjection();
    expect(unread2.length).toBe(0);
  });

  test('respects minPriority filter', async () => {
    const assistant1Id = `pri1-${generateId().slice(0, 8)}`;
    const assistant2Id = `pri2-${generateId().slice(0, 8)}`;

    const sender = createMessagesManager(assistant1Id, 'PriSender', testConfig);

    // Receiver with minPriority: 'high'
    const receiverConfig = {
      ...testConfig,
      injection: {
        ...testConfig.injection,
        minPriority: 'high' as const,
      },
    };
    const receiver = createMessagesManager(assistant2Id, 'PriReceiver', receiverConfig);

    await sender.initialize();
    await receiver.initialize();

    // Send low priority message
    await sender.send({ to: 'PriReceiver', body: 'Low priority', priority: 'low' });

    // Should not be returned for injection due to minPriority filter
    const unread = await receiver.getUnreadForInjection();
    expect(unread.length).toBe(0);

    // Send high priority message
    await sender.send({ to: 'PriReceiver', body: 'High priority', priority: 'high' });

    const unread2 = await receiver.getUnreadForInjection();
    expect(unread2.length).toBe(1);
  });
});

describe('Error Handling', () => {
  test('fails gracefully when sending to non-existent assistant', async () => {
    const assistantId = `err1-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(assistantId, 'ErrAssistant', testConfig);
    await manager.initialize();

    const result = await manager.send({
      to: 'NonExistentAssistant12345',
      body: 'Test message',
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  test('returns null when reading non-existent message', async () => {
    const assistantId = `err2-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(assistantId, 'ErrAssistant2', testConfig);
    await manager.initialize();

    const message = await manager.read('msg_nonexistent');
    expect(message).toBeNull();
  });

  test('returns failure when deleting non-existent message', async () => {
    const assistantId = `err3-${generateId().slice(0, 8)}`;
    const manager = createMessagesManager(assistantId, 'ErrAssistant3', testConfig);
    await manager.initialize();

    const result = await manager.delete('msg_nonexistent');
    expect(result.success).toBe(false);
  });
});

describe('LocalMessagesStorage', () => {
  test('creates storage directories', async () => {
    const storage = new LocalMessagesStorage();
    const assistantId = `store-${generateId().slice(0, 8)}`;

    await storage.ensureDirectories(assistantId);

    // Check assistant can load empty index
    const index = await storage.loadIndex(assistantId);
    expect(index.messages).toEqual([]);
    expect(index.stats.totalMessages).toBe(0);
  });

  test('finds assistant by name case-insensitively', async () => {
    const storage = new LocalMessagesStorage();
    const assistantId = `case-${generateId().slice(0, 8)}`;

    await storage.registerAssistant(assistantId, 'CaseSensitiveAssistant');

    // Find with different case
    const found = await storage.findAssistantByName('casesensitiveassistant');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(assistantId);

    const found2 = await storage.findAssistantByName('CASESENSITIVEASSISTANT');
    expect(found2).not.toBeNull();
    expect(found2?.id).toBe(assistantId);
  });
});
