/**
 * Memory Types
 *
 * Type definitions for the global and shared memory system.
 */

// ============================================
// Core Memory Types
// ============================================

/**
 * Memory scope - determines visibility and access
 */
export type MemoryScope = 'global' | 'shared' | 'private';

/**
 * Memory category - classifies the type of memory
 */
export type MemoryCategory = 'preference' | 'fact' | 'history' | 'knowledge';

/**
 * Memory source - who created the memory
 */
export type MemorySource = 'user' | 'assistant' | 'system';

/**
 * Memory entry stored in the database
 */
export interface Memory {
  id: string;
  scope: MemoryScope;
  scopeId?: string;
  category: MemoryCategory;
  key: string;
  value: unknown;
  summary?: string;
  importance: number;
  tags: string[];
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  accessedAt?: string;
  accessCount: number;
  expiresAt?: string;
}

/**
 * Options for creating or updating a memory
 */
export interface MemoryOptions {
  scope?: MemoryScope;
  scopeId?: string;
  category: MemoryCategory;
  summary?: string;
  importance?: number;
  tags?: string[];
  source?: MemorySource;
  expiresAt?: string;
  ttlMs?: number;
}

/**
 * Query options for retrieving memories
 */
export interface MemoryQuery {
  scope?: MemoryScope;
  scopeId?: string;
  category?: MemoryCategory;
  tags?: string[];
  minImportance?: number;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: 'importance' | 'created' | 'accessed' | 'updated';
  orderDir?: 'asc' | 'desc';
}

/**
 * Result of a memory query with pagination info
 */
export interface MemoryQueryResult {
  memories: Memory[];
  total: number;
  hasMore: boolean;
}

// ============================================
// Memory Injection Types
// ============================================

/**
 * Configuration for memory auto-injection
 */
export interface MemoryInjectionConfig {
  enabled: boolean;
  maxTokens: number;
  minImportance: number;
  categories: MemoryCategory[];
  refreshInterval: number;
}

/**
 * Result of preparing memory injection
 */
export interface MemoryInjectionResult {
  content: string;
  memoryIds: string[];
  tokenEstimate: number;
}

// ============================================
// Memory Statistics Types
// ============================================

/**
 * Statistics about memory usage
 */
export interface MemoryStats {
  totalCount: number;
  byScope: Record<MemoryScope, number>;
  byCategory: Record<MemoryCategory, number>;
  oldestMemory?: string;
  newestMemory?: string;
  avgImportance: number;
}

// ============================================
// Memory Access Log Types
// ============================================

/**
 * Actions that can be logged for memory access
 */
export type MemoryAccessAction = 'read' | 'write' | 'inject' | 'delete';

/**
 * Memory access log entry
 */
export interface MemoryAccessLog {
  id: number;
  memoryId: string;
  sessionId?: string;
  assistantId?: string;
  action: MemoryAccessAction;
  timestamp: string;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Full memory configuration
 */
export interface MemoryConfig {
  enabled: boolean;
  injection: MemoryInjectionConfig;
  storage: {
    maxEntries: number;
    defaultTTL?: number;
  };
  scopes: {
    globalEnabled: boolean;
    sharedEnabled: boolean;
    privateEnabled: boolean;
  };
  accessLog?: {
    /** Maximum number of access log entries (default: 10000) */
    maxEntries?: number;
    /** Maximum age of access log entries in milliseconds (default: 7 days) */
    maxAgeDays?: number;
  };
}

/**
 * Default memory configuration
 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  injection: {
    enabled: true,
    maxTokens: 500,
    minImportance: 5,
    categories: ['preference', 'fact'],
    refreshInterval: 5,
  },
  storage: {
    maxEntries: 1000,
  },
  scopes: {
    globalEnabled: true,
    sharedEnabled: true,
    privateEnabled: true,
  },
  accessLog: {
    maxEntries: 10000,
    maxAgeDays: 7,
  },
};
