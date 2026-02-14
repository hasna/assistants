export { HeartbeatManager } from './manager';
export { StatePersistence } from './persistence';
export { RecoveryManager } from './recovery';
export { findRecoverableSessions, clearRecoveryState, type RecoverableSession } from './finder';
export {
  resolveHeartbeatPersistPath,
  resolveHeartbeatHistoryPath,
  listHeartbeatHistorySessions,
  readHeartbeatHistory,
  readHeartbeatHistoryBySession,
  readLatestHeartbeat,
} from './history';
export type { AssistantState, Heartbeat, HeartbeatConfig, HeartbeatStats, PersistedState, RecoveryOptions } from './types';

// Autonomous heartbeat
export {
  HEARTBEAT_KEYS,
  heartbeatScheduleId,
  watchdogScheduleId,
  WATCHDOG_SCHEDULE_ID,
  DEFAULT_MAX_SLEEP_MS,
  MIN_SLEEP_MS,
  DEFAULT_SLEEP_MS,
  DEFAULT_WATCHDOG_INTERVAL_MS,
} from './conventions';
export { createAutoScheduleHeartbeatHook } from './auto-schedule-hook';
export { ensureWatchdogSchedule } from './watchdog';
export { installHeartbeatSkills } from './install-skills';
