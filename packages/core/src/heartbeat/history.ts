import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';
import type { Heartbeat } from './types';

export type HeartbeatHistoryOrder = 'asc' | 'desc';

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface HeartbeatHistoryRow {
  id: number;
  session_id: string;
  status: string;
  energy: number | null;
  context_tokens: number | null;
  action: string | null;
  timestamp: string;
}

function rowToHeartbeat(row: HeartbeatHistoryRow): Heartbeat {
  // Try to parse the action column as full Heartbeat JSON first
  if (row.action) {
    try {
      const parsed = JSON.parse(row.action);
      if (parsed.sessionId) return parsed as Heartbeat;
    } catch {
      // Fall through to column-based reconstruction
    }
  }

  // Reconstruct from columns
  return {
    sessionId: row.session_id,
    timestamp: row.timestamp,
    state: row.status as Heartbeat['state'],
    lastActivity: row.timestamp,
    stats: {
      messagesProcessed: 0,
      toolCallsExecuted: 0,
      errorsEncountered: 0,
      uptimeSeconds: 0,
    },
  };
}

/**
 * Stub: kept for backward compatibility.
 * Returns the legacy path format but history is now in SQLite.
 */
export function resolveHeartbeatPersistPath(
  sessionId: string,
  persistPath?: string,
  _baseDir?: string
): string {
  if (persistPath) {
    if (persistPath.includes('{sessionId}')) {
      return persistPath.replace('{sessionId}', sessionId);
    }
    return persistPath;
  }
  return `<db>:heartbeat_history:${sessionId}`;
}

/**
 * Stub: kept for backward compatibility.
 */
export function resolveHeartbeatHistoryPath(
  sessionId: string,
  historyPath?: string,
  _baseDir?: string
): string {
  if (historyPath) {
    if (historyPath.includes('{sessionId}')) {
      return historyPath.replace('{sessionId}', sessionId);
    }
    return historyPath;
  }
  return `<db>:heartbeat_history:${sessionId}`;
}

export function listHeartbeatHistorySessions(_baseDir?: string, db?: DatabaseConnection): string[] {
  try {
    const conn = db || getDb();
    const rows = conn.query<{ session_id: string }>(
      'SELECT DISTINCT session_id FROM heartbeat_history'
    ).all();
    return rows.map((r) => r.session_id);
  } catch {
    return [];
  }
}

export async function appendHeartbeatHistory(
  historyPath: string,
  heartbeat: Heartbeat,
  db?: DatabaseConnection
): Promise<void> {
  try {
    const conn = db || getDb();
    conn.prepare(
      `INSERT INTO heartbeat_history (session_id, status, energy, context_tokens, action, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      heartbeat.sessionId,
      heartbeat.state,
      null,
      null,
      JSON.stringify(heartbeat),
      heartbeat.timestamp,
    );
  } catch {
    // Ignore history persistence errors
  }
}

/**
 * Extract session ID from a history path.
 * Supports both DB key format and legacy file path format.
 */
function extractSessionId(historyPath: string): string | null {
  // DB key format: <db>:heartbeat_history:sessionId
  if (historyPath.startsWith('<db>:heartbeat_history:')) {
    return historyPath.replace('<db>:heartbeat_history:', '');
  }
  // Legacy file path format: .../runs/{sessionId}.jsonl or .../heartbeats/{sessionId}.json
  const match = historyPath.match(/[/\\]([^/\\]+?)\.jsonl?$/);
  if (match) {
    return match[1];
  }
  return null;
}

export async function readHeartbeatHistory(
  historyPath: string,
  options: { limit?: number; order?: HeartbeatHistoryOrder } = {},
  db?: DatabaseConnection
): Promise<Heartbeat[]> {
  try {
    const conn = db || getDb();
    const sessionId = extractSessionId(historyPath);

    const order = options.order ?? 'desc';
    const orderSql = order === 'desc' ? 'DESC' : 'ASC';
    const limitSql = options.limit && options.limit > 0 ? `LIMIT ${options.limit}` : '';

    let rows: HeartbeatHistoryRow[];
    if (sessionId) {
      rows = conn.query<HeartbeatHistoryRow>(
        `SELECT * FROM heartbeat_history WHERE session_id = ? ORDER BY timestamp ${orderSql} ${limitSql}`
      ).all(sessionId);
    } else {
      rows = conn.query<HeartbeatHistoryRow>(
        `SELECT * FROM heartbeat_history ORDER BY timestamp ${orderSql} ${limitSql}`
      ).all();
    }

    return rows.map(rowToHeartbeat);
  } catch {
    return [];
  }
}

export async function readHeartbeatHistoryBySession(
  sessionId: string,
  options: { historyPath?: string; limit?: number; order?: HeartbeatHistoryOrder; baseDir?: string } = {},
  db?: DatabaseConnection
): Promise<Heartbeat[]> {
  const historyPath = resolveHeartbeatHistoryPath(sessionId, options.historyPath);
  return readHeartbeatHistory(historyPath, { limit: options.limit, order: options.order }, db);
}

export async function readLatestHeartbeat(
  persistPath: string,
  historyPath?: string,
  db?: DatabaseConnection
): Promise<Heartbeat | null> {
  const path = historyPath || persistPath;
  const history = await readHeartbeatHistory(path, { limit: 1, order: 'desc' }, db);
  if (history.length > 0) return history[0];
  return null;
}
