/**
 * Global Memory Manager
 *
 * Manages scoped memory storage with global, shared, and private scopes.
 * Provides CRUD operations, queries, and access tracking.
 */

import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import { getRuntime } from '../runtime';
import type { DatabaseConnection } from '../runtime';
import {
  DEFAULT_MEMORY_CONFIG,
  type Memory,
  type MemoryScope,
  type MemoryCategory,
  type MemoryOptions,
  type MemoryQuery,
  type MemoryQueryResult,
  type MemoryStats,
  type MemoryAccessAction,
  type MemoryConfig,
} from './types';

// ============================================
// Size Limits
// ============================================

/** Maximum key length in characters */
const MAX_KEY_LENGTH = 256;

/** Maximum value size in bytes (64KB) */
const MAX_VALUE_SIZE = 65536;

/** Maximum summary length in characters */
const MAX_SUMMARY_LENGTH = 500;

/**
 * Global Memory Manager - handles all memory operations
 */
export class GlobalMemoryManager {
  private db: DatabaseConnection;
  private defaultScope: MemoryScope;
  private defaultScopeId?: string;
  private sessionId?: string;
  private config: MemoryConfig;

  constructor(options: {
    dbPath?: string;
    db?: DatabaseConnection;
    defaultScope?: MemoryScope;
    scopeId?: string;
    sessionId?: string;
    config?: Partial<MemoryConfig>;
  } = {}) {
    this.db = options.dbPath ? getRuntime().openDatabase(options.dbPath) : (options.db || getDatabase());
    this.defaultScope = options.defaultScope || 'private';
    this.defaultScopeId = options.scopeId;
    this.sessionId = options.sessionId;
    this.config = this.mergeConfig(DEFAULT_MEMORY_CONFIG, options.config);

    // Run cleanup on startup to enforce retention policies
    this.cleanupAccessLog();
  }

  /**
   * Deep merge memory config, preserving defaults for nested objects
   */
  private mergeConfig(defaults: MemoryConfig, overrides?: Partial<MemoryConfig>): MemoryConfig {
    if (!overrides) {
      return { ...defaults };
    }

    return {
      enabled: overrides.enabled ?? defaults.enabled,
      injection: {
        ...defaults.injection,
        ...overrides.injection,
      },
      storage: {
        ...defaults.storage,
        ...overrides.storage,
      },
      scopes: {
        ...defaults.scopes,
        ...overrides.scopes,
      },
      accessLog: {
        ...defaults.accessLog,
        ...overrides.accessLog,
      },
    };
  }

  /**
   * Set the default scope for operations
   */
  setScope(scope: MemoryScope, scopeId?: string): void {
    this.defaultScope = scope;
    this.defaultScopeId = scopeId;
  }

  /**
   * Check if a scope is enabled in config
   */
  private isScopeEnabled(scope: MemoryScope): boolean {
    switch (scope) {
      case 'global':
        return this.config.scopes.globalEnabled;
      case 'shared':
        return this.config.scopes.sharedEnabled;
      case 'private':
        return this.config.scopes.privateEnabled;
      default:
        return false;
    }
  }

  /**
   * Save or update a memory
   */
  async set(key: string, value: unknown, options: MemoryOptions): Promise<Memory> {
    // Validate key length
    if (!key || key.length > MAX_KEY_LENGTH) {
      throw new Error(`Memory key must be 1-${MAX_KEY_LENGTH} characters`);
    }

    // Validate value size
    const serializedValue = JSON.stringify(value);
    if (serializedValue.length > MAX_VALUE_SIZE) {
      throw new Error(`Memory value exceeds maximum size of ${MAX_VALUE_SIZE} bytes`);
    }

    // Validate summary length
    if (options.summary && options.summary.length > MAX_SUMMARY_LENGTH) {
      throw new Error(`Memory summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters`);
    }

    const now = new Date().toISOString();
    const scope = options.scope || this.defaultScope;

    // Check if scope is enabled
    if (!this.isScopeEnabled(scope)) {
      throw new Error(`Memory scope '${scope}' is disabled in configuration`);
    }

    // Determine scopeId based on scope type:
    // - global: always null (visible to all)
    // - shared: use explicit scopeId or null (for team/project sharing)
    // - private: use explicit scopeId or defaultScopeId (assistant-specific)
    let scopeId: string | null;
    if (options.scopeId !== undefined) {
      // Explicit scopeId provided - use it
      scopeId = options.scopeId || null;
    } else if (scope === 'global') {
      // Global scope: never use defaultScopeId
      scopeId = null;
    } else if (scope === 'private') {
      // Private scope: require scopeId (assistant isolation)
      scopeId = this.defaultScopeId || null;
    } else {
      // Shared scope: use explicit scopeId or null for "all assistants" sharing
      scopeId = null;
    }

    // Require scopeId for private scope to prevent unscoped private data
    if (scope === 'private' && !scopeId) {
      throw new Error('Private scope requires a scopeId to identify the owner. Set defaultScopeId on the manager or provide scopeId explicitly.');
    }

    // Check if memory exists
    const existing = await this.get(key, scope, scopeId || undefined);

    // Calculate expiration - use provided TTL, or default TTL from config
    let expiresAt = options.expiresAt;
    if (!expiresAt && options.ttlMs) {
      expiresAt = new Date(Date.now() + options.ttlMs).toISOString();
    } else if (!expiresAt && this.config.storage.defaultTTL) {
      expiresAt = new Date(Date.now() + this.config.storage.defaultTTL).toISOString();
    }

    if (existing) {
      // Update existing memory
      return this.update(existing.id, {
        value,
        summary: options.summary,
        importance: options.importance,
        tags: options.tags,
        expiresAt,
      });
    }

    // Before inserting, enforce storage limits if configured
    await this.enforceStorageLimits();

    // Create new memory
    const id = generateId();
    const memory: Memory = {
      id,
      scope,
      scopeId: scopeId || undefined,
      category: options.category,
      key,
      value,
      summary: options.summary,
      importance: options.importance ?? 5,
      tags: options.tags || [],
      source: options.source || 'assistant',
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      expiresAt,
    };

    this.db.prepare(`
      INSERT INTO memories (
        id, scope, scope_id, category, key, value, summary,
        importance, tags, source, created_at, updated_at,
        accessed_at, access_count, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.scope,
      memory.scopeId || null,
      memory.category,
      memory.key,
      JSON.stringify(memory.value),
      memory.summary || null,
      memory.importance,
      JSON.stringify(memory.tags),
      memory.source,
      memory.createdAt,
      memory.updatedAt,
      memory.accessedAt || null,
      memory.accessCount,
      memory.expiresAt || null
    );

    this.logAccess(id, 'write');
    return memory;
  }

  /**
   * Enforce storage limits by removing lowest-importance and oldest memories
   * when the count exceeds maxEntries.
   *
   * IMPORTANT: This method clears expired memories first to prevent them
   * from counting toward the limit while live memories get evicted.
   */
  private async enforceStorageLimits(): Promise<number> {
    const maxEntries = this.config.storage.maxEntries;
    if (!maxEntries || maxEntries <= 0) {
      return 0;
    }

    // First, clear expired memories so they don't count toward the limit
    // This prevents the bug where expired memories inflate the count
    // while live memories get evicted instead
    await this.clearExpired();

    // Get current count (now only includes non-expired memories)
    const countResult = this.db
      .query<{ count: number }>(`SELECT COUNT(*) as count FROM memories`)
      .get();
    const currentCount = countResult?.count || 0;

    // If we're at or over the limit, remove entries to make room
    // We remove entries with lowest importance first, then oldest
    if (currentCount >= maxEntries) {
      // Calculate how many to remove (remove at least 1 to make room, or 5% buffer)
      const toRemove = Math.max(1, Math.ceil(maxEntries * 0.05));

      // Delete lowest importance, oldest memories
      // Note: We can now safely select all memories since expired ones are already cleared
      const result = this.db.prepare(`
        DELETE FROM memories WHERE id IN (
          SELECT id FROM memories
          ORDER BY importance ASC, (accessed_at IS NOT NULL) ASC, accessed_at ASC, created_at ASC
          LIMIT ?
        )
      `).run(toRemove);

      return result.changes;
    }

    return 0;
  }

  /**
   * Update an existing memory
   */
  async update(id: string, updates: Partial<Memory>): Promise<Memory> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }

    const now = new Date().toISOString();
    const updated: Memory = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    this.db.prepare(`
      UPDATE memories SET
        value = ?,
        summary = ?,
        importance = ?,
        tags = ?,
        updated_at = ?,
        expires_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(updated.value),
      updated.summary || null,
      updated.importance,
      JSON.stringify(updated.tags),
      updated.updatedAt,
      updated.expiresAt || null,
      id
    );

    this.logAccess(id, 'write');
    return updated;
  }

  /**
   * Get a memory by key and scope
   */
  async get(key: string, scope?: MemoryScope, scopeId?: string): Promise<Memory | null> {
    const effectiveScope = scope || this.defaultScope;

    // Check if scope is enabled
    if (!this.isScopeEnabled(effectiveScope)) {
      return null; // Silently return null for disabled scopes (consistent with query behavior)
    }

    // Determine scopeId based on scope semantics (same as set())
    let effectiveScopeId: string | null;
    if (scopeId !== undefined) {
      effectiveScopeId = scopeId || null;
    } else if (effectiveScope === 'global') {
      effectiveScopeId = null;
    } else if (effectiveScope === 'private') {
      effectiveScopeId = this.defaultScopeId || null;
    } else {
      effectiveScopeId = null;
    }

    // Private scope requires scopeId - return null if missing
    if (effectiveScope === 'private' && !effectiveScopeId) {
      return null;
    }

    const row = this.db
      .query<MemoryRow>(`
        SELECT * FROM memories
        WHERE key = ? AND scope = ? AND (scope_id = ? OR (scope_id IS NULL AND ? IS NULL))
      `)
      .get(key, effectiveScope, effectiveScopeId, effectiveScopeId);

    if (!row) return null;

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.delete(row.id);
      return null;
    }

    const memory = this.rowToMemory(row);
    this.recordAccess(row.id);
    this.logAccess(row.id, 'read');
    return memory;
  }

  /**
   * Get a memory by ID
   */
  async getById(id: string): Promise<Memory | null> {
    const row = this.db
      .query<MemoryRow>(`SELECT * FROM memories WHERE id = ?`)
      .get(id);

    if (!row) return null;

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.delete(row.id);
      return null;
    }

    return this.rowToMemory(row);
  }

  /**
   * Query memories with filters
   *
   * Note: Scope isolation is enforced to prevent cross-assistant leakage.
   * - global: accessible by all (scope_id must be null) - only if enabled
   * - shared: accessible if scope_id is null or matches this assistant - only if enabled
   * - private: only accessible if scope_id matches this assistant - only if enabled
   */
  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Build scope isolation conditions based on requested scope(s) and this assistant's scopeId
    const scopeConditions: string[] = [];

    if (query.scope) {
      // Specific scope requested - check if enabled and enforce isolation rules
      if (!this.isScopeEnabled(query.scope)) {
        // Requested scope is disabled - return empty results
        return { memories: [], total: 0, hasMore: false };
      }

      if (query.scope === 'global') {
        // Global: always accessible, but scope_id must be null
        scopeConditions.push("(scope = 'global' AND scope_id IS NULL)");
      } else if (query.scope === 'shared') {
        // Shared: accessible if scope_id is null (general) or matches this assistant
        if (this.defaultScopeId) {
          scopeConditions.push("(scope = 'shared' AND (scope_id IS NULL OR scope_id = ?))");
          params.push(this.defaultScopeId);
        } else {
          scopeConditions.push("(scope = 'shared' AND scope_id IS NULL)");
        }
      } else if (query.scope === 'private') {
        // Private: only accessible if scope_id matches this assistant
        if (this.defaultScopeId) {
          scopeConditions.push("(scope = 'private' AND scope_id = ?)");
          params.push(this.defaultScopeId);
        } else {
          // No assistant scope set - can't access any private memories
          return { memories: [], total: 0, hasMore: false };
        }
      }
    } else {
      // No specific scope requested - return all accessible memories from ENABLED scopes only
      // Global memories (scope_id must be null)
      if (this.isScopeEnabled('global')) {
        scopeConditions.push("(scope = 'global' AND scope_id IS NULL)");
      }

      // Shared memories (scope_id is null or matches this assistant)
      if (this.isScopeEnabled('shared')) {
        if (this.defaultScopeId) {
          scopeConditions.push("(scope = 'shared' AND (scope_id IS NULL OR scope_id = ?))");
          params.push(this.defaultScopeId);
        } else {
          scopeConditions.push("(scope = 'shared' AND scope_id IS NULL)");
        }
      }

      // Private memories (scope_id must match this assistant)
      if (this.isScopeEnabled('private') && this.defaultScopeId) {
        scopeConditions.push("(scope = 'private' AND scope_id = ?)");
        params.push(this.defaultScopeId);
      }

      // If no scopes are enabled, return empty
      if (scopeConditions.length === 0) {
        return { memories: [], total: 0, hasMore: false };
      }
    }

    if (scopeConditions.length > 0) {
      conditions.push(`(${scopeConditions.join(' OR ')})`);
    }

    // If explicit scopeId filter is provided, add it as an additional constraint
    // (but only if it passes the isolation rules above)
    if (query.scopeId !== undefined && query.scopeId !== null) {
      // Only allow filtering by the assistant's own scopeId for private/shared
      if (query.scopeId === this.defaultScopeId) {
        conditions.push('scope_id = ?');
        params.push(query.scopeId);
      }
      // Otherwise ignore the scopeId filter (can't query other assistants' data)
    }

    // Category filter
    if (query.category) {
      conditions.push('category = ?');
      params.push(query.category);
    }

    // Importance filter
    if (query.minImportance !== undefined) {
      conditions.push('importance >= ?');
      params.push(query.minImportance);
    }

    // Tags filter
    if (query.tags && query.tags.length > 0) {
      // Match any of the tags
      const tagConditions = query.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' OR ')})`);
      for (const tag of query.tags) {
        params.push(`%"${tag}"%`);
      }
    }

    // Search filter (searches key, summary, and value)
    if (query.search) {
      const searchTerm = `%${query.search}%`;
      conditions.push('(key LIKE ? OR summary LIKE ? OR value LIKE ?)');
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Filter out expired
    conditions.push('(expires_at IS NULL OR expires_at > ?)');
    params.push(new Date().toISOString());

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total
    const countResult = this.db
      .query<{ count: number }>(`SELECT COUNT(*) as count FROM memories ${whereClause}`)
      .get(...params);
    const total = countResult?.count || 0;

    // Order by - validate against allowed columns to prevent SQL injection
    const VALID_ORDER_COLUMNS: Record<string, string> = {
      importance: 'importance',
      created: 'created_at',
      accessed: 'accessed_at',
      updated: 'updated_at',
    };
    const VALID_ORDER_DIRS = new Set(['asc', 'desc']);

    const orderByInput = query.orderBy || 'importance';
    const orderDirInput = (query.orderDir || 'desc').toLowerCase();

    // Fallback to safe defaults if invalid
    const orderColumn = VALID_ORDER_COLUMNS[orderByInput] || 'importance';
    const orderDir = VALID_ORDER_DIRS.has(orderDirInput) ? orderDirInput.toUpperCase() : 'DESC';

    // Pagination - clamp to safe values
    const limit = Math.min(Math.max(1, query.limit || 50), 1000);
    const offset = Math.max(0, query.offset || 0);

    const rows = this.db
      .query<MemoryRow>(`
        SELECT * FROM memories
        ${whereClause}
        ORDER BY ${orderColumn} ${orderDir}, importance DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, limit, offset);

    const memories = rows.map(row => this.rowToMemory(row));

    return {
      memories,
      total,
      hasMore: offset + memories.length < total,
    };
  }

  /**
   * Get memories relevant to a context (for injection)
   */
  async getRelevant(
    context: string,
    options: {
      limit?: number;
      minImportance?: number;
      categories?: MemoryCategory[];
      scopes?: MemoryScope[];
    } = {}
  ): Promise<Memory[]> {
    const limit = options.limit || 10;
    const minImportance = options.minImportance ?? 5;
    const categories = options.categories || ['preference', 'fact', 'knowledge'];
    const requestedScopes = options.scopes || ['global', 'shared', 'private'];

    // Filter out disabled scopes
    const scopes = requestedScopes.filter(s => this.isScopeEnabled(s));

    // Guard against empty arrays which would create invalid SQL
    if (categories.length === 0 || scopes.length === 0) {
      return [];
    }

    const conditions: string[] = [
      `importance >= ?`,
      `category IN (${categories.map(() => '?').join(', ')})`,
      `scope IN (${scopes.map(() => '?').join(', ')})`,
      '(expires_at IS NULL OR expires_at > ?)',
    ];
    const params: unknown[] = [minImportance, ...categories, ...scopes, new Date().toISOString()];

    // Scope isolation rules (only for enabled scopes):
    // - global: accessible by all (scope_id = null)
    // - shared: accessible if scope_id is null OR matches assistant's scopeId
    // - private: only accessible if scope_id matches assistant's scopeId (requires scopeId)
    const scopeConditions: string[] = [];

    // Global memories are always accessible (scope_id must be null)
    if (scopes.includes('global')) {
      scopeConditions.push("(scope = 'global' AND scope_id IS NULL)");
    }

    // Shared memories: accessible if scope_id is null (general) or matches this assistant
    if (scopes.includes('shared')) {
      if (this.defaultScopeId) {
        scopeConditions.push("(scope = 'shared' AND (scope_id IS NULL OR scope_id = ?))");
        params.push(this.defaultScopeId);
      } else {
        scopeConditions.push("(scope = 'shared' AND scope_id IS NULL)");
      }
    }

    // Private memories: only accessible if scope_id matches this assistant (requires scopeId)
    if (scopes.includes('private') && this.defaultScopeId) {
      scopeConditions.push("(scope = 'private' AND scope_id = ?)");
      params.push(this.defaultScopeId);
    }

    // If no scope conditions (e.g., private requested but no scopeId), return empty
    if (scopeConditions.length === 0) {
      return [];
    }

    conditions.push(`(${scopeConditions.join(' OR ')})`)

    // Simple keyword matching for relevance
    // In a more sophisticated implementation, this could use embeddings
    const keywords = context.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length > 0) {
      const keywordConditions = keywords.slice(0, 5).map(() =>
        '(LOWER(key) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(value) LIKE ?)'
      );
      if (keywordConditions.length > 0) {
        conditions.push(`(${keywordConditions.join(' OR ')})`);
        for (const keyword of keywords.slice(0, 5)) {
          const pattern = `%${keyword}%`;
          params.push(pattern, pattern, pattern);
        }
      }
    }

    const rows = this.db
      .query<MemoryRow>(`
        SELECT * FROM memories
        WHERE ${conditions.join(' AND ')}
        ORDER BY importance DESC, accessed_at DESC
        LIMIT ?
      `)
      .all(...params, limit);

    const memories = rows.map(row => this.rowToMemory(row));

    // Log access for injected memories
    for (const memory of memories) {
      this.logAccess(memory.id, 'inject');
    }

    return memories;
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<void> {
    this.logAccess(id, 'delete');
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  }

  /**
   * Delete a memory by key and scope
   */
  async deleteByKey(key: string, scope?: MemoryScope, scopeId?: string): Promise<boolean> {
    const memory = await this.get(key, scope, scopeId);
    if (!memory) return false;
    await this.delete(memory.id);
    return true;
  }

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    const total = this.db
      .query<{ count: number }>(`SELECT COUNT(*) as count FROM memories`)
      .get();

    const byScope = this.db
      .query<{ scope: MemoryScope; count: number }>(`
        SELECT scope, COUNT(*) as count FROM memories GROUP BY scope
      `)
      .all();

    const byCategory = this.db
      .query<{ category: MemoryCategory; count: number }>(`
        SELECT category, COUNT(*) as count FROM memories GROUP BY category
      `)
      .all();

    const oldest = this.db
      .query<{ created_at: string }>(`
        SELECT created_at FROM memories ORDER BY created_at ASC LIMIT 1
      `)
      .get();

    const newest = this.db
      .query<{ created_at: string }>(`
        SELECT created_at FROM memories ORDER BY created_at DESC LIMIT 1
      `)
      .get();

    const avgImportance = this.db
      .query<{ avg: number }>(`SELECT AVG(importance) as avg FROM memories`)
      .get();

    const scopeMap: Record<MemoryScope, number> = { global: 0, shared: 0, private: 0 };
    for (const row of byScope) {
      scopeMap[row.scope] = row.count;
    }

    const categoryMap: Record<MemoryCategory, number> = { preference: 0, fact: 0, history: 0, knowledge: 0 };
    for (const row of byCategory) {
      categoryMap[row.category] = row.count;
    }

    return {
      totalCount: total?.count || 0,
      byScope: scopeMap,
      byCategory: categoryMap,
      oldestMemory: oldest?.created_at,
      newestMemory: newest?.created_at,
      avgImportance: avgImportance?.avg || 0,
    };
  }

  /**
   * Clear expired memories
   */
  async clearExpired(): Promise<number> {
    const result = this.db.prepare(`
      DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?
    `).run(new Date().toISOString());
    return result.changes;
  }

  /**
   * Cleanup memories by removing expired and enforcing storage limits
   * Returns total number of memories removed
   */
  async cleanup(): Promise<{ expired: number; overLimit: number; accessLogCleaned: number }> {
    const expired = await this.clearExpired();
    const overLimit = await this.enforceStorageLimits();
    const accessLogCleaned = await this.cleanupAccessLog();
    return { expired, overLimit, accessLogCleaned };
  }

  /**
   * Cleanup old access log entries based on retention policy
   * Removes entries older than maxAgeDays and entries over maxEntries
   */
  private async cleanupAccessLog(): Promise<number> {
    let totalRemoved = 0;

    // Get access log config
    const maxAgeDays = this.config.accessLog?.maxAgeDays ?? 7;
    const maxEntries = this.config.accessLog?.maxEntries ?? 10000;

    // Remove entries older than maxAgeDays
    if (maxAgeDays > 0) {
      const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();
      const result = this.db.prepare(`
        DELETE FROM memory_access_log WHERE timestamp < ?
      `).run(cutoffDate);
      totalRemoved += result.changes;
    }

    // Enforce max entries - keep most recent
    if (maxEntries > 0) {
      const countResult = this.db
        .query<{ count: number }>(`SELECT COUNT(*) as count FROM memory_access_log`)
        .get();
      const currentCount = countResult?.count || 0;

      if (currentCount > maxEntries) {
        // Delete oldest entries to bring count down to maxEntries
        const toDelete = currentCount - maxEntries;
        const result = this.db.prepare(`
          DELETE FROM memory_access_log WHERE id IN (
            SELECT id FROM memory_access_log ORDER BY timestamp ASC LIMIT ?
          )
        `).run(toDelete);
        totalRemoved += result.changes;
      }
    }

    return totalRemoved;
  }

  /**
   * Get current storage configuration
   */
  getStorageConfig(): { maxEntries: number; defaultTTL?: number } {
    return { ...this.config.storage };
  }

  /**
   * Export memories to JSON
   *
   * Unlike query(), export() retrieves ALL matching memories by paginating
   * through results. Use query filters (scope, category) to limit the export.
   */
  async export(query?: MemoryQuery): Promise<Memory[]> {
    const allMemories: Memory[] = [];
    const pageSize = 1000; // Max page size for query
    let offset = 0;
    let hasMore = true;

    // Create base query without pagination params
    const baseQuery: MemoryQuery = {
      ...query,
      limit: pageSize,
    };

    // Paginate through all results
    while (hasMore) {
      const result = await this.query({ ...baseQuery, offset });
      allMemories.push(...result.memories);

      // Check if there are more results
      hasMore = result.hasMore;
      offset += result.memories.length;

      // Safety limit: prevent infinite loops (max 100 pages = 100k memories)
      if (offset >= 100000) {
        break;
      }
    }

    return allMemories;
  }

  /**
   * Import memories from JSON
   */
  async import(memories: Memory[], options: { overwrite?: boolean } = {}): Promise<number> {
    let imported = 0;
    for (const memory of memories) {
      try {
        const existing = await this.get(memory.key, memory.scope, memory.scopeId);
        if (existing && !options.overwrite) {
          continue;
        }
        await this.set(memory.key, memory.value, {
          scope: memory.scope,
          scopeId: memory.scopeId,
          category: memory.category,
          summary: memory.summary,
          importance: memory.importance,
          tags: memory.tags,
          source: memory.source,
          expiresAt: memory.expiresAt,
        });
        imported++;
      } catch {
        // Skip invalid entries
      }
    }
    return imported;
  }

  /**
   * Close the database connection
   */
  close(): void { }

  // ============================================
  // Private Helper Methods
  // ============================================

  private rowToMemory(row: MemoryRow): Memory {
    return {
      id: row.id,
      scope: row.scope as MemoryScope,
      scopeId: row.scope_id || undefined,
      category: row.category as MemoryCategory,
      key: row.key,
      value: this.parseJson(row.value),
      summary: row.summary || undefined,
      importance: row.importance,
      tags: (this.parseJson(row.tags) as string[]) || [],
      source: row.source as Memory['source'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at || undefined,
      accessCount: row.access_count,
      expiresAt: row.expires_at || undefined,
    };
  }

  private parseJson(value: string | null): unknown {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private recordAccess(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?
    `).run(now, id);
  }

  private logAccess(memoryId: string, action: MemoryAccessAction): void {
    this.db.prepare(`
      INSERT INTO memory_access_log (memory_id, session_id, assistant_id, action, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(memoryId, this.sessionId || null, this.defaultScopeId || null, action, new Date().toISOString());
  }
}

// ============================================
// Internal Types
// ============================================

interface MemoryRow {
  id: string;
  scope: string;
  scope_id: string | null;
  category: string;
  key: string;
  value: string;
  summary: string | null;
  importance: number;
  tags: string;
  source: string;
  created_at: string;
  updated_at: string;
  accessed_at: string | null;
  access_count: number;
  expires_at: string | null;
}
