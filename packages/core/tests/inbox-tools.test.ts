import { describe, expect, test } from 'bun:test';
import { createInboxToolExecutors } from '../src/inbox/tools';
import type { Email, EmailListItem } from '@hasna/assistants-shared';

const sampleEmail: Email = {
  id: 'email-1',
  messageId: 'msg-1',
  from: { address: 'from@example.com', name: 'From' },
  to: [{ address: 'to@example.com' }],
  subject: 'Subject',
  date: new Date().toISOString(),
  body: { text: 'Body' },
  headers: {},
};

const listItem: EmailListItem = {
  id: 'email-1',
  messageId: 'msg-1',
  from: 'From <from@example.com>',
  subject: 'Subject',
  date: new Date().toISOString(),
  hasAttachments: false,
  isRead: false,
};

describe('Inbox tools', () => {
  test('inbox_fetch handles missing manager', async () => {
    const executors = createInboxToolExecutors(() => null);
    const result = await executors.inbox_fetch({});
    expect(result).toContain('not enabled');
  });

  test('inbox_list formats output', async () => {
    const executors = createInboxToolExecutors(() => ({
      list: async () => [listItem],
    } as any));

    const output = await executors.inbox_list({});
    expect(output).toContain('Inbox');
    expect(output).toContain(listItem.subject);
  });

  test('inbox_read requires id', async () => {
    const executors = createInboxToolExecutors(() => ({
      read: async () => sampleEmail,
    } as any));

    const output = await executors.inbox_read({});
    expect(output).toContain('Email ID is required');
  });

  test('inbox_download_attachment validates input', async () => {
    const executors = createInboxToolExecutors(() => ({
      downloadAttachment: async () => '/tmp/file',
    } as any));

    const output = await executors.inbox_download_attachment({ emailId: 'email-1' });
    expect(output).toContain('Valid attachment index is required');
  });

  test('inbox_send handles reply and multiple recipients', async () => {
    let sentTo: string | string[] | null = null;
    const executors = createInboxToolExecutors(() => ({
      reply: async () => ({ messageId: 'reply-1' }),
      send: async ({ to }: { to: string | string[] }) => {
        sentTo = to;
        return { messageId: 'msg-1' };
      },
    } as any));

    const replyOutput = await executors.inbox_send({
      to: 'person@example.com',
      subject: 'Subject',
      body: 'Body',
      replyToId: 'email-1',
    });
    expect(replyOutput).toContain('Email sent successfully');

    const output = await executors.inbox_send({
      to: 'a@example.com, b@example.com',
      subject: 'Subject',
      body: 'Body',
    });

    expect(output).toContain('Email sent successfully');
    expect(Array.isArray(sentTo)).toBe(true);
  });
});
