/**
 * Config Tools
 *
 * Tools for reading and updating configuration values.
 * Supports both project-level and global (user-level) config.
 * Enforces safe fields that can be modified via tool calls.
 */

import { join } from 'path';
import type { Tool, AssistantsConfig } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { loadConfig, getConfigDir, getProjectConfigDir } from '../config';
import { getRuntime } from '../runtime';

// ============================================
// Types
// ============================================

export interface ConfigToolsContext {
  cwd: string;
  baseDir?: string;
}

type ConfigScope = 'project' | 'global';

// Safe paths that can be read/written via tools
// Excluded: secrets, wallet, inbox storage credentials, API keys
const SAFE_READ_PATHS = [
  'llm.provider',
  'llm.model',
  'llm.baseUrl',
  'llm.maxTokens',
  'voice.enabled',
  'voice.stt.provider',
  'voice.stt.model',
  'voice.stt.language',
  'voice.tts.provider',
  'voice.tts.model',
  'voice.tts.stability',
  'voice.tts.similarityBoost',
  'voice.tts.speed',
  'voice.autoListen',
  'connectors',
  'skills',
  'scheduler.enabled',
  'scheduler.heartbeatIntervalMs',
  'heartbeat.enabled',
  'heartbeat.intervalMs',
  'heartbeat.staleThresholdMs',
  'context.enabled',
  'context.maxContextTokens',
  'context.targetContextTokens',
  'context.summaryTriggerRatio',
  'context.keepRecentMessages',
  'context.keepSystemPrompt',
  'context.summaryStrategy',
  'context.summaryMaxTokens',
  'context.maxMessages',
  'context.preserveLastToolCalls',
  'context.injection.enabled',
  'context.injection.maxTokens',
  'context.injection.format',
  'energy.enabled',
  'energy.regenRate',
  'energy.lowEnergyThreshold',
  'energy.criticalThreshold',
  'energy.maxEnergy',
  'energy.costs.message',
  'energy.costs.toolCall',
  'energy.costs.llmCall',
  'energy.costs.longContext',
  'validation.mode',
  'validation.maxUserMessageLength',
  'validation.maxToolOutputLength',
  'validation.maxTotalContextTokens',
  'validation.maxFileReadSize',
  'jobs.enabled',
  'jobs.defaultTimeoutMs',
  'jobs.maxJobAgeMs',
  'messages.enabled',
  'messages.injection.enabled',
  'messages.injection.maxPerTurn',
  'messages.injection.minPriority',
  'messages.storage.maxMessages',
  'messages.storage.maxAgeDays',
  'memory.enabled',
  'memory.injection.enabled',
  'memory.injection.maxTokens',
  'memory.injection.minImportance',
  'memory.injection.categories',
  'memory.injection.refreshInterval',
  'memory.storage.maxEntries',
  'memory.scopes.globalEnabled',
  'memory.scopes.sharedEnabled',
  'memory.scopes.privateEnabled',
  'subassistants.maxDepth',
  'subassistants.maxConcurrent',
  'subassistants.maxTurns',
  'subassistants.defaultTimeoutMs',
  'subassistants.defaultTools',
  'subassistants.forbiddenTools',
];

// Safe paths that can be written via tools (subset of readable paths)
// Further restricted to avoid breaking system configs
const SAFE_WRITE_PATHS = [
  'llm.model',
  'llm.baseUrl',
  'llm.maxTokens',
  'voice.enabled',
  'voice.stt.language',
  'voice.tts.stability',
  'voice.tts.similarityBoost',
  'voice.tts.speed',
  'voice.autoListen',
  'context.maxContextTokens',
  'context.targetContextTokens',
  'context.keepRecentMessages',
  'context.summaryMaxTokens',
  'context.maxMessages',
  'context.preserveLastToolCalls',
  'context.injection.enabled',
  'context.injection.maxTokens',
  'energy.enabled',
  'energy.regenRate',
  'energy.lowEnergyThreshold',
  'energy.criticalThreshold',
  'energy.maxEnergy',
  'memory.enabled',
  'memory.injection.enabled',
  'memory.injection.maxTokens',
  'memory.injection.minImportance',
  'memory.injection.refreshInterval',
  'memory.storage.maxEntries',
  'subassistants.maxDepth',
  'subassistants.maxConcurrent',
  'subassistants.maxTurns',
  'subassistants.defaultTimeoutMs',
];

// ============================================
// Tool Definitions
// ============================================

export const configGetTool: Tool = {
  name: 'config_get',
  description: `Get a configuration value by path. Supports dot notation for nested values (e.g., "llm.model", "memory.enabled").
Returns the current effective config value (merged from project and global configs).
Safe readable paths include: ${SAFE_READ_PATHS.slice(0, 10).join(', ')}... and more.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Config path using dot notation (e.g., "llm.model", "memory.injection.enabled")',
      },
      scope: {
        type: 'string',
        enum: ['effective', 'project', 'global'],
        description: 'Which config to read: "effective" (merged, default), "project" (.assistants/config.json), or "global" (~/.assistants/config.json)',
      },
    },
    required: ['path'],
  },
};

export const configSetTool: Tool = {
  name: 'config_set',
  description: `Set a configuration value by path. Writes to project config by default.
Only allows modification of safe, non-sensitive config values.
Safe writable paths include: ${SAFE_WRITE_PATHS.slice(0, 10).join(', ')}... and more.`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Config path using dot notation (e.g., "llm.model", "memory.enabled")',
      },
      value: {
        type: ['string', 'number', 'boolean', 'array'],
        description: 'Value to set. Type must match the expected config value type.',
      },
      scope: {
        type: 'string',
        enum: ['project', 'global'],
        description: 'Which config to modify: "project" (default) or "global"',
      },
    },
    required: ['path', 'value'],
  },
};

export const configListTool: Tool = {
  name: 'config_list',
  description: 'List all available config paths that can be read or written via tools.',
  parameters: {
    type: 'object',
    properties: {
      writable: {
        type: 'boolean',
        description: 'If true, only show writable paths. Default: false (shows all readable paths)',
      },
      category: {
        type: 'string',
        description: 'Filter by category prefix (e.g., "llm", "memory", "context")',
      },
    },
    required: [],
  },
};

export const configTools: Tool[] = [configGetTool, configSetTool, configListTool];

// ============================================
// Helpers
// ============================================

function getValueByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

function setValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function getConfigPath(scope: ConfigScope, cwd: string, baseDir?: string): string {
  if (scope === 'project') {
    return join(getProjectConfigDir(cwd), 'config.json');
  }
  return join(baseDir || getConfigDir(), 'config.json');
}

async function loadScopedConfig(
  scope: ConfigScope,
  cwd: string,
  baseDir?: string
): Promise<Record<string, unknown>> {
  const configPath = getConfigPath(scope, cwd, baseDir);
  try {
    const runtime = getRuntime();
    const file = runtime.file(configPath);
    if (!(await file.exists())) {
      return {};
    }
    return await file.json();
  } catch {
    return {};
  }
}

async function saveScopedConfig(
  scope: ConfigScope,
  cwd: string,
  config: Record<string, unknown>,
  baseDir?: string
): Promise<void> {
  const configPath = getConfigPath(scope, cwd, baseDir);
  const runtime = getRuntime();

  // Ensure directory exists
  const dir = scope === 'project' ? getProjectConfigDir(cwd) : (baseDir || getConfigDir());
  const { mkdir } = await import('fs/promises');
  await mkdir(dir, { recursive: true });

  // Write config
  const content = JSON.stringify(config, null, 2);
  await runtime.write(configPath, content);
}

// ============================================
// Tool Executors Factory
// ============================================

export function createConfigToolExecutors(
  context: ConfigToolsContext
): Record<string, ToolExecutor> {
  return {
    config_get: async (input: Record<string, unknown>): Promise<string> => {
      const path = input.path as string;
      const scope = (input.scope as string) || 'effective';

      // Validate path is safe to read
      if (!SAFE_READ_PATHS.includes(path)) {
        // Check if it's a prefix of a safe path
        const isPrefix = SAFE_READ_PATHS.some(safePath => safePath.startsWith(path + '.'));
        if (!isPrefix) {
          return JSON.stringify({
            success: false,
            error: `Path "${path}" is not readable. Use config_list to see available paths.`,
          });
        }
      }

      try {
        let value: unknown;

        if (scope === 'effective') {
          const config = await loadConfig(context.cwd, context.baseDir);
          value = getValueByPath(config, path);
        } else {
          const scopedConfig = await loadScopedConfig(scope as ConfigScope, context.cwd, context.baseDir);
          value = getValueByPath(scopedConfig, path);
        }

        return JSON.stringify({
          success: true,
          path,
          scope,
          value: value ?? null,
          exists: value !== undefined,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to read config',
        });
      }
    },

    config_set: async (input: Record<string, unknown>): Promise<string> => {
      const path = input.path as string;
      const value = input.value;
      const scope = (input.scope as ConfigScope) || 'project';

      // Validate path is safe to write
      if (!SAFE_WRITE_PATHS.includes(path)) {
        return JSON.stringify({
          success: false,
          error: `Path "${path}" is not writable. Use config_list --writable to see writable paths.`,
        });
      }

      // Validate value type
      if (value === undefined) {
        return JSON.stringify({
          success: false,
          error: 'Value is required',
        });
      }

      try {
        // Load current config
        const config = await loadScopedConfig(scope, context.cwd, context.baseDir);

        // Get previous value for comparison
        const previousValue = getValueByPath(config, path);

        // Set new value
        setValueByPath(config, path, value);

        // Save config
        await saveScopedConfig(scope, context.cwd, config, context.baseDir);

        return JSON.stringify({
          success: true,
          path,
          scope,
          previousValue: previousValue ?? null,
          newValue: value,
          message: `Config "${path}" updated in ${scope} config`,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to write config',
        });
      }
    },

    config_list: async (input: Record<string, unknown>): Promise<string> => {
      const writable = input.writable === true;
      const category = input.category as string | undefined;

      let paths = writable ? SAFE_WRITE_PATHS : SAFE_READ_PATHS;

      if (category) {
        paths = paths.filter(path => path.startsWith(category + '.') || path === category);
      }

      // Group by top-level category
      const grouped: Record<string, string[]> = {};
      for (const path of paths) {
        const topLevel = path.split('.')[0];
        if (!grouped[topLevel]) {
          grouped[topLevel] = [];
        }
        grouped[topLevel].push(path);
      }

      return JSON.stringify({
        success: true,
        type: writable ? 'writable' : 'readable',
        filter: category || null,
        total: paths.length,
        categories: Object.keys(grouped).sort(),
        paths: grouped,
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerConfigTools(
  registry: ToolRegistry,
  context: ConfigToolsContext
): void {
  const executors = createConfigToolExecutors(context);

  for (const tool of configTools) {
    registry.register(tool, executors[tool.name]);
  }
}
