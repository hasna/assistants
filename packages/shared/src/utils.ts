import { randomUUID } from 'crypto';

let lastUuidBase = '';
let uuidCounter = 0;

/**
 * Generate a unique ID
 */
export function generateId(): string {
  const base = randomUUID();
  if (base !== lastUuidBase) {
    lastUuidBase = base;
    uuidCounter = 0;
    return base;
  }

  uuidCounter = (uuidCounter + 1) & 0xffffffffffff;
  const parts = base.split('-');
  if (parts.length !== 5) {
    return base;
  }

  const baseValue = BigInt(`0x${parts[4]}`);
  const nextValue = (baseValue + BigInt(uuidCounter)) & 0xffffffffffffn;
  const nextLast = nextValue.toString(16).padStart(12, '0');
  return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${nextLast}`;
}

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
  return Date.now();
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter<T extends Record<string, unknown>>(
  content: string
): { frontmatter: T; content: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {} as T, content };
  }

  const [, yamlContent, markdownContent] = match;
  const frontmatter: Record<string, unknown> = {};

  // Simple YAML parser for frontmatter
  const lines = yamlContent.split(/\r?\n/);
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Parse basic types
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(Number(value)) && value !== '') value = Number(value);
    else if (
      typeof value === 'string' &&
      value.startsWith('[') &&
      value.endsWith(']') &&
      (value.includes(',') || !/]\s+\[/.test(value))
    ) {
      const inner = value.slice(1, -1).trim();
      if (inner === '') {
        value = [];
      } else {
        value = inner.split(',').map((item) => {
          const trimmed = item.trim();
          if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ) {
            return trimmed.slice(1, -1);
          }
          return trimmed;
        });
      }
    } else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter: frontmatter as T, content: markdownContent.trim() };
}

/**
 * Substitute variables in a string
 * Supports $ARGUMENTS, $0, $1, ${VAR}
 */
export function substituteVariables(
  template: string,
  args: string[],
  env: Record<string, string> = {}
): string {
  let result = template;

  // Replace $ARGUMENTS[n] with specific args (must be done before $ARGUMENTS)
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$ARGUMENTS\\[${i}\\]`, 'g'), args[i]);
  }

  // Replace $ARGUMENTS with all args joined
  result = result.replace(/\$ARGUMENTS/g, args.join(' '));

  // Replace $0, $1, etc. with specific args
  for (let i = 0; i < args.length; i++) {
    result = result.replace(new RegExp(`\\$${i}`, 'g'), args[i]);
  }

  // Replace ${VAR} with environment variables
  result = result.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    return env[varName] || process.env[varName] || '';
  });

  return result;
}

/**
 * Truncate a string to a maximum length
 */
export function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Funny loading words for processing indicators
 */
const LOADING_WORDS = [
  'Metamorphosing',
  'Conjuring',
  'Transmuting',
  'Alchemizing',
  'Manifesting',
  'Brewing',
  'Summoning',
  'Cogitating',
  'Ruminating',
  'Percolating',
  'Incubating',
  'Gestating',
  'Synthesizing',
  'Crystallizing',
  'Catalyzing',
  'Distilling',
  'Fermenting',
  'Marinating',
  'Simmering',
  'Concocting',
];

/**
 * Get a random loading word
 */
export function getRandomLoadingWord(): string {
  return LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)];
}

/**
 * Get all loading words
 */
export function getLoadingWords(): readonly string[] {
  return LOADING_WORDS;
}
