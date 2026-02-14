import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import type { HookConfig, HookMatcher, HookEvent, HookHandler } from '@hasna/assistants-shared';
import { getConfigDir } from '../config';

/**
 * Hook storage location
 */
export type HookLocation = 'user' | 'project' | 'local';

/**
 * Information about a hook including its source
 */
export interface HookInfo {
  id: string;
  event: HookEvent;
  matcher?: string;
  handler: HookHandler;
  location: HookLocation;
  filePath: string;
}

/**
 * Generate a unique ID for a hook
 */
function generateHookId(event: string, hook: HookHandler): string {
  const content = hook.command || hook.prompt || '';
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `${event.toLowerCase()}-${hook.type}-${hash}`;
}

/**
 * Ensure all hooks have IDs
 */
function ensureHookIds(config: HookConfig): void {
  for (const [event, matchers] of Object.entries(config)) {
    for (const matcher of matchers) {
      for (const hook of matcher.hooks) {
        if (!hook.id) {
          hook.id = generateHookId(event, hook);
        }
      }
    }
  }
}

/**
 * Hook store - manages hook persistence across locations
 */
export class HookStore {
  private cwd: string;
  private baseDir?: string;

  constructor(cwd: string = process.cwd(), baseDir?: string) {
    this.cwd = cwd;
    this.baseDir = baseDir;
  }

  /**
   * Get file path for a hook location
   */
  private getFilePath(location: HookLocation): string {
    switch (location) {
      case 'user':
        return join(this.baseDir || getConfigDir(), 'hooks.json');
      case 'project':
        return join(this.cwd, '.assistants', 'hooks.json');
      case 'local':
        return join(this.cwd, '.assistants', 'hooks.local.json');
    }
  }

  /**
   * Load hooks from a specific location
   */
  private loadFrom(location: HookLocation): HookConfig {
    const filePath = this.getFilePath(location);
    if (!existsSync(filePath)) {
      return {};
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const config = data.hooks || data;
      ensureHookIds(config);
      return config;
    } catch {
      return {};
    }
  }

  /**
   * Save hooks to a specific location
   */
  save(location: HookLocation, config: HookConfig): void {
    const filePath = this.getFilePath(location);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    ensureHookIds(config);
    writeFileSync(filePath, JSON.stringify({ hooks: config }, null, 2), 'utf-8');
  }

  /**
   * Load hooks from all sources (user, project, local)
   * Merges all sources with later sources taking precedence
   */
  loadAll(): HookConfig {
    const userHooks = this.loadFrom('user');
    const projectHooks = this.loadFrom('project');
    const localHooks = this.loadFrom('local');

    // Merge all configs
    const merged: HookConfig = {};

    for (const config of [userHooks, projectHooks, localHooks]) {
      for (const [event, matchers] of Object.entries(config)) {
        if (!merged[event]) {
          merged[event] = [];
        }
        merged[event].push(...matchers);
      }
    }

    return merged;
  }

  /**
   * Add a single hook to a specific location
   */
  addHook(
    event: HookEvent,
    handler: HookHandler,
    location: HookLocation = 'project',
    matcher?: string
  ): string {
    const config = this.loadFrom(location);

    if (!handler.id) {
      handler.id = generateHookId(event, handler);
    }

    if (!config[event]) {
      config[event] = [];
    }

    // Check if there's an existing matcher that matches
    let targetMatcher = config[event].find((m) => m.matcher === matcher);
    if (!targetMatcher) {
      targetMatcher = { matcher, hooks: [] };
      config[event].push(targetMatcher);
    }

    targetMatcher.hooks.push(handler);
    this.save(location, config);

    return handler.id;
  }

  /**
   * Remove a hook by ID from all locations
   */
  removeHook(hookId: string): boolean {
    let removed = false;

    for (const location of ['user', 'project', 'local'] as HookLocation[]) {
      const config = this.loadFrom(location);
      let modified = false;

      for (const [event, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          const idx = matcher.hooks.findIndex((h) => h.id === hookId);
          if (idx !== -1) {
            matcher.hooks.splice(idx, 1);
            modified = true;
            removed = true;
          }
        }

        // Clean up empty matchers
        config[event] = matchers.filter((m) => m.hooks.length > 0);
      }

      // Clean up empty events
      for (const event of Object.keys(config)) {
        if (config[event].length === 0) {
          delete config[event];
        }
      }

      if (modified) {
        this.save(location, config);
      }
    }

    return removed;
  }

  /**
   * Enable or disable a hook by ID
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    for (const location of ['user', 'project', 'local'] as HookLocation[]) {
      const config = this.loadFrom(location);
      let modified = false;

      for (const matchers of Object.values(config)) {
        for (const matcher of matchers) {
          const hook = matcher.hooks.find((h) => h.id === hookId);
          if (hook) {
            hook.enabled = enabled;
            modified = true;
          }
        }
      }

      if (modified) {
        this.save(location, config);
        return true;
      }
    }

    return false;
  }

  /**
   * Get a hook by ID
   */
  getHook(hookId: string): HookInfo | null {
    for (const location of ['local', 'project', 'user'] as HookLocation[]) {
      const filePath = this.getFilePath(location);
      const config = this.loadFrom(location);

      for (const [event, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          const hook = matcher.hooks.find((h) => h.id === hookId);
          if (hook) {
            return {
              id: hook.id!,
              event: event as HookEvent,
              matcher: matcher.matcher,
              handler: hook,
              location,
              filePath,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * List all hooks with metadata
   */
  listHooks(): HookInfo[] {
    const hooks: HookInfo[] = [];
    const seenIds = new Set<string>();

    // Process in priority order (local > project > user)
    for (const location of ['local', 'project', 'user'] as HookLocation[]) {
      const filePath = this.getFilePath(location);
      const config = this.loadFrom(location);

      for (const [event, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          for (const hook of matcher.hooks) {
            const id = hook.id || generateHookId(event, hook);
            if (!seenIds.has(id)) {
              seenIds.add(id);
              hooks.push({
                id,
                event: event as HookEvent,
                matcher: matcher.matcher,
                handler: hook,
                location,
                filePath,
              });
            }
          }
        }
      }
    }

    return hooks;
  }

  /**
   * Update working directory
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }
}
