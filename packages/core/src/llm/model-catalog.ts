import OpenAI from 'openai';
import type { LLMConfig, LLMProvider } from '@hasna/assistants-shared';
import { getProviderInfo } from '@hasna/assistants-shared';
import type { ModelDefinition } from './models';
import { resolveApiKey, resolveBaseUrl } from './provider-utils';

type ProviderModel = {
  id: string;
  context_length?: number;
  max_context_length?: number;
  context_window?: number;
  max_output_tokens?: number;
  max_output?: number;
  owned_by?: string;
};

function mapModelDefinition(provider: LLMProvider, model: ProviderModel): ModelDefinition {
  const contextWindow = model.context_length ?? model.max_context_length ?? model.context_window;
  const maxOutputTokens = model.max_output_tokens ?? model.max_output;
  const ownedBy = model.owned_by;
  const description = ownedBy ? `Owned by ${ownedBy}` : 'Provider model';

  return {
    id: model.id,
    provider,
    name: model.id,
    description,
    contextWindow: typeof contextWindow === 'number' ? contextWindow : undefined,
    maxOutputTokens: typeof maxOutputTokens === 'number' ? maxOutputTokens : undefined,
  };
}

export async function fetchProviderModels(provider: LLMProvider, config: LLMConfig): Promise<ModelDefinition[]> {
  const info = getProviderInfo(provider);
  if (!info) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  if (info.apiStyle !== 'openai') {
    return [];
  }
  const apiKey = resolveApiKey(provider, config.apiKey);
  if (!apiKey) {
    throw new Error(`${info.apiKeyEnv} not found`);
  }
  const baseURL = resolveBaseUrl(provider, config.baseUrl);
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
  const response = await client.models.list();
  return response.data.map((model) => mapModelDefinition(provider, model as ProviderModel));
}

export function mergeModelLists(staticModels: ModelDefinition[], liveModels: ModelDefinition[]): ModelDefinition[] {
  const byId = new Map<string, ModelDefinition>();
  for (const model of staticModels) {
    byId.set(model.id, model);
  }
  for (const model of liveModels) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }
  return Array.from(byId.values());
}
