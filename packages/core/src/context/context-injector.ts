/**
 * Context Injector
 *
 * Handles automatic injection of environment context into the system prompt.
 * Supports configurable injection of datetime, timezone, working directory,
 * project info, OS details, git status, and more.
 */

import { platform, arch, userInfo, homedir } from 'os';
import { basename } from 'path';
import type {
  ContextInjectionConfig,
  ContextInjectionResult,
  InjectionConfigs,
} from './types';
import {
  DEFAULT_CONTEXT_INJECTION_CONFIG,
  mergeContextInjectionConfig,
} from './types';

/**
 * Cache entry with value and expiration
 */
interface CacheEntry {
  value: string;
  expires: number;
}

/**
 * Context Injector - prepares environment context for system prompts
 */
export class ContextInjector {
  private config: ContextInjectionConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private cwd: string;

  constructor(cwd: string, config?: Partial<ContextInjectionConfig>) {
    this.cwd = cwd;
    this.config = mergeContextInjectionConfig(
      DEFAULT_CONTEXT_INJECTION_CONFIG,
      config
    );
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<ContextInjectionConfig>): void {
    this.config = mergeContextInjectionConfig(this.config, config);
  }

  /**
   * Update the working directory
   * Clears cwd-dependent cached data (project, git, etc.)
   */
  setCwd(cwd: string): void {
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      // Clear cwd-dependent cache entries
      this.cache.delete('project');
      this.cache.delete('git');
    }
  }

  /**
   * Get the current working directory
   */
  getCwdPath(): string {
    return this.cwd;
  }

  /**
   * Check if injection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Prepare context injection for the current turn
   */
  async prepareInjection(): Promise<ContextInjectionResult> {
    if (!this.config.enabled) {
      return { content: '', tokenEstimate: 0, injectedTypes: [] };
    }

    const items: { type: string; value: string }[] = [];
    const maxTokens = this.config.maxTokens;
    let tokenEstimate = 0;

    const injections = this.config.injections as InjectionConfigs;

    // Datetime (no cache - always fresh)
    if (injections.datetime?.enabled) {
      const value = this.getDatetime();
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'datetime', value });
        tokenEstimate += tokens;
      }
    }

    // Timezone (session cache)
    if (injections.timezone?.enabled) {
      const value = await this.getCached('timezone', 3600000, () => this.getTimezone());
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'timezone', value });
        tokenEstimate += tokens;
      }
    }

    // CWD (session cache)
    if (injections.cwd?.enabled) {
      const value = this.getCwd();
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'cwd', value });
        tokenEstimate += tokens;
      }
    }

    // Project info (session cache)
    if (injections.project?.enabled) {
      const value = await this.getCached('project', 3600000, () => this.getProjectInfo());
      if (value) {
        const tokens = this.estimateTokens(value);
        if (tokenEstimate + tokens <= maxTokens) {
          items.push({ type: 'project', value });
          tokenEstimate += tokens;
        }
      }
    }

    // OS info (session cache)
    if (injections.os?.enabled) {
      const value = await this.getCached('os', 3600000, () => this.getOsInfo());
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'os', value });
        tokenEstimate += tokens;
      }
    }

    // Locale (session cache)
    if (injections.locale?.enabled) {
      const value = await this.getCached('locale', 3600000, () => this.getLocale());
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'locale', value });
        tokenEstimate += tokens;
      }
    }

    // Git info (30-60s cache)
    if (injections.git?.enabled) {
      const value = await this.getCached('git', 30000, () => this.getGitInfo());
      if (value) {
        const tokens = this.estimateTokens(value);
        if (tokenEstimate + tokens <= maxTokens) {
          items.push({ type: 'git', value });
          tokenEstimate += tokens;
        }
      }
    }

    // Username (session cache)
    if (injections.username?.enabled) {
      const value = await this.getCached('username', 3600000, () => this.getUsername());
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'username', value });
        tokenEstimate += tokens;
      }
    }

    // Custom text (no cache)
    if (injections.custom?.enabled && injections.custom.text) {
      const value = injections.custom.text;
      const tokens = this.estimateTokens(value);
      if (tokenEstimate + tokens <= maxTokens) {
        items.push({ type: 'custom', value });
        tokenEstimate += tokens;
      }
    }

    // Environment variables (session cache)
    if (injections.envVars?.enabled) {
      const value = this.getEnvVars();
      if (value) {
        const tokens = this.estimateTokens(value);
        if (tokenEstimate + tokens <= maxTokens) {
          items.push({ type: 'envVars', value });
          tokenEstimate += tokens;
        }
      }
    }

    if (items.length === 0) {
      return { content: '', tokenEstimate: 0, injectedTypes: [] };
    }

    // Format output
    const content = this.config.format === 'compact'
      ? this.formatCompact(items)
      : this.formatFull(items);

    return {
      content,
      tokenEstimate,
      injectedTypes: items.map((i) => i.type),
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ============================================
  // Individual Injectors
  // ============================================

  private getDatetime(): string {
    const injections = this.config.injections as InjectionConfigs;
    const config = injections.datetime;
    const now = new Date();

    let dateStr: string;
    switch (config?.format) {
      case 'relative':
        dateStr = now.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        break;
      case 'short':
        dateStr = now.toISOString().split('T')[0];
        break;
      case 'ISO':
      default:
        dateStr = now.toISOString();
        break;
    }

    if (config?.includeTimezone !== false) {
      const tz = this.getTimezoneAbbr();
      if (tz && config?.format !== 'ISO') {
        dateStr += ` (${tz})`;
      }
    }

    return dateStr;
  }

  private getTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  }

  private getTimezoneAbbr(): string {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' });
      const parts = formatter.formatToParts(new Date());
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      return tzPart?.value || '';
    } catch {
      return '';
    }
  }

  private getCwd(): string {
    const injections = this.config.injections as InjectionConfigs;
    const truncate = injections.cwd?.truncate || 100;

    // Normalize path separators for cross-platform support (Windows uses \)
    let path = this.cwd.replace(/\\/g, '/');
    const home = homedir().replace(/\\/g, '/');

    // Replace home directory with ~
    if (path.startsWith(home)) {
      path = '~' + path.slice(home.length);
    }

    // Truncate if needed
    if (path.length > truncate) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length > 2) {
        // Handle ~ prefix correctly to avoid ~/~/...
        const startsWithTilde = parts[0] === '~';
        // On Windows, first part after split might be drive letter (C:)
        const startsWithDrive = /^[a-zA-Z]:$/.test(parts[0]);
        const startIdx = startsWithTilde ? 1 : (startsWithDrive ? 1 : 0);
        const lastPart = parts[parts.length - 1];

        if (parts.length - startIdx > 1) {
          const firstSignificantPart = parts[startIdx];
          if (startsWithTilde) {
            path = `~/${firstSignificantPart}/.../${lastPart}`;
          } else if (startsWithDrive) {
            path = `${parts[0]}/${firstSignificantPart}/.../${lastPart}`;
          } else {
            path = `/${parts[0]}/.../${lastPart}`;
          }
        }
      }
    }

    return path;
  }

  private async getProjectInfo(): Promise<string | null> {
    const injections = this.config.injections as InjectionConfigs;
    const config = injections.project;
    const parts: string[] = [];

    // Try to detect project name from directory
    const dirName = basename(this.cwd);
    parts.push(dirName);

    // Include package.json info if configured
    if (config?.includePackageJson) {
      try {
        const pkgPath = `${this.cwd}/package.json`;
        const { readFile } = await import('fs/promises');
        const content = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (pkg.name && pkg.name !== dirName) {
          parts[0] = pkg.name;
        }
        if (pkg.version) {
          parts.push(`v${pkg.version}`);
        }
      } catch {
        // No package.json or not readable
      }
    }

    // Include git info if configured
    if (config?.includeGitInfo) {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync('git remote get-url origin 2>/dev/null', {
          cwd: this.cwd,
        });
        const url = stdout.trim();
        if (url) {
          const repoMatch = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
          if (repoMatch) {
            parts.push(`(${repoMatch[1]})`);
          }
        }
      } catch {
        // Not a git repo or git not available
      }
    }

    return parts.length > 0 ? parts.join(' ') : null;
  }

  private getOsInfo(): string {
    const os = platform();
    const architecture = arch();
    const osName =
      os === 'darwin'
        ? 'macOS'
        : os === 'win32'
          ? 'Windows'
          : os === 'linux'
            ? 'Linux'
            : os;
    return `${osName} (${architecture})`;
  }

  private getLocale(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      return 'en-US';
    }
  }

  private async getGitInfo(): Promise<string | null> {
    const injections = this.config.injections as InjectionConfigs;
    const config = injections.git;
    const parts: string[] = [];

    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Get branch name
      if (config?.includeBranch !== false) {
        try {
          const { stdout } = await execAsync('git branch --show-current 2>/dev/null', {
            cwd: this.cwd,
          });
          const branch = stdout.trim();
          if (branch) {
            parts.push(`branch: ${branch}`);
          }
        } catch {
          // Not a git repo
          return null;
        }
      }

      // Get working tree status
      if (config?.includeStatus) {
        try {
          const { stdout } = await execAsync('git status --porcelain 2>/dev/null', {
            cwd: this.cwd,
          });
          const lines = stdout.trim().split('\n').filter(Boolean);
          if (lines.length > 0) {
            parts.push(`${lines.length} modified`);
          } else {
            parts.push('clean');
          }
        } catch {
          // Ignore
        }
      }

      // Get recent commits
      const recentCommits = config?.includeRecentCommits || 0;
      if (recentCommits > 0) {
        try {
          const { stdout } = await execAsync(
            `git log -${recentCommits} --oneline 2>/dev/null`,
            { cwd: this.cwd }
          );
          const commits = stdout.trim().split('\n').filter(Boolean);
          if (commits.length > 0) {
            parts.push(`recent: ${commits[0]}`);
          }
        } catch {
          // Ignore
        }
      }
    } catch {
      return null;
    }

    return parts.length > 0 ? parts.join(', ') : null;
  }

  private getUsername(): string {
    try {
      return userInfo().username;
    } catch {
      return process.env.USER || process.env.USERNAME || 'unknown';
    }
  }

  private getEnvVars(): string | null {
    const injections = this.config.injections as InjectionConfigs;
    const allowed = injections.envVars?.allowed || [];
    if (allowed.length === 0) return null;

    const values: string[] = [];
    for (const name of allowed) {
      const value = process.env[name];
      if (value) {
        values.push(`${name}=${value}`);
      }
    }

    return values.length > 0 ? values.join(', ') : null;
  }

  // ============================================
  // Formatting
  // ============================================

  private formatFull(items: { type: string; value: string }[]): string {
    const lines: string[] = [];

    // Type to label mapping
    const labels: Record<string, string> = {
      datetime: 'Time',
      timezone: 'Timezone',
      cwd: 'Directory',
      project: 'Project',
      os: 'System',
      locale: 'Locale',
      git: 'Git',
      username: 'User',
      custom: 'Note',
      envVars: 'Environment',
    };

    for (const item of items) {
      const label = labels[item.type] || item.type;
      lines.push(`- **${label}:** ${item.value}`);
    }

    return `## Environment Context\n\n${lines.join('\n')}`;
  }

  private formatCompact(items: { type: string; value: string }[]): string {
    const parts = items.map((item) => item.value);
    return `[Context: ${parts.join(' | ')}]`;
  }

  // ============================================
  // Caching
  // ============================================

  private async getCached(
    key: string,
    ttlMs: number,
    fn: () => string | Promise<string | null>
  ): Promise<string> {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry && entry.expires > now) {
      return entry.value;
    }

    const value = await fn();
    if (value) {
      this.cache.set(key, { value, expires: now + ttlMs });
    }

    return value || '';
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Estimate token count (rough approximation)
   * Uses ~4 characters per token as a simple heuristic
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
