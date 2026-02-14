import type { EnergyConfig, EnergyCosts, EnergyEffects, EnergyState } from './types';
import { buildEnergyConfig, createInitialEnergyState } from './types';
import { EnergyStorage } from './storage';
import { effectsForLevel } from './personality';

export class EnergyManager {
  private config: Required<EnergyConfig>;
  private state: EnergyState;
  private storage: EnergyStorage;
  private regenInterval?: ReturnType<typeof setInterval>;

  constructor(config: EnergyConfig | undefined, storage: EnergyStorage) {
    this.config = buildEnergyConfig(config);
    this.storage = storage;
    this.state = createInitialEnergyState(this.config);
  }

  async initialize(): Promise<void> {
    const saved = await this.storage.load();
    if (saved) {
      this.state = saved;
      this.applyOfflineRegen();
      void this.storage.save(this.state);
    }

    this.startRegen();
  }

  consume(action: keyof EnergyCosts): boolean {
    if (!this.config.enabled) return true;

    const cost = this.config.costs[action] ?? 0;
    const enough = this.state.current >= cost;
    this.state.current = Math.max(0, this.state.current - cost);
    this.state.lastUpdate = new Date().toISOString();
    void this.storage.save(this.state);
    return enough;
  }

  rest(amount: number = 20): void {
    this.state.current = Math.min(this.state.max, this.state.current + amount);
    this.state.lastUpdate = new Date().toISOString();
    void this.storage.save(this.state);
  }

  getState(): EnergyState {
    return { ...this.state };
  }

  getEffects(): EnergyEffects {
    if (!this.config.enabled) {
      return effectsForLevel('energetic');
    }

    const level = this.state.current;
    if (level <= this.config.criticalThreshold) {
      return effectsForLevel('exhausted');
    }
    if (level <= this.config.lowEnergyThreshold) {
      return effectsForLevel('tired');
    }
    return effectsForLevel('energetic');
  }

  stop(): void {
    if (this.regenInterval) {
      clearInterval(this.regenInterval);
    }
  }

  private startRegen(): void {
    if (!this.config.enabled) return;
    if (this.config.regenRate <= 0) return;
    if (this.regenInterval) return;

    const intervalMs = Math.max(1000, Math.floor(60000 / this.config.regenRate));
    this.regenInterval = setInterval(() => {
      if (this.state.current < this.state.max) {
        this.state.current = Math.min(this.state.max, this.state.current + 1);
        this.state.lastUpdate = new Date().toISOString();
        void this.storage.save(this.state);
      }
    }, intervalMs);

    if (typeof (this.regenInterval as any).unref === 'function') {
      (this.regenInterval as any).unref();
    }
  }

  private applyOfflineRegen(): void {
    const lastUpdate = new Date(this.state.lastUpdate).getTime();
    const now = Date.now();
    const minutesElapsed = Math.max(0, (now - lastUpdate) / 60000);
    const regenAmount = Math.floor(minutesElapsed * this.config.regenRate);

    if (regenAmount > 0) {
      this.state.current = Math.min(this.state.max, this.state.current + regenAmount);
      this.state.lastUpdate = new Date().toISOString();
    }
  }
}
