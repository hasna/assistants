import { describe, it, expect } from 'bun:test';
import {
  MODELS,
  getModelById,
  getModelsByProvider,
  getProviderForModel,
  isValidModel,
  getAllModelIds,
  getModelDisplayName,
  getModelsGroupedByProvider,
} from '../src/llm/models';
import { LLM_PROVIDER_IDS } from '@hasna/assistants-shared';

describe('Model Registry', () => {
  describe('MODELS array', () => {
    it('should contain Anthropic models', () => {
      const anthropicModels = MODELS.filter((m) => m.provider === 'anthropic');
      expect(anthropicModels.length).toBeGreaterThan(0);
      expect(anthropicModels.some((m) => m.id.includes('claude'))).toBe(true);
    });

    it('should contain OpenAI models', () => {
      const openaiModels = MODELS.filter((m) => m.provider === 'openai');
      expect(openaiModels.length).toBeGreaterThan(0);
      expect(openaiModels.some((m) => m.id.includes('gpt'))).toBe(true);
    });

    it('should contain Gemini models', () => {
      const geminiModels = MODELS.filter((m) => m.provider === 'gemini');
      expect(geminiModels.length).toBeGreaterThan(0);
      expect(geminiModels.some((m) => m.id.includes('gemini'))).toBe(true);
    });

    it('should contain Mistral models', () => {
      const mistralModels = MODELS.filter((m) => m.provider === 'mistral');
      expect(mistralModels.length).toBeGreaterThan(0);
    });

    it('should contain xAI models', () => {
      const xaiModels = MODELS.filter((m) => m.provider === 'xai');
      expect(xaiModels.length).toBeGreaterThan(0);
    });

    it('should have required fields for all models', () => {
      for (const model of MODELS) {
        expect(model.id).toBeDefined();
        expect(LLM_PROVIDER_IDS).toContain(model.provider);
        expect(model.name).toBeDefined();
        expect(model.description).toBeDefined();
        if (model.contextWindow !== undefined) {
          expect(model.contextWindow).toBeGreaterThan(0);
        }
        if (model.maxOutputTokens !== undefined) {
          expect(model.maxOutputTokens).toBeGreaterThan(0);
        }
        if (model.inputCostPer1M !== undefined) {
          expect(model.inputCostPer1M).toBeGreaterThanOrEqual(0);
        }
        if (model.outputCostPer1M !== undefined) {
          expect(model.outputCostPer1M).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('getModelById', () => {
    it('should return model for valid ID', () => {
      const model = getModelById('claude-opus-4-5-20251101');
      expect(model).toBeDefined();
      expect(model?.name).toBe('Claude Opus 4.5');
      expect(model?.provider).toBe('anthropic');
    });

    it('should return model for OpenAI ID', () => {
      const model = getModelById('gpt-5.2');
      expect(model).toBeDefined();
      expect(model?.name).toBe('GPT-5.2 Thinking');
      expect(model?.provider).toBe('openai');
    });

    it('should return undefined for invalid ID', () => {
      const model = getModelById('invalid-model');
      expect(model).toBeUndefined();
    });
  });

  describe('getModelsByProvider', () => {
    it('should return Anthropic models', () => {
      const models = getModelsByProvider('anthropic');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === 'anthropic')).toBe(true);
    });

    it('should return OpenAI models', () => {
      const models = getModelsByProvider('openai');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === 'openai')).toBe(true);
    });

    it('should return Gemini models', () => {
      const models = getModelsByProvider('gemini');
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === 'gemini')).toBe(true);
    });
  });

  describe('getProviderForModel', () => {
    it('should return anthropic for Claude models', () => {
      expect(getProviderForModel('claude-opus-4-5-20251101')).toBe('anthropic');
      expect(getProviderForModel('claude-sonnet-4-20250514')).toBe('anthropic');
    });

    it('should return openai for GPT models', () => {
      expect(getProviderForModel('gpt-4o')).toBe('openai');
      expect(getProviderForModel('gpt-5.2-pro')).toBe('openai');
    });

    it('should return gemini for Gemini models', () => {
      expect(getProviderForModel('gemini-2.5-pro')).toBe('gemini');
    });

    it('should return xai for Grok models', () => {
      expect(getProviderForModel('grok-4')).toBe('xai');
    });

    it('should return mistral for Mistral models', () => {
      expect(getProviderForModel('mistral-small-latest')).toBe('mistral');
    });

    it('should return undefined for invalid models', () => {
      expect(getProviderForModel('invalid')).toBeUndefined();
    });
  });

  describe('isValidModel', () => {
    it('should return true for valid models', () => {
      expect(isValidModel('claude-opus-4-5-20251101')).toBe(true);
      expect(isValidModel('gpt-5.2')).toBe(true);
      expect(isValidModel('gemini-2.5-pro')).toBe(true);
    });

    it('should return false for invalid models', () => {
      expect(isValidModel('invalid-model')).toBe(false);
    });
  });

  describe('getAllModelIds', () => {
    it('should return array of model IDs', () => {
      const ids = getAllModelIds();
      expect(ids.length).toBe(MODELS.length);
      expect(ids).toContain('claude-opus-4-5-20251101');
      expect(ids).toContain('gpt-5.2');
    });
  });

  describe('getModelDisplayName', () => {
    it('should return display name for valid model', () => {
      expect(getModelDisplayName('claude-opus-4-5-20251101')).toBe('Claude Opus 4.5');
      expect(getModelDisplayName('gpt-5.2')).toBe('GPT-5.2 Thinking');
    });

    it('should return ID for invalid model', () => {
      expect(getModelDisplayName('invalid')).toBe('invalid');
    });
  });

  describe('getModelsGroupedByProvider', () => {
    it('should group models by provider', () => {
      const grouped = getModelsGroupedByProvider();
      for (const provider of LLM_PROVIDER_IDS) {
        expect(grouped[provider]).toBeDefined();
      }
    });
  });
});
