/**
 * Session persistence store
 *
 * Persists session metadata to SQLite for recovery across restarts.
 * Storage: persisted_sessions table in ~/.assistants/assistants.db
 */

import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';

/**
 * Persisted session data
 */
export interface PersistedSessionData {
  id: string;
  cwd: string;
  startedAt: number;
  updatedAt: number;
  assistantId: string | null;
  label: string | null;
  status: 'active' | 'background' | 'closed';
}

interface SessionRow {
  id: string;
  cwd: string;
  started_at: number;
  updated_at: number;
  assistant_id: string | null;
  label: string | null;
  status: string;
}

function rowToSession(row: SessionRow): PersistedSessionData {
  return {
    id: row.id,
    cwd: row.cwd,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    assistantId: row.assistant_id,
    label: row.label,
    status: row.status as PersistedSessionData['status'],
  };
}

/**
 * SessionStore - persists session metadata to SQLite
 */
export class SessionStore {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  /**
   * Save session data
   */
  save(data: PersistedSessionData): void {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO persisted_sessions (id, cwd, started_at, updated_at, assistant_id, label, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(data.id, data.cwd, data.startedAt, data.updatedAt, data.assistantId, data.label, data.status);
    } catch {
      // Non-critical - session persistence is best-effort
    }
  }

  /**
   * Load a single session
   */
  load(id: string): PersistedSessionData | null {
    try {
      const row = this.db
        .query<SessionRow>('SELECT * FROM persisted_sessions WHERE id = ?')
        .get(id);
      return row ? rowToSession(row) : null;
    } catch {
      return null;
    }
  }

  /**
   * List all persisted sessions
   */
  list(): PersistedSessionData[] {
    try {
      const rows = this.db
        .query<SessionRow>('SELECT * FROM persisted_sessions ORDER BY updated_at DESC')
        .all();
      return rows.map(rowToSession);
    } catch {
      return [];
    }
  }

  /**
   * Delete a session
   */
  delete(id: string): void {
    try {
      this.db.prepare('DELETE FROM persisted_sessions WHERE id = ?').run(id);
    } catch {
      // Non-critical
    }
  }

  /**
   * List sessions that were active (not closed) - for recovery
   */
  listRecoverable(): PersistedSessionData[] {
    try {
      const rows = this.db
        .query<SessionRow>(`SELECT * FROM persisted_sessions WHERE status != 'closed' ORDER BY updated_at DESC`)
        .all();
      return rows.map(rowToSession);
    } catch {
      return [];
    }
  }

  /**
   * Mark all sessions as closed (e.g., on clean shutdown)
   */
  closeAll(): void {
    try {
      this.db
        .prepare('UPDATE persisted_sessions SET status = ?, updated_at = ?')
        .run('closed', Date.now());
    } catch {
      // Non-critical
    }
  }
}
