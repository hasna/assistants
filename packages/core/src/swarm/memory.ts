/**
 * Swarm Memory
 *
 * Shared memory store for swarm assistants. Provides a knowledge base that
 * assistants can read from and write to, enabling collaboration and context sharing.
 */

import { generateId } from '@hasna/assistants-shared';

/**
 * Memory entry category
 */
export type SwarmMemoryCategory =
  | 'fact'        // Discovered facts about the codebase/project
  | 'finding'     // Investigation findings
  | 'decision'    // Decisions made during execution
  | 'context'     // Context information
  | 'resource'    // Resource references (files, URLs)
  | 'note'        // General notes
  | 'error'       // Error information
  | 'solution';   // Solutions to problems

/**
 * Memory entry
 */
export interface SwarmMemoryEntry {
  /** Unique entry ID */
  id: string;
  /** Entry category */
  category: SwarmMemoryCategory;
  /** Entry content */
  content: string;
  /** Source assistant ID */
  sourceAssistantId?: string;
  /** Source task ID */
  sourceTaskId?: string;
  /** Tags for search */
  tags: string[];
  /** Relevance score (0-1) */
  relevance: number;
  /** Creation timestamp */
  createdAt: number;
  /** Update timestamp */
  updatedAt: number;
  /** Access count */
  accessCount: number;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Memory query
 */
export interface SwarmMemoryQuery {
  /** Search by category */
  category?: SwarmMemoryCategory | SwarmMemoryCategory[];
  /** Search by tags (any match) */
  tags?: string[];
  /** Text search in content */
  search?: string;
  /** Filter by source assistant */
  sourceAssistantId?: string;
  /** Filter by source task */
  sourceTaskId?: string;
  /** Minimum relevance score */
  minRelevance?: number;
  /** Maximum results */
  limit?: number;
  /** Sort by */
  sortBy?: 'relevance' | 'createdAt' | 'accessCount';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
}

/**
 * Memory statistics
 */
export interface SwarmMemoryStats {
  totalEntries: number;
  byCategory: Record<SwarmMemoryCategory, number>;
  totalAccessCount: number;
  oldestEntry: number | null;
  newestEntry: number | null;
}

/**
 * Swarm Memory Store
 *
 * In-memory knowledge base for swarm collaboration.
 */
export class SwarmMemory {
  private entries: Map<string, SwarmMemoryEntry> = new Map();
  private swarmId: string;
  private maxEntries: number;

  constructor(swarmId: string, maxEntries: number = 500) {
    this.swarmId = swarmId;
    this.maxEntries = maxEntries;
  }

  /**
   * Get swarm ID
   */
  getSwarmId(): string {
    return this.swarmId;
  }

  /**
   * Add a memory entry
   */
  add(params: {
    category: SwarmMemoryCategory;
    content: string;
    sourceAssistantId?: string;
    sourceTaskId?: string;
    tags?: string[];
    relevance?: number;
    metadata?: Record<string, unknown>;
  }): SwarmMemoryEntry {
    // Enforce max entries
    if (this.entries.size >= this.maxEntries) {
      this.evictLeastRelevant();
    }

    const now = Date.now();
    const entry: SwarmMemoryEntry = {
      id: generateId(),
      category: params.category,
      content: params.content,
      sourceAssistantId: params.sourceAssistantId,
      sourceTaskId: params.sourceTaskId,
      tags: params.tags || [],
      relevance: params.relevance ?? 0.5,
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      metadata: params.metadata,
    };

    this.entries.set(entry.id, entry);
    return entry;
  }

  /**
   * Get entry by ID
   */
  get(id: string): SwarmMemoryEntry | null {
    const entry = this.entries.get(id);
    if (entry) {
      entry.accessCount++;
    }
    return entry || null;
  }

  /**
   * Update an entry
   */
  update(id: string, updates: Partial<Pick<SwarmMemoryEntry, 'content' | 'tags' | 'relevance' | 'metadata'>>): SwarmMemoryEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;

    if (updates.content !== undefined) entry.content = updates.content;
    if (updates.tags !== undefined) entry.tags = updates.tags;
    if (updates.relevance !== undefined) entry.relevance = updates.relevance;
    if (updates.metadata !== undefined) entry.metadata = { ...entry.metadata, ...updates.metadata };
    entry.updatedAt = Date.now();

    return entry;
  }

  /**
   * Delete an entry
   */
  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Query entries
   */
  query(query: SwarmMemoryQuery): SwarmMemoryEntry[] {
    let results = Array.from(this.entries.values());

    // Filter by category
    if (query.category) {
      const categories = Array.isArray(query.category) ? query.category : [query.category];
      results = results.filter(e => categories.includes(e.category));
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(e =>
        query.tags!.some(tag => e.tags.includes(tag))
      );
    }

    // Text search
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(e =>
        e.content.toLowerCase().includes(searchLower) ||
        e.tags.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    // Filter by source assistant
    if (query.sourceAssistantId) {
      results = results.filter(e => e.sourceAssistantId === query.sourceAssistantId);
    }

    // Filter by source task
    if (query.sourceTaskId) {
      results = results.filter(e => e.sourceTaskId === query.sourceTaskId);
    }

    // Filter by relevance
    if (query.minRelevance !== undefined) {
      results = results.filter(e => e.relevance >= query.minRelevance!);
    }

    // Sort
    const sortBy = query.sortBy || 'relevance';
    const sortDir = query.sortDir || 'desc';
    const multiplier = sortDir === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return multiplier * (a.relevance - b.relevance);
        case 'createdAt':
          return multiplier * (a.createdAt - b.createdAt);
        case 'accessCount':
          return multiplier * (a.accessCount - b.accessCount);
        default:
          return 0;
      }
    });

    // Update access counts
    for (const entry of results) {
      entry.accessCount++;
    }

    // Limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Get all entries
   */
  list(): SwarmMemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get statistics
   */
  getStats(): SwarmMemoryStats {
    const entries = Array.from(this.entries.values());
    const byCategory: Record<SwarmMemoryCategory, number> = {
      fact: 0,
      finding: 0,
      decision: 0,
      context: 0,
      resource: 0,
      note: 0,
      error: 0,
      solution: 0,
    };

    let totalAccessCount = 0;
    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;

    for (const entry of entries) {
      byCategory[entry.category]++;
      totalAccessCount += entry.accessCount;
      if (oldestEntry === null || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
      if (newestEntry === null || entry.createdAt > newestEntry) {
        newestEntry = entry.createdAt;
      }
    }

    return {
      totalEntries: entries.length,
      byCategory,
      totalAccessCount,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Build context string for assistant injection
   */
  buildContextInjection(options?: {
    categories?: SwarmMemoryCategory[];
    tags?: string[];
    maxEntries?: number;
    maxLength?: number;
  }): string {
    const maxEntries = options?.maxEntries ?? 10;
    const maxLength = options?.maxLength ?? 2000;

    const entries = this.query({
      category: options?.categories,
      tags: options?.tags,
      minRelevance: 0.3,
      limit: maxEntries,
      sortBy: 'relevance',
      sortDir: 'desc',
    });

    if (entries.length === 0) {
      return '';
    }

    const parts: string[] = ['## Shared Knowledge Base'];

    let currentLength = parts[0].length;

    for (const entry of entries) {
      const entryText = `\n### ${entry.category.toUpperCase()}\n${entry.content}`;
      if (currentLength + entryText.length > maxLength) {
        break;
      }
      parts.push(entryText);
      currentLength += entryText.length;
    }

    return parts.join('\n');
  }

  /**
   * Evict least relevant entries when at capacity
   */
  private evictLeastRelevant(): void {
    const entries = Array.from(this.entries.values())
      .sort((a, b) => {
        // Combined score: relevance + normalized access count
        const scoreA = a.relevance * 0.7 + Math.min(a.accessCount / 10, 1) * 0.3;
        const scoreB = b.relevance * 0.7 + Math.min(b.accessCount / 10, 1) * 0.3;
        return scoreA - scoreB;
      });

    // Remove bottom 10%
    const toRemove = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(entries[i].id);
    }
  }

  /**
   * Export entries for persistence
   */
  export(): SwarmMemoryEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Import entries from persistence
   */
  import(entries: SwarmMemoryEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }
}

/**
 * Create memory tools for swarm assistants
 */
export function createSwarmMemoryTools(memory: SwarmMemory): {
  remember: (params: { category: SwarmMemoryCategory; content: string; tags?: string[] }) => string;
  recall: (params: { search?: string; category?: SwarmMemoryCategory; tags?: string[]; limit?: number }) => string;
  forget: (params: { id: string }) => string;
} {
  return {
    remember: (params) => {
      const entry = memory.add({
        category: params.category,
        content: params.content,
        tags: params.tags,
      });
      return `Remembered: ${entry.id} (${entry.category})`;
    },

    recall: (params) => {
      const entries = memory.query({
        search: params.search,
        category: params.category,
        tags: params.tags,
        limit: params.limit ?? 5,
      });

      if (entries.length === 0) {
        return 'No matching memories found.';
      }

      const lines: string[] = [];
      for (const entry of entries) {
        lines.push(`[${entry.category}] ${entry.content.slice(0, 100)}${entry.content.length > 100 ? '...' : ''}`);
      }
      return lines.join('\n');
    },

    forget: (params) => {
      const deleted = memory.delete(params.id);
      return deleted ? `Forgot: ${params.id}` : `Not found: ${params.id}`;
    },
  };
}
