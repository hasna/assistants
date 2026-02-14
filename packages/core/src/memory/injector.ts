/**
 * Memory Injector
 *
 * Handles automatic injection of relevant memories into the conversation context.
 * Selects high-importance memories that match the current context and formats them
 * for inclusion in the system prompt.
 */

import type { GlobalMemoryManager } from './global-memory';
import type {
  Memory,
  MemoryCategory,
  MemoryInjectionConfig,
  MemoryInjectionResult,
} from './types';

/**
 * Default injection configuration
 */
const DEFAULT_INJECTION_CONFIG: MemoryInjectionConfig = {
  enabled: true,
  maxTokens: 500,
  minImportance: 5,
  categories: ['preference', 'fact'],
  refreshInterval: 5,
};

/**
 * Memory Injector - prepares memory context for system prompts
 */
export class MemoryInjector {
  private memoryManager: GlobalMemoryManager;
  private config: MemoryInjectionConfig;
  private lastInjectedIds: Set<string> = new Set();
  private turnsSinceRefresh: number = 0;

  constructor(
    memoryManager: GlobalMemoryManager,
    config?: Partial<MemoryInjectionConfig>
  ) {
    this.memoryManager = memoryManager;
    this.config = { ...DEFAULT_INJECTION_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<MemoryInjectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if injection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Prepare memory injection for the current turn
   *
   * Memory injection follows these rules:
   * 1. On each turn, fetch relevant memories from the manager
   * 2. Skip memories that were recently injected (within refreshInterval turns)
   * 3. After refreshInterval turns, clear the dedupe list and allow re-injection
   *
   * This prevents the same memories from being injected every turn,
   * reducing redundancy in the context window.
   */
  async prepareInjection(context: string): Promise<MemoryInjectionResult> {
    if (!this.config.enabled) {
      return { content: '', memoryIds: [], tokenEstimate: 0 };
    }

    // Check if we should refresh (based on turn count)
    this.turnsSinceRefresh++;
    const shouldRefresh = this.turnsSinceRefresh >= this.config.refreshInterval;

    if (shouldRefresh) {
      this.turnsSinceRefresh = 0;
      this.lastInjectedIds.clear();
    }

    // Get relevant memories
    const memories = await this.memoryManager.getRelevant(context, {
      limit: 20, // Fetch more than needed, then filter
      minImportance: this.config.minImportance,
      categories: this.config.categories,
    });

    if (memories.length === 0) {
      return { content: '', memoryIds: [], tokenEstimate: 0 };
    }

    // Filter out recently injected memories (dedupe)
    // Only inject memories that haven't been injected since the last refresh
    const filteredMemories = memories.filter(m => !this.lastInjectedIds.has(m.id));

    if (filteredMemories.length === 0) {
      // All memories were recently injected, return empty
      // (they'll be available again after refreshInterval)
      return { content: '', memoryIds: [], tokenEstimate: 0 };
    }

    // Format memories and track token budget
    const { content, memoryIds, tokenEstimate } = this.formatMemories(filteredMemories);

    // Track injected memory IDs for deduplication
    for (const id of memoryIds) {
      this.lastInjectedIds.add(id);
    }

    return { content, memoryIds, tokenEstimate };
  }

  /**
   * Force refresh on next turn
   */
  refresh(): void {
    this.turnsSinceRefresh = this.config.refreshInterval;
    this.lastInjectedIds.clear();
  }

  /**
   * Reset the injector state
   */
  reset(): void {
    this.turnsSinceRefresh = 0;
    this.lastInjectedIds.clear();
  }

  /**
   * Get IDs of recently injected memories
   */
  getLastInjectedIds(): string[] {
    return Array.from(this.lastInjectedIds);
  }

  /**
   * Format memories into a structured context string
   */
  private formatMemories(memories: Memory[]): MemoryInjectionResult {
    const maxTokens = this.config.maxTokens;
    const memoryIds: string[] = [];
    let tokenEstimate = 0;

    // Group memories by category
    const byCategory: Record<string, Memory[]> = {};
    for (const memory of memories) {
      if (!byCategory[memory.category]) {
        byCategory[memory.category] = [];
      }
      byCategory[memory.category].push(memory);
    }

    const sections: string[] = [];

    // Category display names
    const categoryNames: Record<MemoryCategory, string> = {
      preference: 'User Preferences',
      fact: 'Known Facts',
      knowledge: 'Knowledge Base',
      history: 'Recent Context',
    };

    // Process each category
    for (const category of ['preference', 'fact', 'knowledge', 'history'] as MemoryCategory[]) {
      const categoryMemories = byCategory[category];
      if (!categoryMemories || categoryMemories.length === 0) continue;

      const items: string[] = [];

      for (const memory of categoryMemories) {
        // Estimate tokens for this entry
        const entryText = this.formatMemoryEntry(memory);
        const entryTokens = this.estimateTokens(entryText);

        // Check if we have budget
        if (tokenEstimate + entryTokens > maxTokens) {
          break;
        }

        items.push(entryText);
        memoryIds.push(memory.id);
        tokenEstimate += entryTokens;
      }

      if (items.length > 0) {
        sections.push(`### ${categoryNames[category]}\n${items.join('\n')}`);
      }
    }

    if (sections.length === 0) {
      return { content: '', memoryIds: [], tokenEstimate: 0 };
    }

    const content = `## Relevant Memories\n\n${sections.join('\n\n')}`;
    return { content, memoryIds, tokenEstimate };
  }

  /**
   * Format a single memory entry
   */
  private formatMemoryEntry(memory: Memory): string {
    const importance = memory.importance >= 8 ? ' (important)' : '';
    const summary = memory.summary || this.summarizeValue(memory.value);
    return `- ${summary}${importance}`;
  }

  /**
   * Create a summary from a value
   */
  private summarizeValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.length > 100 ? value.slice(0, 100) + '...' : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value as object);
      return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
    }
    return String(value);
  }

  /**
   * Estimate token count (rough approximation)
   * Uses ~4 characters per token as a simple heuristic
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Build a simple context injection string for testing
 */
export function buildContextInjection(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const injector = {} as MemoryInjector;
  const sections: string[] = [];

  const byCategory: Record<string, Memory[]> = {};
  for (const memory of memories) {
    if (!byCategory[memory.category]) {
      byCategory[memory.category] = [];
    }
    byCategory[memory.category].push(memory);
  }

  const categoryNames: Record<string, string> = {
    preference: 'User Preferences',
    fact: 'Known Facts',
    knowledge: 'Knowledge Base',
    history: 'Recent Context',
  };

  for (const [category, categoryMemories] of Object.entries(byCategory)) {
    const items = categoryMemories.map(m => {
      const importance = m.importance >= 8 ? ' (important)' : '';
      const summary = m.summary || String(m.value).slice(0, 100);
      return `- ${summary}${importance}`;
    });

    if (items.length > 0) {
      sections.push(`### ${categoryNames[category] || category}\n${items.join('\n')}`);
    }
  }

  return sections.length > 0 ? `## Relevant Memories\n\n${sections.join('\n\n')}` : '';
}
