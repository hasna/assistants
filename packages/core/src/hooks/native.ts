import type {
  HookEvent,
  HookInput,
  HookOutput,
  NativeHook,
  NativeHookContext,
  NativeHookConfig,
} from '@hasna/assistants-shared';

/**
 * Native Hook Registry - manages system-level hooks that cannot be deleted
 *
 * Native hooks:
 * - Run before user-defined hooks
 * - Are ordered by priority (lower = runs first)
 * - Cannot be deleted or disabled by users
 * - Are defined in code, not config files
 */
export class NativeHookRegistry {
  private hooks: Map<HookEvent, NativeHook[]> = new Map();
  private config: NativeHookConfig = {};

  /**
   * Register a native hook
   */
  register(hook: NativeHook): void {
    const eventHooks = this.hooks.get(hook.event) || [];
    const deduped = eventHooks.filter((existing) => existing.id !== hook.id);
    deduped.push(hook);
    // Sort by priority (lower = runs first)
    deduped.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.event, deduped);
  }

  /**
   * Get all native hooks for an event
   */
  getHooks(event: HookEvent): NativeHook[] {
    return this.hooks.get(event) || [];
  }

  /**
   * Check if there are native hooks for an event
   */
  hasHooks(event: HookEvent): boolean {
    const hooks = this.hooks.get(event);
    return hooks !== undefined && hooks.length > 0;
  }

  /**
   * Set configuration for native hooks
   */
  setConfig(config: NativeHookConfig): void {
    this.config = config;
  }

  /**
   * Get current configuration
   */
  getConfig(): NativeHookConfig {
    return this.config;
  }

  /**
   * Execute all native hooks for an event
   * Returns the first blocking result, or null if none block
   */
  async execute(
    event: HookEvent,
    input: HookInput,
    context: Omit<NativeHookContext, 'config'>
  ): Promise<HookOutput | null> {
    const hooks = this.getHooks(event);
    if (hooks.length === 0) {
      return null;
    }

    const fullContext: NativeHookContext = {
      ...context,
      config: this.config,
    };

    for (const hook of hooks) {
      // Skip disabled hooks
      if (hook.enabled === false) {
        continue;
      }

      // Check if hook is disabled via config
      if (this.isHookDisabled(hook.id)) {
        continue;
      }

      try {
        const result = await hook.handler(input, fullContext);

        // If hook returns a blocking result, stop processing
        if (result && result.continue === false) {
          return result;
        }

        // If hook returns a permission decision, use it
        if (result?.permissionDecision) {
          return result;
        }
      } catch (error) {
        console.error(`Native hook ${hook.id} error:`, error);
        // Native hooks failing should not block the assistant
        continue;
      }
    }

    return null;
  }

  /**
   * Check if a hook is disabled via config
   */
  private isHookDisabled(hookId: string): boolean {
    // Scope verification can be disabled via config
    if (hookId === 'scope-verification') {
      return this.config.scopeVerification?.enabled === false;
    }
    return false;
  }

  /**
   * Enable or disable a native hook
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    // Find the hook
    let found = false;
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find((h) => h.id === hookId);
      if (hook) {
        found = true;
        break;
      }
    }

    if (!found) {
      return false;
    }

    // Update config based on hook ID
    if (hookId === 'scope-verification') {
      this.config.scopeVerification = {
        ...this.config.scopeVerification,
        enabled,
      };
    }

    return true;
  }

  /**
   * Check if a native hook is enabled
   */
  isEnabled(hookId: string): boolean {
    return !this.isHookDisabled(hookId);
  }

  /**
   * Get a specific native hook by ID
   */
  getHook(hookId: string): NativeHook | null {
    for (const hooks of this.hooks.values()) {
      const hook = hooks.find((h) => h.id === hookId);
      if (hook) {
        return hook;
      }
    }
    return null;
  }

  /**
   * List all registered native hooks
   */
  listAll(): { event: HookEvent; hooks: NativeHook[] }[] {
    const result: { event: HookEvent; hooks: NativeHook[] }[] = [];
    for (const [event, hooks] of this.hooks.entries()) {
      result.push({ event, hooks });
    }
    return result;
  }

  /**
   * List all native hooks as a flat array with enabled status
   */
  listFlat(): Array<{ hook: NativeHook; event: HookEvent; enabled: boolean }> {
    const result: Array<{ hook: NativeHook; event: HookEvent; enabled: boolean }> = [];
    for (const [event, hooks] of this.hooks.entries()) {
      for (const hook of hooks) {
        result.push({
          hook,
          event,
          enabled: this.isEnabled(hook.id),
        });
      }
    }
    return result;
  }

  /**
   * Clear all hooks (mainly for testing)
   */
  clear(): void {
    this.hooks.clear();
  }
}

/**
 * Singleton registry instance for native hooks
 */
export const nativeHookRegistry = new NativeHookRegistry();
