/**
 * Assistant Registry Store
 *
 * Provides storage layer for registered assistants with support for
 * in-memory and SQLite-based persistence.
 *
 * Table: registered_assistants
 */

import type {
  RegisteredAssistant,
  AssistantRegistration,
  AssistantUpdate,
  AssistantQuery,
  AssistantQueryResult,
  RegistryConfig,
  RegistryStats,
  AssistantType,
  RegistryAssistantState,
} from './types';
import { DEFAULT_REGISTRY_CONFIG } from './types';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../database';

function getDb(): DatabaseConnection {
  return getDatabase();
}

/**
 * Generate a unique assistant ID
 */
function generateAssistantId(): string {
  return `assistant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new assistant record from registration
 */
function createAssistantRecord(registration: AssistantRegistration): RegisteredAssistant {
  const now = new Date().toISOString();
  const id = registration.id || generateAssistantId();

  return {
    id,
    name: registration.name,
    description: registration.description,
    type: registration.type,
    sessionId: registration.sessionId,
    parentId: registration.parentId,
    childIds: [],
    capabilities: {
      tools: registration.capabilities.tools || [],
      skills: registration.capabilities.skills || [],
      models: registration.capabilities.models || [],
      tags: registration.capabilities.tags || [],
      maxConcurrent: registration.capabilities.maxConcurrent,
      maxDepth: registration.capabilities.maxDepth,
      toolScopes: registration.capabilities.toolScopes,
    },
    status: {
      state: 'idle',
      uptime: 0,
      messagesProcessed: 0,
      toolCallsExecuted: 0,
      errorsCount: 0,
    },
    load: {
      activeTasks: 0,
      queuedTasks: 0,
      tokensUsed: 0,
      llmCalls: 0,
      currentDepth: 0,
    },
    heartbeat: {
      lastHeartbeat: now,
      intervalMs: 10000,
      isStale: false,
      missedCount: 0,
    },
    registeredAt: now,
    updatedAt: now,
    endpoint: registration.endpoint,
    metadata: registration.metadata,
  };
}

/**
 * Check if assistant has required capabilities
 */
function hasRequiredCapabilities(
  assistant: RegisteredAssistant,
  required?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!required) return true;

  if (required.tools?.length) {
    const hasAllTools = required.tools.every((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (!hasAllTools) return false;
  }

  if (required.skills?.length) {
    const hasAllSkills = required.skills.every((skill) =>
      assistant.capabilities.skills.includes(skill)
    );
    if (!hasAllSkills) return false;
  }

  if (required.tags?.length) {
    const hasAllTags = required.tags.every((tag) =>
      assistant.capabilities.tags.includes(tag)
    );
    if (!hasAllTags) return false;
  }

  return true;
}

/**
 * Calculate capability match score
 */
function calculateMatchScore(
  assistant: RegisteredAssistant,
  preferred?: { tools?: string[]; skills?: string[]; tags?: string[] }
): number {
  if (!preferred) return 1;

  let score = 0;
  let total = 0;

  if (preferred.tools?.length) {
    total += preferred.tools.length;
    score += preferred.tools.filter((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    ).length;
  }

  if (preferred.skills?.length) {
    total += preferred.skills.length;
    score += preferred.skills.filter((skill) =>
      assistant.capabilities.skills.includes(skill)
    ).length;
  }

  if (preferred.tags?.length) {
    total += preferred.tags.length;
    score += preferred.tags.filter((tag) =>
      assistant.capabilities.tags.includes(tag)
    ).length;
  }

  return total > 0 ? score / total : 1;
}

/**
 * Check if assistant has excluded capabilities
 */
function hasExcludedCapabilities(
  assistant: RegisteredAssistant,
  excluded?: { tools?: string[]; skills?: string[]; tags?: string[] }
): boolean {
  if (!excluded) return false;

  if (excluded.tools?.length) {
    const hasExcludedTool = excluded.tools.some((tool) =>
      assistant.capabilities.tools.some((t) => t === tool || t.startsWith(tool.replace('*', '')))
    );
    if (hasExcludedTool) return true;
  }

  if (excluded.skills?.length) {
    const hasExcludedSkill = excluded.skills.some((skill) =>
      assistant.capabilities.skills.includes(skill)
    );
    if (hasExcludedSkill) return true;
  }

  if (excluded.tags?.length) {
    const hasExcludedTag = excluded.tags.some((tag) =>
      assistant.capabilities.tags.includes(tag)
    );
    if (hasExcludedTag) return true;
  }

  return false;
}

/**
 * Calculate load factor (0-1)
 */
function calculateLoadFactor(assistant: RegisteredAssistant): number {
  const { load, capabilities } = assistant;
  const maxConcurrent = capabilities.maxConcurrent || 5;

  // Weight active tasks heavily, queued tasks less
  const taskLoad = (load.activeTasks + load.queuedTasks * 0.5) / maxConcurrent;

  // Consider token usage if limit is set
  const tokenLoad = load.tokenLimit
    ? load.tokensUsed / load.tokenLimit
    : 0;

  // Combine factors
  return Math.min(1, Math.max(taskLoad, tokenLoad));
}

/**
 * Assistant Registry Store
 */
export class RegistryStore {
  private assistants: Map<string, RegisteredAssistant> = new Map();
  private config: RegistryConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt: number;
  private db: DatabaseConnection | null = null;

  constructor(config?: Partial<RegistryConfig>, db?: DatabaseConnection) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.startedAt = Date.now();

    // Use provided DB or get from singleton for database mode
    if (db) {
      this.db = db;
    } else if (this.config.storage === 'database' || this.config.storage === 'file') {
      try {
        this.db = getDb();
      } catch {
        // Fall back to memory-only if DB not available
      }
    }

    // Load from storage
    if (this.db) {
      this.loadFromDb();
    }

    // Start cleanup timer
    if (this.config.autoDeregister) {
      this.startCleanup();
    }
  }

  /**
   * Load assistants from database
   */
  private loadFromDb(): void {
    if (!this.db) return;
    try {
      const rows = this.db.query<{ id: string; metadata: string | null }>(
        'SELECT * FROM registered_assistants'
      ).all() as Array<{
        id: string;
        name: string;
        type: string;
        description: string | null;
        model: string | null;
        status: string;
        state: string;
        capabilities: string | null;
        tags: string | null;
        parent_id: string | null;
        created_at: string;
        updated_at: string;
        last_active_at: string | null;
        metadata: string | null;
      }>;

      for (const row of rows) {
        try {
          // Full assistant data is stored in metadata column
          if (row.metadata) {
            const assistant = JSON.parse(row.metadata) as RegisteredAssistant;
            this.assistants.set(assistant.id, assistant);
          }
        } catch {
          // Skip malformed rows
        }
      }
    } catch {
      // Failed to load, start fresh
    }
  }

  /**
   * Save assistants to database
   */
  private saveToDb(): void {
    if (!this.db) return;

    try {
      // Sync all assistants to DB
      for (const assistant of this.assistants.values()) {
        this.persistAssistant(assistant);
      }
    } catch {
      // Failed to save, non-critical
    }
  }

  /**
   * Persist a single assistant to DB
   */
  private persistAssistant(assistant: RegisteredAssistant): void {
    if (!this.db) return;
    try {
      const capabilitiesStr = JSON.stringify(assistant.capabilities);
      const tagsStr = JSON.stringify(assistant.capabilities.tags);
      const metadataStr = JSON.stringify(assistant);

      this.db.prepare(
        `INSERT OR REPLACE INTO registered_assistants
         (id, name, type, description, model, status, state, capabilities, tags, parent_id, created_at, updated_at, last_active_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        assistant.id,
        assistant.name,
        assistant.type,
        assistant.description || null,
        null,
        assistant.heartbeat.isStale ? 'stale' : 'active',
        assistant.status.state,
        capabilitiesStr,
        tagsStr,
        assistant.parentId || null,
        assistant.registeredAt,
        assistant.updatedAt,
        assistant.heartbeat.lastHeartbeat,
        metadataStr,
      );
    } catch {
      // Non-critical
    }
  }

  /**
   * Remove an assistant from DB
   */
  private removeFromDb(id: string): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM registered_assistants WHERE id = ?').run(id);
    } catch {
      // Non-critical
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleAssistants();
    }, this.config.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up stale assistants
   * This is called automatically on an interval, but can be called manually
   * to trigger cleanup (e.g., on startup to clean up crashed sessions)
   */
  cleanupStaleAssistants(): void {
    const now = Date.now();
    const staleThreshold = this.config.staleTTL;

    for (const [id, assistant] of this.assistants) {
      const lastHeartbeat = new Date(assistant.heartbeat.lastHeartbeat).getTime();
      const age = now - lastHeartbeat;

      if (age > staleThreshold) {
        // Auto-deregister stale assistants
        this.assistants.delete(id);
        this.removeFromDb(id);
      } else if (age > this.config.heartbeatStaleThreshold) {
        // Mark as stale but keep
        assistant.heartbeat.isStale = true;
        assistant.heartbeat.missedCount = Math.floor(age / this.config.heartbeatStaleThreshold);
        assistant.status.state = 'offline';
        assistant.updatedAt = new Date().toISOString();
        this.persistAssistant(assistant);
      }
    }
  }

  /**
   * Register a new assistant
   */
  register(registration: AssistantRegistration): RegisteredAssistant {
    // Check max assistants limit
    if (this.assistants.size >= this.config.maxAssistants) {
      // Try to clean up stale assistants first
      this.cleanupStaleAssistants();

      if (this.assistants.size >= this.config.maxAssistants) {
        throw new Error(`Registry full: maximum ${this.config.maxAssistants} assistants reached`);
      }
    }

    const assistant = createAssistantRecord(registration);

    // Update parent's childIds if parent exists
    if (assistant.parentId) {
      const parent = this.assistants.get(assistant.parentId);
      if (parent) {
        parent.childIds.push(assistant.id);
        parent.updatedAt = new Date().toISOString();
        this.persistAssistant(parent);
      }
    }

    this.assistants.set(assistant.id, assistant);
    this.persistAssistant(assistant);

    return assistant;
  }

  /**
   * Get an assistant by ID
   */
  get(id: string): RegisteredAssistant | null {
    return this.assistants.get(id) || null;
  }

  /**
   * Update an assistant
   */
  update(id: string, update: AssistantUpdate): RegisteredAssistant | null {
    const assistant = this.assistants.get(id);
    if (!assistant) return null;

    const now = new Date().toISOString();

    if (update.name !== undefined) assistant.name = update.name;
    if (update.description !== undefined) assistant.description = update.description;

    if (update.capabilities) {
      assistant.capabilities = {
        ...assistant.capabilities,
        ...update.capabilities,
      };
    }

    if (update.status) {
      assistant.status = {
        ...assistant.status,
        ...update.status,
      };
    }

    if (update.load) {
      assistant.load = {
        ...assistant.load,
        ...update.load,
      };
    }

    if (update.metadata) {
      assistant.metadata = {
        ...assistant.metadata,
        ...update.metadata,
      };
    }

    assistant.updatedAt = now;
    this.persistAssistant(assistant);

    return assistant;
  }

  /**
   * Record a heartbeat
   */
  heartbeat(id: string): RegisteredAssistant | null {
    const assistant = this.assistants.get(id);
    if (!assistant) return null;

    const now = new Date().toISOString();
    assistant.heartbeat.lastHeartbeat = now;
    assistant.heartbeat.isStale = false;
    assistant.heartbeat.missedCount = 0;

    // Recover from offline state
    if (assistant.status.state === 'offline') {
      assistant.status.state = 'idle';
    }

    assistant.updatedAt = now;

    return assistant;
  }

  /**
   * Deregister an assistant
   */
  deregister(id: string): boolean {
    const assistant = this.assistants.get(id);
    if (!assistant) return false;

    // Update parent's childIds
    if (assistant.parentId) {
      const parent = this.assistants.get(assistant.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((cid) => cid !== id);
        parent.updatedAt = new Date().toISOString();
        this.persistAssistant(parent);
      }
    }

    // Deregister children
    for (const childId of assistant.childIds) {
      this.deregister(childId);
    }

    this.assistants.delete(id);
    this.removeFromDb(id);

    return true;
  }

  /**
   * Query assistants
   */
  query(query: AssistantQuery): AssistantQueryResult {
    let results = Array.from(this.assistants.values());
    const scores = new Map<string, number>();

    // Filter by type
    if (query.type) {
      const types = Array.isArray(query.type) ? query.type : [query.type];
      results = results.filter((a) => types.includes(a.type));
    }

    // Filter by state
    if (query.state) {
      const states = Array.isArray(query.state) ? query.state : [query.state];
      results = results.filter((a) => states.includes(a.status.state));
    }

    // Filter by session ID
    if (query.sessionId) {
      results = results.filter((a) => a.sessionId === query.sessionId);
    }

    // Filter by parent ID
    if (query.parentId) {
      results = results.filter((a) => a.parentId === query.parentId);
    }

    // Filter by required capabilities
    if (query.requiredCapabilities) {
      results = results.filter((a) => hasRequiredCapabilities(a, query.requiredCapabilities));
    }

    // Filter by excluded capabilities
    if (query.excludedCapabilities) {
      results = results.filter((a) => !hasExcludedCapabilities(a, query.excludedCapabilities));
    }

    // Exclude offline assistants if not requested
    if (!query.includeOffline) {
      results = results.filter((a) => a.status.state !== 'offline' && !a.heartbeat.isStale);
    }

    // Filter by max load factor
    if (query.maxLoadFactor !== undefined) {
      results = results.filter((a) => calculateLoadFactor(a) <= query.maxLoadFactor!);
    }

    // Calculate scores
    for (const assistant of results) {
      scores.set(assistant.id, calculateMatchScore(assistant, query.preferredCapabilities));
    }

    // Sort results
    const sortBy = query.sortBy || 'registeredAt';
    const sortDir = query.sortDir === 'desc' ? -1 : 1;

    results.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name) * sortDir;
        case 'load':
          return (calculateLoadFactor(a) - calculateLoadFactor(b)) * sortDir;
        case 'uptime':
          return (a.status.uptime - b.status.uptime) * sortDir;
        case 'registeredAt':
        default:
          return (new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime()) * sortDir;
      }
    });

    // Also sort by score (higher first) as secondary sort
    results.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));

    const total = results.length;

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return { assistants: results, total, scores };
  }

  /**
   * List all assistants
   */
  list(): RegisteredAssistant[] {
    return Array.from(this.assistants.values());
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    const assistants = Array.from(this.assistants.values());

    const byType: Record<AssistantType, number> = {
      assistant: 0,
      subassistant: 0,
      coordinator: 0,
      worker: 0,
    };

    const byState: Record<RegistryAssistantState, number> = {
      idle: 0,
      processing: 0,
      waiting_input: 0,
      error: 0,
      offline: 0,
      stopped: 0,
    };

    let totalLoad = 0;
    let staleCount = 0;

    for (const assistant of assistants) {
      byType[assistant.type]++;
      byState[assistant.status.state]++;
      totalLoad += calculateLoadFactor(assistant);

      if (assistant.heartbeat.isStale) {
        staleCount++;
      }
    }

    return {
      totalAssistants: assistants.length,
      byType,
      byState,
      staleCount,
      averageLoad: assistants.length > 0 ? totalLoad / assistants.length : 0,
      uptime: (Date.now() - this.startedAt) / 1000,
    };
  }

  /**
   * Clear all assistants
   */
  clear(): void {
    this.assistants.clear();
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM registered_assistants').run();
      } catch {
        // Non-critical
      }
    }
  }
}
