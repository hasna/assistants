import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

export function loadApiKeyFromSecrets(key: string): string | undefined {
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  const secretsPath = join(homeDir, '.secrets');
  if (!existsSync(secretsPath)) return undefined;

  try {
    const content = readFileSync(secretsPath, 'utf-8');
    const match = content.match(new RegExp(`export\\s+${key}\\s*=\\s*['\"]?([^'\"\\n]+)['\"]?`));
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function findExecutable(name: string): string | null {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(command, [name], { encoding: 'utf-8' });
  if (result.status === 0 && result.stdout) {
    const output = result.stdout.trim().split('\n')[0]?.trim();
    return output || null;
  }
  return null;
}
