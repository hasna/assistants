/**
 * Energy Tools
 *
 * Tools for managing the assistant's energy system.
 */

import type { Tool, EnergyState } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { EnergyManager, EnergyEffects } from '../energy';

// ============================================
// Types
// ============================================

export interface EnergyToolsContext {
  getEnergyManager: () => EnergyManager | null;
  getEnergyState: () => EnergyState | null;
  restEnergy: (amount?: number) => void;
}

// ============================================
// Tool Definitions
// ============================================

export const energyRestTool: Tool = {
  name: 'energy_rest',
  description: 'Recharge energy by resting. Restores a specified amount of energy points (default: 20% of max energy). Use when energy is low to avoid tired responses.',
  parameters: {
    type: 'object',
    properties: {
      amount: {
        type: 'number',
        description: 'Amount of energy to restore (default: 20% of max, which is typically 2000 points)',
      },
    },
    required: [],
  },
};

export const energyStatusTool: Tool = {
  name: 'energy_info',
  description: 'Get detailed information about the current energy state including level, effects, and recommendations.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const energyTools: Tool[] = [
  energyRestTool,
  energyStatusTool,
];

// ============================================
// Helper Functions
// ============================================

function getEnergyLevelInfo(percentage: number): { level: string; recommendation: string } {
  if (percentage >= 80) {
    return {
      level: 'energetic',
      recommendation: 'Energy is high. Continue working normally.',
    };
  } else if (percentage >= 60) {
    return {
      level: 'normal',
      recommendation: 'Energy is good. No rest needed yet.',
    };
  } else if (percentage >= 30) {
    return {
      level: 'low',
      recommendation: 'Energy is getting low. Consider taking a rest soon.',
    };
  } else if (percentage >= 10) {
    return {
      level: 'tired',
      recommendation: 'Energy is low. Responses may be affected. Rest recommended.',
    };
  } else {
    return {
      level: 'exhausted',
      recommendation: 'Energy is critically low. Rest immediately to restore normal function.',
    };
  }
}

// ============================================
// Tool Executors Factory
// ============================================

export function createEnergyToolExecutors(
  context: EnergyToolsContext
): Record<string, ToolExecutor> {
  return {
    energy_rest: async (input: Record<string, unknown>): Promise<string> => {
      const manager = context.getEnergyManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Energy system not enabled',
        });
      }

      const stateBefore = context.getEnergyState();
      if (!stateBefore) {
        return JSON.stringify({
          success: false,
          error: 'Unable to get energy state',
        });
      }

      // Calculate default amount as 20% of max
      const defaultAmount = Math.floor(stateBefore.max * 0.2);
      const amount = typeof input.amount === 'number' && input.amount > 0
        ? Math.min(input.amount, stateBefore.max)
        : defaultAmount;

      context.restEnergy(amount);

      const stateAfter = context.getEnergyState();
      if (!stateAfter) {
        return JSON.stringify({
          success: true,
          message: 'Rested successfully',
          restored: amount,
        });
      }

      const actualRestored = stateAfter.current - stateBefore.current;
      const percentage = Math.round((stateAfter.current / stateAfter.max) * 100);
      const { level } = getEnergyLevelInfo(percentage);

      return JSON.stringify({
        success: true,
        message: `Restored ${actualRestored} energy points`,
        before: {
          current: stateBefore.current,
          percentage: Math.round((stateBefore.current / stateBefore.max) * 100),
        },
        after: {
          current: stateAfter.current,
          max: stateAfter.max,
          percentage,
          level,
        },
      });
    },

    energy_info: async (): Promise<string> => {
      const state = context.getEnergyState();
      if (!state) {
        return JSON.stringify({
          success: false,
          error: 'Energy system not enabled or unavailable',
        });
      }

      const manager = context.getEnergyManager();
      const effects = manager?.getEffects();

      const percentage = Math.round((state.current / state.max) * 100);
      const { level, recommendation } = getEnergyLevelInfo(percentage);

      const response: Record<string, unknown> = {
        success: true,
        energy: {
          current: state.current,
          max: state.max,
          percentage,
          level,
          regenRate: state.regenRate,
          lastUpdate: state.lastUpdate,
        },
        recommendation,
      };

      if (effects) {
        response.effects = {
          level: effects.level,
          promptModifier: effects.promptModifier || null,
          responseLengthFactor: effects.responseLengthFactor,
          processingDelayMs: effects.processingDelayMs,
        };

        if (effects.message) {
          response.statusMessage = effects.message;
        }
      }

      return JSON.stringify(response);
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerEnergyTools(
  registry: ToolRegistry,
  context: EnergyToolsContext
): void {
  const executors = createEnergyToolExecutors(context);

  for (const tool of energyTools) {
    registry.register(tool, executors[tool.name]);
  }
}
