import { join, basename } from 'path';
import { mkdir, readFile, writeFile, rm, readdir, stat } from 'fs/promises';
import { createHash } from 'crypto';
import type { Email, EmailListItem } from '@hasna/assistants-shared';
import { getDatabase } from '../../database';
import type { DatabaseConnection } from '../../database';

const STRICT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SAFE_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isValidAssistantId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && STRICT_ID_PATTERN.test(id);
}

function validateAssistantId(id: string): void {
  if (!isValidAssistantId(id)) {
    throw new Error(
      `Invalid assistantId: "${id}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
    );
  }
}

function emailIdToFilename(emailId: string): string {
  if (SAFE_FILENAME_PATTERN.test(emailId) && emailId.length <= 100) {
    return emailId;
  }

  const hash = createHash('sha256').update(emailId).digest('base64url').slice(0, 16);

  const readable = emailId
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 20);

  return readable ? `${readable}_${hash}` : hash;
}

function isValidMappedFilename(filename: string): boolean {
  return typeof filename === 'string' && filename.length > 0 && SAFE_FILENAME_PATTERN.test(filename);
}

function sanitizeFilename(filename: string): string {
  const base = basename(filename);
  return base.replace(/[/\\]/g, '_');
}

export interface LocalInboxCacheOptions {
  assistantId: string;
  basePath: string;
  db?: DatabaseConnection;
}

export interface CacheIndex {
  emails: CachedEmailEntry[];
  lastSync?: string;
}

export interface CachedEmailEntry {
  id: string;
  filename: string;
  messageId: string;
  from: string;
  subject: string;
  date: string;
  hasAttachments: boolean;
  isRead: boolean;
  cachedAt: string;
}

interface InboxCacheRow {
  id: string;
  assistant_id: string;
  filename: string;
  message_id: string;
  from_address: string;
  subject: string;
  date: string;
  has_attachments: number;
  is_read: number;
  cached_at: string;
}

interface InboxSyncRow {
  assistant_id: string;
  last_sync: string | null;
}

function getDb(injected?: DatabaseConnection): DatabaseConnection {
  if (injected) return injected;
  return getDatabase();
}

export class LocalInboxCache {
  private assistantId: string;
  private basePath: string;
  private cacheDir: string;
  private injectedDb?: DatabaseConnection;

  constructor(options: LocalInboxCacheOptions) {
    validateAssistantId(options.assistantId);
    this.assistantId = options.assistantId;
    this.basePath = options.basePath;
    this.cacheDir = join(this.basePath, this.assistantId);
    this.injectedDb = options.db;
  }

  private db(): DatabaseConnection {
    return getDb(this.injectedDb);
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(join(this.cacheDir, 'emails'), { recursive: true });
    await mkdir(join(this.cacheDir, 'attachments'), { recursive: true });
  }

  async loadIndex(): Promise<CacheIndex> {
    const rows = this.db().query<InboxCacheRow>(
      'SELECT * FROM inbox_cache WHERE assistant_id = ? ORDER BY date DESC'
    ).all(this.assistantId);

    const emails: CachedEmailEntry[] = rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      messageId: row.message_id,
      from: row.from_address,
      subject: row.subject,
      date: row.date,
      hasAttachments: row.has_attachments === 1,
      isRead: row.is_read === 1,
      cachedAt: row.cached_at,
    }));

    const syncRow = this.db().query<InboxSyncRow>(
      'SELECT * FROM inbox_sync WHERE assistant_id = ?'
    ).get(this.assistantId);

    return {
      emails,
      lastSync: syncRow?.last_sync ?? undefined,
    };
  }

  async saveIndex(): Promise<void> {
    // No-op: individual operations write directly to SQLite
  }

  async saveEmail(email: Email): Promise<void> {
    const filename = emailIdToFilename(email.id);
    if (!isValidMappedFilename(filename)) {
      throw new Error(`Failed to create safe filename for email ID: "${email.id}"`);
    }

    await this.ensureDirectories();

    // Save email JSON on disk
    const emailPath = join(this.cacheDir, 'emails', `${filename}.json`);
    await writeFile(emailPath, JSON.stringify(email, null, 2));

    // Check if existing entry
    const existing = this.db().query<InboxCacheRow>(
      'SELECT * FROM inbox_cache WHERE id = ? AND assistant_id = ?'
    ).get(email.id, this.assistantId);

    if (existing) {
      // Preserve read status and existing filename
      const useFilename = existing.filename || filename;
      this.db().prepare(
        'UPDATE inbox_cache SET filename = ?, message_id = ?, from_address = ?, subject = ?, date = ?, has_attachments = ?, cached_at = ? WHERE id = ? AND assistant_id = ?'
      ).run(
        useFilename,
        email.messageId,
        email.from.name || email.from.address,
        email.subject,
        email.date,
        (email.attachments?.length || 0) > 0 ? 1 : 0,
        new Date().toISOString(),
        email.id,
        this.assistantId
      );
    } else {
      this.db().prepare(
        `INSERT INTO inbox_cache (id, assistant_id, filename, message_id, from_address, subject, date, has_attachments, is_read, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).run(
        email.id,
        this.assistantId,
        filename,
        email.messageId,
        email.from.name || email.from.address,
        email.subject,
        email.date,
        (email.attachments?.length || 0) > 0 ? 1 : 0,
        new Date().toISOString()
      );
    }
  }

  async loadEmail(id: string): Promise<Email | null> {
    const row = this.db().query<InboxCacheRow>(
      'SELECT * FROM inbox_cache WHERE id = ? AND assistant_id = ?'
    ).get(id, this.assistantId);

    if (!row) return null;

    const filename = row.filename || emailIdToFilename(id);
    if (!isValidMappedFilename(filename)) return null;

    try {
      const emailPath = join(this.cacheDir, 'emails', `${filename}.json`);
      const content = await readFile(emailPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async listEmails(options?: {
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<EmailListItem[]> {
    let sql = 'SELECT * FROM inbox_cache WHERE assistant_id = ?';
    const params: unknown[] = [this.assistantId];

    if (options?.unreadOnly) {
      sql += ' AND is_read = 0';
    }

    sql += ' ORDER BY date DESC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db().query<InboxCacheRow>(sql).all(...params);

    return rows.map((row) => ({
      id: row.id,
      messageId: row.message_id,
      from: row.from_address,
      subject: row.subject,
      date: row.date,
      hasAttachments: row.has_attachments === 1,
      isRead: row.is_read === 1,
    }));
  }

  async markRead(id: string): Promise<void> {
    this.db().prepare(
      'UPDATE inbox_cache SET is_read = 1 WHERE id = ? AND assistant_id = ?'
    ).run(id, this.assistantId);
  }

  async markUnread(id: string): Promise<void> {
    this.db().prepare(
      'UPDATE inbox_cache SET is_read = 0 WHERE id = ? AND assistant_id = ?'
    ).run(id, this.assistantId);
  }

  async hasCachedEmail(id: string): Promise<boolean> {
    const row = this.db().query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM inbox_cache WHERE id = ? AND assistant_id = ?'
    ).get(id, this.assistantId);
    return (row?.cnt ?? 0) > 0;
  }

  async getCachedIds(): Promise<Set<string>> {
    const rows = this.db().query<{ id: string }>(
      'SELECT id FROM inbox_cache WHERE assistant_id = ?'
    ).all(this.assistantId);
    return new Set(rows.map((r) => r.id));
  }

  async saveAttachment(
    emailId: string,
    filename: string,
    content: Buffer
  ): Promise<string> {
    const emailFilename = emailIdToFilename(emailId);
    if (!isValidMappedFilename(emailFilename)) {
      throw new Error(`Failed to create safe directory name for email ID: "${emailId}"`);
    }

    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      throw new Error('Invalid attachment filename');
    }

    const attachmentDir = join(this.cacheDir, 'attachments', emailFilename);
    await mkdir(attachmentDir, { recursive: true });

    const attachmentPath = join(attachmentDir, safeFilename);
    await writeFile(attachmentPath, content);

    return attachmentPath;
  }

  async getAttachmentPath(emailId: string, filename: string): Promise<string | null> {
    const emailFilename = emailIdToFilename(emailId);
    if (!isValidMappedFilename(emailFilename)) {
      return null;
    }

    const safeFilename = sanitizeFilename(filename);
    if (!safeFilename) {
      return null;
    }

    try {
      const attachmentPath = join(this.cacheDir, 'attachments', emailFilename, safeFilename);
      await stat(attachmentPath);
      return attachmentPath;
    } catch {
      return null;
    }
  }

  async updateLastSync(): Promise<void> {
    const now = new Date().toISOString();
    this.db().prepare(
      'INSERT OR REPLACE INTO inbox_sync (assistant_id, last_sync) VALUES (?, ?)'
    ).run(this.assistantId, now);
  }

  async getLastSync(): Promise<string | null> {
    const row = this.db().query<InboxSyncRow>(
      'SELECT * FROM inbox_sync WHERE assistant_id = ?'
    ).get(this.assistantId);
    return row?.last_sync ?? null;
  }

  async cleanup(maxAgeDays: number = 30): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffISO = new Date(cutoff).toISOString();

    const rows = this.db().query<InboxCacheRow>(
      'SELECT * FROM inbox_cache WHERE assistant_id = ? AND cached_at < ?'
    ).all(this.assistantId, cutoffISO);

    for (const row of rows) {
      const filename = row.filename || emailIdToFilename(row.id);
      if (isValidMappedFilename(filename)) {
        try {
          await rm(join(this.cacheDir, 'emails', `${filename}.json`));
        } catch {
          // Ignore
        }
        try {
          await rm(join(this.cacheDir, 'attachments', filename), { recursive: true });
        } catch {
          // Ignore
        }
      }
    }

    if (rows.length > 0) {
      this.db().prepare(
        'DELETE FROM inbox_cache WHERE assistant_id = ? AND cached_at < ?'
      ).run(this.assistantId, cutoffISO);
    }

    return rows.length;
  }

  async getCacheSize(): Promise<number> {
    let totalSize = 0;

    try {
      const emailsDir = join(this.cacheDir, 'emails');
      const files = await readdir(emailsDir);
      for (const file of files) {
        const fileStat = await stat(join(emailsDir, file));
        totalSize += fileStat.size;
      }
    } catch {
      // Directory may not exist
    }

    try {
      const attachmentsDir = join(this.cacheDir, 'attachments');
      const dirs = await readdir(attachmentsDir);
      for (const dir of dirs) {
        const files = await readdir(join(attachmentsDir, dir));
        for (const file of files) {
          const fileStat = await stat(join(attachmentsDir, dir, file));
          totalSize += fileStat.size;
        }
      }
    } catch {
      // Directory may not exist
    }

    return totalSize;
  }

  async clear(): Promise<void> {
    try {
      await rm(this.cacheDir, { recursive: true });
    } catch {
      // Ignore
    }
    this.db().prepare(
      'DELETE FROM inbox_cache WHERE assistant_id = ?'
    ).run(this.assistantId);
    this.db().prepare(
      'DELETE FROM inbox_sync WHERE assistant_id = ?'
    ).run(this.assistantId);
  }
}

export const __test__ = {
  emailIdToFilename,
  isValidMappedFilename,
  isValidAssistantId,
  sanitizeFilename,
};
