import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { EnergyState } from './types';

interface EnergyRow {
  id: string;
  current_energy: number;
  max_energy: number;
  regen_rate: number;
  last_update: string;
}

export class EnergyStorage {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  async save(state: EnergyState): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO energy_state (id, current_energy, max_energy, regen_rate, last_update)
           VALUES ('default', ?, ?, ?, ?)`
        )
        .run(state.current, state.max, state.regenRate, state.lastUpdate);
    } catch {
      // ignore persistence errors
    }
  }

  async load(): Promise<EnergyState | null> {
    try {
      const row = this.db
        .query<EnergyRow>(`SELECT * FROM energy_state WHERE id = 'default'`)
        .get();
      if (!row) return null;
      return {
        current: row.current_energy,
        max: row.max_energy,
        regenRate: row.regen_rate,
        lastUpdate: row.last_update,
      };
    } catch {
      return null;
    }
  }
}
