/**
 * @hasna/assistants - Library exports
 *
 * This module provides the public API for programmatic usage of the terminal assistant.
 * For CLI usage, run the `assistants` command directly.
 *
 * @example
 * ```typescript
 * import { EmbeddedClient, runHeadless } from '@hasna/assistants';
 *
 * // Option 1: Use EmbeddedClient for full control
 * const client = new EmbeddedClient(process.cwd(), {
 *   systemPrompt: 'You are a helpful assistant.',
 *   allowedTools: ['bash', 'read', 'write'],
 * });
 *
 * await client.initialize();
 * await client.send('What files are in this directory?');
 * client.disconnect();
 *
 * // Option 2: Use runHeadless for simple one-shot queries
 * await runHeadless({
 *   prompt: 'Summarize this project',
 *   cwd: process.cwd(),
 *   outputFormat: 'json',
 * });
 * ```
 */

// Initialize Bun runtime before any core imports
// This is required for the terminal to work properly
import { setRuntime, hasRuntime } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';

// Only set runtime if not already set (allows users to set custom runtime)
if (!hasRuntime()) {
  setRuntime(bunRuntime);
}

// ============================================================================
// Core Client
// ============================================================================

// Re-export EmbeddedClient from core (the main programmatic interface)
export { EmbeddedClient } from '@hasna/assistants-core';

// ============================================================================
// Headless Mode
// ============================================================================

// Headless runner for non-interactive usage
export { runHeadless } from './headless';
export type { HeadlessOptions, HeadlessResult } from './headless';

// ============================================================================
// CLI Utilities
// ============================================================================

// CLI argument parsing (for building custom CLIs)
export { parseArgs } from './cli/main';
export type { ParsedOptions } from './cli/main';

// ============================================================================
// Types from Core/Shared
// ============================================================================

// Re-export commonly used types for convenience
export type {
  // Messages
  Message,
  StreamChunk,
  TokenUsage,
  // Tools
  Tool,
  ToolCall,
  ToolResult,
  // Config
  AssistantsConfig,
} from '@hasna/assistants-shared';

// Re-export session storage for advanced usage
export { SessionStorage, Logger, initAssistantsDir } from '@hasna/assistants-core';
export type { SessionData, SavedSessionInfo } from '@hasna/assistants-core';

// Feature detection
export {
  isAWSConfigured,
  isElevenLabsConfigured,
  isOpenAIConfigured,
  isExaConfigured,
  isSystemVoiceAvailable,
  getFeatureAvailability,
  getFeatureStatusMessage,
} from '@hasna/assistants-core';
export type { FeatureAvailability } from '@hasna/assistants-core';
