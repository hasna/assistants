import type { EnergyConfig, EnergyCosts, EnergyState } from '@hasna/assistants-shared';

export type { EnergyConfig, EnergyCosts, EnergyState } from '@hasna/assistants-shared';

export type EnergyLevel = 'energetic' | 'tired' | 'exhausted';

export interface EnergyEffects {
  level: EnergyLevel;
  promptModifier?: string;
  responseLengthFactor: number;
  processingDelayMs: number;
  message?: string | null;
}

export const DEFAULT_ENERGY_COSTS: EnergyCosts = {
  message: 200,
  toolCall: 500,
  llmCall: 300,
  longContext: 1000,
};

export const DEFAULT_ENERGY_CONFIG: Required<EnergyConfig> = {
  enabled: true,
  costs: DEFAULT_ENERGY_COSTS,
  regenRate: 500,
  lowEnergyThreshold: 3000,
  criticalThreshold: 1000,
  maxEnergy: 10000,
};

export function buildEnergyConfig(config?: EnergyConfig): Required<EnergyConfig> {
  return {
    enabled: config?.enabled ?? DEFAULT_ENERGY_CONFIG.enabled,
    costs: {
      ...DEFAULT_ENERGY_COSTS,
      ...(config?.costs || {}),
    },
    regenRate: config?.regenRate ?? DEFAULT_ENERGY_CONFIG.regenRate,
    lowEnergyThreshold: config?.lowEnergyThreshold ?? DEFAULT_ENERGY_CONFIG.lowEnergyThreshold,
    criticalThreshold: config?.criticalThreshold ?? DEFAULT_ENERGY_CONFIG.criticalThreshold,
    maxEnergy: config?.maxEnergy ?? DEFAULT_ENERGY_CONFIG.maxEnergy,
  };
}

export function createInitialEnergyState(config: Required<EnergyConfig>): EnergyState {
  return {
    current: config.maxEnergy,
    max: config.maxEnergy,
    regenRate: config.regenRate,
    lastUpdate: new Date().toISOString(),
  };
}
