import type { PersistedState, RecoveryOptions } from './types';
import { StatePersistence } from './persistence';
import { HeartbeatManager } from './manager';

export class RecoveryManager {
  private persistence: StatePersistence;
  private options: RecoveryOptions;
  private heartbeatPath: string;
  private staleThresholdMs: number;

  constructor(persistence: StatePersistence, heartbeatPath: string, staleThresholdMs: number, options: RecoveryOptions) {
    this.persistence = persistence;
    this.heartbeatPath = heartbeatPath;
    this.staleThresholdMs = staleThresholdMs;
    this.options = options;
  }

  async checkForRecovery(): Promise<{
    available: boolean;
    state?: PersistedState;
    reason?: string;
  }> {
    const state = await this.persistence.load();
    if (!state) {
      return { available: false, reason: 'No saved state' };
    }

    const age = Date.now() - new Date(state.timestamp).getTime();
    if (age > this.options.maxAgeMs) {
      return { available: false, reason: 'State too old' };
    }

    const stale = await HeartbeatManager.checkStale(this.heartbeatPath, this.staleThresholdMs);
    if (!stale.isStale) {
      return { available: false, reason: 'Session still active' };
    }

    return { available: true, state };
  }

  async recover(state: PersistedState): Promise<void> {
    if (this.options.autoResume) {
      if (state.context?.cwd) {
        process.chdir(state.context.cwd);
      }
    }

    await this.persistence.clear();
  }
}
