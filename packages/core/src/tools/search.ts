import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';

/**
 * Tool metadata with category and optional tags
 */
export interface ToolMetadata {
  name: string;
  description: string;
  category: string;
  tags?: string[];
  source?: 'builtin' | 'connector' | 'skill' | 'custom';
}

/**
 * Tool index for efficient searching
 */
export class ToolIndex {
  private tools: Map<string, ToolMetadata> = new Map();
  private byCategory: Map<string, Set<string>> = new Map();
  private byTag: Map<string, Set<string>> = new Map();

  /**
   * Add a tool to the index
   */
  add(metadata: ToolMetadata): void {
    this.tools.set(metadata.name, metadata);

    // Index by category
    if (!this.byCategory.has(metadata.category)) {
      this.byCategory.set(metadata.category, new Set());
    }
    this.byCategory.get(metadata.category)!.add(metadata.name);

    // Index by tags
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        const normalizedTag = tag.toLowerCase();
        if (!this.byTag.has(normalizedTag)) {
          this.byTag.set(normalizedTag, new Set());
        }
        this.byTag.get(normalizedTag)!.add(metadata.name);
      }
    }
  }

  /**
   * Remove a tool from the index
   */
  remove(name: string): void {
    const metadata = this.tools.get(name);
    if (!metadata) return;

    this.tools.delete(name);

    // Remove from category index
    this.byCategory.get(metadata.category)?.delete(name);

    // Remove from tag index
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        this.byTag.get(tag.toLowerCase())?.delete(name);
      }
    }
  }

  /**
   * Search tools by query, category, and/or tags
   */
  search(options: {
    query?: string;
    category?: string;
    tags?: string[];
    source?: string;
    limit?: number;
    offset?: number;
  }): { tools: ToolMetadata[]; total: number } {
    let candidates: Set<string>;

    // Start with all tools or filter by category
    if (options.category) {
      candidates = new Set(this.byCategory.get(options.category) || []);
    } else {
      candidates = new Set(this.tools.keys());
    }

    // Filter by tags (intersection)
    if (options.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        const tagTools = this.byTag.get(tag.toLowerCase()) || new Set();
        const intersection = new Set<string>();
        for (const name of candidates) {
          if (tagTools.has(name)) {
            intersection.add(name);
          }
        }
        candidates = intersection;
      }
    }

    // Filter by source
    if (options.source) {
      const filtered = new Set<string>();
      for (const name of candidates) {
        const metadata = this.tools.get(name);
        if (metadata?.source === options.source) {
          filtered.add(name);
        }
      }
      candidates = filtered;
    }

    // Search by query (name and description)
    let results: Array<{ tool: ToolMetadata; score: number }> = [];

    if (options.query) {
      const query = options.query.toLowerCase();
      const queryWords = query.split(/\s+/).filter(w => w.length > 0);

      for (const name of candidates) {
        const metadata = this.tools.get(name)!;
        let score = 0;

        // Name matching (highest weight)
        const nameLower = metadata.name.toLowerCase();
        if (nameLower === query) {
          score += 20; // Exact match
        } else if (nameLower.includes(query)) {
          score += 10; // Contains query
        } else {
          // Word matching in name
          for (const word of queryWords) {
            if (nameLower.includes(word)) {
              score += 5;
            }
          }
        }

        // Description matching
        const descLower = metadata.description.toLowerCase();
        for (const word of queryWords) {
          if (descLower.includes(word)) {
            score += 2;
          }
        }

        // Category matching
        if (metadata.category.toLowerCase().includes(query)) {
          score += 3;
        }

        // Tag matching
        if (metadata.tags) {
          for (const tag of metadata.tags) {
            if (tag.toLowerCase().includes(query)) {
              score += 2;
            }
          }
        }

        if (score > 0) {
          results.push({ tool: metadata, score });
        }
      }

      // Sort by score
      results.sort((a, b) => b.score - a.score);
    } else {
      // No query, return all candidates sorted by name
      for (const name of candidates) {
        results.push({ tool: this.tools.get(name)!, score: 0 });
      }
      results.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
    }

    const total = results.length;
    const offset = options.offset || 0;
    const limit = options.limit || 20;
    results = results.slice(offset, offset + limit);

    return {
      tools: results.map(r => r.tool),
      total,
    };
  }

  /**
   * Get all categories
   */
  getCategories(): string[] {
    return Array.from(this.byCategory.keys()).sort();
  }

  /**
   * Get all tags
   */
  getTags(): string[] {
    return Array.from(this.byTag.keys()).sort();
  }

  /**
   * Get tool count
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.tools.clear();
    this.byCategory.clear();
    this.byTag.clear();
  }

  /**
   * Build index from a tool registry
   */
  static fromRegistry(registry: ToolRegistry, categorizer?: (tool: Tool) => ToolMetadata): ToolIndex {
    const index = new ToolIndex();
    const tools = registry.getTools();

    for (const tool of tools) {
      const metadata = categorizer
        ? categorizer(tool)
        : inferToolMetadata(tool);
      index.add(metadata);
    }

    return index;
  }
}

/**
 * Infer tool metadata from a Tool definition
 */
function inferToolMetadata(tool: Tool): ToolMetadata {
  const name = tool.name;
  let category = 'general';
  let source: ToolMetadata['source'] = 'builtin';
  const tags: string[] = [];

  // Categorize by name prefix patterns
  if (name.startsWith('memory_')) {
    category = 'memory';
  } else if (name.startsWith('assistant_') || name === 'assistant_spawn' || name === 'assistant_list') {
    category = 'assistants';
  } else if (name.startsWith('task') || name.startsWith('tasks_')) {
    category = 'tasks';
  } else if (name.startsWith('session_')) {
    category = 'sessions';
  } else if (name.startsWith('job_')) {
    category = 'jobs';
  } else if (name.startsWith('schedule') || name.startsWith('pause_') || name.startsWith('cancel_')) {
    category = 'scheduling';
  } else if (name.startsWith('wallet_')) {
    category = 'wallet';
  } else if (name.startsWith('secrets_')) {
    category = 'secrets';
  } else if (name.startsWith('messages_')) {
    category = 'messages';
  } else if (name.startsWith('inbox_')) {
    category = 'inbox';
  } else if (name.startsWith('project_')) {
    category = 'projects';
  } else if (name.startsWith('plan_')) {
    category = 'plans';
  } else if (name.startsWith('skill_') || name === 'skills_list') {
    category = 'skills';
  } else if (name.startsWith('web_') || name === 'curl') {
    category = 'web';
  } else if (['read', 'write', 'glob', 'grep', 'read_pdf'].includes(name)) {
    category = 'filesystem';
  } else if (name === 'bash') {
    category = 'system';
  } else if (['wait', 'sleep'].includes(name)) {
    category = 'timing';
  } else if (['feedback', 'ask_user'].includes(name)) {
    category = 'interaction';
  } else if (name === 'display_image') {
    category = 'media';
  } else if (['context_get', 'context_stats', 'whoami', 'identity_get', 'energy_status', 'resource_limits'].includes(name)) {
    category = 'self-awareness';
  } else if (name.startsWith('connector') || name === 'connectors_list' || name === 'connectors_search') {
    category = 'connectors';
    source = 'connector';
  }

  // Detect connector-based tools
  if (!name.includes('_') && !['bash', 'read', 'write', 'glob', 'grep', 'curl', 'wait', 'sleep', 'feedback'].includes(name)) {
    // Likely a connector tool (e.g., "notion", "gmail")
    source = 'connector';
    category = 'connectors';
  }

  // Extract tags from description
  const desc = tool.description.toLowerCase();
  if (desc.includes('search')) tags.push('search');
  if (desc.includes('list')) tags.push('list');
  if (desc.includes('create') || desc.includes('add') || desc.includes('new')) tags.push('create');
  if (desc.includes('update') || desc.includes('modify') || desc.includes('edit')) tags.push('update');
  if (desc.includes('delete') || desc.includes('remove')) tags.push('delete');
  if (desc.includes('read') || desc.includes('get') || desc.includes('fetch')) tags.push('read');

  return {
    name,
    description: tool.description,
    category,
    source,
    tags: tags.length > 0 ? tags : undefined,
  };
}

// ============================================
// Tools Search Tool
// ============================================

export const toolsSearchTool: Tool = {
  name: 'tools_search',
  description: 'Search for available tools by name, description, category, or tags. Use this to find the right tool for a task without loading all tools into context.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to match against tool names and descriptions',
      },
      category: {
        type: 'string',
        description: 'Filter by category (e.g., "memory", "filesystem", "web", "assistants")',
      },
      tags: {
        type: 'array',
        description: 'Filter by tags (e.g., ["search", "create"])',
        items: { type: 'string', description: 'Tag to filter by' },
      },
      source: {
        type: 'string',
        description: 'Filter by source',
        enum: ['builtin', 'connector', 'skill', 'custom'],
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
      },
    },
    required: [],
  },
};

export interface ToolsSearchContext {
  getToolIndex: () => ToolIndex | null;
  getToolRegistry?: () => ToolRegistry | null;
}

export function createToolsSearchExecutor(
  context: ToolsSearchContext
): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    // Get or build the index
    let index = context.getToolIndex();

    if (!index && context.getToolRegistry) {
      const registry = context.getToolRegistry();
      if (registry) {
        index = ToolIndex.fromRegistry(registry);
      }
    }

    if (!index) {
      return JSON.stringify({
        error: 'Tool index not available',
        suggestion: 'Tool search is not configured',
      });
    }

    const query = input.query as string | undefined;
    const category = input.category as string | undefined;
    const tags = input.tags as string[] | undefined;
    const source = input.source as string | undefined;
    const limit = Math.min(Math.max(1, Number(input.limit) || 10), 50);

    const { tools, total } = index.search({
      query,
      category,
      tags,
      source,
      limit,
    });

    const categories = index.getCategories();

    return JSON.stringify({
      query: query || null,
      filters: {
        category: category || null,
        tags: tags || null,
        source: source || null,
      },
      count: tools.length,
      total,
      hasMore: tools.length < total,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        source: t.source,
        tags: t.tags,
      })),
      availableCategories: categories,
      suggestion: tools.length === 0
        ? `No tools found. Try a different query or browse by category: ${categories.slice(0, 5).join(', ')}`
        : tools.length === 1
          ? `Found "${tools[0].name}". Call it directly or use limit to see more results.`
          : null,
    }, null, 2);
  };
}

export function registerToolsSearchTool(
  registry: ToolRegistry,
  context: ToolsSearchContext
): void {
  const executor = createToolsSearchExecutor(context);
  registry.register(toolsSearchTool, executor);
}
