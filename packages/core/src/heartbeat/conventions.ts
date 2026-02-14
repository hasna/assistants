/**
 * Heartbeat autonomy conventions — memory keys, schedule ID helpers, timing defaults.
 */

// ── Memory key conventions ──────────────────────────────────────────
export const HEARTBEAT_KEYS = {
  /** ISO timestamp of last heartbeat execution */
  LAST: 'agent.heartbeat.last',
  /** ISO timestamp of next planned heartbeat */
  NEXT: 'agent.heartbeat.next',
  /** Free-text note the agent leaves about why it scheduled the next wakeup */
  INTENTION: 'agent.heartbeat.intention',
  /** Serialised goals the agent is tracking */
  GOALS: 'agent.goals',
  /** Summary of what the agent did last turn */
  LAST_ACTIONS: 'agent.state.lastActions',
  /** Items the agent has flagged for follow-up */
  PENDING: 'agent.state.pending',
} as const;

// ── Schedule ID helpers ─────────────────────────────────────────────

/** Deterministic schedule ID for a session's heartbeat. */
export function heartbeatScheduleId(sessionId: string): string {
  return `heartbeat-${sessionId}`;
}

/** Fixed schedule ID for the watchdog. */
export const WATCHDOG_SCHEDULE_ID = 'watchdog-main';

/** Session-scoped watchdog schedule ID. */
export function watchdogScheduleId(sessionId: string): string {
  return `watchdog-${sessionId}`;
}

// ── Timing defaults ─────────────────────────────────────────────────

/** Maximum time the agent can sleep between heartbeats (30 min). */
export const DEFAULT_MAX_SLEEP_MS = 30 * 60 * 1000;

/** Minimum sleep between heartbeats (30 s). */
export const MIN_SLEEP_MS = 30 * 1000;

/** Default sleep if the agent doesn't choose its own timing (10 min). */
export const DEFAULT_SLEEP_MS = 10 * 60 * 1000;

/** Default watchdog polling interval (1 hour). */
export const DEFAULT_WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;
