import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  createMessagesToolExecutors,
  registerMessagesTools,
  messagesTools,
} from '../src/messages/tools';

const buildMessage = (overrides?: Partial<any>) => ({
  id: 'msg-1',
  threadId: 'thread-1',
  parentId: null,
  fromAssistantId: 'assistant-a',
  fromAssistantName: 'Assistant A',
  toAssistantId: 'assistant-b',
  toAssistantName: 'Assistant B',
  subject: 'Hello',
  body: 'Body text',
  priority: 'normal',
  status: 'unread',
  createdAt: new Date('2026-02-01T00:00:00Z').toISOString(),
  readAt: undefined,
  replyCount: 0,
  preview: 'Body text',
  ...overrides,
});

describe('Messages tools', () => {
  let manager: any;

  beforeEach(() => {
    manager = {
      send: mock(async () => ({ success: true, message: 'Sent', messageId: 'msg-1' })),
      list: mock(async () => [buildMessage()]),
      read: mock(async () => buildMessage({ readAt: new Date('2026-02-01T01:00:00Z').toISOString() })),
      readThread: mock(async () => [buildMessage()]),
      delete: mock(async () => ({ message: 'Deleted' })),
      listAssistants: mock(async () => [{ id: 'assistant-a', name: 'Assistant A', lastSeen: Date.now() }]),
    };
  });

  test('messages_send validates inputs and handles success', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    expect(await executors.messages_send({ to: '', body: 'x' })).toBe('Error: Recipient (to) is required.');
    expect(await executors.messages_send({ to: 'recipient', body: '' })).toBe('Error: Message body is required.');

    const response = await executors.messages_send({ to: 'recipient', body: 'hi' });
    expect(response).toBe('Sent (Message ID: msg-1)');
  });

  test('messages_send returns error when manager missing', async () => {
    const executors = createMessagesToolExecutors(() => null);
    const response = await executors.messages_send({ to: 'recipient', body: 'hi' });
    expect(response).toBe('Error: Messages are not enabled or configured.');
  });

  test('messages_list formats output and handles empty states', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    const output = await executors.messages_list({});
    expect(output).toContain('## Inbox');
    expect(output).toContain('Assistant A');

    manager.list = mock(async () => []);
    const empty = await executors.messages_list({});
    expect(empty).toBe('Inbox is empty.');

    const unreadEmpty = await executors.messages_list({ unreadOnly: true });
    expect(unreadEmpty).toBe('No unread messages.');

    manager.list = mock(async () => {
      throw new Error('boom');
    });
    const error = await executors.messages_list({});
    expect(error).toBe('Error listing messages: boom');
  });

  test('messages_read handles missing and formats message', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    expect(await executors.messages_read({ id: '' })).toBe('Error: Message ID is required.');

    manager.read = mock(async () => null);
    expect(await executors.messages_read({ id: 'missing' })).toBe('Message missing not found.');

    manager.read = mock(async () => buildMessage({ parentId: 'parent-1' }));
    const formatted = await executors.messages_read({ id: 'msg-1' });
    expect(formatted).toContain('## Message: msg-1');
    expect(formatted).toContain('In reply to');
  });

  test('messages_read_thread handles empty and errors', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    expect(await executors.messages_read_thread({ threadId: '' })).toBe('Error: Thread ID is required.');

    manager.readThread = mock(async () => []);
    expect(await executors.messages_read_thread({ threadId: 'thread-1' })).toBe('Thread thread-1 not found or empty.');

    manager.readThread = mock(async () => [buildMessage()]);
    const output = await executors.messages_read_thread({ threadId: 'thread-1' });
    expect(output).toContain('## Thread: thread-1');

    manager.readThread = mock(async () => {
      throw new Error('boom');
    });
    const error = await executors.messages_read_thread({ threadId: 'thread-1' });
    expect(error).toBe('Error reading thread: boom');
  });

  test('messages_delete handles errors', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    expect(await executors.messages_delete({ id: '' })).toBe('Error: Message ID is required.');

    const ok = await executors.messages_delete({ id: 'msg-1' });
    expect(ok).toBe('Deleted');

    manager.delete = mock(async () => {
      throw new Error('boom');
    });
    const error = await executors.messages_delete({ id: 'msg-1' });
    expect(error).toBe('Error deleting message: boom');
  });

  test('messages_list_assistants handles empty and errors', async () => {
    const executors = createMessagesToolExecutors(() => manager);

    const output = await executors.messages_list_assistants({});
    expect(output).toContain('Known Assistants');

    manager.listAssistants = mock(async () => []);
    const empty = await executors.messages_list_assistants({});
    expect(empty).toBe('No other assistants found. Assistants appear here after sending or receiving messages.');

    manager.listAssistants = mock(async () => {
      throw new Error('boom');
    });
    const error = await executors.messages_list_assistants({});
    expect(error).toBe('Error listing assistants: boom');
  });

  test('registerMessagesTools registers executors', () => {
    const registry = {
      registered: [] as string[],
      register: function register(tool: any): void {
        this.registered.push(tool.name);
      },
    };

    registerMessagesTools(registry as any, () => manager);
    expect(registry.registered.sort()).toEqual(messagesTools.map((tool) => tool.name).sort());
  });
});
