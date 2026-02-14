import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import type { AssistantState, Heartbeat, HeartbeatConfig, HeartbeatStats } from './types';
import { appendHeartbeatHistory } from './history';

export class HeartbeatManager {
  private config: HeartbeatConfig;
  private state: AssistantState = 'idle';
  private startTime: number;
  private lastActivity: number;
  private stats: HeartbeatStats;
  private intervalId?: ReturnType<typeof setInterval>;
  private listeners: Set<(heartbeat: Heartbeat) => void> = new Set();
  private lastHeartbeatAt: number | null = null;

  constructor(config: HeartbeatConfig) {
    this.config = config;
    this.startTime = Date.now();
    this.lastActivity = this.startTime;
    this.stats = {
      messagesProcessed: 0,
      toolCallsExecuted: 0,
      errorsEncountered: 0,
      uptimeSeconds: 0,
    };

    const dir = dirname(config.persistPath);
    mkdirSync(dir, { recursive: true });
  }

  start(sessionId: string): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      void this.emit(sessionId);
    }, this.config.intervalMs);
    if (typeof (this.intervalId as any).unref === 'function') {
      (this.intervalId as any).unref();
    }
    void this.emit(sessionId);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  setState(state: AssistantState): void {
    this.state = state;
    this.touchActivity();
  }

  recordActivity(type: 'message' | 'tool' | 'error'): void {
    if (type === 'message') {
      this.stats.messagesProcessed += 1;
    } else if (type === 'tool') {
      this.stats.toolCallsExecuted += 1;
    } else if (type === 'error') {
      this.stats.errorsEncountered += 1;
    }
    this.touchActivity();
  }

  getState(): AssistantState {
    return this.state;
  }

  getLastActivity(): number {
    return this.lastActivity;
  }

  getStartTime(): number {
    return this.startTime;
  }

  getNextHeartbeatAt(): number {
    const base = this.lastHeartbeatAt ?? Date.now();
    return base + this.config.intervalMs;
  }

  getStats(): HeartbeatStats {
    return {
      ...this.stats,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  onHeartbeat(listener: (heartbeat: Heartbeat) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private touchActivity(): void {
    this.lastActivity = Date.now();
  }

  private async emit(sessionId: string): Promise<void> {
    const now = Date.now();
    this.lastHeartbeatAt = now;
    const uptimeSeconds = Math.floor((now - this.startTime) / 1000);
    const heartbeat: Heartbeat = {
      sessionId,
      timestamp: new Date(now).toISOString(),
      state: this.state,
      lastActivity: new Date(this.lastActivity).toISOString(),
      stats: {
        ...this.stats,
        uptimeSeconds,
      },
    };

    for (const listener of this.listeners) {
      listener(heartbeat);
    }

    await this.persist(heartbeat);
  }

  private async persist(heartbeat: Heartbeat): Promise<void> {
    try {
      await writeFile(this.config.persistPath, JSON.stringify(heartbeat, null, 2));
      if (this.config.historyPath) {
        await appendHeartbeatHistory(this.config.historyPath, heartbeat);
      }
    } catch {
      // ignore persistence errors
    }
  }

  static async checkStale(
    path: string,
    thresholdMs: number
  ): Promise<{ isStale: boolean; lastHeartbeat?: Heartbeat }> {
    try {
      const content = await readFile(path, 'utf-8');
      const heartbeat = JSON.parse(content) as Heartbeat;
      const age = Date.now() - new Date(heartbeat.timestamp).getTime();
      return { isStale: age > thresholdMs, lastHeartbeat: heartbeat };
    } catch {
      return { isStale: true };
    }
  }
}
