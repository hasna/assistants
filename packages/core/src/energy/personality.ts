import type { EnergyEffects, EnergyLevel } from './types';

interface PersonalityEffect {
  promptModifier?: string;
  responseLengthFactor: number;
  processingDelayMs: number;
  message?: string | null;
}

const PERSONALITIES: Record<EnergyLevel, PersonalityEffect> = {
  energetic: {
    responseLengthFactor: 1,
    processingDelayMs: 0,
    message: null,
  },
  tired: {
    promptModifier: 'You are feeling a bit tired. Keep responses concise and focused.',
    responseLengthFactor: 0.85,
    processingDelayMs: 200,
    message: 'Getting a bit tired... responses may be shorter.',
  },
  exhausted: {
    promptModifier: 'You are very tired. Provide minimal but helpful responses.',
    responseLengthFactor: 0.6,
    processingDelayMs: 500,
    message: '*yawns* Running low on energy. Responses will be brief.',
  },
};

export function effectsForLevel(level: EnergyLevel): EnergyEffects {
  const effect = PERSONALITIES[level];
  return {
    level,
    promptModifier: effect.promptModifier,
    responseLengthFactor: effect.responseLengthFactor,
    processingDelayMs: effect.processingDelayMs,
    message: effect.message ?? null,
  };
}

export function applyPersonality(systemPrompt: string, effects: EnergyEffects): string {
  if (!effects.promptModifier) return systemPrompt;
  return `${systemPrompt}\n\n${effects.promptModifier}`;
}
