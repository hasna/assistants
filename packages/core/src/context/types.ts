import type { Message } from '@hasna/assistants-shared';

// ============================================
// Context Manager Types
// ============================================

export interface ContextConfig {
  enabled: boolean;
  maxContextTokens: number;
  targetContextTokens: number;
  summaryTriggerRatio: number;
  keepRecentMessages: number;
  keepSystemPrompt: boolean;
  summaryStrategy: 'llm' | 'hybrid';
  summaryModel?: string;
  summaryMaxTokens: number;
  maxMessages: number;
  /**
   * Number of recent tool calls to always preserve during summarization.
   * This ensures the assistant remembers what it just did and can continue
   * multi-step operations after context compaction.
   * Default: 5
   */
  preserveLastToolCalls?: number;
}

export interface ContextState {
  totalTokens: number;
  messageCount: number;
  summaryCount: number;
  lastSummaryAt?: string;
  lastSummaryMessageCount?: number;
  lastSummaryTokensBefore?: number;
  lastSummaryTokensAfter?: number;
  lastSummaryStrategy?: string;
}

export interface ContextProcessResult {
  messages: Message[];
  summarized: boolean;
  summary?: string;
  tokensBefore: number;
  tokensAfter: number;
  summarizedCount: number;
}

export interface ContextInfo {
  config: ContextConfig;
  state: ContextState;
}

// ============================================
// Context Injection Types
// ============================================

/**
 * Configuration for individual injection types
 */
export interface DatetimeInjectionConfig {
  enabled: boolean;
  /** Format: "ISO" | "relative" | "short" */
  format?: 'ISO' | 'relative' | 'short';
  /** Include timezone in output */
  includeTimezone?: boolean;
}

export interface TimezoneInjectionConfig {
  enabled: boolean;
}

export interface CwdInjectionConfig {
  enabled: boolean;
  /** Maximum path length before truncation */
  truncate?: number;
}

export interface ProjectInjectionConfig {
  enabled: boolean;
  /** Include package.json info (name, version) */
  includePackageJson?: boolean;
  /** Include git repository info */
  includeGitInfo?: boolean;
}

export interface OsInjectionConfig {
  enabled: boolean;
}

export interface LocaleInjectionConfig {
  enabled: boolean;
}

export interface GitInjectionConfig {
  enabled: boolean;
  /** Include current branch name */
  includeBranch?: boolean;
  /** Include working tree status (modified files count) */
  includeStatus?: boolean;
  /** Number of recent commits to include (0 to disable) */
  includeRecentCommits?: number;
}

export interface UsernameInjectionConfig {
  enabled: boolean;
}

export interface CustomInjectionConfig {
  enabled: boolean;
  /** Custom text to inject */
  text?: string;
}

export interface EnvVarsInjectionConfig {
  enabled: boolean;
  /** Whitelist of environment variable names to include */
  allowed?: string[];
}

/**
 * All injection type configurations
 */
export interface InjectionConfigs {
  datetime: DatetimeInjectionConfig;
  timezone: TimezoneInjectionConfig;
  cwd: CwdInjectionConfig;
  project: ProjectInjectionConfig;
  os: OsInjectionConfig;
  locale: LocaleInjectionConfig;
  git: GitInjectionConfig;
  username: UsernameInjectionConfig;
  custom: CustomInjectionConfig;
  envVars: EnvVarsInjectionConfig;
}

/**
 * Main context injection configuration
 */
export interface ContextInjectionConfig {
  /** Whether context injection is enabled globally */
  enabled: boolean;
  /** Maximum tokens for injected context */
  maxTokens: number;
  /** Output format: "full" for markdown sections, "compact" for single line */
  format?: 'full' | 'compact';
  /** Individual injection type configurations */
  injections: Partial<InjectionConfigs>;
}

/**
 * Result of context injection preparation
 */
export interface ContextInjectionResult {
  /** Formatted context string to inject */
  content: string;
  /** Estimated token count */
  tokenEstimate: number;
  /** List of injection types that were included */
  injectedTypes: string[];
}

/**
 * Default configuration with sensible defaults
 * datetime, timezone, cwd, project ON by default (minimal, useful info)
 * os, locale, git, username, custom, envVars OFF by default (optional/privacy)
 */
export const DEFAULT_CONTEXT_INJECTION_CONFIG: ContextInjectionConfig = {
  enabled: true,
  maxTokens: 200,
  format: 'full',
  injections: {
    datetime: {
      enabled: true,
      format: 'ISO',
      includeTimezone: true,
    },
    timezone: {
      enabled: true,
    },
    cwd: {
      enabled: true,
      truncate: 100,
    },
    project: {
      enabled: true,
      includePackageJson: false,
      includeGitInfo: false,
    },
    os: {
      enabled: false,
    },
    locale: {
      enabled: false,
    },
    git: {
      enabled: false,
      includeBranch: true,
      includeStatus: false,
      includeRecentCommits: 0,
    },
    username: {
      enabled: false,
    },
    custom: {
      enabled: false,
      text: '',
    },
    envVars: {
      enabled: false,
      allowed: ['NODE_ENV'],
    },
  },
};

/**
 * Merge partial config with defaults
 */
export function mergeContextInjectionConfig(
  base: ContextInjectionConfig,
  override?: Partial<ContextInjectionConfig>
): ContextInjectionConfig {
  if (!override) return base;

  const baseInj = base.injections;
  const overrideInj = override.injections || {};

  return {
    enabled: override.enabled ?? base.enabled,
    maxTokens: override.maxTokens ?? base.maxTokens,
    format: override.format ?? base.format,
    injections: {
      datetime: baseInj.datetime
        ? { ...baseInj.datetime, ...(overrideInj.datetime || {}) }
        : overrideInj.datetime,
      timezone: baseInj.timezone
        ? { ...baseInj.timezone, ...(overrideInj.timezone || {}) }
        : overrideInj.timezone,
      cwd: baseInj.cwd
        ? { ...baseInj.cwd, ...(overrideInj.cwd || {}) }
        : overrideInj.cwd,
      project: baseInj.project
        ? { ...baseInj.project, ...(overrideInj.project || {}) }
        : overrideInj.project,
      os: baseInj.os
        ? { ...baseInj.os, ...(overrideInj.os || {}) }
        : overrideInj.os,
      locale: baseInj.locale
        ? { ...baseInj.locale, ...(overrideInj.locale || {}) }
        : overrideInj.locale,
      git: baseInj.git
        ? { ...baseInj.git, ...(overrideInj.git || {}) }
        : overrideInj.git,
      username: baseInj.username
        ? { ...baseInj.username, ...(overrideInj.username || {}) }
        : overrideInj.username,
      custom: baseInj.custom
        ? { ...baseInj.custom, ...(overrideInj.custom || {}) }
        : overrideInj.custom,
      envVars: baseInj.envVars
        ? { ...baseInj.envVars, ...(overrideInj.envVars || {}) }
        : overrideInj.envVars,
    },
  };
}
