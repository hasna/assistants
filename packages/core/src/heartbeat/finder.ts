import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { Heartbeat, PersistedState } from './types';

/**
 * Information about a session that can be recovered
 */
export interface RecoverableSession {
  sessionId: string;
  heartbeat: Heartbeat;
  state: PersistedState;
  sessionPath: string;
  cwd: string;
  lastActivity: Date;
  messageCount: number;
}

/**
 * Find sessions that crashed or were terminated unexpectedly and can be recovered.
 */
export function findRecoverableSessions(
  staleThresholdMs = 120000,
  maxAgeMs = 24 * 60 * 60 * 1000,
  baseDir?: string
): RecoverableSession[] {
  const recoverableSessions: RecoverableSession[] = [];

  let db: DatabaseConnection;
  try {
    db = getDatabase();
  } catch {
    return recoverableSessions;
  }

  const now = Date.now();
  const cutoffIso = new Date(now - maxAgeMs).toISOString();

  // Query heartbeat_state table for stale sessions
  const rows = db
    .query<{ session_id: string; heartbeat: string; context: string; timestamp: string }>(
      'SELECT session_id, heartbeat, context, timestamp FROM heartbeat_state WHERE timestamp > ?'
    )
    .all(cutoffIso);

  for (const row of rows) {
    try {
      const heartbeat = JSON.parse(row.heartbeat) as Heartbeat;
      const context = JSON.parse(row.context) as { cwd: string; lastMessage?: string; lastTool?: string };
      const heartbeatAge = now - new Date(heartbeat.timestamp).getTime();

      // Skip if heartbeat is recent (session is still active)
      if (heartbeatAge < staleThresholdMs) {
        continue;
      }

      const state: PersistedState = {
        sessionId: row.session_id,
        heartbeat,
        context,
        timestamp: row.timestamp,
      };

      // Try to get message count from persisted_sessions
      let messageCount = 0;
      const cwd = context.cwd || process.cwd();

      recoverableSessions.push({
        sessionId: row.session_id,
        heartbeat,
        state,
        sessionPath: '',
        cwd,
        lastActivity: new Date(heartbeat.lastActivity || heartbeat.timestamp),
        messageCount,
      });
    } catch {
      continue;
    }
  }

  recoverableSessions.sort(
    (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
  );

  return recoverableSessions;
}

/**
 * Clean up heartbeat state for a recovered or discarded session
 */
export function clearRecoveryState(sessionId: string, baseDir?: string): void {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM heartbeat_state WHERE session_id = ?').run(sessionId);
  } catch {
    // Ignore
  }
}
