import { describe, expect, test } from 'bun:test';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { LocalInboxCache } from '../src/inbox/storage/local-cache';
import type { Email } from '@hasna/assistants-shared';
import { withTempDir } from './fixtures/helpers';
import { createTestDatabase } from './fixtures/test-db';

const createEmail = (overrides?: Partial<Email>): Email => ({
  id: 'email-1',
  messageId: 'msg-1',
  from: { address: 'from@example.com', name: 'From' },
  to: [{ address: 'to@example.com' }],
  subject: 'Hello',
  date: new Date().toISOString(),
  body: { text: 'Hi' },
  headers: {},
  attachments: [{ filename: 'note.txt', contentType: 'text/plain', size: 4 }],
  ...overrides,
});

describe('LocalInboxCache', () => {
  test('saves, lists, and marks emails', async () => {
    await withTempDir(async (dir) => {
      const cache = new LocalInboxCache({ assistantId: 'assistant-1', basePath: dir, db: createTestDatabase() });
      await cache.saveEmail(createEmail());

      const list = await cache.listEmails();
      expect(list).toHaveLength(1);
      expect(list[0].hasAttachments).toBe(true);

      await cache.markRead('email-1');
      const unread = await cache.listEmails({ unreadOnly: true });
      expect(unread).toHaveLength(0);

      await cache.markUnread('email-1');
      const unreadAgain = await cache.listEmails({ unreadOnly: true });
      expect(unreadAgain).toHaveLength(1);
    });
  });

  test('stores attachments and returns path', async () => {
    await withTempDir(async (dir) => {
      const cache = new LocalInboxCache({ assistantId: 'assistant-1', basePath: dir, db: createTestDatabase() });
      const path = await cache.saveAttachment('email-1', 'file.txt', Buffer.from('data'));
      const existing = await cache.getAttachmentPath('email-1', 'file.txt');

      expect(existing).toBe(path);
      const content = await readFile(path, 'utf-8');
      expect(content).toBe('data');
    });
  });

  test('cleanup removes expired emails', async () => {
    await withTempDir(async (dir) => {
      const db = createTestDatabase();
      const cache = new LocalInboxCache({ assistantId: 'assistant-1', basePath: dir, db });
      await cache.saveEmail(createEmail({ id: 'old-email', messageId: 'old-msg' }));

      // Directly update cached_at in the database to simulate an old email
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE inbox_cache SET cached_at = ? WHERE id = ? AND assistant_id = ?')
        .run(oldDate, 'old-email', 'assistant-1');

      const removed = await cache.cleanup(1);
      expect(removed).toBe(1);
      const list = await cache.listEmails();
      expect(list).toHaveLength(0);
    });
  });

  test('getCacheSize accounts for stored files', async () => {
    await withTempDir(async (dir) => {
      const cache = new LocalInboxCache({ assistantId: 'assistant-1', basePath: dir, db: createTestDatabase() });
      await cache.saveEmail(createEmail({ id: 'email-1', messageId: 'msg-1' }));
      await cache.saveAttachment('email-1', 'file.txt', Buffer.from('hello'));

      const size = await cache.getCacheSize();
      expect(size).toBeGreaterThan(0);

      const emailPath = join(dir, 'assistant-1', 'emails', 'email-1.json');
      const emailJson = await readFile(emailPath, 'utf-8');
      expect(emailJson).toContain('Hello');
    });
  });
});
