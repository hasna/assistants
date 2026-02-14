/**
 * Context Entry Management Tools
 *
 * Tools for managing project context entries (files, connectors, notes, etc.).
 * These work with the active project's context.
 */

import type { Tool } from '@hasna/assistants-shared';
import { generateId } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import {
  listProjects,
  readProject,
  updateProject,
  type ProjectContextEntry,
  type ProjectContextType,
} from '../projects/store';
import { buildProjectContext, type ProjectContextConnector } from '../projects/context';

// ============================================
// Types
// ============================================

export interface ContextEntryToolsContext {
  cwd: string;
  getActiveProjectId: () => string | null;
  setProjectContext: (content: string | null) => void;
  getConnectors?: () => ProjectContextConnector[];
}

// ============================================
// Tool Definitions
// ============================================

export const contextEntryListTool: Tool = {
  name: 'context_entry_list',
  description: 'List all context entries for the active project. Shows files, connectors, databases, notes, and entities attached to the project.',
  parameters: {
    type: 'object',
    properties: {
      projectId: {
        type: 'string',
        description: 'Optional: Specific project ID (defaults to active project)',
      },
    },
    required: [],
  },
};

export const contextEntryAddTool: Tool = {
  name: 'context_entry_add',
  description: 'Add a context entry to the active project. Entries provide context to the assistant about the project.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['file', 'connector', 'database', 'note', 'entity'],
        description: 'Type of context entry',
      },
      value: {
        type: 'string',
        description: 'Value for the entry (file path, connector name, note text, etc.)',
      },
      label: {
        type: 'string',
        description: 'Optional: Human-readable label for the entry',
      },
    },
    required: ['type', 'value'],
  },
};

export const contextEntryRemoveTool: Tool = {
  name: 'context_entry_remove',
  description: 'Remove a context entry from the active project by its ID.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The ID of the context entry to remove',
      },
    },
    required: ['id'],
  },
};

export const contextEntryClearTool: Tool = {
  name: 'context_entry_clear',
  description: 'Remove all context entries from the active project.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const contextEntryTools: Tool[] = [
  contextEntryListTool,
  contextEntryAddTool,
  contextEntryRemoveTool,
  contextEntryClearTool,
];

// ============================================
// Helper Functions
// ============================================

async function getProjectById(cwd: string, projectId: string | null): Promise<{
  project: Awaited<ReturnType<typeof readProject>>;
  error?: string;
}> {
  if (!projectId) {
    const projects = await listProjects(cwd);
    if (projects.length === 0) {
      return { project: null, error: 'No projects found. Create one first using /projects new <name>' };
    }
    return { project: null, error: 'No active project. Use /projects use <name> to select one.' };
  }

  const project = await readProject(cwd, projectId);
  if (!project) {
    return { project: null, error: `Project "${projectId}" not found` };
  }

  return { project };
}

// ============================================
// Tool Executors Factory
// ============================================

export function createContextEntryToolExecutors(
  context: ContextEntryToolsContext
): Record<string, ToolExecutor> {
  return {
    context_entry_list: async (input: Record<string, unknown>): Promise<string> => {
      const projectId = (input.projectId as string) || context.getActiveProjectId();
      const { project, error } = await getProjectById(context.cwd, projectId);

      if (error || !project) {
        return JSON.stringify({
          success: false,
          error: error || 'Project not found',
        });
      }

      const entries = project.context.map((entry) => ({
        id: entry.id,
        type: entry.type,
        value: entry.value,
        label: entry.label || null,
        addedAt: new Date(entry.addedAt).toISOString(),
      }));

      // Group by type
      const grouped: Record<string, typeof entries> = {};
      for (const entry of entries) {
        if (!grouped[entry.type]) {
          grouped[entry.type] = [];
        }
        grouped[entry.type].push(entry);
      }

      return JSON.stringify({
        success: true,
        projectId: project.id,
        projectName: project.name,
        total: entries.length,
        byType: {
          file: grouped.file?.length || 0,
          connector: grouped.connector?.length || 0,
          database: grouped.database?.length || 0,
          note: grouped.note?.length || 0,
          entity: grouped.entity?.length || 0,
        },
        entries,
      });
    },

    context_entry_add: async (input: Record<string, unknown>): Promise<string> => {
      const projectId = context.getActiveProjectId();
      const { project, error } = await getProjectById(context.cwd, projectId);

      if (error || !project) {
        return JSON.stringify({
          success: false,
          error: error || 'Project not found',
        });
      }

      const type = input.type as ProjectContextType;
      const value = input.value as string;
      const label = input.label as string | undefined;

      if (!type || !value) {
        return JSON.stringify({
          success: false,
          error: 'Both type and value are required',
        });
      }

      const allowedTypes: ProjectContextType[] = ['file', 'connector', 'database', 'note', 'entity'];
      if (!allowedTypes.includes(type)) {
        return JSON.stringify({
          success: false,
          error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}`,
        });
      }

      const entry: ProjectContextEntry = {
        id: generateId(),
        type,
        value: value.trim(),
        label: label?.trim(),
        addedAt: Date.now(),
      };

      const updated = await updateProject(context.cwd, project.id, (current) => ({
        ...current,
        context: [...current.context, entry],
        updatedAt: Date.now(),
      }));

      if (!updated) {
        return JSON.stringify({
          success: false,
          error: 'Failed to add context entry',
        });
      }

      // Update the injected project context
      const connectors = context.getConnectors?.() || [];
      const contextContent = await buildProjectContext(updated, {
        cwd: context.cwd,
        connectors,
      });
      context.setProjectContext(contextContent);

      return JSON.stringify({
        success: true,
        message: `Added ${type} entry to project "${updated.name}"`,
        entry: {
          id: entry.id,
          type: entry.type,
          value: entry.value,
          label: entry.label || null,
        },
      });
    },

    context_entry_remove: async (input: Record<string, unknown>): Promise<string> => {
      const projectId = context.getActiveProjectId();
      const { project, error } = await getProjectById(context.cwd, projectId);

      if (error || !project) {
        return JSON.stringify({
          success: false,
          error: error || 'Project not found',
        });
      }

      const id = input.id as string;
      if (!id) {
        return JSON.stringify({
          success: false,
          error: 'Entry ID is required',
        });
      }

      const entry = project.context.find((e) => e.id === id);
      if (!entry) {
        return JSON.stringify({
          success: false,
          error: `Context entry "${id}" not found`,
        });
      }

      const updated = await updateProject(context.cwd, project.id, (current) => ({
        ...current,
        context: current.context.filter((e) => e.id !== id),
        updatedAt: Date.now(),
      }));

      if (!updated) {
        return JSON.stringify({
          success: false,
          error: 'Failed to remove context entry',
        });
      }

      // Update the injected project context
      const connectors = context.getConnectors?.() || [];
      const contextContent = await buildProjectContext(updated, {
        cwd: context.cwd,
        connectors,
      });
      context.setProjectContext(contextContent);

      return JSON.stringify({
        success: true,
        message: `Removed ${entry.type} entry from project "${updated.name}"`,
        removed: {
          id: entry.id,
          type: entry.type,
          value: entry.value,
        },
      });
    },

    context_entry_clear: async (): Promise<string> => {
      const projectId = context.getActiveProjectId();
      const { project, error } = await getProjectById(context.cwd, projectId);

      if (error || !project) {
        return JSON.stringify({
          success: false,
          error: error || 'Project not found',
        });
      }

      const entryCount = project.context.length;

      if (entryCount === 0) {
        return JSON.stringify({
          success: true,
          message: 'Project has no context entries to clear',
        });
      }

      const updated = await updateProject(context.cwd, project.id, (current) => ({
        ...current,
        context: [],
        updatedAt: Date.now(),
      }));

      if (!updated) {
        return JSON.stringify({
          success: false,
          error: 'Failed to clear context entries',
        });
      }

      // Clear the injected project context
      context.setProjectContext(null);

      return JSON.stringify({
        success: true,
        message: `Cleared ${entryCount} context entries from project "${updated.name}"`,
        removedCount: entryCount,
      });
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerContextEntryTools(
  registry: ToolRegistry,
  context: ContextEntryToolsContext
): void {
  const executors = createContextEntryToolExecutors(context);

  for (const tool of contextEntryTools) {
    registry.register(tool, executors[tool.name]);
  }
}
