// Model definitions for consistent model selection across terminal and web
import type { LLMProvider } from './llm-providers';
import { LLM_PROVIDER_IDS } from './llm-providers';

export type ModelProvider = LLMProvider;

export interface ModelDefinition {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  notes?: string;
}

/**
 * All available models across all providers
 */
export const ALL_MODELS: ModelDefinition[] = [
  // Anthropic Claude Models
  {
    id: 'claude-opus-4-5-20251101',
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    description: 'Most capable, best for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputCostPer1M: 15,
    outputCostPer1M: 75,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    description: 'Balanced performance and speed',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    description: 'Fast and capable',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'claude-3-5-haiku-20241022',
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    description: 'Fastest, best for simple tasks',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputCostPer1M: 1,
    outputCostPer1M: 5,
    supportsTools: true,
    supportsStreaming: true,
  },
  // OpenAI GPT Models
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    description: 'Fast multimodal flagship',
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'Affordable small model',
    contextWindow: 128000,
    maxOutputTokens: 16384,
  },
  {
    id: 'o1',
    provider: 'openai',
    name: 'o1',
    description: 'Reasoning model for complex tasks',
    contextWindow: 200000,
    maxOutputTokens: 100000,
  },
  {
    id: 'o1-mini',
    provider: 'openai',
    name: 'o1 Mini',
    description: 'Fast reasoning model',
    contextWindow: 128000,
    maxOutputTokens: 65536,
  },
  // OpenAI GPT-5.2 Models
  {
    id: 'gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2 Thinking',
    description: 'Main flagship model, complex tasks',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Best for professional use and complex reasoning',
  },
  {
    id: 'gpt-5.2-chat-latest',
    provider: 'openai',
    name: 'GPT-5.2 Instant',
    description: 'Fast everyday workhorse',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Optimized for quick responses',
  },
  {
    id: 'gpt-5.2-pro',
    provider: 'openai',
    name: 'GPT-5.2 Pro',
    description: 'High-stakes, extended reasoning',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 21,
    outputCostPer1M: 84,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Supports xhigh reasoning effort',
  },
  {
    id: 'gpt-5.2-codex',
    provider: 'openai',
    name: 'GPT-5.2 Codex',
    description: 'Specialized for coding',
    contextWindow: 400000,
    maxOutputTokens: 128000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14,
    supportsTools: true,
    supportsStreaming: true,
    notes: 'Optimized for agentic coding tasks',
  },
  // OpenAI Utility Models (image/audio generation)
  {
    id: 'gpt-image-1',
    provider: 'openai',
    name: 'GPT Image 1',
    description: 'Image generation model',
    notes: 'Used by generate_image tool',
  },
  {
    id: 'gpt-4o-mini-tts',
    provider: 'openai',
    name: 'GPT-4o Mini TTS',
    description: 'Fast text-to-speech with instructions support',
    notes: 'Used by generate_audio tool and OpenAI TTS provider',
  },
  // Mistral Models
  {
    id: 'mistral-large-latest',
    provider: 'mistral',
    name: 'Mistral Large (latest)',
    description: 'High quality general model',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'mistral-small-latest',
    provider: 'mistral',
    name: 'Mistral Small (latest)',
    description: 'Fast, cost-effective model',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    supportsTools: true,
    supportsStreaming: true,
  },
  // xAI Grok Models
  {
    id: 'grok-4',
    provider: 'xai',
    name: 'Grok 4',
    description: 'Latest flagship model',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'grok-3',
    provider: 'xai',
    name: 'Grok 3',
    description: 'Prior flagship model',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'grok-3-mini',
    provider: 'xai',
    name: 'Grok 3 Mini',
    description: 'Lightweight Grok variant',
    contextWindow: 131072,
    maxOutputTokens: 16384,
    supportsTools: true,
    supportsStreaming: true,
  },
  // Google Gemini Models
  {
    id: 'gemini-3-pro-preview',
    provider: 'gemini',
    name: 'Gemini 3 Pro Preview',
    description: 'Most capable preview model',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-3-pro-image-preview',
    provider: 'gemini',
    name: 'Gemini 3 Pro Image Preview',
    description: 'Image generation preview model',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini',
    name: 'Gemini 3 Flash Preview',
    description: 'Fast preview model',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'gemini',
    name: 'Gemini 2.5 Pro',
    description: 'Most capable Gemini 2.5 model',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    name: 'Gemini 2.5 Flash',
    description: 'Fast Gemini 2.5 model',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    name: 'Gemini 2.5 Flash Lite',
    description: 'Lightweight Gemini 2.5 model',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    provider: 'gemini',
    name: 'Gemini 2.5 Flash Image',
    description: 'Image-capable Gemini 2.5 Flash',
    contextWindow: 65536,
    maxOutputTokens: 32768,
    supportsTools: true,
    supportsStreaming: true,
  },
  {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    name: 'Gemini Embedding 001',
    description: 'Text embedding model',
  },
] as const;

/**
 * @deprecated Use ALL_MODELS instead. Only includes Anthropic models for backward compatibility.
 */
export const ANTHROPIC_MODELS: ModelDefinition[] = ALL_MODELS.filter(m => m.provider === 'anthropic');

export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';

export const DEFAULT_TEMPERATURE = 1.0;
export const MIN_TEMPERATURE = 0.0;
export const MAX_TEMPERATURE = 2.0;
export const TEMPERATURE_STEP = 0.1;

export const DEFAULT_MAX_TOKENS = 8192;

/**
 * Get a model definition by ID
 */
export function getModelById(modelId: string): ModelDefinition | undefined {
  return ALL_MODELS.find((m) => m.id === modelId);
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: ModelProvider): ModelDefinition[] {
  return ALL_MODELS.filter((m) => m.provider === provider);
}

/**
 * Get the provider for a model ID
 */
export function getProviderForModel(modelId: string): ModelProvider | undefined {
  return getModelById(modelId)?.provider ?? inferProviderForModelId(modelId);
}

export function inferProviderForModelId(modelId: string): ModelProvider | undefined {
  const id = modelId.toLowerCase();

  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('grok-')) return 'xai';
  if (id.startsWith('mistral-') || id.startsWith('codestral') || id.startsWith('ministral') ||
      id.startsWith('pixtral') || id.startsWith('magistral') || id.startsWith('devstral') ||
      id.startsWith('voxtral')) {
    return 'mistral';
  }
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id.startsWith('o5')) {
    return 'openai';
  }

  return undefined;
}

/**
 * Get model display name by ID
 */
export function getModelDisplayName(modelId: string): string {
  const model = getModelById(modelId);
  return model?.name ?? modelId;
}

/**
 * Clamp maxTokens to the model's maximum output tokens
 */
export function clampMaxTokens(modelId: string, maxTokens: number): number {
  const model = getModelById(modelId);
  const modelMax = model?.maxOutputTokens ?? 8192;
  return Math.min(maxTokens, modelMax);
}

/**
 * Get models grouped by provider for UI display
 */
export function getModelsGroupedByProvider(): Record<ModelProvider, ModelDefinition[]> {
  const grouped = {} as Record<ModelProvider, ModelDefinition[]>;
  for (const provider of LLM_PROVIDER_IDS) {
    grouped[provider] = [];
  }
  for (const model of ALL_MODELS) {
    grouped[model.provider].push(model);
  }
  return grouped;
}
