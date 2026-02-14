import type { VerificationSession, VerificationResult } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface VerificationRow {
  id: string;
  session_id: string;
  assistant_id: string | null;
  goal: string;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
  data: string | null;
}

function rowToSession(row: VerificationRow): VerificationSession | null {
  try {
    if (row.data) {
      return JSON.parse(row.data) as VerificationSession;
    }
    // Fallback: reconstruct from columns
    const goals = row.goal ? JSON.parse(row.goal) : [];
    const result = (row.result || 'fail') as VerificationSession['result'];
    return {
      id: row.id,
      parentSessionId: row.session_id,
      type: 'scope-verification',
      result,
      goals,
      reason: '',
      suggestions: [],
      verificationResult: {
        goalsMet: result === 'pass',
        goalsAnalysis: [],
        reason: '',
        suggestions: [],
      },
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

/**
 * Storage for verification sessions
 * Allows users to view past verification results
 */
export class VerificationSessionStore {
  private maxSessions: number;
  private lastTimestamp: number;
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection, maxSessions?: number);
  constructor(basePath?: string, maxSessions?: number);
  constructor(dbOrBasePath?: DatabaseConnection | string, maxSessions: number = 100) {
    this.maxSessions = maxSessions;
    this.lastTimestamp = 0;
    if (dbOrBasePath && typeof dbOrBasePath === 'object' && 'exec' in dbOrBasePath) {
      this.db = dbOrBasePath;
    } else {
      this.db = getDb();
    }
  }

  /**
   * Create a new verification session
   */
  create(
    parentSessionId: string,
    goals: string[],
    verificationResult: VerificationResult
  ): VerificationSession {
    let timestamp = Date.now();
    if (timestamp <= this.lastTimestamp) {
      timestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = timestamp;

    const session: VerificationSession = {
      id: generateId(),
      parentSessionId,
      type: 'scope-verification',
      result: verificationResult.goalsMet ? 'pass' : 'fail',
      goals,
      reason: verificationResult.reason,
      suggestions: verificationResult.suggestions,
      verificationResult,
      createdAt: new Date(timestamp).toISOString(),
    };

    this.save(session);
    this.pruneOldSessions();

    return session;
  }

  /**
   * Save a verification session
   */
  private save(session: VerificationSession): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO verification_sessions (id, session_id, assistant_id, goal, status, result, created_at, completed_at, data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.parentSessionId,
      null,
      JSON.stringify(session.goals),
      session.result === 'pass' ? 'passed' : session.result === 'fail' ? 'failed' : session.result,
      session.result,
      session.createdAt,
      null,
      JSON.stringify(session),
    );
  }

  /**
   * Get a verification session by ID
   */
  get(id: string): VerificationSession | null {
    const row = this.db.query<VerificationRow>(
      'SELECT * FROM verification_sessions WHERE id = ?'
    ).get(id);
    if (!row) return null;
    return rowToSession(row);
  }

  /**
   * Get all verification sessions for a parent session
   */
  getByParentSession(parentSessionId: string): VerificationSession[] {
    const rows = this.db.query<VerificationRow>(
      'SELECT * FROM verification_sessions WHERE session_id = ? ORDER BY created_at DESC'
    ).all(parentSessionId);

    const sessions: VerificationSession[] = [];
    for (const row of rows) {
      const session = rowToSession(row);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  /**
   * List recent verification sessions
   */
  listRecent(limit: number = 10): VerificationSession[] {
    const rows = this.db.query<VerificationRow>(
      'SELECT * FROM verification_sessions ORDER BY created_at DESC LIMIT ?'
    ).all(limit);

    const sessions: VerificationSession[] = [];
    for (const row of rows) {
      const session = rowToSession(row);
      if (session) sessions.push(session);
    }
    return sessions;
  }

  /**
   * Update a session's result (e.g., when force-continue is used)
   */
  updateResult(id: string, result: 'pass' | 'fail' | 'force-continue'): void {
    const session = this.get(id);
    if (!session) return;

    session.result = result;
    this.save(session);
  }

  /**
   * Prune old sessions to maintain max count
   */
  private pruneOldSessions(): void {
    const countRow = this.db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM verification_sessions'
    ).get();
    const count = countRow?.cnt || 0;
    if (count <= this.maxSessions) return;

    // Delete oldest sessions beyond the limit
    this.db.prepare(
      `DELETE FROM verification_sessions WHERE id IN (
        SELECT id FROM verification_sessions ORDER BY created_at ASC LIMIT ?
      )`
    ).run(count - this.maxSessions);
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.db.prepare('DELETE FROM verification_sessions').run();
  }
}
