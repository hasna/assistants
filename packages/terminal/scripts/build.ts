#!/usr/bin/env bun
/**
 * Build script for @hasna/assistants
 *
 * Bundles core and shared packages into a single distributable package.
 *
 * Produces:
 * - dist/lib.js    - Library entry point (for imports)
 * - dist/cli.js    - CLI entry point (for bin commands)
 * - dist/*.d.ts    - TypeScript declarations
 */

import { $ } from 'bun';
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const DIST = join(ROOT, 'dist');

async function build() {
  console.log('Building @hasna/assistants...');

  // Clean dist
  if (existsSync(DIST)) {
    rmSync(DIST, { recursive: true });
  }
  mkdirSync(DIST, { recursive: true });

  // Build library entry point
  console.log('  Building lib.js...');
  const libResult = await Bun.build({
    entrypoints: [join(ROOT, 'src/lib.ts')],
    outdir: DIST,
    target: 'bun',
    format: 'esm',
    external: [
      // Internal packages are bundled, not external
      // '@hasna/assistants-core',  -- bundled
      // '@hasna/assistants-shared', -- bundled
      // '@hasna/runtime-bun', -- bundled
      'react',
      'ink',
      'ink-text-input',
      'ink-spinner',
      'ink-scroll-view',
      'marked',
      'marked-terminal',
      'chalk',
    ],
    define: {
      'process.env.ASSISTANTS_VERSION': JSON.stringify(
        process.env.ASSISTANTS_VERSION || 'dev'
      ),
    },
  });

  if (!libResult.success) {
    console.error('Failed to build lib.js:', libResult.logs);
    process.exit(1);
  }

  // Build CLI entry point
  console.log('  Building cli.js...');
  const cliResult = await Bun.build({
    entrypoints: [join(ROOT, 'src/cli.tsx')],
    outdir: DIST,
    target: 'bun',
    format: 'esm',
    external: [
      // Internal packages are bundled, not external
      // '@hasna/assistants-core',  -- bundled
      // '@hasna/assistants-shared', -- bundled
      // '@hasna/runtime-bun', -- bundled
      'react',
      'ink',
      'ink-text-input',
      'ink-spinner',
      'ink-scroll-view',
      'marked',
      'marked-terminal',
      'chalk',
    ],
    define: {
      'process.env.ASSISTANTS_VERSION': JSON.stringify(
        process.env.ASSISTANTS_VERSION || 'dev'
      ),
    },
  });

  if (!cliResult.success) {
    console.error('Failed to build cli.js:', cliResult.logs);
    process.exit(1);
  }

  // Post-process bundles to fix Bun bundler bugs
  // Bug: Bun 1.3.x generates __promiseAll calls without defining the helper
  // Fix: Inject the helper definition at the start of each bundle
  console.log('  Post-processing bundles...');

  const promiseAllPolyfill = `var __promiseAll = (arr) => Promise.all(arr);\n`;

  for (const filename of ['lib.js', 'cli.js']) {
    const filePath = join(DIST, filename);
    let content = await Bun.file(filePath).text();

    // Only add polyfill if __promiseAll is used but not defined
    if (content.includes('__promiseAll') && !content.includes('var __promiseAll')) {
      // Insert after shebang if present, otherwise at the start
      if (content.startsWith('#!')) {
        const newlineIndex = content.indexOf('\n');
        content = content.slice(0, newlineIndex + 1) + promiseAllPolyfill + content.slice(newlineIndex + 1);
      } else {
        content = promiseAllPolyfill + content;
      }
      await Bun.write(filePath, content);
      console.log(`    Fixed __promiseAll in ${filename}`);
    }
  }

  // Ensure CLI has shebang (only add if not already present)
  const cliPath = join(DIST, 'cli.js');
  const cliContent = await Bun.file(cliPath).text();
  if (!cliContent.startsWith('#!')) {
    await Bun.write(cliPath, '#!/usr/bin/env bun\n' + cliContent);
  }

  // Generate TypeScript declarations
  // In monorepo: may fail due to cross-package imports pointing to source files
  // We generate fallback .d.ts files that re-export from @hasna/assistants-core
  //
  // CI/Release mode: Set STRICT_TYPES=1 to fail build if declarations fail
  // This ensures published packages have proper types
  const strictTypes = process.env.STRICT_TYPES === '1' || process.env.CI === 'true';
  console.log(`  Generating type declarations... (strict=${strictTypes})`);

  let declarationsGenerated = false;
  let declarationError: string | undefined;

  try {
    const tscResult = await $`cd ${ROOT} && bunx tsc -p tsconfig.build.json`.quiet();
    if (tscResult.exitCode === 0) {
      declarationsGenerated = true;
    } else {
      declarationError = tscResult.stderr.toString() || 'Unknown error';
    }
  } catch (error) {
    declarationError = error instanceof Error ? error.message : String(error);
  }

  if (!declarationsGenerated) {
    if (strictTypes) {
      console.error('  ERROR: Type declaration generation failed in strict mode');
      if (declarationError) {
        console.error('  Error:', declarationError.slice(0, 500));
      }
      console.error('  Set STRICT_TYPES=0 to allow fallback declarations in development');
      process.exit(1);
    }

    console.log('  Full declarations failed, generating fallback .d.ts...');
    // Generate minimal fallback declarations
    // Core and shared are bundled, so types are inline
    const fallbackDeclaration = `/**
 * Type declarations for @hasna/assistants
 *
 * Note: Full declarations are generated from source in development.
 * Published packages should include proper .d.ts files.
 */

// ============================================================================
// Core Client
// ============================================================================

export declare class EmbeddedClient {
  constructor(cwd: string, options?: EmbeddedClientOptions);
  initialize(): Promise<void>;
  send(message: string): Promise<void>;
  stop(): void;
  disconnect(): void;
  onChunk(callback: (chunk: StreamChunk) => void): void;
  onError(callback: (error: Error) => void): void;
  getSessionId(): string;
  getTokenUsage(): TokenUsage | undefined;
  getModel(): string | null;
}

export interface EmbeddedClientOptions {
  sessionId?: string;
  initialMessages?: Message[];
  systemPrompt?: string;
  allowedTools?: string[];
  startedAt?: string;
}

// ============================================================================
// Headless Mode
// ============================================================================

export interface HeadlessOptions {
  prompt: string;
  cwd: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  allowedTools?: string[];
  systemPrompt?: string;
  jsonSchema?: string;
  continue?: boolean;
  resume?: string | null;
  cwdProvided?: boolean;
}

export interface HeadlessResult {
  success: boolean;
  result: string;
  sessionId: string;
  usage?: TokenUsage;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  error?: string;
  structuredOutput?: unknown;
}

export declare function runHeadless(options: HeadlessOptions): Promise<HeadlessResult>;

// ============================================================================
// CLI Utilities
// ============================================================================

export interface ParsedOptions {
  command: string | undefined;
  cwd: string;
  prompt?: string;
  outputFormat: 'text' | 'json' | 'stream-json';
  allowedTools?: string[];
  systemPrompt?: string;
  jsonSchema?: string;
  continue: boolean;
  resume?: string | null;
  cwdProvided: boolean;
}

export declare function parseArgs(args?: string[]): ParsedOptions;

// ============================================================================
// Shared Types
// ============================================================================

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'usage' | 'error' | 'done' | 'exit' | 'show_panel' | 'stopped' | 'partial_transcript';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  error?: string;
  usage?: TokenUsage;
  panel?: string;
  panelValue?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  maxContextTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required?: string[];
}

export interface ToolProperty {
  type: string | string[];
  description: string;
  enum?: string[];
  items?: ToolProperty;
  default?: unknown;
  properties?: Record<string, ToolProperty>;
  required?: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  rawContent?: string;
  truncated?: boolean;
  isError?: boolean;
  toolName?: string;
}

export interface AssistantsConfig {
  llm: LLMConfig;
  voice?: VoiceConfig;
  connectors?: string[];
  skills?: string[];
  hooks?: Record<string, unknown>;
  scheduler?: Record<string, unknown>;
  context?: Record<string, unknown>;

  memory?: Record<string, unknown>;
}

export interface LLMConfig {
  provider?: 'anthropic' | 'openai' | 'xai' | 'mistral' | 'gemini';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
}

export interface VoiceConfig {
  enabled: boolean;
  stt: { provider: string; model?: string; language?: string };
  tts: { provider: string; voiceId?: string };
  wake?: { enabled: boolean; word: string };
  autoListen?: boolean;
}

// ============================================================================
// Session Storage
// ============================================================================

export interface SessionData {
  id: string;
  cwd: string;
  messages: Message[];
  startedAt: string;
  updatedAt: string;
}

export interface SavedSessionInfo {
  id: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  messageCount: number;
  assistantId?: string | null;
}

export declare const SessionStorage: {
  saveSession(id: string, data: SessionData): void;
  loadSession(id: string, assistantId?: string | null): SessionData | null;
  listSessions(assistantId?: string | null): SavedSessionInfo[];
  listAllSessions(): SavedSessionInfo[];
  deleteSession(id: string): void;
  getLatestSession(): SavedSessionInfo | null;
};

export declare const Logger: {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
};

export declare function initAssistantsDir(cwd: string): Promise<void>;

// ============================================================================
// Feature Detection
// ============================================================================

export interface FeatureAvailability {
  aws: boolean;
  elevenlabs: boolean;
  openai: boolean;
  exa: boolean;
  systemVoice: boolean;
}

export declare function isAWSConfigured(): boolean;
export declare function isElevenLabsConfigured(): boolean;
export declare function isOpenAIConfigured(): boolean;
export declare function isExaConfigured(): boolean;
export declare function isSystemVoiceAvailable(): boolean;
export declare function getFeatureAvailability(): FeatureAvailability;
export declare function getFeatureStatusMessage(): string;
`;
    await Bun.write(join(DIST, 'lib.d.ts'), fallbackDeclaration);
    console.log('  Generated fallback lib.d.ts');
  } else {
    console.log('  Type declarations generated successfully');
  }

  console.log('Build complete!');
  console.log('  dist/lib.js  - Library entry point');
  console.log('  dist/cli.js  - CLI entry point');
  console.log('  dist/*.d.ts  - Type declarations');
}

build().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
