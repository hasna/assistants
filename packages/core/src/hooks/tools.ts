/**
 * Hooks tools for assistant use
 * Allows assistants to inspect and manage event hooks
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { HookStore } from './store';

/**
 * hooks_list - List all registered hooks
 */
export const hooksListTool: Tool = {
  name: 'hooks_list',
  description: 'List all registered hooks with their event type, matcher, handler type, and source location.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * hooks_get - Get specific hook details
 */
export const hooksGetTool: Tool = {
  name: 'hooks_get',
  description: 'Get detailed information about a specific hook by ID.',
  parameters: {
    type: 'object',
    properties: {
      hookId: {
        type: 'string',
        description: 'The hook ID to retrieve',
      },
    },
    required: ['hookId'],
  },
};

/**
 * hooks_enable - Enable a hook
 */
export const hooksEnableTool: Tool = {
  name: 'hooks_enable',
  description: 'Enable a specific hook by ID so it will execute when its event fires.',
  parameters: {
    type: 'object',
    properties: {
      hookId: {
        type: 'string',
        description: 'The hook ID to enable',
      },
    },
    required: ['hookId'],
  },
};

/**
 * hooks_disable - Disable a hook
 */
export const hooksDisableTool: Tool = {
  name: 'hooks_disable',
  description: 'Disable a specific hook by ID so it will not execute when its event fires.',
  parameters: {
    type: 'object',
    properties: {
      hookId: {
        type: 'string',
        description: 'The hook ID to disable',
      },
    },
    required: ['hookId'],
  },
};

/**
 * Create executors for hooks tools
 */
export function createHooksToolExecutors(
  getHookStore: () => HookStore | null
): Record<string, ToolExecutor> {
  return {
    hooks_list: async () => {
      const store = getHookStore();
      if (!store) {
        return 'Hooks store is not available.';
      }

      const hooks = store.listHooks();

      if (hooks.length === 0) {
        return 'No hooks configured. Add hooks to .assistants/hooks.json or ~/.config/assistants/hooks.json.';
      }

      const lines: string[] = [];
      lines.push(`## Hooks (${hooks.length})`);
      lines.push('');

      for (const hook of hooks) {
        const enabled = hook.handler.enabled !== false ? 'enabled' : 'disabled';
        const matcherStr = hook.matcher ? ` [${hook.matcher}]` : '';
        lines.push(`**${hook.id}**`);
        lines.push(`  Event: ${hook.event}${matcherStr}`);
        lines.push(`  Type: ${hook.handler.type}`);
        lines.push(`  Status: ${enabled}`);
        lines.push(`  Location: ${hook.location}`);
        if (hook.handler.command) {
          lines.push(`  Command: ${hook.handler.command}`);
        }
        if (hook.handler.prompt) {
          lines.push(`  Prompt: ${hook.handler.prompt.slice(0, 80)}${hook.handler.prompt.length > 80 ? '...' : ''}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    },

    hooks_get: async (input) => {
      const store = getHookStore();
      if (!store) {
        return 'Hooks store is not available.';
      }

      const hookId = String(input.hookId || '').trim();
      if (!hookId) {
        return 'Error: hookId is required.';
      }

      const info = store.getHook(hookId);
      if (!info) {
        return `Hook ${hookId} not found.`;
      }

      return JSON.stringify({
        id: info.id,
        event: info.event,
        matcher: info.matcher,
        handler: info.handler,
        location: info.location,
        filePath: info.filePath,
      }, null, 2);
    },

    hooks_enable: async (input) => {
      const store = getHookStore();
      if (!store) {
        return 'Hooks store is not available.';
      }

      const hookId = String(input.hookId || '').trim();
      if (!hookId) {
        return 'Error: hookId is required.';
      }

      const hook = store.getHook(hookId);
      if (!hook) {
        return `Hook ${hookId} not found.`;
      }

      // Update the hook's enabled status in its source file
      const config = store.loadAll();
      let found = false;

      for (const [_event, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          for (const h of matcher.hooks) {
            if (h.id === hookId) {
              h.enabled = true;
              found = true;
            }
          }
        }
      }

      if (!found) {
        return `Hook ${hookId} not found in configuration.`;
      }

      // Save back to the hook's source location
      store.save(hook.location, config);

      return `Hook ${hookId} enabled.`;
    },

    hooks_disable: async (input) => {
      const store = getHookStore();
      if (!store) {
        return 'Hooks store is not available.';
      }

      const hookId = String(input.hookId || '').trim();
      if (!hookId) {
        return 'Error: hookId is required.';
      }

      const hook = store.getHook(hookId);
      if (!hook) {
        return `Hook ${hookId} not found.`;
      }

      // Update the hook's enabled status in its source file
      const config = store.loadAll();
      let found = false;

      for (const [_event, matchers] of Object.entries(config)) {
        for (const matcher of matchers) {
          for (const h of matcher.hooks) {
            if (h.id === hookId) {
              h.enabled = false;
              found = true;
            }
          }
        }
      }

      if (!found) {
        return `Hook ${hookId} not found in configuration.`;
      }

      // Save back to the hook's source location
      store.save(hook.location, config);

      return `Hook ${hookId} disabled.`;
    },
  };
}

/**
 * All hooks tools
 */
export const hooksTools: Tool[] = [
  hooksListTool,
  hooksGetTool,
  hooksEnableTool,
  hooksDisableTool,
];

/**
 * Register hooks tools with a tool registry
 */
export function registerHooksTools(
  registry: ToolRegistry,
  getHookStore: () => HookStore | null
): void {
  const executors = createHooksToolExecutors(getHookStore);

  for (const tool of hooksTools) {
    registry.register(tool, executors[tool.name]);
  }
}
