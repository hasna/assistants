/**
 * Assistant Registry Service
 *
 * Provides high-level API for assistant registration, discovery, and lifecycle management.
 * Integrates with heartbeat system for automatic registration and health tracking.
 */

import type {
  RegisteredAssistant,
  AssistantRegistration,
  AssistantUpdate,
  AssistantQuery,
  AssistantQueryResult,
  RegistryConfig,
  RegistryStats,
  RegistryEvent,
  RegistryEventListener,
  RegistryEventType,
  AssistantCapabilities,
} from './types';
import { DEFAULT_REGISTRY_CONFIG } from './types';
import { RegistryStore } from './store';

/**
 * Assistant Registry Service
 */
export class AssistantRegistryService {
  private store: RegistryStore;
  private config: RegistryConfig;
  private listeners: Set<RegistryEventListener> = new Set();

  constructor(config?: Partial<RegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
    this.store = new RegistryStore(this.config);
  }

  /**
   * Emit a registry event
   */
  private emit(
    type: RegistryEventType,
    assistantId: string,
    assistant?: RegisteredAssistant,
    previousState?: Partial<RegisteredAssistant>
  ): void {
    const event: RegistryEvent = {
      type,
      assistantId,
      assistant,
      previousState,
      timestamp: new Date().toISOString(),
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: RegistryEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(listener: RegistryEventListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Check if registry is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Register a new assistant
   */
  register(registration: AssistantRegistration): RegisteredAssistant {
    if (!this.config.enabled) {
      throw new Error('Registry is disabled');
    }

    const assistant = this.store.register(registration);
    this.emit('assistant:registered', assistant.id, assistant);

    return assistant;
  }

  /**
   * Register from heartbeat data
   * Used for auto-registration when assistants start
   */
  registerFromHeartbeat(data: {
    assistantId: string;
    name: string;
    sessionId?: string;
    parentId?: string;
    tools?: string[];
    skills?: string[];
  }): RegisteredAssistant {
    if (!this.config.autoRegister) {
      throw new Error('Auto-registration is disabled');
    }

    // Check if already registered
    const existing = this.store.get(data.assistantId);
    if (existing) {
      // Just update heartbeat
      return this.heartbeat(data.assistantId) || existing;
    }

    return this.register({
      id: data.assistantId,
      name: data.name,
      type: data.parentId ? 'subassistant' : 'assistant',
      sessionId: data.sessionId,
      parentId: data.parentId,
      capabilities: {
        tools: data.tools,
        skills: data.skills,
      },
    });
  }

  /**
   * Get an assistant by ID
   */
  get(id: string): RegisteredAssistant | null {
    return this.store.get(id);
  }

  /**
   * Update an assistant
   */
  update(id: string, update: AssistantUpdate): RegisteredAssistant | null {
    const previous = this.store.get(id);
    const assistant = this.store.update(id, update);

    if (assistant) {
      this.emit('assistant:updated', id, assistant, previous || undefined);
    }

    return assistant;
  }

  /**
   * Update assistant status
   */
  updateStatus(
    id: string,
    status: Partial<RegisteredAssistant['status']>
  ): RegisteredAssistant | null {
    return this.update(id, { status });
  }

  /**
   * Update assistant load
   */
  updateLoad(
    id: string,
    load: Partial<RegisteredAssistant['load']>
  ): RegisteredAssistant | null {
    return this.update(id, { load });
  }

  /**
   * Update assistant capabilities
   */
  updateCapabilities(
    id: string,
    capabilities: Partial<AssistantCapabilities>
  ): RegisteredAssistant | null {
    return this.update(id, { capabilities });
  }

  /**
   * Record a heartbeat for an assistant
   */
  heartbeat(id: string): RegisteredAssistant | null {
    const previous = this.store.get(id);
    const wasStale = previous?.heartbeat.isStale;

    const assistant = this.store.heartbeat(id);

    if (assistant && wasStale) {
      this.emit('assistant:recovered', id, assistant);
    }

    return assistant;
  }

  /**
   * Deregister an assistant
   */
  deregister(id: string): boolean {
    const assistant = this.store.get(id);
    const result = this.store.deregister(id);

    if (result && assistant) {
      this.emit('assistant:deregistered', id, undefined, assistant);
    }

    return result;
  }

  /**
   * Query assistants by criteria
   */
  query(query: AssistantQuery): AssistantQueryResult {
    return this.store.query(query);
  }

  /**
   * Find assistants by capability
   */
  findByCapability(capability: {
    tools?: string[];
    skills?: string[];
    tags?: string[];
  }): RegisteredAssistant[] {
    const result = this.store.query({
      requiredCapabilities: capability,
      includeOffline: false,
    });
    return result.assistants;
  }

  /**
   * Find available assistants (idle, low load)
   */
  findAvailable(options?: {
    type?: RegisteredAssistant['type'];
    maxLoadFactor?: number;
    limit?: number;
  }): RegisteredAssistant[] {
    const result = this.store.query({
      type: options?.type,
      state: 'idle',
      maxLoadFactor: options?.maxLoadFactor ?? 0.8,
      limit: options?.limit,
      sortBy: 'load',
      sortDir: 'asc',
      includeOffline: false,
    });
    return result.assistants;
  }

  /**
   * Find best assistant for a task
   * Considers capabilities, load, and preferences
   */
  findBestMatch(requirements: {
    required?: { tools?: string[]; skills?: string[]; tags?: string[] };
    preferred?: { tools?: string[]; skills?: string[]; tags?: string[] };
    excluded?: { tools?: string[]; skills?: string[]; tags?: string[] };
    maxLoadFactor?: number;
  }): RegisteredAssistant | null {
    const result = this.store.query({
      requiredCapabilities: requirements.required,
      preferredCapabilities: requirements.preferred,
      excludedCapabilities: requirements.excluded,
      maxLoadFactor: requirements.maxLoadFactor ?? 0.9,
      limit: 1,
      includeOffline: false,
    });

    return result.assistants[0] || null;
  }

  /**
   * Get children of an assistant
   */
  getChildren(parentId: string): RegisteredAssistant[] {
    const result = this.store.query({
      parentId,
      includeOffline: true,
    });
    return result.assistants;
  }

  /**
   * List all registered assistants
   */
  list(): RegisteredAssistant[] {
    return this.store.list();
  }

  /**
   * Get registry statistics
   */
  getStats(): RegistryStats {
    return this.store.getStats();
  }

  /**
   * Stop the registry service
   */
  stop(): void {
    this.store.stopCleanup();
    this.listeners.clear();
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Manually trigger cleanup of stale assistants
   * Useful on startup to clean up assistants from crashed sessions
   */
  cleanupStaleAssistants(): void {
    this.store.cleanupStaleAssistants();
  }
}

// Singleton instance
let globalRegistry: AssistantRegistryService | null = null;

/**
 * Get or create the global registry instance
 */
export function getGlobalRegistry(config?: Partial<RegistryConfig>): AssistantRegistryService {
  if (!globalRegistry) {
    globalRegistry = new AssistantRegistryService(config);
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetGlobalRegistry(): void {
  if (globalRegistry) {
    globalRegistry.stop();
    globalRegistry = null;
  }
}
