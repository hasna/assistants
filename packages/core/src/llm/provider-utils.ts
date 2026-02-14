import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getProviderInfo, type LLMProvider } from '@hasna/assistants-shared';

function getSecretsPath(): string {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(homeDir, '.secrets');
}

export function loadApiKeyFromSecrets(envName: string): string | undefined {
  const secretsPath = getSecretsPath();
  if (!existsSync(secretsPath)) return undefined;
  try {
    const content = readFileSync(secretsPath, 'utf-8');
    const match = content.match(new RegExp(`export\\s+${envName}\\s*=\\s*['\\\"]?([^'\\\"\\n]+)['\\\"]?`));
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

export function resolveApiKey(provider: LLMProvider, override?: string): string | undefined {
  if (override) return override;
  const info = getProviderInfo(provider);
  const envName = info?.apiKeyEnv;
  if (!envName) return undefined;
  return process.env[envName] || loadApiKeyFromSecrets(envName);
}

export function resolveBaseUrl(provider: LLMProvider, override?: string): string | undefined {
  if (override) return override;
  const info = getProviderInfo(provider);
  return info?.defaultBaseUrl;
}
