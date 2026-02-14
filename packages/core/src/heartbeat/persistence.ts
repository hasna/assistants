import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { PersistedState } from './types';

interface HeartbeatRow {
  session_id: string;
  heartbeat: string;
  context: string;
  timestamp: string;
}

export class StatePersistence {
  private sessionId: string;
  private db: DatabaseConnection;

  constructor(sessionId: string, db?: DatabaseConnection) {
    this.sessionId = sessionId;
    this.db = db || getDatabase();
  }

  async save(state: PersistedState): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO heartbeat_state (session_id, heartbeat, context, timestamp)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          this.sessionId,
          JSON.stringify(state.heartbeat),
          JSON.stringify(state.context),
          state.timestamp
        );
    } catch {
      // ignore persistence errors
    }
  }

  async load(): Promise<PersistedState | null> {
    try {
      const row = this.db
        .query<HeartbeatRow>('SELECT * FROM heartbeat_state WHERE session_id = ?')
        .get(this.sessionId);
      if (!row) return null;
      return {
        sessionId: row.session_id,
        heartbeat: JSON.parse(row.heartbeat),
        context: JSON.parse(row.context),
        timestamp: row.timestamp,
      };
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      this.db.prepare('DELETE FROM heartbeat_state WHERE session_id = ?').run(this.sessionId);
    } catch {
      // ignore missing row
    }
  }
}
