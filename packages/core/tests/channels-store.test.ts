import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ChannelStore } from '../src/channels/store';
import { createTestDatabase } from './fixtures/test-db';

describe('ChannelStore', () => {
  let store: ChannelStore;

  beforeEach(() => {
    const db = createTestDatabase();
    store = new ChannelStore(db);
  });

  afterEach(() => {
    store.close();
  });

  test('orders channels with messages before empty channels', () => {
    const createdBy = 'assistant-1';
    const createdByName = 'Alice';

    const alpha = store.createChannel('alpha', null, createdBy, createdByName);
    const beta = store.createChannel('beta', null, createdBy, createdByName);

    expect(alpha.success).toBe(true);
    expect(beta.success).toBe(true);
    expect(alpha.channelId).toBeDefined();
    expect(beta.channelId).toBeDefined();

    // Only alpha gets a message
    store.sendMessage(alpha.channelId!, createdBy, createdByName, 'hello');

    const list = store.listChannels();
    expect(list.length).toBe(2);
    expect(list[0].name).toBe('alpha');

    const alphaEntry = list.find((c) => c.name === 'alpha');
    const betaEntry = list.find((c) => c.name === 'beta');

    expect(alphaEntry?.lastMessageAt).not.toBeNull();
    expect(betaEntry?.lastMessageAt).toBeNull();
  });

  test('orders channels by most recent message', async () => {
    const createdBy = 'assistant-1';
    const createdByName = 'Alice';

    const alpha = store.createChannel('alpha-msg', null, createdBy, createdByName);
    const beta = store.createChannel('beta-msg', null, createdBy, createdByName);

    store.sendMessage(alpha.channelId!, createdBy, createdByName, 'alpha-first');
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.sendMessage(beta.channelId!, createdBy, createdByName, 'beta-first');
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.sendMessage(beta.channelId!, createdBy, createdByName, 'beta-second');

    const list = store.listChannels();
    expect(list[0].name).toBe('beta-msg');
  });

  test('orders empty channels by created time desc', async () => {
    const createdBy = 'assistant-1';
    const createdByName = 'Alice';

    store.createChannel('older', null, createdBy, createdByName);
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.createChannel('newer', null, createdBy, createdByName);

    const list = store.listChannels();
    expect(list[0].name).toBe('newer');
    expect(list[1].name).toBe('older');
  });

  test('tracks unread counts and markRead for assistants', () => {
    const createdBy = 'assistant-a';
    const createdByName = 'Alice';
    const assistantB = 'assistant-b';
    const assistantBName = 'Bob';

    const channel = store.createChannel('gamma', null, createdBy, createdByName);
    expect(channel.success).toBe(true);
    store.addMember(channel.channelId!, assistantB, assistantBName, 'member');

    let list = store.listChannels({ assistantId: assistantB });
    expect(list.length).toBe(1);
    expect(list[0].unreadCount).toBe(0);

    store.sendMessage(channel.channelId!, createdBy, createdByName, 'hello');
    list = store.listChannels({ assistantId: assistantB });
    expect(list[0].unreadCount).toBe(1);

    store.markRead(channel.channelId!, assistantB);
    list = store.listChannels({ assistantId: assistantB });
    expect(list[0].unreadCount).toBe(0);
  });

  test('listChannels excludes sender messages from unread counts', () => {
    const createdBy = 'assistant-a';
    const createdByName = 'Alice';
    const assistantB = 'assistant-b';
    const assistantBName = 'Bob';

    const channel = store.createChannel('epsilon', null, createdBy, createdByName);
    expect(channel.success).toBe(true);
    store.addMember(channel.channelId!, assistantB, assistantBName, 'member');

    store.sendMessage(channel.channelId!, assistantB, assistantBName, 'from bob');

    const listForB = store.listChannels({ assistantId: assistantB });
    expect(listForB[0].unreadCount).toBe(0);

    const listForA = store.listChannels({ assistantId: createdBy });
    expect(listForA[0].unreadCount).toBe(1);
  });

  test('returns unread messages in chronological order and excludes sender', async () => {
    const createdBy = 'assistant-a';
    const createdByName = 'Alice';
    const assistantB = 'assistant-b';
    const assistantBName = 'Bob';

    const channel = store.createChannel('delta', null, createdBy, createdByName);
    expect(channel.success).toBe(true);
    store.addMember(channel.channelId!, assistantB, assistantBName, 'member');

    store.sendMessage(channel.channelId!, createdBy, createdByName, 'first');
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.sendMessage(channel.channelId!, createdBy, createdByName, 'second');

    const unreadForB = store.getUnreadMessages(channel.channelId!, assistantB);
    expect(unreadForB.map((m) => m.content)).toEqual(['first', 'second']);

    const unreadForA = store.getUnreadMessages(channel.channelId!, createdBy);
    expect(unreadForA.length).toBe(0);
  });

  test('markReadAt advances unread cursor without skipping newer messages', async () => {
    const createdBy = 'assistant-a';
    const createdByName = 'Alice';
    const assistantB = 'assistant-b';
    const assistantBName = 'Bob';

    const channel = store.createChannel('zeta', null, createdBy, createdByName);
    expect(channel.success).toBe(true);
    store.addMember(channel.channelId!, assistantB, assistantBName, 'member');

    store.sendMessage(channel.channelId!, createdBy, createdByName, 'first');
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.sendMessage(channel.channelId!, createdBy, createdByName, 'second');
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.sendMessage(channel.channelId!, createdBy, createdByName, 'third');

    const allMessages = store.getMessages(channel.channelId!, { limit: 10 });
    expect(allMessages.length).toBe(3);

    // Mark read up to the first message timestamp
    store.markReadAt(channel.channelId!, assistantB, allMessages[0].createdAt);

    const unreadForB = store.getUnreadMessages(channel.channelId!, assistantB);
    expect(unreadForB.map((m) => m.content)).toEqual(['second', 'third']);
  });
});
