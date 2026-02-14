/**
 * Capability Storage
 *
 * Provides persistence and loading for assistant capabilities.
 * Backed by SQLite capability_chains and capability_overrides tables.
 */

import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type { CapabilitiesConfigShared } from '@hasna/assistants-shared';
import type {
  AssistantCapabilitySet,
  CapabilityChain,
  CapabilityScope,
  OrchestrationLevel,
  ToolAccessPolicy,
} from './types';
import {
  DEFAULT_CAPABILITY_SET,
  ORCHESTRATION_DEFAULTS,
  RESTRICTED_CAPABILITY_SET,
  COORDINATOR_CAPABILITY_SET,
} from './types';

/**
 * Storage configuration
 */
export interface CapabilityStorageConfig {
  /** Whether storage is enabled */
  enabled: boolean;
  /** Storage directory path */
  storagePath?: string;
  /** Auto-save on changes */
  autoSave: boolean;
}

/**
 * Default storage configuration
 */
export const DEFAULT_STORAGE_CONFIG: CapabilityStorageConfig = {
  enabled: true,
  autoSave: true,
};

/**
 * Stored capability data format
 */
interface StoredCapabilities {
  version: number;
  savedAt: string;
  chains: Record<string, CapabilityChain>;
  overrides: Record<string, Partial<AssistantCapabilitySet>>;
}

interface ChainRow {
  entity_id: string;
  chain: string;
}

interface OverrideRow {
  entity_id: string;
  overrides: string;
}

/**
 * Capability Storage class
 */
export class CapabilityStorage {
  private config: CapabilityStorageConfig;
  private chains: Map<string, CapabilityChain> = new Map();
  private overrides: Map<string, Partial<AssistantCapabilitySet>> = new Map();
  private dirty = false;
  private db: DatabaseConnection;

  constructor(config?: Partial<CapabilityStorageConfig>, db?: DatabaseConnection) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.db = db || getDatabase();
    this.load();
  }

  /**
   * Load capabilities from storage
   */
  private load(): void {
    if (!this.config.enabled) return;

    try {
      const chainRows = this.db.query<ChainRow>('SELECT * FROM capability_chains').all();
      for (const row of chainRows) {
        this.chains.set(row.entity_id, JSON.parse(row.chain));
      }

      const overrideRows = this.db.query<OverrideRow>('SELECT * FROM capability_overrides').all();
      for (const row of overrideRows) {
        this.overrides.set(row.entity_id, JSON.parse(row.overrides));
      }
    } catch {
      // Failed to load, start fresh
    }
  }

  /**
   * Save capabilities to storage
   */
  save(): void {
    if (!this.config.enabled) return;

    try {
      this.db.transaction(() => {
        this.db.exec('DELETE FROM capability_chains');
        this.db.exec('DELETE FROM capability_overrides');

        const insertChain = this.db.prepare(
          'INSERT INTO capability_chains (entity_id, chain) VALUES (?, ?)'
        );
        for (const [entityId, chain] of this.chains) {
          insertChain.run(entityId, JSON.stringify(chain));
        }

        const insertOverride = this.db.prepare(
          'INSERT INTO capability_overrides (entity_id, overrides) VALUES (?, ?)'
        );
        for (const [entityId, override] of this.overrides) {
          insertOverride.run(entityId, JSON.stringify(override));
        }
      });

      this.dirty = false;
    } catch {
      // Failed to save, non-critical
    }
  }

  /**
   * Auto-save if enabled
   */
  private autoSave(): void {
    if (this.config.autoSave && this.dirty) {
      this.save();
    }
  }

  /**
   * Get capability chain for an entity
   */
  getChain(entityId: string): CapabilityChain | null {
    return this.chains.get(entityId) || null;
  }

  /**
   * Set capability chain for an entity
   */
  setChain(entityId: string, chain: CapabilityChain): void {
    this.chains.set(entityId, chain);
    this.dirty = true;
    this.autoSave();
  }

  /**
   * Get override for an entity
   */
  getOverride(entityId: string): Partial<AssistantCapabilitySet> | null {
    return this.overrides.get(entityId) || null;
  }

  /**
   * Set override for an entity
   */
  setOverride(entityId: string, override: Partial<AssistantCapabilitySet>): void {
    this.overrides.set(entityId, override);
    this.dirty = true;
    this.autoSave();
  }

  /**
   * Remove capability chain for an entity
   */
  removeChain(entityId: string): boolean {
    const result = this.chains.delete(entityId);
    if (result) {
      this.dirty = true;
      this.autoSave();
    }
    return result;
  }

  /**
   * Remove override for an entity
   */
  removeOverride(entityId: string): boolean {
    const result = this.overrides.delete(entityId);
    if (result) {
      this.dirty = true;
      this.autoSave();
    }
    return result;
  }

  /**
   * List all stored entity IDs
   */
  listEntities(): string[] {
    const entities = new Set<string>();
    for (const id of this.chains.keys()) {
      entities.add(id);
    }
    for (const id of this.overrides.keys()) {
      entities.add(id);
    }
    return Array.from(entities);
  }

  /**
   * Clear all stored capabilities
   */
  clear(): void {
    this.chains.clear();
    this.overrides.clear();
    this.dirty = true;
    this.autoSave();
  }
}

/**
 * Convert shared config to capability set partial
 */
export function configToCapabilities(config: CapabilitiesConfigShared): Partial<AssistantCapabilitySet> {
  const result: Partial<AssistantCapabilitySet> = {
    enabled: config.enabled ?? true,
  };

  // Orchestration from preset or individual settings
  if (config.orchestrationLevel) {
    result.orchestration = { ...ORCHESTRATION_DEFAULTS[config.orchestrationLevel] };
  } else if (config.maxConcurrentSubassistants !== undefined || config.maxSubassistantDepth !== undefined) {
    result.orchestration = {
      ...ORCHESTRATION_DEFAULTS.standard,
      maxConcurrentSubassistants: config.maxConcurrentSubassistants ?? ORCHESTRATION_DEFAULTS.standard.maxConcurrentSubassistants,
      maxSubassistantDepth: config.maxSubassistantDepth ?? ORCHESTRATION_DEFAULTS.standard.maxSubassistantDepth,
    };
  }

  // Tool access policy
  if (config.toolPolicy) {
    const policy: ToolAccessPolicy = config.toolPolicy;
    result.tools = {
      policy,
      capabilities: [],
    };

    if (config.allowedTools?.length && policy === 'allow_list') {
      result.tools.capabilities = config.allowedTools.map((pattern) => ({
        pattern,
        allowed: true,
      }));
    }

    if (config.deniedTools?.length && policy === 'deny_list') {
      result.tools.capabilities = config.deniedTools.map((pattern) => ({
        pattern,
        allowed: false,
      }));
    }
  }

  return result;
}

/**
 * Get default capabilities for a scope
 */
export function getDefaultCapabilities(scope: CapabilityScope): Partial<AssistantCapabilitySet> {
  switch (scope) {
    case 'system':
      return {}; // System defaults are the base
    case 'organization':
      return {}; // No org-level defaults yet
    case 'identity':
      return {}; // No identity-level defaults yet
    case 'assistant':
      return DEFAULT_CAPABILITY_SET;
    case 'session':
      return {}; // Sessions inherit from assistant
    case 'instance':
      return {}; // Instances inherit from session
    default:
      return {};
  }
}

/**
 * Get capability preset by name
 */
export function getCapabilityPreset(preset: 'default' | 'restricted' | 'coordinator'): Partial<AssistantCapabilitySet> {
  switch (preset) {
    case 'restricted':
      return RESTRICTED_CAPABILITY_SET;
    case 'coordinator':
      return COORDINATOR_CAPABILITY_SET;
    case 'default':
    default:
      return DEFAULT_CAPABILITY_SET;
  }
}

// Singleton storage instance
let globalStorage: CapabilityStorage | null = null;

/**
 * Get or create the global capability storage
 */
export function getGlobalCapabilityStorage(config?: Partial<CapabilityStorageConfig>): CapabilityStorage {
  if (!globalStorage) {
    globalStorage = new CapabilityStorage(config);
  }
  return globalStorage;
}

/**
 * Reset the global capability storage (for testing)
 */
export function resetGlobalCapabilityStorage(): void {
  if (globalStorage) {
    globalStorage.clear();
    globalStorage = null;
  }
}
