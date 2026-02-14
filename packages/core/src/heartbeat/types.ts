export type AssistantState = 'idle' | 'processing' | 'waiting_input' | 'error' | 'stopped';

export interface HeartbeatStats {
  messagesProcessed: number;
  toolCallsExecuted: number;
  errorsEncountered: number;
  uptimeSeconds: number;
}

export interface Heartbeat {
  sessionId: string;
  timestamp: string;
  state: AssistantState;
  lastActivity: string;
  stats: HeartbeatStats;
}

export interface HeartbeatConfig {
  intervalMs: number;
  staleThresholdMs: number;
  persistPath: string;
  historyPath?: string;
  /** Enable autonomous self-scheduling (default: false). */
  autonomous?: boolean;
  /** Maximum ms the agent can sleep between heartbeats. */
  maxSleepMs?: number;
  /** Enable the watchdog safety-net schedule (default: false). */
  watchdogEnabled?: boolean;
  /** Watchdog polling interval in ms. */
  watchdogIntervalMs?: number;
}

export interface PersistedState {
  sessionId: string;
  heartbeat: Heartbeat;
  context: {
    cwd: string;
    lastMessage?: string;
    lastTool?: string;
    pendingToolCalls?: string[];
  };
  timestamp: string;
}

export interface RecoveryOptions {
  autoResume: boolean;
  maxAgeMs: number;
}
