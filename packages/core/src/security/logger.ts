import { appendFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { getConfigDir } from '../config';
import type { SecurityEvent, Severity } from './types';

export class SecurityLogger {
  private events: SecurityEvent[] = [];
  private logFile: string;

  constructor(logFile?: string) {
    this.logFile = logFile ?? join(getConfigDir(), 'security.log');
  }

  setLogFile(path: string): void {
    this.logFile = path;
  }

  getLogFile(): string {
    return this.logFile;
  }

  log(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);

    if (event.severity === 'critical' || event.severity === 'high') {
      console.warn(`[SECURITY] ${event.eventType}: ${event.details.reason}`);
    }

    void this.persist(fullEvent);
  }

  getEvents(filter?: Partial<SecurityEvent>): SecurityEvent[] {
    return this.events.filter((event) => {
      if (filter?.eventType && event.eventType !== filter.eventType) return false;
      if (filter?.severity && event.severity !== filter.severity) return false;
      if (filter?.sessionId && event.sessionId !== filter.sessionId) return false;
      return true;
    });
  }

  clear(): void {
    this.events = [];
  }

  private async persist(event: SecurityEvent): Promise<void> {
    try {
      await mkdir(dirname(this.logFile), { recursive: true });
      await appendFile(this.logFile, `${JSON.stringify(event)}\n`);
    } catch {
      // Ignore persistence errors.
    }
  }

  /**
   * Read persisted security events from the JSONL log file.
   * Provides cross-session access beyond the in-memory buffer.
   */
  static readPersistedEvents(options?: {
    logFile?: string;
    severity?: Severity;
    eventType?: string;
    sessionId?: string;
    since?: string;
    limit?: number;
    offset?: number;
  }): SecurityEvent[] {
    const logFile = options?.logFile ?? join(getConfigDir(), 'security.log');
    if (!existsSync(logFile)) return [];

    try {
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entries: SecurityEvent[] = [];

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as SecurityEvent;

          if (options?.severity && event.severity !== options.severity) continue;
          if (options?.eventType && event.eventType !== options.eventType) continue;
          if (options?.sessionId && event.sessionId !== options.sessionId) continue;
          if (options?.since && event.timestamp < options.since) continue;

          entries.push(event);
        } catch {
          // Skip malformed entries
        }
      }

      // Sort by timestamp descending (most recent first)
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? entries.length;
      return entries.slice(offset, offset + limit);
    } catch {
      return [];
    }
  }
}

let sharedLogger: SecurityLogger | null = null;

export function getSecurityLogger(): SecurityLogger {
  if (!sharedLogger) {
    sharedLogger = new SecurityLogger();
  }
  return sharedLogger;
}

export function setSecurityLogger(logger: SecurityLogger): void {
  sharedLogger = logger;
}

export function severityFromString(value?: string): Severity | undefined {
  if (!value) return undefined;
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }
  return undefined;
}
