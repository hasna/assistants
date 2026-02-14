/**
 * Memory Tools
 *
 * Tools that allow assistants to save, recall, and manage memories.
 * These tools provide the assistant with persistent storage across sessions.
 *
 * NOTE: This is for the terminal/core package only (SQLite-based).
 * The web version uses PostgreSQL with AWS vector storage.
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import type { GlobalMemoryManager } from '../memory/global-memory';
import type { MemoryScope, MemoryCategory } from '../memory/types';

/**
 * Context required for memory tools
 */
export interface MemoryToolContext {
  getMemoryManager: () => GlobalMemoryManager | null;
}

// ============================================
// Tool Definitions
// ============================================

export const memorySaveTool: Tool = {
  name: 'memory_save',
  description:
    'Save information to persistent memory for future recall across sessions. Use this to remember user preferences, important facts, or knowledge that should be retained.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Unique identifier for this memory (e.g., "user.timezone", "project.stack")',
      },
      value: {
        type: ['string', 'number', 'boolean', 'object'],
        description: 'The information to remember. Can be a string, number, boolean, or object.',
      },
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'knowledge', 'history'],
        description: 'Type of memory: preference (user settings), fact (known truths), knowledge (learned info), history (past events)',
      },
      scope: {
        type: 'string',
        enum: ['global', 'shared', 'private'],
        description: 'Memory scope: global (all assistants), shared (this assistant + delegates), private (this assistant only). Default: private.',
      },
      scopeId: {
        type: 'string',
        description: 'Optional scope identifier for shared/private memories. If not provided, uses the assistant default.',
      },
      importance: {
        type: 'number',
        description: 'How important is this memory? 1-10, higher values are more likely to be recalled (default: 5)',
      },
      summary: {
        type: 'string',
        description: 'Optional short summary for quick recall (shown in memory injection)',
      },
      tags: {
        type: 'array',
        items: { type: 'string', description: 'A tag string' },
        description: 'Optional tags for categorization and filtering',
      },
    },
    required: ['key', 'value', 'category'],
  },
};

export const memoryRecallTool: Tool = {
  name: 'memory_recall',
  description:
    'Recall information from memory. Use a specific key for exact recall, or search for related memories.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Specific key to recall (exact match)',
      },
      search: {
        type: 'string',
        description: 'Search term to find relevant memories (searches key, summary, and value)',
      },
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'knowledge', 'history'],
        description: 'Filter by category',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 5)',
      },
    },
  },
};

export const memoryListTool: Tool = {
  name: 'memory_list',
  description:
    'List all memories matching criteria. Use this to browse available memories or find specific categories.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'knowledge', 'history'],
        description: 'Filter by category',
      },
      scope: {
        type: 'string',
        enum: ['global', 'shared', 'private'],
        description: 'Filter by scope (default: all)',
      },
      tags: {
        type: 'array',
        items: { type: 'string', description: 'A tag to filter by' },
        description: 'Filter by tags (matches any)',
      },
      minImportance: {
        type: 'number',
        description: 'Minimum importance level (1-10)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 20)',
      },
    },
  },
};

export const memoryForgetTool: Tool = {
  name: 'memory_forget',
  description:
    'Remove a memory entry. Use this to delete outdated or incorrect information.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key of the memory to forget',
      },
    },
    required: ['key'],
  },
};

export const memoryUpdateTool: Tool = {
  name: 'memory_update',
  description:
    'Update an existing memory (importance, tags, or summary). Use this to refine memory metadata without changing the value.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The key of the memory to update',
      },
      importance: {
        type: 'number',
        description: 'New importance level (1-10)',
      },
      tags: {
        type: 'array',
        items: { type: 'string', description: 'A tag string' },
        description: 'New tags (replaces existing)',
      },
      summary: {
        type: 'string',
        description: 'New summary text',
      },
    },
    required: ['key'],
  },
};

export const memoryStatsTool: Tool = {
  name: 'memory_stats',
  description:
    'Get statistics about stored memories including counts by scope and category.',
  parameters: {
    type: 'object',
    properties: {},
  },
};

export const memoryExportTool: Tool = {
  name: 'memory_export',
  description:
    'Export all memories to a JSON array format. Returns the data directly (not to a file).',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'knowledge', 'history'],
        description: 'Filter by category (optional)',
      },
      scope: {
        type: 'string',
        enum: ['global', 'shared', 'private'],
        description: 'Filter by scope (optional)',
      },
    },
  },
};

export const memoryImportTool: Tool = {
  name: 'memory_import',
  description:
    'Import memories from a JSON array. Each entry must have key, value, and category fields.',
  parameters: {
    type: 'object',
    properties: {
      memories: {
        type: 'array',
        description: 'Array of memory objects to import',
        items: {
          type: 'object',
          description: 'A memory entry to import',
          properties: {
            key: { type: 'string', description: 'Unique identifier for the memory' },
            value: { type: ['string', 'number', 'boolean', 'object'], description: 'The information to store. Can be a string, number, boolean, or object.' },
            category: {
              type: 'string',
              enum: ['preference', 'fact', 'knowledge', 'history'],
              description: 'Type of memory',
            },
            scope: {
              type: 'string',
              enum: ['global', 'shared', 'private'],
              description: 'Memory scope (default: private)',
            },
            scopeId: {
              type: 'string',
              description: 'Scope identifier for shared/private memories',
            },
            importance: { type: 'number', description: 'Importance level 1-10' },
            summary: { type: 'string', description: 'Short summary' },
            tags: {
              type: 'array',
              items: { type: 'string', description: 'A tag string' },
              description: 'Tags for categorization',
            },
          },
          required: ['key', 'value', 'category'],
        },
      },
      overwrite: {
        type: 'boolean',
        description: 'Whether to overwrite existing memories with the same key (default: false)',
      },
    },
    required: ['memories'],
  },
};

// ============================================
// Tool Array
// ============================================

export const memoryTools: Tool[] = [
  memorySaveTool,
  memoryRecallTool,
  memoryListTool,
  memoryForgetTool,
  memoryUpdateTool,
  memoryStatsTool,
  memoryExportTool,
  memoryImportTool,
];

// ============================================
// Tool Executors Factory
// ============================================

// ============================================
// Constants
// ============================================

const MAX_LIMIT = 100;
const DEFAULT_SAVE_LIMIT = 5;
const DEFAULT_LIST_LIMIT = 20;
const MAX_KEY_LENGTH = 256;
const MAX_VALUE_LENGTH = 65536; // 64KB
const MAX_SUMMARY_LENGTH = 500;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 20;
const VALID_CATEGORIES = new Set(['preference', 'fact', 'knowledge', 'history']);
const VALID_SCOPES = new Set(['global', 'shared', 'private']);

// ============================================
// Validation Helpers
// ============================================

function validateString(value: unknown, fieldName: string, maxLength?: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (maxLength && trimmed.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  return trimmed || null;
}

function validateRequiredString(value: unknown, fieldName: string, maxLength?: number): string {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName} is required`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} cannot be empty`);
  }
  if (maxLength && trimmed.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength} characters`);
  }
  return trimmed;
}

function validateCategory(value: unknown): MemoryCategory {
  const str = validateRequiredString(value, 'category');
  if (!VALID_CATEGORIES.has(str)) {
    throw new Error(`category must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
  }
  return str as MemoryCategory;
}

function validateScope(value: unknown): MemoryScope | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) {
    return undefined;
  }
  if (!VALID_SCOPES.has(str)) {
    throw new Error(`scope must be one of: ${[...VALID_SCOPES].join(', ')}`);
  }
  return str as MemoryScope;
}

function validateLimit(value: unknown, defaultLimit: number): number {
  if (value === undefined || value === null) {
    return defaultLimit;
  }
  const num = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (isNaN(num) || num < 1) {
    return defaultLimit;
  }
  return Math.min(num, MAX_LIMIT);
}

function validateImportance(value: unknown, defaultValue: number): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) {
    return defaultValue;
  }
  return Math.min(10, Math.max(1, Math.round(num)));
}

function validateTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('tags must be an array');
  }
  if (value.length > MAX_TAGS) {
    throw new Error(`tags cannot exceed ${MAX_TAGS} items`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue; // Skip non-string tags
    }
    const trimmed = item.trim();
    if (trimmed && trimmed.length <= MAX_TAG_LENGTH) {
      result.push(trimmed);
    }
  }
  return result;
}

// ============================================
// Tool Executors Factory
// ============================================

export function createMemoryToolExecutors(
  getMemoryManager: () => GlobalMemoryManager | null
): Record<string, ToolExecutor> {
  return {
    memory_save: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        // Validate required fields
        const key = validateRequiredString(input.key, 'key', MAX_KEY_LENGTH);
        const category = validateCategory(input.category);

        // Validate scope and scopeId
        const scope = validateScope(input.scope);
        const scopeId = validateString(input.scopeId, 'scopeId', MAX_KEY_LENGTH);

        // Validate scope rules - scopeId is only meaningful for shared/private
        if (scopeId && scope === 'global') {
          throw new Error('scopeId cannot be used with global scope');
        }

        // Validate value - can be string, number, boolean, or object
        if (input.value === undefined || input.value === null) {
          throw new Error('value is required');
        }

        let parsedValue: unknown;
        if (typeof input.value === 'string') {
          const valueStr = input.value.trim();
          if (!valueStr) {
            throw new Error('value cannot be empty');
          }
          if (valueStr.length > MAX_VALUE_LENGTH) {
            throw new Error(`value exceeds maximum length of ${MAX_VALUE_LENGTH} characters`);
          }
          // Try to parse value as JSON if it looks like JSON
          if (valueStr.startsWith('{') || valueStr.startsWith('[')) {
            try {
              parsedValue = JSON.parse(valueStr);
            } catch {
              parsedValue = valueStr;
            }
          } else {
            parsedValue = valueStr;
          }
        } else if (typeof input.value === 'number' || typeof input.value === 'boolean') {
          parsedValue = input.value;
        } else if (typeof input.value === 'object') {
          const serialized = JSON.stringify(input.value);
          if (serialized.length > MAX_VALUE_LENGTH) {
            throw new Error(`value exceeds maximum length of ${MAX_VALUE_LENGTH} characters when serialized`);
          }
          parsedValue = input.value;
        } else {
          throw new Error('value must be a string, number, boolean, or object');
        }

        // Validate optional fields
        const importance = validateImportance(input.importance, 5);
        const summary = validateString(input.summary, 'summary', MAX_SUMMARY_LENGTH);
        const tags = validateTags(input.tags);

        const memory = await manager.set(key, parsedValue, {
          category,
          importance,
          summary: summary || undefined,
          tags,
          source: 'assistant',
          scope: scope || undefined,
          scopeId: scopeId || undefined,
        });

        return JSON.stringify({
          success: true,
          id: memory.id,
          key: memory.key,
          scope: memory.scope,
          message: `Memory saved: ${key} (scope: ${memory.scope})`,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to save memory',
        });
      }
    },

    memory_recall: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const key = validateString(input.key, 'key', MAX_KEY_LENGTH);
        const search = validateString(input.search, 'search', MAX_KEY_LENGTH);
        const category = input.category ? validateCategory(input.category) : undefined;
        const limit = validateLimit(input.limit, DEFAULT_SAVE_LIMIT);

        // If specific key provided, do exact lookup
        if (key) {
          const memory = await manager.get(key);
          if (memory) {
            return JSON.stringify({
              found: true,
              memory: {
                key: memory.key,
                value: memory.value,
                category: memory.category,
                summary: memory.summary,
                importance: memory.importance,
                tags: memory.tags,
                createdAt: memory.createdAt,
                updatedAt: memory.updatedAt,
              },
            });
          }
          return JSON.stringify({
            found: false,
            message: `No memory found with key: ${key}`,
          });
        }

        // Require at least one filter (search, category) to prevent returning all
        if (!search && !category) {
          return JSON.stringify({
            error: 'Either key, search, or category is required to recall memories',
          });
        }

        // Query with filters
        const result = await manager.query({
          search: search || undefined,
          category,
          limit,
          orderBy: 'importance',
          orderDir: 'desc',
        });

        return JSON.stringify({
          found: result.memories.length > 0,
          count: result.memories.length,
          total: result.total,
          memories: result.memories.map(m => ({
            key: m.key,
            value: m.value,
            category: m.category,
            summary: m.summary,
            importance: m.importance,
            tags: m.tags,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to recall memory',
        });
      }
    },

    memory_list: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const category = input.category ? validateCategory(input.category) : undefined;
        const scope = validateScope(input.scope);
        const tags = validateTags(input.tags);
        const minImportance = validateImportance(input.minImportance, 0);
        const limit = validateLimit(input.limit, DEFAULT_LIST_LIMIT);

        // Require at least one filter to prevent listing all memories unbounded
        const hasFilter = category || scope || (tags && tags.length > 0) || minImportance > 0;
        if (!hasFilter) {
          return JSON.stringify({
            error: 'At least one filter (category, scope, tags, or minImportance) is required to list memories. Use memory_stats to see summary statistics.',
          });
        }

        const result = await manager.query({
          category,
          scope,
          tags: tags.length > 0 ? tags : undefined,
          minImportance: minImportance > 0 ? minImportance : undefined,
          limit,
          orderBy: 'importance',
          orderDir: 'desc',
        });

        return JSON.stringify({
          count: result.memories.length,
          total: result.total,
          hasMore: result.hasMore,
          memories: result.memories.map(m => ({
            key: m.key,
            category: m.category,
            summary: m.summary || (typeof m.value === 'string' ? m.value.slice(0, 50) : JSON.stringify(m.value).slice(0, 50)),
            importance: m.importance,
            scope: m.scope,
            tags: m.tags,
            updatedAt: m.updatedAt,
          })),
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to list memories',
        });
      }
    },

    memory_forget: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const key = validateRequiredString(input.key, 'key', MAX_KEY_LENGTH);

        const deleted = await manager.deleteByKey(key);
        if (deleted) {
          return JSON.stringify({
            success: true,
            message: `Memory forgotten: ${key}`,
          });
        }
        return JSON.stringify({
          success: false,
          message: `No memory found with key: ${key}`,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to forget memory',
        });
      }
    },

    memory_update: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const key = validateRequiredString(input.key, 'key', MAX_KEY_LENGTH);
        const importance = input.importance !== undefined ? validateImportance(input.importance, 0) : undefined;
        const tags = input.tags !== undefined ? validateTags(input.tags) : undefined;
        const summary = input.summary !== undefined ? validateString(input.summary, 'summary', MAX_SUMMARY_LENGTH) : undefined;

        // Require at least one update field
        if (importance === undefined && tags === undefined && summary === undefined) {
          return JSON.stringify({
            error: 'At least one field to update (importance, tags, or summary) is required',
          });
        }

        const memory = await manager.get(key);
        if (!memory) {
          return JSON.stringify({
            success: false,
            message: `No memory found with key: ${key}`,
          });
        }

        const updates: Record<string, unknown> = {};
        if (importance !== undefined && importance > 0) {
          updates.importance = importance;
        }
        if (tags !== undefined) {
          updates.tags = tags;
        }
        if (summary !== undefined) {
          updates.summary = summary;
        }

        const updated = await manager.update(memory.id, updates);

        return JSON.stringify({
          success: true,
          key: updated.key,
          message: `Memory updated: ${key}`,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to update memory',
        });
      }
    },

    memory_stats: async (): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const stats = await manager.getStats();
        return JSON.stringify({
          totalMemories: stats.totalCount,
          byScope: stats.byScope,
          byCategory: stats.byCategory,
          averageImportance: Math.round(stats.avgImportance * 10) / 10,
          oldestMemory: stats.oldestMemory,
          newestMemory: stats.newestMemory,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to get memory stats',
        });
      }
    },

    memory_export: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        const category = input.category ? validateCategory(input.category) : undefined;
        const scope = validateScope(input.scope);

        // Use manager.export() to get all memories (not limited to 100)
        const memories = await manager.export({
          category,
          scope,
          orderBy: 'created',
          orderDir: 'desc',
        });

        // Format for export
        const exported = memories.map(m => ({
          key: m.key,
          value: m.value,
          category: m.category,
          scope: m.scope,
          scopeId: m.scopeId,
          importance: m.importance,
          summary: m.summary,
          tags: m.tags,
          source: m.source,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        }));

        return JSON.stringify({
          success: true,
          count: exported.length,
          memories: exported,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to export memories',
        });
      }
    },

    memory_import: async (input): Promise<string> => {
      const manager = getMemoryManager();
      if (!manager) {
        return JSON.stringify({ error: 'Memory system not available' });
      }

      try {
        if (!input.memories || !Array.isArray(input.memories)) {
          throw new Error('memories must be an array');
        }

        if (input.memories.length === 0) {
          return JSON.stringify({
            success: true,
            imported: 0,
            message: 'No memories to import',
          });
        }

        if (input.memories.length > MAX_LIMIT) {
          throw new Error(`Too many memories. Maximum is ${MAX_LIMIT} per import.`);
        }

        const overwrite = input.overwrite === true;

        // Validate and prepare memories for import
        const toImport: Array<{
          key: string;
          value: unknown;
          category: MemoryCategory;
          scope?: MemoryScope;
          scopeId?: string;
          importance?: number;
          summary?: string;
          tags?: string[];
          source?: 'user' | 'assistant' | 'system';
        }> = [];

        const errors: string[] = [];

        for (let i = 0; i < input.memories.length; i++) {
          const mem = input.memories[i] as Record<string, unknown>;

          try {
            const key = validateRequiredString(mem.key, 'key', MAX_KEY_LENGTH);
            const category = validateCategory(mem.category);

            if (mem.value === undefined || mem.value === null) {
              throw new Error('value is required');
            }

            // Parse value
            let value: unknown;
            if (typeof mem.value === 'string') {
              const valueStr = mem.value.trim();
              if (!valueStr) {
                throw new Error('value cannot be empty');
              }
              if (valueStr.length > MAX_VALUE_LENGTH) {
                throw new Error(`value exceeds maximum length`);
              }
              value = valueStr;
            } else {
              value = mem.value;
            }

            toImport.push({
              key,
              value,
              category,
              scope: validateScope(mem.scope),
              scopeId: validateString(mem.scopeId, 'scopeId', MAX_KEY_LENGTH) || undefined,
              importance: mem.importance !== undefined ? validateImportance(mem.importance, 5) : undefined,
              summary: validateString(mem.summary, 'summary', MAX_SUMMARY_LENGTH) || undefined,
              tags: mem.tags ? validateTags(mem.tags) : undefined,
              source: mem.source as 'user' | 'assistant' | 'system' | undefined,
            });
          } catch (error) {
            errors.push(`Entry ${i}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (errors.length > 0 && toImport.length === 0) {
          return JSON.stringify({
            error: 'All entries failed validation',
            validationErrors: errors.slice(0, 10),
          });
        }

        // Import valid memories
        // Use type assertion since import() only uses these fields, not the full Memory type
        const imported = await manager.import(
          toImport.map(m => ({
            key: m.key,
            value: m.value,
            scope: m.scope || 'private',
            scopeId: m.scopeId,
            category: m.category,
            importance: m.importance || 5,
            summary: m.summary,
            tags: m.tags || [],
            source: m.source || 'assistant',
          })) as Parameters<typeof manager.import>[0],
          { overwrite }
        );

        return JSON.stringify({
          success: true,
          imported,
          total: input.memories.length,
          skipped: input.memories.length - imported - errors.length,
          validationErrors: errors.length > 0 ? errors.slice(0, 5) : undefined,
          message: `Imported ${imported} of ${input.memories.length} memories`,
        });
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : 'Failed to import memories',
        });
      }
    },
  };
}

// ============================================
// Registration Function
// ============================================

export function registerMemoryTools(
  registry: ToolRegistry,
  getMemoryManager: () => GlobalMemoryManager | null
): void {
  const executors = createMemoryToolExecutors(getMemoryManager);

  for (const tool of memoryTools) {
    registry.register(tool, executors[tool.name]);
  }
}
