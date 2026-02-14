import { describe, expect, test, spyOn, beforeEach, afterEach } from 'bun:test';
import type { LLMConfig } from '@hasna/assistants-shared';
import { createLLMClient, ProviderMismatchError } from '../src/llm/client';

describe('createLLMClient', () => {
  let consoleWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  describe('provider auto-detection', () => {
    test('auto-detects anthropic provider from claude model', async () => {
      const client = await createLLMClient({
        model: 'claude-opus-4-5-20251101',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('claude-opus-4-5-20251101');
    });

    test('auto-detects anthropic provider from claude-sonnet model', async () => {
      const client = await createLLMClient({
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('claude-sonnet-4-20250514');
    });

    test('auto-detects openai provider from gpt model', async () => {
      // This will throw because OPENAI_API_KEY is not set, but we can catch the error
      // to verify it tried to create an OpenAI client
      try {
        await createLLMClient({
          model: 'gpt-4o',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('OPENAI_API_KEY');
      }
    });

    test('auto-detects gemini provider from gemini model', async () => {
      try {
        await createLLMClient({
          model: 'gemini-2.5-pro',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('GEMINI_API_KEY');
      }
    });

    test('auto-detects xai provider from grok model', async () => {
      try {
        await createLLMClient({
          model: 'grok-4',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('XAI_API_KEY');
      }
    });

    test('auto-detects mistral provider from mistral model', async () => {
      try {
        await createLLMClient({
          model: 'mistral-large-latest',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('MISTRAL_API_KEY');
      }
    });

    test('defaults to anthropic for unknown models without explicit provider', async () => {
      const client = await createLLMClient({
        model: 'some-unknown-model',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('some-unknown-model');
    });
  });

  describe('provider validation', () => {
    test('uses correct provider when explicit provider is anthropic for claude model', async () => {
      const client = await createLLMClient({
        provider: 'anthropic',
        model: 'claude-opus-4-5-20251101',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('claude-opus-4-5-20251101');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('warns and uses correct provider when openai is specified for claude model', async () => {
      const client = await createLLMClient({
        provider: 'openai',
        model: 'claude-opus-4-5-20251101',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('claude-opus-4-5-20251101');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("model 'claude-opus-4-5-20251101' belongs to provider 'anthropic'")
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("'openai' was specified")
      );
    });

    test('warns and uses correct provider when anthropic is specified for gpt model', async () => {
      // Will fail because no OPENAI_API_KEY, but should log warning first
      try {
        await createLLMClient({
          provider: 'anthropic',
          model: 'gpt-4o',
        });
      } catch {
        // Expected to fail due to missing API key
      }
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("model 'gpt-4o' belongs to provider 'openai'")
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("'anthropic' was specified")
      );
    });

    test('uses specified provider for unknown model', async () => {
      const client = await createLLMClient({
        provider: 'anthropic',
        model: 'unknown-custom-model',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('unknown-custom-model');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('uses specified openai provider for unknown model', async () => {
      try {
        await createLLMClient({
          provider: 'openai',
          model: 'custom-finetuned-gpt',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('OPENAI_API_KEY');
      }
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    test('throws for unsupported provider', async () => {
      await expect(
        createLLMClient({
          provider: 'unsupported' as LLMConfig['provider'],
          model: 'some-model',
        })
      ).rejects.toThrow('Unsupported LLM provider: unsupported');
    });

    test('returns anthropic client when provider is anthropic', async () => {
      const client = await createLLMClient({
        provider: 'anthropic',
        model: 'stub',
        apiKey: 'test-key',
      });
      expect(client.getModel()).toBe('stub');
    });
  });
});

describe('ProviderMismatchError', () => {
  test('has correct message format', () => {
    const error = new ProviderMismatchError('openai', 'claude-opus-4-5-20251101', 'anthropic');
    expect(error.message).toContain("model 'claude-opus-4-5-20251101' belongs to provider 'anthropic'");
    expect(error.message).toContain("'openai' was specified");
    expect(error.message).toContain("Using correct provider 'anthropic'");
    expect(error.specifiedProvider).toBe('openai');
    expect(error.model).toBe('claude-opus-4-5-20251101');
    expect(error.detectedProvider).toBe('anthropic');
  });

  test('has correct name', () => {
    const error = new ProviderMismatchError('openai', 'model', 'anthropic');
    expect(error.name).toBe('ProviderMismatchError');
  });
});
