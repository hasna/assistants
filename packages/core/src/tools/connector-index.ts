import type { Connector, ConnectorCommand } from '@hasna/assistants-shared';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

/**
 * Common tags to derive from connector command names and descriptions
 */
const TAG_KEYWORDS: Record<string, string[]> = {
  email: ['email', 'mail', 'inbox', 'send', 'receive', 'message', 'compose'],
  calendar: ['calendar', 'event', 'meeting', 'schedule', 'appointment'],
  storage: ['file', 'storage', 'drive', 'folder', 'upload', 'download', 'document'],
  notes: ['note', 'page', 'database', 'notion', 'workspace'],
  productivity: ['task', 'todo', 'project', 'board', 'kanban'],
  communication: ['chat', 'slack', 'discord', 'teams', 'channel'],
  crm: ['contact', 'lead', 'customer', 'deal', 'pipeline', 'salesforce'],
  database: ['database', 'sql', 'query', 'table', 'record'],
  api: ['api', 'endpoint', 'request', 'webhook', 'rest'],
  automation: ['automation', 'workflow', 'trigger', 'action', 'zapier'],
  social: ['social', 'twitter', 'linkedin', 'facebook', 'post'],
  code: ['code', 'git', 'github', 'repository', 'commit', 'branch'],
  analytics: ['analytics', 'report', 'metrics', 'dashboard', 'data'],
  payment: ['payment', 'stripe', 'invoice', 'billing', 'subscription'],
  search: ['search', 'find', 'query', 'lookup', 'filter'],
};

/**
 * Indexed connector entry with computed fields
 */
export interface IndexedConnector {
  name: string;
  description: string;
  cli: string;
  commandCount: number;
  commandNames: string[];
  tags: string[];
  lastUsedAt: string | null;
  usageCount: number;
  /** Pre-computed search text (lowercase) */
  searchText: string;
}

interface IndexCache {
  version: number;
  timestamp: number;
  entries: Record<string, IndexedConnector>;
}

const INDEX_VERSION = 1;
const INDEX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Connector index for fast search and ranking
 * Maintains a cached index of connector metadata with auto-generated tags
 */
export class ConnectorIndex {
  private entries: Map<string, IndexedConnector> = new Map();
  private static indexLoaded = false;
  private static indexCache: Map<string, IndexedConnector> = new Map();

  constructor() {
    // Load disk cache on first instantiation
    if (!ConnectorIndex.indexLoaded) {
      this.loadDiskCache();
    } else {
      // Use existing in-memory cache
      this.entries = new Map(ConnectorIndex.indexCache);
    }
  }

  private getHomeDir(): string {
    const envHome = process.env.HOME || process.env.USERPROFILE;
    return envHome && envHome.trim().length > 0 ? envHome : homedir();
  }

  private getCachePath(): string {
    return join(this.getHomeDir(), '.assistants', 'cache', 'connector-index.json');
  }

  private loadDiskCache(): void {
    ConnectorIndex.indexLoaded = true;
    try {
      const cachePath = this.getCachePath();
      if (!existsSync(cachePath)) return;

      const data = JSON.parse(readFileSync(cachePath, 'utf-8')) as IndexCache;

      // Check version and TTL
      if (data.version !== INDEX_VERSION) return;
      if (Date.now() - data.timestamp > INDEX_TTL_MS) return;

      // Load into memory cache
      for (const [name, entry] of Object.entries(data.entries)) {
        this.entries.set(name, entry);
        ConnectorIndex.indexCache.set(name, entry);
      }
    } catch {
      // Cache read failed, will rebuild
    }
  }

  private saveDiskCache(): void {
    try {
      const cachePath = this.getCachePath();
      const cacheDir = dirname(cachePath);
      if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir, { recursive: true });
      }

      const data: IndexCache = {
        version: INDEX_VERSION,
        timestamp: Date.now(),
        entries: Object.fromEntries(this.entries),
      };

      writeFileSync(cachePath, JSON.stringify(data));

      // Update shared cache
      ConnectorIndex.indexCache = new Map(this.entries);
    } catch {
      // Cache write failed, non-critical
    }
  }

  /**
   * Generate tags from connector metadata
   */
  private generateTags(connector: Connector): string[] {
    const tags = new Set<string>();

    // Build text corpus for tag matching
    const textCorpus = [
      connector.name.toLowerCase(),
      connector.description.toLowerCase(),
      ...connector.commands.map((cmd) => cmd.name.toLowerCase()),
      ...connector.commands.map((cmd) => (cmd.description || '').toLowerCase()),
    ].join(' ');

    // Match against known tags
    for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
      for (const keyword of keywords) {
        if (textCorpus.includes(keyword)) {
          tags.add(tag);
          break;
        }
      }
    }

    // Add connector name as a tag
    tags.add(connector.name.toLowerCase());

    return Array.from(tags);
  }

  /**
   * Build search text for fast matching
   */
  private buildSearchText(connector: Connector): string {
    const parts = [
      connector.name,
      connector.description,
      ...connector.commands.map((cmd) => cmd.name),
      ...connector.commands.map((cmd) => cmd.description || ''),
    ];
    return parts.join(' ').toLowerCase();
  }

  /**
   * Index a connector
   */
  index(connector: Connector): IndexedConnector {
    const existing = this.entries.get(connector.name);

    const entry: IndexedConnector = {
      name: connector.name,
      description: connector.description,
      cli: connector.cli,
      commandCount: connector.commands.length,
      commandNames: connector.commands.map((cmd) => cmd.name),
      tags: this.generateTags(connector),
      lastUsedAt: existing?.lastUsedAt || connector.lastUsedAt || null,
      usageCount: existing?.usageCount || connector.usageCount || 0,
      searchText: this.buildSearchText(connector),
    };

    this.entries.set(connector.name, entry);
    ConnectorIndex.indexCache.set(connector.name, entry);
    this.saveDiskCache();

    return entry;
  }

  /**
   * Index multiple connectors
   */
  indexAll(connectors: Connector[]): void {
    for (const connector of connectors) {
      // Don't save to disk for each one
      const existing = this.entries.get(connector.name);
      const entry: IndexedConnector = {
        name: connector.name,
        description: connector.description,
        cli: connector.cli,
        commandCount: connector.commands.length,
        commandNames: connector.commands.map((cmd) => cmd.name),
        tags: this.generateTags(connector),
        lastUsedAt: existing?.lastUsedAt || connector.lastUsedAt || null,
        usageCount: existing?.usageCount || connector.usageCount || 0,
        searchText: this.buildSearchText(connector),
      };
      this.entries.set(connector.name, entry);
      ConnectorIndex.indexCache.set(connector.name, entry);
    }
    // Save once at the end
    this.saveDiskCache();
  }

  /**
   * Record connector usage
   */
  recordUsage(connectorName: string): void {
    const entry = this.entries.get(connectorName);
    if (entry) {
      entry.lastUsedAt = new Date().toISOString();
      entry.usageCount++;
      ConnectorIndex.indexCache.set(connectorName, entry);
      this.saveDiskCache();
    }
  }

  /**
   * Get indexed entry
   */
  get(name: string): IndexedConnector | undefined {
    return this.entries.get(name);
  }

  /**
   * Get all indexed entries
   */
  getAll(): IndexedConnector[] {
    return Array.from(this.entries.values());
  }

  /**
   * Search connectors with scoring
   */
  search(
    query: string,
    options: {
      limit?: number;
      tags?: string[];
      boostRecent?: boolean;
      boostUsage?: boolean;
    } = {}
  ): Array<{ entry: IndexedConnector; score: number }> {
    const { limit = 10, tags, boostRecent = true, boostUsage = true } = options;
    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(Boolean);

    const results: Array<{ entry: IndexedConnector; score: number }> = [];

    for (const entry of this.entries.values()) {
      // Filter by tags if specified
      if (tags && tags.length > 0) {
        const hasTag = tags.some((tag) => entry.tags.includes(tag.toLowerCase()));
        if (!hasTag) continue;
      }

      // Calculate relevance score
      let score = 0;

      // Exact name match
      if (entry.name.toLowerCase() === lowerQuery) {
        score += 100;
      }
      // Name starts with query
      else if (entry.name.toLowerCase().startsWith(lowerQuery)) {
        score += 50;
      }
      // Name contains query
      else if (entry.name.toLowerCase().includes(lowerQuery)) {
        score += 30;
      }

      // Check each query word
      for (const word of queryWords) {
        // Word in search text
        if (entry.searchText.includes(word)) {
          score += 10;
        }
        // Word matches a tag
        if (entry.tags.includes(word)) {
          score += 15;
        }
        // Word matches a command name
        if (entry.commandNames.some((cmd) => cmd.toLowerCase().includes(word))) {
          score += 20;
        }
      }

      // No match
      if (score === 0) continue;

      // Boost for recency
      if (boostRecent && entry.lastUsedAt) {
        const ageMs = Date.now() - new Date(entry.lastUsedAt).getTime();
        const daysSinceUse = ageMs / (24 * 60 * 60 * 1000);
        // Boost decreases over time: +10 if used today, +5 if used this week, etc.
        if (daysSinceUse < 1) score += 10;
        else if (daysSinceUse < 7) score += 5;
        else if (daysSinceUse < 30) score += 2;
      }

      // Boost for usage count
      if (boostUsage && entry.usageCount > 0) {
        // Logarithmic boost: +5 for 10 uses, +10 for 100 uses, etc.
        score += Math.min(15, Math.floor(Math.log10(entry.usageCount + 1) * 5));
      }

      results.push({ entry, score });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Return top results
    return results.slice(0, limit);
  }

  /**
   * Get connectors by tag
   */
  getByTag(tag: string): IndexedConnector[] {
    const lowerTag = tag.toLowerCase();
    return Array.from(this.entries.values()).filter((entry) =>
      entry.tags.includes(lowerTag)
    );
  }

  /**
   * Get all available tags
   */
  getAllTags(): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const entry of this.entries.values()) {
      for (const tag of entry.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get recently used connectors
   */
  getRecentlyUsed(limit: number = 5): IndexedConnector[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.lastUsedAt)
      .sort((a, b) => {
        const aTime = new Date(a.lastUsedAt!).getTime();
        const bTime = new Date(b.lastUsedAt!).getTime();
        return bTime - aTime;
      })
      .slice(0, limit);
  }

  /**
   * Get most used connectors
   */
  getMostUsed(limit: number = 5): IndexedConnector[] {
    return Array.from(this.entries.values())
      .filter((entry) => entry.usageCount > 0)
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit);
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.entries.clear();
    ConnectorIndex.indexCache.clear();
    this.saveDiskCache();
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalConnectors: number;
    totalCommands: number;
    uniqueTags: number;
    mostUsedTags: Array<{ tag: string; count: number }>;
    recentlyUsedCount: number;
  } {
    let totalCommands = 0;
    let recentlyUsedCount = 0;

    for (const entry of this.entries.values()) {
      totalCommands += entry.commandCount;
      if (entry.lastUsedAt) recentlyUsedCount++;
    }

    const allTags = this.getAllTags();

    return {
      totalConnectors: this.entries.size,
      totalCommands,
      uniqueTags: allTags.length,
      mostUsedTags: allTags.slice(0, 5),
      recentlyUsedCount,
    };
  }
}
