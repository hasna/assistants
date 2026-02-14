import type { Message, Tool, StreamChunk, LLMConfig } from '@hasna/assistants-shared';
import { getProviderInfo, type LLMProvider } from '@hasna/assistants-shared';
import { getProviderForModel } from './models';

/**
 * Abstract LLM client interface
 */
export interface LLMClient {
  /**
   * Send messages and get a streaming response
   */
  chat(
    messages: Message[],
    tools?: Tool[],
    systemPrompt?: string
  ): AsyncGenerator<StreamChunk>;

  /**
   * Get the model name
   */
  getModel(): string;
}

/**
 * Error thrown when provider and model are incompatible
 */
export class ProviderMismatchError extends Error {
  constructor(
    public specifiedProvider: string,
    public model: string,
    public detectedProvider: string
  ) {
    super(
      `Provider mismatch: model '${model}' belongs to provider '${detectedProvider}', ` +
        `but '${specifiedProvider}' was specified. Using correct provider '${detectedProvider}'.`
    );
    this.name = 'ProviderMismatchError';
  }
}

/**
 * Create an LLM client based on config
 * Automatically detects and validates provider from model ID
 * @throws ProviderMismatchError if explicit provider doesn't match model (logged as warning, uses correct provider)
 */
export async function createLLMClient(config: LLMConfig): Promise<LLMClient> {
  // Detect provider from model ID
  const detectedProvider = getProviderForModel(config.model);

  // Determine the provider to use
  let provider = config.provider as LLMProvider | undefined;

  if (detectedProvider) {
    // Model found in registry - validate and use correct provider
    if (provider && provider !== detectedProvider) {
      // Provider mismatch - log warning and use correct provider
      console.warn(
        `Provider mismatch: model '${config.model}' belongs to provider '${detectedProvider}', ` +
          `but '${provider}' was specified. Using correct provider '${detectedProvider}'.`
      );
    }
    provider = detectedProvider;
  } else if (!provider) {
    // Model not in registry and no provider specified - default to anthropic
    provider = 'anthropic';
  }
  // else: Model not in registry but provider specified - use specified provider

  if (!provider) {
    throw new Error('LLM provider could not be determined.');
  }

  const providerInfo = getProviderInfo(provider);
  if (!providerInfo) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  const resolvedConfig: LLMConfig = { ...config, provider };

  if (providerInfo.apiStyle === 'anthropic') {
    const { AnthropicClient } = await import('./anthropic');
    return new AnthropicClient(resolvedConfig);
  }

  const { OpenAIClient } = await import('./openai');
  return new OpenAIClient(resolvedConfig);
}
