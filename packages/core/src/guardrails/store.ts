import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import type { GuardrailsConfig, GuardrailsPolicy, PolicyOverride } from './types';
import { DEFAULT_GUARDRAILS_CONFIG, DEFAULT_SYSTEM_POLICY } from './defaults';
import { getConfigDir } from '../config';

/**
 * Guardrails storage location
 */
export type GuardrailsLocation = 'user' | 'project' | 'local';

/**
 * Information about a policy including its source
 */
export interface PolicyInfo {
  id: string;
  name: string;
  scope: string;
  enabled: boolean;
  location: GuardrailsLocation;
  filePath: string;
  policy: GuardrailsPolicy;
}

/**
 * Generate a unique ID for a policy
 */
function generatePolicyId(name: string, scope: string): string {
  const hash = createHash('sha256')
    .update(`${name}-${scope}-${Date.now()}`)
    .digest('hex')
    .slice(0, 8);
  return `policy-${scope}-${hash}`;
}

/**
 * Ensure all policies have IDs
 */
function ensurePolicyIds(config: GuardrailsConfig): void {
  for (const policy of config.policies) {
    if (!policy.id) {
      policy.id = generatePolicyId(policy.name || 'unnamed', policy.scope);
    }
  }
}

/**
 * Guardrails store - manages guardrails persistence across locations
 */
export class GuardrailsStore {
  private cwd: string;
  private baseDir?: string;

  constructor(cwd: string = process.cwd(), baseDir?: string) {
    this.cwd = cwd;
    this.baseDir = baseDir;
  }

  /**
   * Get file path for a guardrails location
   */
  private getFilePath(location: GuardrailsLocation): string {
    switch (location) {
      case 'user':
        return join(this.baseDir || getConfigDir(), 'guardrails.json');
      case 'project':
        return join(this.cwd, '.assistants', 'guardrails.json');
      case 'local':
        return join(this.cwd, '.assistants', 'guardrails.local.json');
    }
  }

  /**
   * Load guardrails from a specific location
   */
  private loadFrom(location: GuardrailsLocation): GuardrailsConfig | null {
    const filePath = this.getFilePath(location);
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      const config = data.guardrails || data;
      ensurePolicyIds(config);
      return config;
    } catch {
      return null;
    }
  }

  /**
   * Save guardrails to a specific location
   */
  save(location: GuardrailsLocation, config: GuardrailsConfig): void {
    const filePath = this.getFilePath(location);
    const dir = dirname(filePath);

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    ensurePolicyIds(config);
    writeFileSync(filePath, JSON.stringify({ guardrails: config }, null, 2), 'utf-8');
  }

  /**
   * Load guardrails from all sources (user, project, local)
   * Merges all sources with later sources and higher precedence scopes winning
   */
  loadAll(): GuardrailsConfig {
    const userConfig = this.loadFrom('user');
    const projectConfig = this.loadFrom('project');
    const localConfig = this.loadFrom('local');

    // Start with defaults
    const merged: GuardrailsConfig = {
      enabled: DEFAULT_GUARDRAILS_CONFIG.enabled,
      policies: [DEFAULT_SYSTEM_POLICY],
      overrides: [],
      defaultAction: DEFAULT_GUARDRAILS_CONFIG.defaultAction,
      logEvaluations: false,
      persist: false,
    };

    // Apply configs in order (user < project < local)
    for (const config of [userConfig, projectConfig, localConfig]) {
      if (!config) continue;

      // Override enabled state
      if (config.enabled !== undefined) {
        merged.enabled = config.enabled;
      }

      // Override default action
      if (config.defaultAction) {
        merged.defaultAction = config.defaultAction;
      }

      // Merge policies (adding to the list)
      if (config.policies) {
        for (const policy of config.policies) {
          // Skip system policy duplicates
          if (policy.id === 'system-default') continue;

          // Check if policy already exists by ID
          const existingIdx = merged.policies.findIndex((p) => p.id === policy.id);
          if (existingIdx >= 0) {
            // Replace existing
            merged.policies[existingIdx] = policy;
          } else {
            merged.policies.push(policy);
          }
        }
      }

      // Merge overrides
      if (config.overrides) {
        merged.overrides = [...(merged.overrides || []), ...config.overrides];
      }

      // Override log settings
      if (config.logEvaluations !== undefined) {
        merged.logEvaluations = config.logEvaluations;
      }

      if (config.persist !== undefined) {
        merged.persist = config.persist;
      }
    }

    return merged;
  }

  /**
   * Add a policy to a specific location
   */
  addPolicy(
    policy: GuardrailsPolicy,
    location: GuardrailsLocation = 'project'
  ): string {
    let config = this.loadFrom(location);
    if (!config) {
      config = {
        enabled: true,
        policies: [],
        defaultAction: 'allow',
      };
    }

    if (!policy.id) {
      policy.id = generatePolicyId(policy.name || 'unnamed', policy.scope);
    }

    config.policies.push(policy);
    this.save(location, config);

    return policy.id;
  }

  /**
   * Remove a policy by ID from all locations
   */
  removePolicy(policyId: string): boolean {
    let removed = false;

    for (const location of ['user', 'project', 'local'] as GuardrailsLocation[]) {
      const config = this.loadFrom(location);
      if (!config) continue;

      const idx = config.policies.findIndex((p) => p.id === policyId);
      if (idx !== -1) {
        config.policies.splice(idx, 1);
        this.save(location, config);
        removed = true;
      }
    }

    return removed;
  }

  /**
   * Enable or disable a policy by ID
   */
  setPolicyEnabled(policyId: string, enabled: boolean): boolean {
    for (const location of ['user', 'project', 'local'] as GuardrailsLocation[]) {
      const config = this.loadFrom(location);
      if (!config) continue;

      const policy = config.policies.find((p) => p.id === policyId);
      if (policy) {
        policy.enabled = enabled;
        this.save(location, config);
        return true;
      }
    }

    return false;
  }

  /**
   * Get a policy by ID
   */
  getPolicy(policyId: string): PolicyInfo | null {
    for (const location of ['local', 'project', 'user'] as GuardrailsLocation[]) {
      const filePath = this.getFilePath(location);
      const config = this.loadFrom(location);
      if (!config) continue;

      const policy = config.policies.find((p) => p.id === policyId);
      if (policy) {
        return {
          id: policy.id!,
          name: policy.name || 'Unnamed',
          scope: policy.scope,
          enabled: policy.enabled,
          location,
          filePath,
          policy,
        };
      }
    }

    return null;
  }

  /**
   * List all policies with metadata
   */
  listPolicies(): PolicyInfo[] {
    const policies: PolicyInfo[] = [];
    const seenIds = new Set<string>();

    // Process in priority order (local > project > user)
    for (const location of ['local', 'project', 'user'] as GuardrailsLocation[]) {
      const filePath = this.getFilePath(location);
      const config = this.loadFrom(location);
      if (!config) continue;

      for (const policy of config.policies) {
        const id = policy.id || generatePolicyId(policy.name || 'unnamed', policy.scope);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          policies.push({
            id,
            name: policy.name || 'Unnamed',
            scope: policy.scope,
            enabled: policy.enabled,
            location,
            filePath,
            policy,
          });
        }
      }
    }

    // Add system default if not overridden
    if (!seenIds.has('system-default')) {
      policies.unshift({
        id: 'system-default',
        name: 'System Default Policy',
        scope: 'system',
        enabled: true,
        location: 'user',
        filePath: '',
        policy: DEFAULT_SYSTEM_POLICY,
      });
    }

    return policies;
  }

  /**
   * Add an override
   */
  addOverride(
    override: PolicyOverride,
    location: GuardrailsLocation = 'project'
  ): string {
    let config = this.loadFrom(location);
    if (!config) {
      config = {
        enabled: true,
        policies: [],
        overrides: [],
        defaultAction: 'allow',
      };
    }

    if (!config.overrides) {
      config.overrides = [];
    }

    config.overrides.push(override);
    this.save(location, config);

    return override.id;
  }

  /**
   * Remove an override by ID
   */
  removeOverride(overrideId: string): boolean {
    let removed = false;

    for (const location of ['user', 'project', 'local'] as GuardrailsLocation[]) {
      const config = this.loadFrom(location);
      if (!config || !config.overrides) continue;

      const idx = config.overrides.findIndex((o) => o.id === overrideId);
      if (idx !== -1) {
        config.overrides.splice(idx, 1);
        this.save(location, config);
        removed = true;
      }
    }

    return removed;
  }

  /**
   * Set guardrails enabled state in a specific location
   */
  setEnabled(enabled: boolean, location: GuardrailsLocation = 'project'): void {
    let config = this.loadFrom(location);
    if (!config) {
      config = {
        enabled,
        policies: [],
        defaultAction: 'allow',
      };
    } else {
      config.enabled = enabled;
    }
    this.save(location, config);
  }

  /**
   * Get enabled state from all locations (local overrides project overrides user)
   */
  isEnabled(): boolean {
    // Check in priority order
    for (const location of ['local', 'project', 'user'] as GuardrailsLocation[]) {
      const config = this.loadFrom(location);
      if (config?.enabled !== undefined) {
        return config.enabled;
      }
    }
    return DEFAULT_GUARDRAILS_CONFIG.enabled;
  }

  /**
   * Update working directory
   */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }
}
