import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config';

/**
 * Pattern for safe IDs - only alphanumeric, hyphens, and underscores allowed
 */
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID is safe to use in filesystem paths.
 * Returns true if valid, false otherwise.
 */
function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && SAFE_ID_PATTERN.test(id);
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * Logger that writes to ~/.assistants/logs/
 */
export class Logger {
  private logDir: string;
  private logFile: string;
  private sessionId: string;

  constructor(sessionId: string, basePath?: string) {
    this.sessionId = sessionId;
    this.logDir = join(basePath || getConfigDir(), 'logs');
    this.ensureDir(this.logDir);

    const date = new Date().toISOString().split('T')[0];
    this.logFile = join(this.logDir, `${date}.log`);
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private write(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };

    const line = JSON.stringify({
      ...entry,
      sessionId: this.sessionId,
    }) + '\n';

    try {
      appendFileSync(this.logFile, line);
    } catch {
      // Ignore write errors
    }
  }

  debug(message: string, data?: unknown) {
    this.write('debug', message, data);
  }

  info(message: string, data?: unknown) {
    this.write('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.write('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.write('error', message, data);
  }

  /**
   * Read log entries from daily JSONL log files.
   */
  static readEntries(options?: {
    basePath?: string;
    sessionId?: string;
    level?: LogLevel;
    since?: string;
    limit?: number;
    offset?: number;
  }): (LogEntry & { sessionId?: string })[] {
    const logDir = join(options?.basePath || getConfigDir(), 'logs');
    if (!existsSync(logDir)) return [];

    const levelOrder: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const minLevel = options?.level ? levelOrder[options.level] : 0;

    // Get all log files sorted by date descending
    const files = readdirSync(logDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort((a, b) => b.localeCompare(a));

    const entries: (LogEntry & { sessionId?: string })[] = [];

    for (const file of files) {
      // Skip files older than since date (optimization)
      if (options?.since) {
        const fileDate = file.replace('.log', '');
        const sinceDate = options.since.split('T')[0];
        if (fileDate < sinceDate) break;
      }

      try {
        const content = readFileSync(join(logDir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry & { sessionId?: string };

            if (options?.level && levelOrder[entry.level] < minLevel) continue;
            if (options?.sessionId && entry.sessionId !== options.sessionId) continue;
            if (options?.since && entry.timestamp < options.since) continue;

            entries.push(entry);
          } catch {
            // Skip malformed entries
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by timestamp descending
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;
    return entries.slice(offset, offset + limit);
  }

  /**
   * List available log file dates.
   */
  static listLogDates(basePath?: string): string[] {
    const logDir = join(basePath || getConfigDir(), 'logs');
    if (!existsSync(logDir)) return [];

    return readdirSync(logDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => f.replace('.log', ''))
      .sort((a, b) => b.localeCompare(a));
  }
}

/**
 * Session storage - saves conversations to ~/.assistants/assistants/{id}/sessions/
 */
export class SessionStorage {
  private sessionsDir: string;
  private sessionFile: string;
  private sessionId: string;

  constructor(sessionId: string, basePath?: string, assistantId?: string | null) {
    // Validate sessionId to prevent path traversal
    if (!isValidId(sessionId)) {
      throw new Error(
        `Invalid sessionId: "${sessionId}" contains invalid characters. Only alphanumeric characters, hyphens, and underscores are allowed.`
      );
    }
    this.sessionId = sessionId;
    const root = basePath || getConfigDir();
    // Validate assistantId to prevent path traversal - fall back to root sessions dir if invalid
    const safeAssistantId = isValidId(assistantId) ? assistantId : null;
    this.sessionsDir = safeAssistantId
      ? join(root, 'assistants', safeAssistantId, 'sessions')
      : join(root, 'sessions');
    this.ensureDir(this.sessionsDir);
    this.sessionFile = join(this.sessionsDir, `${sessionId}.json`);
  }

  private ensureDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  save(data: {
    messages: unknown[];
    startedAt: string;
    updatedAt: string;
    cwd: string;
  }) {
    try {
      writeFileSync(this.sessionFile, JSON.stringify(data, null, 2));
    } catch {
      // Ignore write errors
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Load session data from file
   */
  load(): SessionData | null {
    try {
      if (!existsSync(this.sessionFile)) return null;
      return JSON.parse(readFileSync(this.sessionFile, 'utf-8')) as SessionData;
    } catch {
      return null;
    }
  }

  private static getActiveAssistantId(basePath?: string): string | null {
    try {
      const root = basePath || getConfigDir();
      const activePath = join(root, 'active.json');
      if (!existsSync(activePath)) return null;
      const raw = readFileSync(activePath, 'utf-8');
      const data = JSON.parse(raw) as { id?: string };
      const id = data.id || null;
      // Validate ID to prevent path traversal from poisoned active.json
      if (id && !isValidId(id)) {
        return null;
      }
      return id;
    } catch {
      return null;
    }
  }

  private static resolveSessionsDir(assistantId?: string | null, basePath?: string): string {
    return SessionStorage.resolveSessionsDirWithAssistant(assistantId, basePath).dir;
  }

  private static resolveSessionsDirWithAssistant(
    assistantId?: string | null,
    basePath?: string
  ): { dir: string; assistantId: string | null } {
    const root = basePath || getConfigDir();
    const safeAssistantId = isValidId(assistantId) ? assistantId : null;
    const resolvedId = safeAssistantId ?? SessionStorage.getActiveAssistantId(basePath);
    if (resolvedId && isValidId(resolvedId)) {
      const assistantDir = join(root, 'assistants', resolvedId, 'sessions');
      if (existsSync(assistantDir)) {
        return { dir: assistantDir, assistantId: resolvedId };
      }
    }
    return { dir: join(root, 'sessions'), assistantId: null };
  }

  private static readSessionsFromDir(
    sessionsDir: string,
    assistantId: string | null
  ): SavedSessionInfo[] {
    if (!existsSync(sessionsDir)) return [];
    const sessions: SavedSessionInfo[] = [];
    const files = readdirSync(sessionsDir);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const filePath = join(sessionsDir, file);
        const content = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionData;
        sessions.push({
          id: file.replace('.json', ''),
          cwd: content.cwd,
          startedAt: content.startedAt,
          updatedAt: content.updatedAt,
          messageCount: content.messages?.length || 0,
          assistantId,
        });
      } catch {
        // Skip invalid files
      }
    }

    return sessions;
  }

  /**
   * List all saved sessions
   */
  static listSessions(assistantId?: string | null, basePath?: string): SavedSessionInfo[] {
    const { dir, assistantId: resolvedAssistantId } =
      SessionStorage.resolveSessionsDirWithAssistant(assistantId, basePath);
    const sessions = SessionStorage.readSessionsFromDir(dir, resolvedAssistantId);

    // Sort by updatedAt descending (most recent first)
    return sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * List all saved sessions across all assistants and global sessions
   */
  static listAllSessions(basePath?: string): SavedSessionInfo[] {
    const root = basePath || getConfigDir();
    const sessions: SavedSessionInfo[] = [];

    const rootSessionsDir = join(root, 'sessions');
    sessions.push(...SessionStorage.readSessionsFromDir(rootSessionsDir, null));

    const assistantsDir = join(root, 'assistants');
    if (existsSync(assistantsDir)) {
      const entries = readdirSync(assistantsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!isValidId(entry.name)) continue;
        const assistantSessionsDir = join(assistantsDir, entry.name, 'sessions');
        sessions.push(...SessionStorage.readSessionsFromDir(assistantSessionsDir, entry.name));
      }
    }

    return sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Get the most recent session
   */
  static getLatestSession(assistantId?: string | null, basePath?: string): SavedSessionInfo | null {
    const sessions = SessionStorage.listSessions(assistantId, basePath);
    return sessions[0] || null;
  }

  /**
   * Load a session by ID
   */
  static loadSession(sessionId: string, assistantId?: string | null, basePath?: string): SessionData | null {
    // Validate sessionId to prevent path traversal
    if (!isValidId(sessionId)) {
      return null;
    }
    const sessionsDir = SessionStorage.resolveSessionsDir(assistantId, basePath);
    const sessionFile = join(sessionsDir, `${sessionId}.json`);

    try {
      if (!existsSync(sessionFile)) return null;
      return JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionData;
    } catch {
      return null;
    }
  }
}

/**
 * Session data structure
 */
export interface SessionData {
  messages: unknown[];
  startedAt: string;
  updatedAt: string;
  cwd: string;
}

/**
 * Saved session info (lightweight, for listing)
 */
export interface SavedSessionInfo {
  id: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  assistantId?: string | null;
}

/**
 * Initialize .assistants directory structure
 */
export function initAssistantsDir(basePath?: string): void {
  const baseDir = basePath || getConfigDir();
  // Only create directories for files that stay on disk.
  // All data storage is in assistants.db now.
  const dirs = [
    baseDir,
    join(baseDir, 'logs'),
    join(baseDir, 'temp'),
    join(baseDir, 'messages'),
    join(baseDir, 'backups'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
