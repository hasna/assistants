import type { HookConfig, HookMatcher, HookEvent, HookHandler } from '@hasna/assistants-shared';
import { createHash } from 'crypto';

/**
 * Generate a unique ID for a hook
 * Format: {event}-{type}-{hash}
 */
function generateHookId(event: string, hook: HookHandler): string {
  const content = hook.command || hook.prompt || '';
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `${event.toLowerCase()}-${hook.type}-${hash}`;
}

/**
 * Assign IDs to all hooks in a config, modifying them in place
 */
function assignHookIds(config: HookConfig): void {
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
 * Hook loader - manages hook configuration
 */
export class HookLoader {
  private hooks: HookConfig = {};

  constructor() {
    this.hooks = {};
  }

  /**
   * Load hooks from configuration
   */
  load(config: HookConfig): void {
    assignHookIds(config);
    this.hooks = config;
  }

  /**
   * Merge additional hooks
   */
  merge(config: HookConfig): void {
    assignHookIds(config);
    for (const [event, matchers] of Object.entries(config)) {
      if (!this.hooks[event]) {
        this.hooks[event] = [];
      }
      this.hooks[event].push(...matchers);
    }
  }

  /**
   * Get hooks for a specific event
   */
  getHooks(event: HookEvent): HookMatcher[] {
    return this.hooks[event] || [];
  }

  /**
   * Get all hooks
   */
  getAllHooks(): HookConfig {
    return { ...this.hooks };
  }

  /**
   * Check if there are hooks for an event
   */
  hasHooks(event: HookEvent): boolean {
    const hooks = this.hooks[event];
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks = {};
  }
}
