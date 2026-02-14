import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { getConfigDir } from '../config';
import { getRuntime } from '../runtime';
import type { DatabaseConnection } from '../runtime';
import type { Session, Message } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';

/**
 * Session manager - handles conversation session persistence
 */
export class SessionManager {
  private db: DatabaseConnection;

  constructor(dbPath?: string, assistantId?: string | null) {
    const baseDir = getConfigDir();
    const path = dbPath || (assistantId
      ? join(baseDir, 'assistants', assistantId, 'memory.db')
      : join(baseDir, 'memory.db'));
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const runtime = getRuntime();
    this.db = runtime.openDatabase(path);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool_calls TEXT,
        tool_results TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)
    `);
  }

  /**
   * Create a new session
   */
  create(metadata?: Record<string, unknown>): Session {
    const session: Session = {
      id: generateId(),
      createdAt: now(),
      updatedAt: now(),
      messages: [],
      metadata,
    };

    const metadataJson = safeJsonStringify(metadata || {}) ?? '{}';
    this.db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?)`
    ).run(session.id, session.createdAt, session.updatedAt, metadataJson);

    return session;
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): Session | null {
    const sessionRow = this.db
      .query<{ id: string; created_at: number; updated_at: number; metadata: string }>(
        `SELECT * FROM sessions WHERE id = ?`
      )
      .get(sessionId);

    if (!sessionRow) return null;

    const messageRows = this.db
      .query<{
        id: string;
        role: string;
        content: string;
        timestamp: number;
        tool_calls: string | null;
        tool_results: string | null;
      }>(`SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp`)
      .all(sessionId);

    const messages: Message[] = messageRows.map((row) => ({
      id: row.id,
      role: row.role as Message['role'],
      content: row.content ?? '',
      timestamp: row.timestamp,
      toolCalls: row.tool_calls ? safeJsonParse(row.tool_calls, undefined) : undefined,
      toolResults: row.tool_results ? safeJsonParse(row.tool_results, undefined) : undefined,
    }));

    return {
      id: sessionRow.id,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
      messages,
      metadata: safeJsonParse(sessionRow.metadata || '{}', {}),
    };
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: string, message: Message): void {
    this.db.prepare(
      `INSERT INTO messages (id, session_id, role, content, timestamp, tool_calls, tool_results)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      message.id,
      sessionId,
      message.role,
      message.content,
      message.timestamp,
      message.toolCalls ? (safeJsonStringify(message.toolCalls) ?? null) : null,
      message.toolResults ? (safeJsonStringify(message.toolResults) ?? null) : null
    );

    this.db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now(), sessionId);
  }

  /**
   * List recent sessions
   */
  list(limit: number = 20): Session[] {
    const rows = this.db
      .query<{ id: string; created_at: number; updated_at: number; metadata: string }>(
        `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`
      )
      .all(limit);

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: [],
      metadata: safeJsonParse(row.metadata || '{}', {}),
    }));
  }

  /**
   * Delete a session and its messages
   */
  delete(sessionId: string): void {
    this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  /**
   * Get the most recent session
   */
  getLatest(): Session | null {
    const row = this.db
      .query<{ id: string }>(`SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1`)
      .get();

    return row ? this.get(row.id) : null;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeJsonStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
