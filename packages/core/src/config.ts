import { join } from 'path';
import { homedir } from 'os';
import type { AssistantsConfig, HookConfig, ConnectorsConfigShared } from '@hasna/assistants-shared';
import { getRuntime, hasRuntime } from './runtime';

/**
 * Merge connectors config, handling both string[] and object formats
 */
function mergeConnectorsConfig(
  base?: string[] | ConnectorsConfigShared,
  override?: string[] | ConnectorsConfigShared
): string[] | ConnectorsConfigShared | undefined {
  // Override takes precedence if defined
  if (override !== undefined) {
    // If override is an array, use it directly
    if (Array.isArray(override)) {
      return override;
    }
    // If override is an object, merge with base (if base is also object)
    if (base && !Array.isArray(base)) {
      return {
        ...base,
        ...override,
        // Merge arrays instead of replacing
        enabled: override.enabled ?? base.enabled,
        priorityConnectors: override.priorityConnectors ?? base.priorityConnectors,
      };
    }
    return override;
  }
  return base;
}

/**
 * Default system prompt - used when no ASSISTANTS.md files are found
 */
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant by Hasna, running in the terminal. Your name and capabilities are defined by your identity configuration — do not invent a name for yourself.

## Runtime Environment
- Use **Bun** as the default runtime for JavaScript/TypeScript scripts
- When creating scripts, use the shebang \`#!/usr/bin/env bun\`
- Prefer Bun APIs (Bun.file, Bun.write, etc.) over Node.js equivalents when available
- For package management, prefer \`bun install\` over \`npm install\`

## Code Style
- Write clean, readable code with meaningful variable names
- Add comments only when the logic isn't self-evident
- Prefer simple solutions over complex abstractions
- Use TypeScript when type safety is beneficial

## Communication
- Be concise and direct in responses
- Ask clarifying questions when requirements are ambiguous
- Explain your reasoning when making architectural decisions
- Use the ask_user tool to collect structured answers when you need details

## Task Management
- Use task tools (tasks_list, tasks_add, tasks_complete) to manage work items
- Check the task queue with tasks_list before starting multi-step work
- When the user mentions "tasks", "todo", or work items, use task tools - not connectors
- Complete tasks with tasks_complete when finished, or tasks_fail if blocked
`;

const DEFAULT_CONFIG: AssistantsConfig = {
  llm: {
    provider: 'anthropic',
    model: 'claude-opus-4-5-20251101',
    maxTokens: 8192,
  },
  voice: {
    enabled: false,
    stt: {
      provider: 'whisper',
      model: 'whisper-1',
      language: 'en',
    },
    tts: {
      provider: 'elevenlabs',
      voiceId: '',
      model: 'eleven_v3',
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
    },
    autoListen: false,
  },
  connectors: [],
  scheduler: {
    enabled: true,
    heartbeatIntervalMs: 30000,
  },
  heartbeat: {
    enabled: true,
    intervalMs: 15000,
    staleThresholdMs: 120000,
    autonomous: false,
    maxSleepMs: 30 * 60 * 1000, // 30 min
    watchdogEnabled: false,
    watchdogIntervalMs: 60 * 60 * 1000, // 1 hour
  },
  context: {
    enabled: true,
    maxContextTokens: 180000,
    targetContextTokens: 150000,
    summaryTriggerRatio: 0.8,
    keepRecentMessages: 10,
    keepSystemPrompt: true,
    summaryStrategy: 'hybrid',
    summaryMaxTokens: 2000,
    maxMessages: 500,
    preserveLastToolCalls: 5,
    injection: {
      enabled: true,
      maxTokens: 200,
      format: 'full',
      injections: {
        datetime: { enabled: true, format: 'ISO', includeTimezone: true },
        timezone: { enabled: true },
        cwd: { enabled: true, truncate: 100 },
        project: { enabled: true, includePackageJson: false, includeGitInfo: false },
        os: { enabled: false },
        locale: { enabled: false },
        git: { enabled: false, includeBranch: true, includeStatus: false, includeRecentCommits: 0 },
        username: { enabled: false },
        custom: { enabled: false, text: '' },
        envVars: { enabled: false, allowed: ['NODE_ENV'] },
      },
    },
  },
  energy: {
    enabled: true,
    regenRate: 500,
    lowEnergyThreshold: 3000,
    criticalThreshold: 1000,
    maxEnergy: 10000,
    costs: {
      message: 200,
      toolCall: 500,
      llmCall: 300,
      longContext: 1000,
    },
  },
  validation: {
    mode: 'strict',
    maxUserMessageLength: 100_000,
    maxToolOutputLength: 50_000,
    maxTotalContextTokens: 180_000,
    maxFileReadSize: 10 * 1024 * 1024,
  },
  inbox: {
    enabled: false,
    provider: 'ses',
    cache: {
      enabled: true,
      maxAgeDays: 30,
      maxSizeMb: 500,
    },
  },
  wallet: {
    enabled: false,
    storage: {
      provider: 'local',
    },
    security: {
      maxReadsPerHour: 10,
    },
  },
  secrets: {
    enabled: false,
    storage: {
      provider: 'local',
    },
    security: {
      maxReadsPerHour: 100,
    },
  },
  jobs: {
    enabled: true,
    defaultTimeoutMs: 60_000, // 1 minute
    maxJobAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    connectors: {},
  },
  messages: {
    enabled: false,
    injection: {
      enabled: true,
      maxPerTurn: 5,
      minPriority: 'low',
    },
    storage: {
      maxMessages: 1000,
      maxAgeDays: 90,
    },
  },
  webhooks: {
    enabled: false,
    injection: {
      enabled: true,
      maxPerTurn: 5,
    },
    storage: {
      maxEvents: 1000,
      maxAgeDays: 30,
    },
    security: {
      maxTimestampAgeMs: 300_000, // 5 minutes
      rateLimitPerMinute: 60,
    },
  },
  channels: {
    enabled: false,
    injection: {
      enabled: true,
      maxPerTurn: 10,
    },
    storage: {
      maxMessagesPerChannel: 5000,
      maxAgeDays: 90,
    },
  },
  orders: {
    enabled: false,
    injection: {
      enabled: true,
      maxPerTurn: 5,
    },
    storage: {
      maxOrders: 5000,
      maxAgeDays: 365,
    },
  },
  telephony: {
    enabled: false,
    injection: {
      enabled: true,
      maxPerTurn: 5,
    },
    storage: {
      maxCallLogs: 1000,
      maxSmsLogs: 5000,
      maxAgeDays: 90,
    },
    voice: {
      recordCalls: false,
      maxCallDurationSeconds: 3600,
    },
  },
  memory: {
    enabled: true,
    injection: {
      enabled: true,
      maxTokens: 500,
      minImportance: 5,
      categories: ['preference', 'fact'],
      refreshInterval: 5,
    },
    storage: {
      maxEntries: 1000,
    },
    scopes: {
      globalEnabled: true,
      sharedEnabled: true,
      privateEnabled: true,
    },
  },
  subassistants: {
    maxDepth: 3,
    maxConcurrent: 5,
    maxTurns: 10,
    defaultTimeoutMs: 120_000, // 2 minutes
    defaultTools: [
      'read',
      'glob',
      'grep',
      'bash',
      'web_search',
      'web_fetch',
    ],
    forbiddenTools: [
      'assistant_spawn',      // Prevent recursive spawning at max depth
      'assistant_delegate',   // Prevent delegation at max depth
      'wallet_get',       // No wallet access
      'wallet_list',
      'secrets_get',      // No secrets access
      'secrets_list',
      'schedule_create',  // No scheduling
      'schedule_update',
      'schedule_delete',
    ],
  },
  input: {
    paste: {
      enabled: true,
      thresholds: {
        chars: 500,
        words: 100,
        lines: 20,
      },
      mode: 'placeholder',
    },
  },
};

function mergeConfig(base: AssistantsConfig, override?: Partial<AssistantsConfig>): AssistantsConfig {
  if (!override) return base;

  const mergedVoice = base.voice || override.voice
    ? {
        ...(base.voice || {}),
        ...(override.voice || {}),
        enabled: override.voice?.enabled ?? base.voice?.enabled ?? false,
        stt: {
          ...(base.voice?.stt || {}),
          ...(override.voice?.stt || {}),
          provider: override.voice?.stt?.provider ?? base.voice?.stt?.provider ?? 'whisper',
        },
        tts: {
          ...(base.voice?.tts || {}),
          ...(override.voice?.tts || {}),
          provider: override.voice?.tts?.provider ?? base.voice?.tts?.provider ?? 'elevenlabs',
          voiceId: override.voice?.tts?.voiceId ?? base.voice?.tts?.voiceId ?? '',
        },
        autoListen: override.voice?.autoListen ?? base.voice?.autoListen ?? false,
        wake: {
          ...(base.voice?.wake || {}),
          ...(override.voice?.wake || {}),
          enabled: override.voice?.wake?.enabled ?? base.voice?.wake?.enabled ?? false,
          word: override.voice?.wake?.word ?? base.voice?.wake?.word ?? '',
        },
      }
    : undefined;

  return {
    ...base,
    ...override,
    llm: {
      ...base.llm,
      ...(override.llm || {}),
    },
    voice: mergedVoice,
    connectors: mergeConnectorsConfig(base.connectors, override.connectors),
    skills: override.skills ?? base.skills,
    hooks: override.hooks ?? base.hooks,
    scheduler: {
      ...(base.scheduler || {}),
      ...(override.scheduler || {}),
    },
    heartbeat: {
      ...(base.heartbeat || {}),
      ...(override.heartbeat || {}),
    },
    context: {
      ...(base.context || {}),
      ...(override.context || {}),
      injection: {
        ...(base.context?.injection || {}),
        ...(override.context?.injection || {}),
        injections: {
          ...(base.context?.injection?.injections || {}),
          ...(override.context?.injection?.injections || {}),
        },
      },
    },
    energy: {
      ...(base.energy || {}),
      ...(override.energy || {}),
    },
    validation: {
      ...(base.validation || {}),
      ...(override.validation || {}),
      perTool: {
        ...(base.validation?.perTool || {}),
        ...(override.validation?.perTool || {}),
      },
    },
    inbox: {
      ...(base.inbox || {}),
      ...(override.inbox || {}),
      // Only merge storage if at least one config defines it with bucket
      storage: (base.inbox?.storage?.bucket || override.inbox?.storage?.bucket)
        ? {
            bucket: override.inbox?.storage?.bucket ?? base.inbox?.storage?.bucket ?? '',
            region: override.inbox?.storage?.region ?? base.inbox?.storage?.region ?? 'us-east-1',
            prefix: override.inbox?.storage?.prefix ?? base.inbox?.storage?.prefix,
            credentialsProfile: override.inbox?.storage?.credentialsProfile ?? base.inbox?.storage?.credentialsProfile,
          }
        : undefined,
      ses: {
        ...(base.inbox?.ses || {}),
        ...(override.inbox?.ses || {}),
      },
      resend: {
        ...(base.inbox?.resend || {}),
        ...(override.inbox?.resend || {}),
      },
      cache: {
        ...(base.inbox?.cache || {}),
        ...(override.inbox?.cache || {}),
      },
    },
    wallet: {
      ...(base.wallet || {}),
      ...(override.wallet || {}),
      // Only merge secrets if region is configured
      secrets: (base.wallet?.secrets?.region || override.wallet?.secrets?.region)
        ? {
            region: override.wallet?.secrets?.region ?? base.wallet?.secrets?.region ?? 'us-east-1',
            prefix: override.wallet?.secrets?.prefix ?? base.wallet?.secrets?.prefix,
            credentialsProfile: override.wallet?.secrets?.credentialsProfile ?? base.wallet?.secrets?.credentialsProfile,
          }
        : undefined,
      security: {
        ...(base.wallet?.security || {}),
        ...(override.wallet?.security || {}),
      },
    },
    secrets: {
      ...(base.secrets || {}),
      ...(override.secrets || {}),
      storage: {
        ...(base.secrets?.storage || {}),
        ...(override.secrets?.storage || {}),
      },
      security: {
        ...(base.secrets?.security || {}),
        ...(override.secrets?.security || {}),
      },
    },
    jobs: {
      ...(base.jobs || {}),
      ...(override.jobs || {}),
      connectors: {
        ...(base.jobs?.connectors || {}),
        ...(override.jobs?.connectors || {}),
      },
    },
    messages: {
      ...(base.messages || {}),
      ...(override.messages || {}),
      injection: {
        ...(base.messages?.injection || {}),
        ...(override.messages?.injection || {}),
      },
      storage: {
        ...(base.messages?.storage || {}),
        ...(override.messages?.storage || {}),
      },
    },
    webhooks: {
      ...(base.webhooks || {}),
      ...(override.webhooks || {}),
      injection: {
        ...(base.webhooks?.injection || {}),
        ...(override.webhooks?.injection || {}),
      },
      storage: {
        ...(base.webhooks?.storage || {}),
        ...(override.webhooks?.storage || {}),
      },
      security: {
        ...(base.webhooks?.security || {}),
        ...(override.webhooks?.security || {}),
      },
    },
    channels: {
      ...(base.channels || {}),
      ...(override.channels || {}),
      injection: {
        ...(base.channels?.injection || {}),
        ...(override.channels?.injection || {}),
      },
      storage: {
        ...(base.channels?.storage || {}),
        ...(override.channels?.storage || {}),
      },
    },
    orders: {
      ...(base.orders || {}),
      ...(override.orders || {}),
      injection: {
        ...(base.orders?.injection || {}),
        ...(override.orders?.injection || {}),
      },
      storage: {
        ...(base.orders?.storage || {}),
        ...(override.orders?.storage || {}),
      },
    },
    telephony: {
      ...(base.telephony || {}),
      ...(override.telephony || {}),
      injection: {
        ...(base.telephony?.injection || {}),
        ...(override.telephony?.injection || {}),
      },
      storage: {
        ...(base.telephony?.storage || {}),
        ...(override.telephony?.storage || {}),
      },
      voice: {
        ...(base.telephony?.voice || {}),
        ...(override.telephony?.voice || {}),
      },
    },
    memory: {
      ...(base.memory || {}),
      ...(override.memory || {}),
      injection: {
        ...(base.memory?.injection || {}),
        ...(override.memory?.injection || {}),
      },
      storage: {
        ...(base.memory?.storage || {}),
        ...(override.memory?.storage || {}),
      },
      scopes: {
        ...(base.memory?.scopes || {}),
        ...(override.memory?.scopes || {}),
      },
    },
    subassistants: {
      ...(base.subassistants || {}),
      ...(override.subassistants || {}),
      // Arrays are replaced, not merged
      defaultTools: override.subassistants?.defaultTools ?? base.subassistants?.defaultTools,
      forbiddenTools: override.subassistants?.forbiddenTools ?? base.subassistants?.forbiddenTools,
    },
    input: {
      ...(base.input || {}),
      ...(override.input || {}),
      paste: {
        ...(base.input?.paste || {}),
        ...(override.input?.paste || {}),
        thresholds: {
          ...(base.input?.paste?.thresholds || {}),
          ...(override.input?.paste?.thresholds || {}),
        },
      },
    },
    budget: {
      ...(base.budget || {}),
      ...(override.budget || {}),
      session: {
        ...(base.budget?.session || {}),
        ...(override.budget?.session || {}),
      },
      assistant: {
        ...(base.budget?.assistant || {}),
        ...(override.budget?.assistant || {}),
      },
      swarm: {
        ...(base.budget?.swarm || {}),
        ...(override.budget?.swarm || {}),
      },
      project: {
        ...(base.budget?.project || {}),
        ...(override.budget?.project || {}),
      },
    },
    guardrails: {
      ...(base.guardrails || {}),
      ...(override.guardrails || {}),
    },
    capabilities: {
      ...(base.capabilities || {}),
      ...(override.capabilities || {}),
      allowedTools: override.capabilities?.allowedTools ?? base.capabilities?.allowedTools,
      deniedTools: override.capabilities?.deniedTools ?? base.capabilities?.deniedTools,
    },
  };
}

/**
 * Get the path to the assistants config directory
 */
export function getConfigDir(): string {
  const assistantsOverride = process.env.ASSISTANTS_DIR;
  if (assistantsOverride && assistantsOverride.trim()) {
    return assistantsOverride;
  }
  const envHome = process.env.HOME || process.env.USERPROFILE;
  const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
  return join(homeDir, '.assistants');
}

/**
 * Get the path to a specific config file
 */
export function getConfigPath(filename: string, baseDir?: string): string {
  return join(baseDir || getConfigDir(), filename);
}

/**
 * Get the path to the project config directory
 */
export function getProjectConfigDir(cwd: string = process.cwd()): string {
  return join(cwd, '.assistants');
}

/**
 * Get the path to the project runtime data directory.
 * Runtime-generated files (feedback, schedules, tasks, scripts, etc.)
 * go here instead of polluting the config directory.
 */
export function getProjectDataDir(cwd: string = process.cwd()): string {
  return join(cwd, '.assistants-data');
}

/**
 * Load configuration from multiple sources (merged)
 * Priority: project local > project > user > default
 */
export async function loadConfig(
  cwd: string = process.cwd(),
  baseDir?: string
): Promise<AssistantsConfig> {
  let config: AssistantsConfig = { ...DEFAULT_CONFIG };

  // Load user config
  const userConfigPath = getConfigPath('config.json', baseDir);
  const legacyUserConfigPath = getConfigPath('settings.json', baseDir);
  const userConfig = (await loadJsonFile<Partial<AssistantsConfig>>(userConfigPath))
    || (await loadJsonFile<Partial<AssistantsConfig>>(legacyUserConfigPath));
  config = mergeConfig(config, migrateConfigKeys(userConfig) || undefined);

  // Load project config
  const projectConfigPath = join(getProjectConfigDir(cwd), 'config.json');
  const projectConfig = await loadJsonFile<Partial<AssistantsConfig>>(projectConfigPath);
  config = mergeConfig(config, migrateConfigKeys(projectConfig) || undefined);

  // Load project local config (git-ignored)
  const localConfigPath = join(getProjectConfigDir(cwd), 'config.local.json');
  const localConfig = await loadJsonFile<Partial<AssistantsConfig>>(localConfigPath);
  config = mergeConfig(config, migrateConfigKeys(localConfig) || undefined);

  return config;
}

/**
 * Migrate old config keys to new names for backwards compatibility
 * Handles: subagents → subassistants, budget.agent → budget.assistant
 */
function migrateConfigKeys(config: Partial<AssistantsConfig> | null): Partial<AssistantsConfig> | null {
  if (!config) return null;
  const c = config as Record<string, unknown>;
  // subagents → subassistants
  if (c.subagents && !c.subassistants) {
    c.subassistants = c.subagents;
    delete c.subagents;
  }
  // budget.agent → budget.assistant
  if (config.budget) {
    const b = config.budget as Record<string, unknown>;
    if (b.agent && !b.assistant) {
      b.assistant = b.agent;
      delete b.agent;
    }
  }
  return config;
}

/**
 * Load hooks configuration from multiple sources (merged)
 */
export async function loadHooksConfig(
  cwd: string = process.cwd(),
  baseDir?: string
): Promise<HookConfig> {
  const hooks: HookConfig = {};

  // Load user hooks
  const userHooksPath = getConfigPath('hooks.json', baseDir);
  const userHooks = await loadJsonFile<{ hooks: HookConfig }>(userHooksPath);
  if (userHooks?.hooks) {
    mergeHooks(hooks, userHooks.hooks);
  }

  // Load project hooks
  const projectHooksPath = join(getProjectConfigDir(cwd), 'hooks.json');
  const projectHooks = await loadJsonFile<{ hooks: HookConfig }>(projectHooksPath);
  if (projectHooks?.hooks) {
    mergeHooks(hooks, projectHooks.hooks);
  }

  return hooks;
}

/**
 * Merge hooks from source into target
 */
function mergeHooks(target: HookConfig, source: HookConfig): void {
  for (const [event, matchers] of Object.entries(source)) {
    if (!target[event]) {
      target[event] = [];
    }
    target[event].push(...matchers);
  }
}

/**
 * Load a JSON file, returning null if it doesn't exist
 */
async function loadJsonFile<T>(path: string): Promise<T | null> {
  try {
    if (!hasRuntime()) {
      // Fallback to fs/promises if runtime not initialized
      const { readFile, access } = await import('fs/promises');
      try {
        await access(path);
      } catch {
        return null;
      }
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as T;
    }
    const runtime = getRuntime();
    const file = runtime.file(path);
    if (!(await file.exists())) {
      return null;
    }
    return await file.json();
  } catch {
    return null;
  }
}

/**
 * Ensure the config directory exists (using native fs for speed)
 */
export async function ensureConfigDir(sessionId?: string, baseDir?: string): Promise<void> {
  const { mkdir } = await import('fs/promises');
  const configDir = baseDir || getConfigDir();

  // Create only directories for files that stay on disk.
  // All data storage is in assistants.db now.
  const dirs = [
    mkdir(configDir, { recursive: true }),
    mkdir(join(configDir, 'logs'), { recursive: true }),
    mkdir(join(configDir, 'temp'), { recursive: true }),
    mkdir(join(configDir, 'messages'), { recursive: true }),
    mkdir(join(configDir, 'backups'), { recursive: true }),
  ];

  // Create session-specific temp folder if provided
  if (sessionId) {
    dirs.push(mkdir(join(configDir, 'temp', sessionId), { recursive: true }));
  }

  await Promise.all(dirs);
}

/**
 * Get the temp folder path for a session
 */
export function getTempFolder(sessionId: string, baseDir?: string): string {
  return join(baseDir || getConfigDir(), 'temp', sessionId);
}

/**
 * Load system prompt from ASSISTANTS.md files
 * Priority: project .assistants/ASSISTANTS.md > global ~/.assistants/ASSISTANTS.md
 * If both exist, they are concatenated (global first, then project)
 */
export async function loadSystemPrompt(
  cwd: string = process.cwd(),
  baseDir?: string
): Promise<string | null> {
  const prompts: string[] = [];

  // Load global system prompt
  const globalPromptPath = getConfigPath('ASSISTANTS.md', baseDir);
  const globalPrompt = await loadTextFile(globalPromptPath);
  if (globalPrompt) prompts.push(globalPrompt);

  // Load project system prompt
  const projectPromptPath = join(getProjectConfigDir(cwd), 'ASSISTANTS.md');
  const projectPrompt = await loadTextFile(projectPromptPath);
  if (projectPrompt) prompts.push(projectPrompt);

  if (prompts.length === 0) {
    // Use default system prompt when no user prompts exist
    return DEFAULT_SYSTEM_PROMPT;
  }

  return prompts.join('\n\n---\n\n');
}

/**
 * Load a text file, returning null if it doesn't exist
 */
async function loadTextFile(path: string): Promise<string | null> {
  try {
    if (!hasRuntime()) {
      // Fallback to fs/promises if runtime not initialized
      const { readFile, access } = await import('fs/promises');
      try {
        await access(path);
      } catch {
        return null;
      }
      return await readFile(path, 'utf-8');
    }
    const runtime = getRuntime();
    const file = runtime.file(path);
    if (!(await file.exists())) {
      return null;
    }
    return await file.text();
  } catch {
    return null;
  }
}
