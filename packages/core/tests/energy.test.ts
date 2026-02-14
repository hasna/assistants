import { describe, expect, test } from 'bun:test';
import { EnergyManager } from '../src/energy/manager';
import { EnergyStorage } from '../src/energy/storage';
import { createTestDatabase } from './fixtures/test-db';

describe('EnergyManager', () => {
  test('consumes energy per action', async () => {
    const storage = new EnergyStorage(createTestDatabase());
    const manager = new EnergyManager({
      enabled: true,
      regenRate: 0,
      maxEnergy: 100,
      costs: { message: 5, toolCall: 0, llmCall: 0, longContext: 0 },
      lowEnergyThreshold: 30,
      criticalThreshold: 10,
    }, storage);

    await manager.initialize();
    const before = manager.getState().current;
    manager.consume('message');
    expect(manager.getState().current).toBe(before - 5);
  });

  test('applies offline regeneration', async () => {
    const storage = new EnergyStorage(createTestDatabase());
    const twoMinutesAgo = new Date(Date.now() - 2 * 60000).toISOString();
    await storage.save({
      current: 50,
      max: 100,
      regenRate: 60,
      lastUpdate: twoMinutesAgo,
    });

    const manager = new EnergyManager({
      enabled: true,
      regenRate: 60,
      maxEnergy: 100,
      costs: { message: 1, toolCall: 1, llmCall: 1, longContext: 1 },
      lowEnergyThreshold: 30,
      criticalThreshold: 10,
    }, storage);

    await manager.initialize();
    const state = manager.getState();
    expect(state.current).toBeGreaterThan(50);
  });

  test('returns tired effects when low', async () => {
    const storage = new EnergyStorage(createTestDatabase());
    await storage.save({
      current: 25,
      max: 100,
      regenRate: 5,
      lastUpdate: new Date().toISOString(),
    });

    const manager = new EnergyManager({
      enabled: true,
      regenRate: 5,
      maxEnergy: 100,
      costs: { message: 1, toolCall: 1, llmCall: 1, longContext: 1 },
      lowEnergyThreshold: 30,
      criticalThreshold: 10,
    }, storage);

    await manager.initialize();
    const effects = manager.getEffects();
    expect(effects.level).toBe('tired');
  });
});
