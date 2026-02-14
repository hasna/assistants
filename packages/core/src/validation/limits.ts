import type { ValidationConfig } from '@hasna/assistants-shared';

export interface SizeLimits {
  maxUserMessageLength: number;
  maxToolOutputLength: number;
  maxTotalContextTokens: number;
  maxFileReadSize: number;
}

const DEFAULT_LIMITS: SizeLimits = {
  maxUserMessageLength: 100_000,
  maxToolOutputLength: 50_000,
  maxTotalContextTokens: 180_000,
  maxFileReadSize: 10 * 1024 * 1024,
};

let activeLimits: SizeLimits = { ...DEFAULT_LIMITS };

export function configureLimits(config?: ValidationConfig): SizeLimits {
  if (!config) {
    activeLimits = { ...DEFAULT_LIMITS };
    return activeLimits;
  }

  activeLimits = {
    maxUserMessageLength: config.maxUserMessageLength ?? DEFAULT_LIMITS.maxUserMessageLength,
    maxToolOutputLength: config.maxToolOutputLength ?? DEFAULT_LIMITS.maxToolOutputLength,
    maxTotalContextTokens: config.maxTotalContextTokens ?? DEFAULT_LIMITS.maxTotalContextTokens,
    maxFileReadSize: config.maxFileReadSize ?? DEFAULT_LIMITS.maxFileReadSize,
  };

  return activeLimits;
}

export function getLimits(): SizeLimits {
  return activeLimits;
}

export function enforceMessageLimit(message: string, limit: number): string {
  if (message.length <= limit) return message;
  const truncated = message.slice(0, Math.max(0, limit - 100));
  return `${truncated}\n\n[Truncated: ${message.length - truncated.length} characters removed]`;
}

export function enforceToolOutputLimit(output: string, limit: number): string {
  if (output.length <= limit) return output;
  const keepStart = Math.floor(limit * 0.7);
  const keepEnd = Math.floor(limit * 0.2);
  return `${output.slice(0, keepStart)}\n\n[... ${output.length - keepStart - keepEnd} characters truncated ...]\n\n${output.slice(-keepEnd)}`;
}

export function exceedsFileReadLimit(size: number, limit: number): boolean {
  return size > limit;
}
