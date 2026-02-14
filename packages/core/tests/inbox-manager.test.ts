import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { readFile } from 'fs/promises';
import { withTempDir } from './fixtures/helpers';
import type { Email } from '@hasna/assistants-shared';

const storedObjects: { key: string; body: Buffer }[] = [];
const emailsById = new Map<string, Email>();
let lastSendOptions: any = null;

mock.module('../src/inbox/storage/s3-client', () => ({
  S3InboxClient: class S3InboxClient {
    prefix: string;

    constructor(options: { prefix?: string }) {
      this.prefix = options.prefix || 'inbox/';
    }

    async listObjects(): Promise<{ objects: { key: string }[] }> {
      return { objects: storedObjects.map((obj) => ({ key: obj.key })) };
    }

    async getObject(key: string): Promise<Buffer> {
      const match = storedObjects.find((obj) => obj.key === key);
      if (!match) {
        throw new Error('missing object');
      }
      return match.body;
    }

    extractEmailId(key: string): string {
      const parts = key.split('/');
      return parts[parts.length - 1] || key;
    }
  },
}));

mock.module('../src/inbox/parser/email-parser', () => ({
  EmailParser: class EmailParser {
    async parse(_raw: Buffer, options: { id: string; s3Key?: string }): Promise<Email> {
      const email = emailsById.get(options.id);
      if (!email) {
        throw new Error('email not found');
      }
      return { ...email, id: options.id, s3Key: options.s3Key } as Email;
    }

    async extractAttachment(): Promise<Buffer | null> {
      return Buffer.from('attachment-content');
    }
  },
}));

mock.module('../src/inbox/providers', () => ({
  createEmailProvider: () => ({
    send: async (options: any) => {
      lastSendOptions = options;
      return { messageId: 'msg-1' };
    },
  }),
}));

const { InboxManager } = await import('../src/inbox/inbox-manager');

const buildEmail = (overrides?: Partial<Email>): Email => ({
  id: 'email-1',
  messageId: 'message-1',
  from: { address: 'from@example.com', name: 'From' },
  to: [{ address: 'assistant@example.com' }],
  subject: 'Hello',
  date: new Date().toISOString(),
  body: { text: 'Body' },
  headers: {},
  attachments: [{ filename: 'file.txt', contentType: 'text/plain', size: 5 }],
  ...overrides,
});

describe('InboxManager', () => {
  beforeEach(() => {
    storedObjects.length = 0;
    emailsById.clear();
    lastSendOptions = null;
  });

  test('formats email address with domain and template', async () => {
    await withTempDir(async (dir) => {
      const manager = new InboxManager({
        assistantId: 'assistant-1',
        assistantName: 'Assistant Name',
        config: { domain: 'example.com', addressFormat: '{assistant-id}@{domain}' },
        basePath: dir,
      });

      expect(manager.getEmailAddress()).toBe('assistant-1@example.com');
    });
  });

  test('fetch stores only emails addressed to assistant', async () => {
    await withTempDir(async (dir) => {
      const assistantEmail = 'assistant@example.com';
      const manager = new InboxManager({
        assistantId: 'assistant-1',
        assistantName: 'Assistant',
        config: { domain: 'example.com', storage: { bucket: 'bucket', region: 'us-east-1' } },
        basePath: dir,
      });

      storedObjects.push(
        { key: 'inbox/assistant-1/email-1', body: Buffer.from('raw1') },
        { key: 'inbox/assistant-1/email-2', body: Buffer.from('raw2') }
      );

      emailsById.set('email-1', buildEmail({ to: [{ address: assistantEmail }] }));
      emailsById.set('email-2', buildEmail({
        id: 'email-2',
        messageId: 'message-2',
        to: [{ address: 'other@example.com' }],
      }));

      const count = await manager.fetch({ limit: 5 });
      expect(count).toBe(1);

      const list = await manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('email-1');
    });
  });

  test('downloads attachments and caches file', async () => {
    await withTempDir(async (dir) => {
      const manager = new InboxManager({
        assistantId: 'assistant-1',
        assistantName: 'Assistant',
        config: { domain: 'example.com', storage: { bucket: 'bucket', region: 'us-east-1' } },
        basePath: dir,
      });

      storedObjects.push({ key: 'inbox/assistant-1/email-1', body: Buffer.from('raw1') });
      emailsById.set('email-1', buildEmail());

      await manager.fetch({ limit: 5 });
      const localPath = await manager.downloadAttachment('email-1', 0);

      expect(localPath).toBeTruthy();
      const content = await readFile(localPath!, 'utf-8');
      expect(content).toBe('attachment-content');
    });
  });

  test('sends and replies using provider', async () => {
    await withTempDir(async (dir) => {
      const manager = new InboxManager({
        assistantId: 'assistant-1',
        assistantName: 'Assistant',
        config: { domain: 'example.com', storage: { bucket: 'bucket', region: 'us-east-1' } },
        basePath: dir,
      });

      await manager.send({ to: 'someone@example.com', subject: 'Hi', text: 'Body' });
      expect(lastSendOptions?.from).toContain('@example.com');

      storedObjects.push({ key: 'inbox/assistant-1/email-1', body: Buffer.from('raw1') });
      emailsById.set('email-1', buildEmail({
        headers: { 'reply-to': 'reply@example.com' },
      }));

      await manager.fetch({ limit: 5 });
      await manager.reply('email-1', { text: 'Reply' });

      expect(lastSendOptions?.to).toBe('reply@example.com');
      expect(lastSendOptions?.subject).toContain('Re:');
    });
  });
});
