import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';

/**
 * Memory store - SQLite-based persistent storage
 */
export class MemoryStore {
  private db: DatabaseConnection;
  private assistantId: string | null;

  constructor(db?: DatabaseConnection, assistantId?: string | null) {
    this.db = db || getDatabase();
    this.assistantId = assistantId || null;
  }

  /**
   * Store a key-value pair
   */
  set(key: string, value: unknown, ttlMs?: number): void {
    const now = Date.now();
    const ttl = typeof ttlMs === 'number' && ttlMs > 0 ? ttlMs : undefined;
    const expiresAt = ttl ? now + ttl : null;
    const valueStr = JSON.stringify(value) ?? 'null';

    // Use DELETE + INSERT to handle NULL assistant_id (NULL != NULL in SQL,
    // so INSERT OR REPLACE won't detect duplicates when assistant_id is NULL)
    this.db.transaction(() => {
      this.db.prepare(
        `DELETE FROM memory WHERE key = ? AND (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`
      ).run(key, this.assistantId, this.assistantId);
      this.db.prepare(
        `INSERT INTO memory (key, assistant_id, value, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(key, this.assistantId, valueStr, now, now, expiresAt);
    });
  }

  /**
   * Get a value by key
   */
  get<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string; expires_at: number | null }>(
        `SELECT value, expires_at FROM memory WHERE key = ? AND (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`
      )
      .get(key, this.assistantId, this.assistantId);

    if (!row) return null;

    // Check expiration
    if (row.expires_at && row.expires_at < Date.now()) {
      this.delete(key);
      return null;
    }

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Delete a key
   */
  delete(key: string): void {
    this.db.prepare(`DELETE FROM memory WHERE key = ? AND (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`).run(key, this.assistantId, this.assistantId);
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get all keys matching a pattern
   */
  keys(pattern?: string): string[] {
    if (pattern) {
      const rows = this.db.query<{ key: string }>(
        `SELECT key FROM memory WHERE key LIKE ? AND (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`
      ).all(pattern.replace(/\*/g, '%'), this.assistantId, this.assistantId);
      return rows.map((r) => r.key);
    }

    const rows = this.db.query<{ key: string }>(
      `SELECT key FROM memory WHERE (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`
    ).all(this.assistantId, this.assistantId);
    return rows.map((r) => r.key);
  }

  /**
   * Clear all expired entries
   */
  clearExpired(): number {
    const result = this.db.prepare(
      `DELETE FROM memory WHERE expires_at IS NOT NULL AND expires_at < ? AND (assistant_id = ? OR (assistant_id IS NULL AND ? IS NULL))`
    ).run(Date.now(), this.assistantId, this.assistantId);
    return result.changes;
  }

  /**
   * Close the database connection
   */
  close(): void { }
}
