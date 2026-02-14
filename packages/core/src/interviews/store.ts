/**
 * Interview Store - SQLite-based persistence for all AI interviews
 *
 * Stores all interviews the AI has conducted with the user,
 * including questions, answers, and metadata.
 */

import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { InterviewQuestion, InterviewRecord } from '@hasna/assistants-shared';

export class InterviewStore {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  /**
   * Create a new interview record
   */
  create(record: Omit<InterviewRecord, 'createdAt' | 'status' | 'answers'> & { answers?: Record<string, string | string[]> }): InterviewRecord {
    const now = Date.now();
    const entry: InterviewRecord = {
      id: record.id,
      sessionId: record.sessionId,
      assistantId: record.assistantId,
      title: record.title,
      questions: record.questions,
      answers: record.answers || {},
      status: 'pending',
      createdAt: now,
    };

    this.db.prepare(
      `INSERT INTO interviews (id, session_id, assistant_id, title, questions, answers, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      entry.id,
      entry.sessionId,
      entry.assistantId || null,
      entry.title || null,
      JSON.stringify(entry.questions),
      JSON.stringify(entry.answers),
      entry.status,
      entry.createdAt,
    );

    return entry;
  }

  /**
   * Update interview answers (partial update during progress)
   */
  updateAnswers(id: string, answers: Record<string, string | string[]>): void {
    this.db.prepare(
      `UPDATE interviews SET answers = ? WHERE id = ?`
    ).run(JSON.stringify(answers), id);
  }

  /**
   * Mark interview as completed
   */
  complete(id: string, answers: Record<string, string | string[]>): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE interviews SET answers = ?, status = 'completed', completed_at = ? WHERE id = ?`
    ).run(JSON.stringify(answers), now, id);
  }

  /**
   * Mark interview as cancelled
   */
  cancel(id: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE interviews SET status = 'cancelled', completed_at = ? WHERE id = ?`
    ).run(now, id);
  }

  /**
   * Get an interview by ID
   */
  get(id: string): InterviewRecord | undefined {
    const row = this.db.prepare<{
      id: string;
      session_id: string;
      assistant_id: string | null;
      title: string | null;
      questions: string;
      answers: string;
      status: string;
      created_at: number;
      completed_at: number | null;
    }>(
      `SELECT * FROM interviews WHERE id = ?`
    ).get(id);

    if (!row) return undefined;
    return this.rowToRecord(row);
  }

  /**
   * List interviews for a session
   */
  listBySession(sessionId: string, limit = 50): InterviewRecord[] {
    const rows = this.db.prepare<{
      id: string;
      session_id: string;
      assistant_id: string | null;
      title: string | null;
      questions: string;
      answers: string;
      status: string;
      created_at: number;
      completed_at: number | null;
    }>(
      `SELECT * FROM interviews WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
    ).all(sessionId, limit);

    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * List all interviews
   */
  listAll(limit = 100, offset = 0): InterviewRecord[] {
    const rows = this.db.prepare<{
      id: string;
      session_id: string;
      assistant_id: string | null;
      title: string | null;
      questions: string;
      answers: string;
      status: string;
      created_at: number;
      completed_at: number | null;
    }>(
      `SELECT * FROM interviews ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);

    return rows.map((row) => this.rowToRecord(row));
  }

  /**
   * Count interviews by status
   */
  countByStatus(): Record<string, number> {
    const rows = this.db.prepare<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM interviews GROUP BY status`
    ).all();

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  }

  /**
   * Search interviews by title or question text
   */
  search(query: string, limit = 20): InterviewRecord[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare<{
      id: string;
      session_id: string;
      assistant_id: string | null;
      title: string | null;
      questions: string;
      answers: string;
      status: string;
      created_at: number;
      completed_at: number | null;
    }>(
      `SELECT * FROM interviews WHERE title LIKE ? OR questions LIKE ? ORDER BY created_at DESC LIMIT ?`
    ).all(pattern, pattern, limit);

    return rows.map((row) => this.rowToRecord(row));
  }

  close(): void { }

  private rowToRecord(row: {
    id: string;
    session_id: string;
    assistant_id: string | null;
    title: string | null;
    questions: string;
    answers: string;
    status: string;
    created_at: number;
    completed_at: number | null;
  }): InterviewRecord {
    return {
      id: row.id,
      sessionId: row.session_id,
      assistantId: row.assistant_id || undefined,
      title: row.title || undefined,
      questions: JSON.parse(row.questions) as InterviewQuestion[],
      answers: JSON.parse(row.answers) as Record<string, string | string[]>,
      status: row.status as InterviewRecord['status'],
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    };
  }
}
