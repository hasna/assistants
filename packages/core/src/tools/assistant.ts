/**
 * Assistant Management Tools
 *
 * Tools for listing, creating, updating, deleting, and switching assistants.
 * Enables assistants to programmatically manage other assistants.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { AssistantManager } from '../identity';
import { isSystemAssistantId } from '../identity/system-assistants';

// ============================================
// Types
// ============================================

export interface AssistantToolsContext {
  getAssistantManager: () => AssistantManager | null;
}

// ============================================
// Tool Definitions
// ============================================

export const assistantListTool: Tool = {
  name: 'assistant_list',
  description: 'List all configured assistants with their details (id, name, description, model, active status).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const assistantGetTool: Tool = {
  name: 'assistant_get',
  description: 'Get detailed information about a specific assistant by ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The assistant ID to retrieve',
      },
    },
    required: ['id'],
  },
};

export const assistantCreateTool: Tool = {
  name: 'assistant_create',
  description: 'Create a new assistant with the specified configuration.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new assistant',
      },
      description: {
        type: 'string',
        description: 'Optional description of the assistant',
      },
      avatar: {
        type: 'string',
        description: 'Optional avatar emoji or icon for the assistant (e.g., "🤖", "🧠", "🔧")',
      },
      color: {
        type: 'string',
        description: 'Optional theme color for the assistant (e.g., "cyan", "green", "magenta", "#ff6600")',
      },
      model: {
        type: 'string',
        description: 'LLM model to use (e.g., "claude-opus-4-5", "claude-sonnet-4-20250514")',
      },
      systemPromptAddition: {
        type: 'string',
        description: 'Optional system prompt addition for this assistant',
      },
      maxTokens: {
        type: 'number',
        description: 'Optional maximum tokens per response',
      },
      temperature: {
        type: 'number',
        description: 'Optional temperature setting (0.0-2.0)',
      },
      enabledTools: {
        type: 'array',
        description: 'Optional list of tool names this assistant can use (whitelist)',
        items: { type: 'string', description: 'Tool name' },
      },
      disabledTools: {
        type: 'array',
        description: 'Optional list of tool names this assistant cannot use (blacklist)',
        items: { type: 'string', description: 'Tool name' },
      },
    },
    required: ['name'],
  },
};

export const assistantUpdateTool: Tool = {
  name: 'assistant_update',
  description: 'Update an existing assistant\'s configuration. Supports changing name, description, avatar, color, model, system prompt, tokens, temperature, and tool access.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The assistant ID to update',
      },
      name: {
        type: 'string',
        description: 'New name for the assistant',
      },
      description: {
        type: 'string',
        description: 'New description for the assistant',
      },
      avatar: {
        type: 'string',
        description: 'New avatar emoji or icon (e.g., "🤖", "🧠", "🔧")',
      },
      color: {
        type: 'string',
        description: 'New theme color (e.g., "cyan", "green", "magenta", "#ff6600")',
      },
      model: {
        type: 'string',
        description: 'New LLM model to use',
      },
      systemPromptAddition: {
        type: 'string',
        description: 'New system prompt addition',
      },
      maxTokens: {
        type: 'number',
        description: 'New maximum tokens per response',
      },
      temperature: {
        type: 'number',
        description: 'New temperature setting (0.0-2.0)',
      },
      enabledTools: {
        type: 'array',
        description: 'Tool names this assistant can use (whitelist, replaces existing)',
        items: { type: 'string', description: 'Tool name' },
      },
      disabledTools: {
        type: 'array',
        description: 'Tool names this assistant cannot use (blacklist, replaces existing)',
        items: { type: 'string', description: 'Tool name' },
      },
    },
    required: ['id'],
  },
};

export const assistantDeleteTool: Tool = {
  name: 'assistant_delete',
  description: 'Delete an assistant by ID. Cannot delete the last remaining assistant.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The assistant ID to delete',
      },
    },
    required: ['id'],
  },
};

export const assistantSwitchTool: Tool = {
  name: 'assistant_switch',
  description: 'Switch to a different assistant by ID. The new assistant becomes active.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The assistant ID to switch to',
      },
    },
    required: ['id'],
  },
};

export const assistantTools: Tool[] = [
  assistantListTool,
  assistantGetTool,
  assistantCreateTool,
  assistantUpdateTool,
  assistantDeleteTool,
  assistantSwitchTool,
];

// ============================================
// Tool Executors Factory
// ============================================

export function createAssistantToolExecutors(
  context: AssistantToolsContext
): Record<string, ToolExecutor> {
  return {
    assistant_list: async (): Promise<string> => {
      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      const assistants = manager.listAssistants();
      const activeId = manager.getActiveId();

      const list = assistants.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description || null,
        model: a.settings.model,
        backend: a.settings.backend || 'native',
        isSystem: a.isSystem || false,
        isActive: a.id === activeId,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      }));

      return JSON.stringify({
        success: true,
        total: list.length,
        activeId,
        assistants: list,
      });
    },

    assistant_get: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Assistant ID is required',
        });
      }

      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      const assistants = manager.listAssistants();
      const assistant = assistants.find((a) => a.id === id);

      if (!assistant) {
        return JSON.stringify({
          success: false,
          error: `Assistant "${id}" not found`,
        });
      }

      const activeId = manager.getActiveId();

      return JSON.stringify({
        success: true,
        assistant: {
          id: assistant.id,
          name: assistant.name,
          description: assistant.description || null,
          avatar: assistant.avatar || null,
          settings: {
            model: assistant.settings.model,
            maxTokens: assistant.settings.maxTokens,
            temperature: assistant.settings.temperature,
            systemPromptAddition: assistant.settings.systemPromptAddition,
            enabledTools: assistant.settings.enabledTools,
            disabledTools: assistant.settings.disabledTools,
          },
          isActive: assistant.id === activeId,
          createdAt: assistant.createdAt,
          updatedAt: assistant.updatedAt,
        },
      });
    },

    assistant_create: async (input: Record<string, unknown>): Promise<string> => {
      const name = input.name as string;
      if (!name || typeof name !== 'string' || !name.trim()) {
        return JSON.stringify({
          success: false,
          error: 'Assistant name is required',
        });
      }

      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      try {
        const settings: Record<string, unknown> = {};
        if (input.model) settings.model = input.model;
        if (input.maxTokens) settings.maxTokens = input.maxTokens;
        if (input.temperature !== undefined) settings.temperature = input.temperature;
        if (input.systemPromptAddition) settings.systemPromptAddition = input.systemPromptAddition;
        if (input.enabledTools) settings.enabledTools = input.enabledTools;
        if (input.disabledTools) settings.disabledTools = input.disabledTools;

        const assistant = await manager.createAssistant({
          name: name.trim(),
          description: input.description as string | undefined,
          avatar: input.avatar as string | undefined,
          color: input.color as string | undefined,
          settings: Object.keys(settings).length > 0 ? settings : undefined,
        });

        return JSON.stringify({
          success: true,
          message: `Assistant "${assistant.name}" created`,
          assistant: {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description || null,
            model: assistant.settings.model,
            isActive: true,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create assistant',
        });
      }
    },

    assistant_update: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Assistant ID is required',
        });
      }

      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      try {
        const updates: Record<string, unknown> = {};
        if (input.name) updates.name = input.name;
        if (input.description !== undefined) updates.description = input.description;
        if (input.avatar !== undefined) updates.avatar = input.avatar;
        if (input.color !== undefined) updates.color = input.color;

        const settings: Record<string, unknown> = {};
        if (input.model) settings.model = input.model;
        if (input.maxTokens !== undefined) settings.maxTokens = input.maxTokens;
        if (input.temperature !== undefined) settings.temperature = input.temperature;
        if (input.systemPromptAddition !== undefined) settings.systemPromptAddition = input.systemPromptAddition;
        if (input.enabledTools !== undefined) settings.enabledTools = input.enabledTools;
        if (input.disabledTools !== undefined) settings.disabledTools = input.disabledTools;

        if (Object.keys(settings).length > 0) {
          updates.settings = settings;
        }

        if (Object.keys(updates).length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No updates provided',
          });
        }

        const assistant = await manager.updateAssistant(id, updates);
        const activeId = manager.getActiveId();

        return JSON.stringify({
          success: true,
          message: `Assistant "${assistant.name}" updated`,
          assistant: {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description || null,
            model: assistant.settings.model,
            isActive: assistant.id === activeId,
            updatedAt: assistant.updatedAt,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update assistant',
        });
      }
    },

    assistant_delete: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Assistant ID is required',
        });
      }

      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      try {
        // Protect system assistants
        if (isSystemAssistantId(id)) {
          return JSON.stringify({
            success: false,
            error: 'Cannot delete a system assistant. System assistants (Marcus, Claude, Codex) are built-in and cannot be removed.',
          });
        }

        const assistants = manager.listAssistants();
        if (assistants.length <= 1) {
          return JSON.stringify({
            success: false,
            error: 'Cannot delete the last remaining assistant',
          });
        }

        const toDelete = assistants.find((a) => a.id === id);
        if (!toDelete) {
          return JSON.stringify({
            success: false,
            error: `Assistant "${id}" not found`,
          });
        }

        if (toDelete.isSystem) {
          return JSON.stringify({
            success: false,
            error: `Cannot delete system assistant "${toDelete.name}". System assistants are built-in and cannot be removed.`,
          });
        }

        await manager.deleteAssistant(id);

        return JSON.stringify({
          success: true,
          message: `Assistant "${toDelete.name}" deleted`,
          deletedId: id,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete assistant',
        });
      }
    },

    assistant_switch: async (input: Record<string, unknown>): Promise<string> => {
      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Assistant ID is required',
        });
      }

      const manager = context.getAssistantManager();
      if (!manager) {
        return JSON.stringify({
          success: false,
          error: 'Assistant manager not initialized',
        });
      }

      try {
        const assistant = await manager.switchAssistant(id);

        return JSON.stringify({
          success: true,
          message: `Switched to assistant "${assistant.name}"`,
          assistant: {
            id: assistant.id,
            name: assistant.name,
            description: assistant.description || null,
            model: assistant.settings.model,
          },
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to switch assistant',
        });
      }
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerAssistantTools(
  registry: ToolRegistry,
  context: AssistantToolsContext
): void {
  const executors = createAssistantToolExecutors(context);

  for (const tool of assistantTools) {
    registry.register(tool, executors[tool.name]);
  }
}
