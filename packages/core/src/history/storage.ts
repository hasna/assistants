/**
 * Command history storage for terminal input
 * Persists command history to SQLite command_history table
 */

import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';

const MAX_HISTORY_SIZE = 1000;

function getDb(): DatabaseConnection {
  return getDatabase();
}

interface HistoryRow {
  id: number;
  command: string;
  created_at: number;
}

/**
 * Get the path to the history file (legacy stub)
 */
export function getHistoryPath(): string {
  return '';
}

/**
 * Load command history from database
 * Returns array of commands, most recent last
 */
export async function loadHistory(): Promise<string[]> {
  try {
    const rows = getDb()
      .query<HistoryRow>(`SELECT command FROM command_history ORDER BY created_at ASC, id ASC LIMIT ${MAX_HISTORY_SIZE}`)
      .all();
    return rows.map((r) => r.command);
  } catch {
    return [];
  }
}

/**
 * Save command history to database (replaces all)
 */
export async function saveHistory(history: string[]): Promise<void> {
  try {
    const conn = getDb();
    const trimmed = history.slice(-MAX_HISTORY_SIZE);

    conn.transaction(() => {
      conn.exec('DELETE FROM command_history');
      const insert = conn.prepare('INSERT INTO command_history (command, created_at) VALUES (?, ?)');
      const now = Date.now();
      for (let i = 0; i < trimmed.length; i++) {
        insert.run(trimmed[i], now + i);
      }
    });
  } catch {
    // Silently fail - history is non-critical
  }
}

/**
 * Append a single command to history
 */
export async function appendToHistory(command: string): Promise<void> {
  if (!command.trim()) return;

  try {
    const conn = getDb();
    conn.prepare('INSERT INTO command_history (command, created_at) VALUES (?, ?)').run(command, Date.now());

    // Trim old entries if over limit
    const countRow = conn.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM command_history').get();
    if (countRow && countRow.cnt > MAX_HISTORY_SIZE) {
      conn.exec(
        `DELETE FROM command_history WHERE id IN (
          SELECT id FROM command_history ORDER BY created_at ASC, id ASC LIMIT ${countRow.cnt - MAX_HISTORY_SIZE}
        )`
      );
    }
  } catch {
    // Silently fail - history is non-critical
  }
}

/**
 * Command history manager for in-memory access with database persistence
 */
export class CommandHistory {
  private history: string[] = [];
  private index: number = -1;
  private currentInput: string = '';
  private loaded: boolean = false;

  /**
   * Load history from database (call once at startup)
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    this.history = await loadHistory();
    this.resetIndex();
    this.loaded = true;
  }

  /**
   * Add a command to history
   * Skips duplicates of the last command
   */
  async add(command: string): Promise<void> {
    const trimmed = command.trim();
    if (!trimmed) return;

    // Skip if it's the same as the last command
    if (this.history.length > 0 && this.history[this.history.length - 1] === trimmed) {
      this.resetIndex();
      return;
    }

    this.history.push(trimmed);

    // Trim in-memory history if needed
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history = this.history.slice(-MAX_HISTORY_SIZE);
    }

    this.resetIndex();

    // Persist to database
    await appendToHistory(trimmed);
  }

  /**
   * Reset the navigation index (call when input changes or command is submitted)
   */
  resetIndex(currentInput: string = ''): void {
    this.index = -1;
    this.currentInput = currentInput;
  }

  /**
   * Navigate to previous command (arrow up)
   * Returns the command to display, or null if at the beginning
   */
  previous(): string | null {
    if (this.history.length === 0) return null;

    // Save current input before navigating
    if (this.index === -1) {
      // Starting navigation - save what user typed
      // currentInput is already set by caller
    }

    // Move to previous (older) command
    const newIndex = this.index === -1
      ? this.history.length - 1
      : Math.max(0, this.index - 1);

    if (newIndex === this.index && this.index === 0) {
      // Already at oldest command
      return null;
    }

    this.index = newIndex;
    return this.history[this.index];
  }

  /**
   * Navigate to next command (arrow down)
   * Returns the command to display, or the original input if at the end
   */
  next(): string | null {
    if (this.index === -1) {
      // Not navigating history
      return null;
    }

    // Move to next (newer) command
    const newIndex = this.index + 1;

    if (newIndex >= this.history.length) {
      // Past the end of history - restore original input
      this.index = -1;
      return this.currentInput;
    }

    this.index = newIndex;
    return this.history[this.index];
  }

  /**
   * Check if currently navigating history
   */
  isNavigating(): boolean {
    return this.index !== -1;
  }

  /**
   * Get current history length
   */
  get length(): number {
    return this.history.length;
  }

  /**
   * Get all history entries (for display/search)
   */
  getAll(): string[] {
    return [...this.history];
  }
}

// Global singleton instance for the terminal
let globalHistory: CommandHistory | null = null;

/**
 * Get the global command history instance
 */
export function getCommandHistory(): CommandHistory {
  if (!globalHistory) {
    globalHistory = new CommandHistory();
  }
  return globalHistory;
}
