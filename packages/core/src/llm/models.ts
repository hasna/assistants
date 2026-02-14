/**
 * Model Registry - Centralized model definitions for all providers
 */

import type { ModelDefinition } from '@hasna/assistants-shared';
import {
  ALL_MODELS,
  LLM_PROVIDER_IDS,
  getProviderLabel,
  inferProviderForModelId,
} from '@hasna/assistants-shared';

export type { ModelDefinition } from '@hasna/assistants-shared';

/**
 * All available models across providers
 */
export const MODELS: ModelDefinition[] = ALL_MODELS;

/**
 * Get a model definition by ID
 */
export function getModelById(id: string): ModelDefinition | undefined {
  return MODELS.find((m) => m.id === id);
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: import('@hasna/assistants-shared').LLMProvider): ModelDefinition[] {
  return MODELS.filter((m) => m.provider === provider);
}

/**
 * Get the provider for a model ID (registry + heuristics)
 */
export function getProviderForModel(modelId: string): import('@hasna/assistants-shared').LLMProvider | undefined {
  const model = getModelById(modelId);
  return model?.provider ?? inferProviderForModelId(modelId);
}

/**
 * Check if a model ID is valid
 */
export function isValidModel(modelId: string): boolean {
  return MODELS.some((m) => m.id === modelId);
}

/**
 * Get all available model IDs
 */
export function getAllModelIds(): string[] {
  return MODELS.map((m) => m.id);
}

/**
 * Get a short display name for a model
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  return model?.name ?? modelId;
}

/**
 * Format model info for display
 */
export function formatModelInfo(model: ModelDefinition): string {
  const lines = [
    `**${model.name}** (${model.id})`,
    `Provider: ${getProviderLabel(model.provider)}`,
    `${model.description}`,
  ];

  if (model.contextWindow) {
    lines.push(`Context: ${(model.contextWindow / 1000).toFixed(0)}K tokens`);
  } else {
    lines.push('Context: unknown');
  }

  if (model.maxOutputTokens) {
    lines.push(`Max output: ${(model.maxOutputTokens / 1000).toFixed(0)}K tokens`);
  } else {
    lines.push('Max output: unknown');
  }

  if (model.inputCostPer1M !== undefined && model.outputCostPer1M !== undefined) {
    lines.push(`Cost: $${model.inputCostPer1M}/1M in, $${model.outputCostPer1M}/1M out`);
  } else {
    lines.push('Cost: unknown');
  }

  if (model.notes) {
    lines.push(`Note: ${model.notes}`);
  }
  return lines.join('\n');
}

/**
 * Group models by provider for display
 */
export function getModelsGroupedByProvider(): Record<import('@hasna/assistants-shared').LLMProvider, ModelDefinition[]> {
  const grouped = {} as Record<import('@hasna/assistants-shared').LLMProvider, ModelDefinition[]>;
  for (const provider of LLM_PROVIDER_IDS) {
    grouped[provider] = [];
  }
  for (const model of MODELS) {
    grouped[model.provider].push(model);
  }
  return grouped;
}
