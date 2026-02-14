import { getDatabase } from '../../database';
import type { DatabaseConnection } from '../../database';
import type {
  AssistantMessage,
  AssistantRegistry,
  AssistantRegistryEntry,
  InboxIndex,
  MessageListItem,
  MessageThread,
} from '../types';

export interface LocalStorageOptions {
  db?: DatabaseConnection;
}

export function getMessagesBasePath(): string {
  return ''; // No longer needed - storage is in SQLite
}

function getDb(injected?: DatabaseConnection): DatabaseConnection {
  if (injected) return injected;
  return getDatabase();
}

interface RegistryRow {
  id: string;
  name: string;
  last_seen: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  parent_id: string | null;
  from_assistant_id: string;
  from_assistant_name: string;
  to_assistant_id: string;
  to_assistant_name: string;
  subject: string | null;
  body: string;
  priority: string;
  status: string;
  created_at: string;
  read_at: string | null;
  injected_at: string | null;
}

interface ThreadRow {
  thread_id: string;
  subject: string | null;
  participants: string;
  message_count: number;
  unread_count: number;
  last_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMessage(row: MessageRow): AssistantMessage {
  const msg: AssistantMessage = {
    id: row.id,
    threadId: row.thread_id,
    parentId: row.parent_id,
    fromAssistantId: row.from_assistant_id,
    fromAssistantName: row.from_assistant_name,
    toAssistantId: row.to_assistant_id,
    toAssistantName: row.to_assistant_name,
    body: row.body,
    priority: row.priority as AssistantMessage['priority'],
    status: row.status as AssistantMessage['status'],
    createdAt: row.created_at,
  };
  if (row.subject) msg.subject = row.subject;
  if (row.read_at) msg.readAt = row.read_at;
  if (row.injected_at) msg.injectedAt = row.injected_at;
  return msg;
}

function messageToListItem(msg: AssistantMessage, replyCount: number): MessageListItem {
  return {
    id: msg.id,
    threadId: msg.threadId,
    parentId: msg.parentId,
    fromAssistantId: msg.fromAssistantId,
    fromAssistantName: msg.fromAssistantName,
    subject: msg.subject,
    preview: msg.body.slice(0, 100) + (msg.body.length > 100 ? '...' : ''),
    priority: msg.priority,
    status: msg.status,
    createdAt: msg.createdAt,
    replyCount,
  };
}

export class LocalMessagesStorage {
  private injectedDb?: DatabaseConnection;

  constructor(options: LocalStorageOptions = {}) {
    this.injectedDb = options.db;
  }

  private db(): DatabaseConnection {
    return getDb(this.injectedDb);
  }

  async ensureDirectories(_assistantId: string): Promise<void> {
    // No-op: tables are created by schema initialization
  }

  // ============================================
  // Assistant Registry Operations
  // ============================================

  async loadRegistry(): Promise<AssistantRegistry> {
    const rows = this.db().query<RegistryRow>(
      'SELECT * FROM assistant_registry'
    ).all();
    const assistants: Record<string, AssistantRegistryEntry> = {};
    for (const row of rows) {
      assistants[row.id] = { name: row.name, lastSeen: row.last_seen };
    }
    return { assistants };
  }

  async saveRegistry(registry: AssistantRegistry): Promise<void> {
    const d = this.db();
    d.transaction(() => {
      d.exec('DELETE FROM assistant_registry');
      const stmt = d.prepare(
        'INSERT INTO assistant_registry (id, name, last_seen) VALUES (?, ?, ?)'
      );
      for (const [id, entry] of Object.entries(registry.assistants)) {
        stmt.run(id, entry.name, entry.lastSeen);
      }
    });
  }

  async registerAssistant(assistantId: string, name: string): Promise<void> {
    this.db().prepare(
      'INSERT OR REPLACE INTO assistant_registry (id, name, last_seen) VALUES (?, ?, ?)'
    ).run(assistantId, name, new Date().toISOString());
  }

  async getAssistantById(assistantId: string): Promise<AssistantRegistryEntry | null> {
    const row = this.db().query<RegistryRow>(
      'SELECT * FROM assistant_registry WHERE id = ?'
    ).get(assistantId);
    if (!row) return null;
    return { name: row.name, lastSeen: row.last_seen };
  }

  async findAssistantByName(name: string): Promise<{ id: string; entry: AssistantRegistryEntry } | null> {
    const rows = this.db().query<RegistryRow>(
      'SELECT * FROM assistant_registry'
    ).all();

    const lowerName = name.toLowerCase();
    for (const row of rows) {
      if (row.name.toLowerCase() === lowerName) {
        return { id: row.id, entry: { name: row.name, lastSeen: row.last_seen } };
      }
    }

    return null;
  }

  async listAssistants(): Promise<Array<{ id: string; name: string; lastSeen: string }>> {
    const rows = this.db().query<RegistryRow>(
      'SELECT * FROM assistant_registry'
    ).all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      lastSeen: row.last_seen,
    }));
  }

  // ============================================
  // Inbox Index Operations
  // ============================================

  async loadIndex(assistantId: string): Promise<InboxIndex> {
    const rows = this.db().query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE to_assistant_id = ? ORDER BY created_at DESC'
    ).all(assistantId);

    const messages: MessageListItem[] = rows.map((row) => {
      const msg = rowToMessage(row);
      const replyCount = this.db().query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM assistant_messages WHERE parent_id = ?'
      ).get(row.id)?.cnt ?? 0;
      return messageToListItem(msg, replyCount);
    });

    const threadIds = new Set(messages.map((m) => m.threadId));
    let unreadCount = 0;
    for (const msg of messages) {
      if (msg.status === 'unread' || msg.status === 'injected') {
        unreadCount++;
      }
    }

    return {
      messages,
      lastCheck: new Date().toISOString(),
      stats: {
        totalMessages: messages.length,
        unreadCount,
        threadCount: threadIds.size,
      },
    };
  }

  async saveIndex(_assistantId: string, _index: InboxIndex): Promise<void> {
    // No-op: index is computed from the messages table
  }

  // ============================================
  // Message Operations
  // ============================================

  async saveMessage(message: AssistantMessage): Promise<void> {
    const d = this.db();
    d.transaction(() => {
      d.prepare(
        `INSERT OR REPLACE INTO assistant_messages (id, thread_id, parent_id, from_assistant_id, from_assistant_name, to_assistant_id, to_assistant_name, subject, body, priority, status, created_at, read_at, injected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        message.id,
        message.threadId,
        message.parentId,
        message.fromAssistantId,
        message.fromAssistantName,
        message.toAssistantId,
        message.toAssistantName,
        message.subject ?? null,
        message.body,
        message.priority,
        message.status,
        message.createdAt,
        message.readAt ?? null,
        message.injectedAt ?? null
      );

      // Update thread metadata
      this.upsertThread(d, message);
    });
  }

  async loadMessage(assistantId: string, messageId: string): Promise<AssistantMessage | null> {
    const row = this.db().query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE to_assistant_id = ? AND id = ?'
    ).get(assistantId, messageId);
    if (!row) return null;
    return rowToMessage(row);
  }

  async updateMessageStatus(
    assistantId: string,
    messageId: string,
    status: AssistantMessage['status'],
    timestamp?: string
  ): Promise<void> {
    const setClauses = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'read' && timestamp) {
      setClauses.push('read_at = ?');
      params.push(timestamp);
    } else if (status === 'injected' && timestamp) {
      setClauses.push('injected_at = ?');
      params.push(timestamp);
    }

    params.push(assistantId, messageId);
    this.db().prepare(
      `UPDATE assistant_messages SET ${setClauses.join(', ')} WHERE to_assistant_id = ? AND id = ?`
    ).run(...params);

    // Update thread unread count
    const row = this.db().query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE to_assistant_id = ? AND id = ?'
    ).get(assistantId, messageId);
    if (row) {
      this.refreshThreadCounts(this.db(), row.thread_id, assistantId);
    }
  }

  async deleteMessage(assistantId: string, messageId: string): Promise<boolean> {
    const row = this.db().query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE to_assistant_id = ? AND id = ?'
    ).get(assistantId, messageId);
    if (!row) return false;

    const d = this.db();
    d.transaction(() => {
      d.prepare(
        'DELETE FROM assistant_messages WHERE to_assistant_id = ? AND id = ?'
      ).run(assistantId, messageId);

      // Refresh thread
      const remaining = d.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM assistant_messages WHERE thread_id = ? AND to_assistant_id = ?'
      ).get(row.thread_id, assistantId);

      if (!remaining || remaining.cnt === 0) {
        d.prepare('DELETE FROM assistant_message_threads WHERE thread_id = ?').run(row.thread_id);
      } else {
        this.refreshThreadCounts(d, row.thread_id, assistantId);
      }
    });

    return true;
  }

  async listMessages(
    assistantId: string,
    options?: {
      limit?: number;
      unreadOnly?: boolean;
      threadId?: string;
      fromAssistantId?: string;
    }
  ): Promise<MessageListItem[]> {
    let sql = 'SELECT * FROM assistant_messages WHERE to_assistant_id = ?';
    const params: unknown[] = [assistantId];

    if (options?.unreadOnly) {
      sql += " AND (status = 'unread' OR status = 'injected')";
    }
    if (options?.threadId) {
      sql += ' AND thread_id = ?';
      params.push(options.threadId);
    }
    if (options?.fromAssistantId) {
      sql += ' AND from_assistant_id = ?';
      params.push(options.fromAssistantId);
    }

    sql += ' ORDER BY created_at DESC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db().query<MessageRow>(sql).all(...params);
    return rows.map((row) => {
      const msg = rowToMessage(row);
      const replyCount = this.db().query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM assistant_messages WHERE parent_id = ?'
      ).get(row.id)?.cnt ?? 0;
      return messageToListItem(msg, replyCount);
    });
  }

  // ============================================
  // Thread Operations
  // ============================================

  async loadThread(assistantId: string, threadId: string): Promise<MessageThread | null> {
    const row = this.db().query<ThreadRow>(
      'SELECT * FROM assistant_message_threads WHERE thread_id = ?'
    ).get(threadId);
    if (!row) return null;
    return this.rowToThread(row);
  }

  async listThreads(assistantId: string): Promise<MessageThread[]> {
    // Get distinct thread IDs for this assistant
    const threadIds = this.db().query<{ thread_id: string }>(
      'SELECT DISTINCT thread_id FROM assistant_messages WHERE to_assistant_id = ?'
    ).all(assistantId);

    const threads: MessageThread[] = [];
    for (const { thread_id } of threadIds) {
      const row = this.db().query<ThreadRow>(
        'SELECT * FROM assistant_message_threads WHERE thread_id = ?'
      ).get(thread_id);
      if (row) {
        threads.push(this.rowToThread(row));
      }
    }

    threads.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return threads;
  }

  async loadThreadMessages(assistantId: string, threadId: string): Promise<AssistantMessage[]> {
    const rows = this.db().query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE to_assistant_id = ? AND thread_id = ? ORDER BY created_at ASC'
    ).all(assistantId, threadId);
    return rows.map(rowToMessage);
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  async cleanup(assistantId: string, maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffISO = cutoffDate.toISOString();

    const result = this.db().prepare(
      'DELETE FROM assistant_messages WHERE to_assistant_id = ? AND created_at < ?'
    ).run(assistantId, cutoffISO);

    return result.changes;
  }

  async enforceMaxMessages(assistantId: string, maxMessages: number): Promise<number> {
    const countRow = this.db().query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM assistant_messages WHERE to_assistant_id = ?'
    ).get(assistantId);

    const total = countRow?.cnt ?? 0;
    if (total <= maxMessages) return 0;

    const toDelete = total - maxMessages;

    this.db().prepare(
      `DELETE FROM assistant_messages WHERE id IN (
        SELECT id FROM assistant_messages WHERE to_assistant_id = ? ORDER BY created_at ASC LIMIT ?
      )`
    ).run(assistantId, toDelete);

    return toDelete;
  }

  // ============================================
  // Private helpers
  // ============================================

  private upsertThread(d: DatabaseConnection, message: AssistantMessage): void {
    const existing = d.query<ThreadRow>(
      'SELECT * FROM assistant_message_threads WHERE thread_id = ?'
    ).get(message.threadId);

    if (existing) {
      const participants = JSON.parse(existing.participants) as Array<{ assistantId: string; assistantName: string }>;

      if (!participants.some((p) => p.assistantId === message.fromAssistantId)) {
        participants.push({ assistantId: message.fromAssistantId, assistantName: message.fromAssistantName });
      }
      if (!participants.some((p) => p.assistantId === message.toAssistantId)) {
        participants.push({ assistantId: message.toAssistantId, assistantName: message.toAssistantName });
      }

      const unreadCount = d.query<{ cnt: number }>(
        "SELECT COUNT(*) as cnt FROM assistant_messages WHERE thread_id = ? AND (status = 'unread' OR status = 'injected')"
      ).get(message.threadId)?.cnt ?? 0;

      const messageCount = d.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM assistant_messages WHERE thread_id = ?'
      ).get(message.threadId)?.cnt ?? 0;

      d.prepare(
        'UPDATE assistant_message_threads SET participants = ?, message_count = ?, unread_count = ?, last_message_id = ?, updated_at = ?, subject = COALESCE(?, subject) WHERE thread_id = ?'
      ).run(
        JSON.stringify(participants),
        messageCount,
        unreadCount,
        message.id,
        message.createdAt,
        message.subject ?? null,
        message.threadId
      );
    } else {
      const participants = [
        { assistantId: message.fromAssistantId, assistantName: message.fromAssistantName },
        { assistantId: message.toAssistantId, assistantName: message.toAssistantName },
      ];

      d.prepare(
        `INSERT INTO assistant_message_threads (thread_id, subject, participants, message_count, unread_count, last_message_id, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        message.threadId,
        message.subject ?? null,
        JSON.stringify(participants),
        (message.status === 'unread' || message.status === 'injected') ? 1 : 0,
        message.id,
        message.createdAt,
        message.createdAt
      );
    }
  }

  private refreshThreadCounts(d: DatabaseConnection, threadId: string, assistantId: string): void {
    const messageCount = d.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM assistant_messages WHERE thread_id = ?'
    ).get(threadId)?.cnt ?? 0;

    const unreadCount = d.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM assistant_messages WHERE thread_id = ? AND (status = 'unread' OR status = 'injected')"
    ).get(threadId)?.cnt ?? 0;

    const lastMsg = d.query<MessageRow>(
      'SELECT * FROM assistant_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(threadId);

    if (lastMsg) {
      d.prepare(
        'UPDATE assistant_message_threads SET message_count = ?, unread_count = ?, last_message_id = ?, updated_at = ? WHERE thread_id = ?'
      ).run(messageCount, unreadCount, lastMsg.id, lastMsg.created_at, threadId);
    }
  }

  private rowToThread(row: ThreadRow): MessageThread {
    const participants = JSON.parse(row.participants) as Array<{ assistantId: string; assistantName: string }>;

    let lastMessage: MessageListItem;
    if (row.last_message_id) {
      const msgRow = this.db().query<MessageRow>(
        'SELECT * FROM assistant_messages WHERE id = ?'
      ).get(row.last_message_id);
      if (msgRow) {
        const msg = rowToMessage(msgRow);
        lastMessage = messageToListItem(msg, 0);
      } else {
        lastMessage = {} as MessageListItem;
      }
    } else {
      lastMessage = {} as MessageListItem;
    }

    return {
      threadId: row.thread_id,
      subject: row.subject ?? undefined,
      participants,
      messageCount: row.message_count,
      unreadCount: row.unread_count,
      lastMessage,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
