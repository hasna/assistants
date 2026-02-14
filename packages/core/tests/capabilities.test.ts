import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CapabilitiesConfigShared } from '@hasna/assistants-shared';
import {
  resolveCapabilityChain,
  createCapabilityChain,
  extendCapabilityChain,
  CapabilityEnforcer,
  getGlobalCapabilityEnforcer,
  resetGlobalCapabilityEnforcer,
  CapabilityStorage,
  getGlobalCapabilityStorage,
  resetGlobalCapabilityStorage,
  configToCapabilities,
  getDefaultCapabilities,
  getCapabilityPreset,
  DEFAULT_CAPABILITY_SET,
  ORCHESTRATION_DEFAULTS,
  RESTRICTED_CAPABILITY_SET,
  COORDINATOR_CAPABILITY_SET,
} from '../src/capabilities';
import type {
  CapabilityChain,
  AssistantCapabilitySet,
  CapabilityScope,
  OrchestrationLevel,
} from '../src/capabilities';

let tempDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-capabilities-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  resetGlobalCapabilityEnforcer();
  resetGlobalCapabilityStorage();
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
  resetGlobalCapabilityEnforcer();
  resetGlobalCapabilityStorage();
});

describe('Capability Types', () => {
  describe('DEFAULT_CAPABILITY_SET', () => {
    test('has standard orchestration level', () => {
      expect(DEFAULT_CAPABILITY_SET.orchestration.level).toBe('standard');
      expect(DEFAULT_CAPABILITY_SET.orchestration.canSpawnSubassistants).toBe(true);
      expect(DEFAULT_CAPABILITY_SET.orchestration.maxConcurrentSubassistants).toBe(5);
      expect(DEFAULT_CAPABILITY_SET.orchestration.maxSubassistantDepth).toBe(3);
    });

    test('allows all tools by default', () => {
      expect(DEFAULT_CAPABILITY_SET.tools.policy).toBe('allow_all');
      expect(DEFAULT_CAPABILITY_SET.tools.capabilities).toEqual([]);
    });

    test('allows all skills by default', () => {
      expect(DEFAULT_CAPABILITY_SET.skills.policy).toBe('allow_all');
    });

    test('allows all models by default', () => {
      expect(DEFAULT_CAPABILITY_SET.models.allowed).toEqual([{ pattern: '*', allowed: true }]);
    });

    test('has no approval required by default', () => {
      expect(DEFAULT_CAPABILITY_SET.approval.defaultLevel).toBe('none');
    });

    test('allows communication', () => {
      expect(DEFAULT_CAPABILITY_SET.communication.canSendMessages).toBe(true);
      expect(DEFAULT_CAPABILITY_SET.communication.canReceiveMessages).toBe(true);
      expect(DEFAULT_CAPABILITY_SET.communication.canBroadcast).toBe(false);
    });

    test('allows memory access', () => {
      expect(DEFAULT_CAPABILITY_SET.memory.canAccessGlobalMemory).toBe(true);
      expect(DEFAULT_CAPABILITY_SET.memory.canWriteMemory).toBe(true);
      expect(DEFAULT_CAPABILITY_SET.memory.allowedMemoryScopes).toEqual(['*']);
    });
  });

  describe('ORCHESTRATION_DEFAULTS', () => {
    test('none level cannot spawn subassistants', () => {
      expect(ORCHESTRATION_DEFAULTS.none.canSpawnSubassistants).toBe(false);
      expect(ORCHESTRATION_DEFAULTS.none.maxConcurrentSubassistants).toBe(0);
      expect(ORCHESTRATION_DEFAULTS.none.maxSubassistantDepth).toBe(0);
      expect(ORCHESTRATION_DEFAULTS.none.canCoordinateSwarms).toBe(false);
    });

    test('limited level has restricted spawning', () => {
      expect(ORCHESTRATION_DEFAULTS.limited.canSpawnSubassistants).toBe(true);
      expect(ORCHESTRATION_DEFAULTS.limited.maxConcurrentSubassistants).toBe(2);
      expect(ORCHESTRATION_DEFAULTS.limited.maxSubassistantDepth).toBe(1);
      expect(ORCHESTRATION_DEFAULTS.limited.canCoordinateSwarms).toBe(false);
    });

    test('standard level allows normal spawning', () => {
      expect(ORCHESTRATION_DEFAULTS.standard.canSpawnSubassistants).toBe(true);
      expect(ORCHESTRATION_DEFAULTS.standard.maxConcurrentSubassistants).toBe(5);
      expect(ORCHESTRATION_DEFAULTS.standard.maxSubassistantDepth).toBe(3);
      expect(ORCHESTRATION_DEFAULTS.standard.canDelegate).toBe(true);
    });

    test('full level enables swarm coordination', () => {
      expect(ORCHESTRATION_DEFAULTS.full.canSpawnSubassistants).toBe(true);
      expect(ORCHESTRATION_DEFAULTS.full.canCoordinateSwarms).toBe(true);
      expect(ORCHESTRATION_DEFAULTS.full.maxSwarmSize).toBe(10);
    });

    test('coordinator level has maximum capabilities', () => {
      expect(ORCHESTRATION_DEFAULTS.coordinator.maxConcurrentSubassistants).toBe(20);
      expect(ORCHESTRATION_DEFAULTS.coordinator.maxSubassistantDepth).toBe(10);
      expect(ORCHESTRATION_DEFAULTS.coordinator.maxSwarmSize).toBe(50);
    });
  });

  describe('RESTRICTED_CAPABILITY_SET', () => {
    test('has no orchestration capabilities', () => {
      expect(RESTRICTED_CAPABILITY_SET.orchestration?.level).toBe('none');
      expect(RESTRICTED_CAPABILITY_SET.orchestration?.canSpawnSubassistants).toBe(false);
    });

    test('has allow_list tool policy', () => {
      expect(RESTRICTED_CAPABILITY_SET.tools?.policy).toBe('allow_list');
      expect(RESTRICTED_CAPABILITY_SET.tools?.capabilities.length).toBeGreaterThan(0);
    });

    test('requires approval by default', () => {
      expect(RESTRICTED_CAPABILITY_SET.approval?.defaultLevel).toBe('require');
    });

    test('restricts communication', () => {
      expect(RESTRICTED_CAPABILITY_SET.communication?.canSendMessages).toBe(false);
    });

    test('restricts memory access', () => {
      expect(RESTRICTED_CAPABILITY_SET.memory?.canAccessGlobalMemory).toBe(false);
      expect(RESTRICTED_CAPABILITY_SET.memory?.canWriteMemory).toBe(false);
    });
  });

  describe('COORDINATOR_CAPABILITY_SET', () => {
    test('has coordinator orchestration level', () => {
      expect(COORDINATOR_CAPABILITY_SET.orchestration?.level).toBe('coordinator');
    });

    test('has generous budget limits', () => {
      expect(COORDINATOR_CAPABILITY_SET.budget?.limits.maxTotalTokens).toBe(2000000);
    });

    test('can override budget', () => {
      expect(COORDINATOR_CAPABILITY_SET.budget?.canOverrideBudget).toBe(true);
    });

    test('can broadcast messages', () => {
      expect(COORDINATOR_CAPABILITY_SET.communication?.canBroadcast).toBe(true);
    });
  });
});

describe('Capability Resolver', () => {
  describe('resolveCapabilityChain', () => {
    test('returns defaults for empty chain', () => {
      const resolved = resolveCapabilityChain({});
      expect(resolved.orchestration.level).toBe('standard');
      expect(resolved.tools.policy).toBe('allow_all');
      expect(resolved.resolvedAt).toBeDefined();
    });

    test('applies single scope override', () => {
      const chain: CapabilityChain = {
        assistant: {
          orchestration: { ...ORCHESTRATION_DEFAULTS.limited },
        },
      };
      const resolved = resolveCapabilityChain(chain);
      expect(resolved.orchestration.level).toBe('limited');
      expect(resolved.orchestration.maxConcurrentSubassistants).toBe(2);
    });

    test('higher precedence scope takes effect (system over assistant)', () => {
      const chain: CapabilityChain = {
        assistant: {
          orchestration: { ...ORCHESTRATION_DEFAULTS.full },
        },
        system: {
          orchestration: { ...ORCHESTRATION_DEFAULTS.limited },
        },
      };
      const resolved = resolveCapabilityChain(chain);
      // System has highest precedence (applied last, overrides all)
      expect(resolved.orchestration.level).toBe('limited');
    });

    test('merges tool capabilities by pattern', () => {
      const chain: CapabilityChain = {
        assistant: {
          tools: {
            policy: 'deny_list',
            capabilities: [
              { pattern: 'bash:*', allowed: false },
            ],
          },
        },
        session: {
          tools: {
            policy: 'deny_list',
            capabilities: [
              { pattern: 'bash:execute', allowed: true },
            ],
          },
        },
      };
      const resolved = resolveCapabilityChain(chain);
      // Session override for specific pattern should win
      const bashExec = resolved.tools.capabilities.find((c) => c.pattern === 'bash:execute');
      const bashWildcard = resolved.tools.capabilities.find((c) => c.pattern === 'bash:*');
      expect(bashExec?.allowed).toBe(true);
      expect(bashWildcard?.allowed).toBe(false);
    });

    test('tracks sources', () => {
      const chain: CapabilityChain = {
        assistant: {
          orchestration: { ...ORCHESTRATION_DEFAULTS.limited },
        },
      };
      const resolved = resolveCapabilityChain(chain);
      expect(resolved.sources.orchestration).toBe('assistant');
    });

    test('restrictive merge for orchestration limits', () => {
      const chain: CapabilityChain = {
        organization: {
          orchestration: {
            level: 'full',
            canSpawnSubassistants: true,
            maxConcurrentSubassistants: 10,
            maxSubassistantDepth: 5,
            canCoordinateSwarms: true,
            maxSwarmSize: 10,
            canDelegate: true,
          },
        },
        assistant: {
          orchestration: {
            level: 'standard',
            canSpawnSubassistants: true,
            maxConcurrentSubassistants: 3,
            maxSubassistantDepth: 2,
            canCoordinateSwarms: false,
            maxSwarmSize: 0,
            canDelegate: true,
          },
        },
      };
      const resolved = resolveCapabilityChain(chain);
      // Should take the minimum values
      expect(resolved.orchestration.maxConcurrentSubassistants).toBeLessThanOrEqual(3);
      expect(resolved.orchestration.maxSubassistantDepth).toBeLessThanOrEqual(2);
    });

    test('disabled at any level results in disabled', () => {
      const chain: CapabilityChain = {
        organization: {
          enabled: false,
        },
      };
      const resolved = resolveCapabilityChain(chain);
      expect(resolved.enabled).toBe(false);
    });
  });

  describe('createCapabilityChain', () => {
    test('creates chain with single scope', () => {
      const chain = createCapabilityChain('session', {
        orchestration: { ...ORCHESTRATION_DEFAULTS.limited },
      });
      expect(chain.session).toBeDefined();
      expect(chain.session?.orchestration?.level).toBe('limited');
    });
  });

  describe('extendCapabilityChain', () => {
    test('extends existing chain', () => {
      const baseChain = createCapabilityChain('assistant', {
        tools: { policy: 'allow_all', capabilities: [] },
      });
      const extended = extendCapabilityChain(baseChain, 'session', {
        tools: { policy: 'deny_list', capabilities: [] },
      });
      expect(extended.assistant).toBeDefined();
      expect(extended.session).toBeDefined();
      expect(extended.session?.tools?.policy).toBe('deny_list');
    });
  });
});

describe('Capability Enforcer', () => {
  describe('initialization', () => {
    test('creates with default config', () => {
      const enforcer = new CapabilityEnforcer();
      expect(enforcer.isEnabled()).toBe(false);
    });

    test('creates with custom config', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'limited',
      };
      const enforcer = new CapabilityEnforcer(config);
      expect(enforcer.isEnabled()).toBe(true);
    });

    test('can enable and disable enforcement', () => {
      const enforcer = new CapabilityEnforcer();
      expect(enforcer.isEnabled()).toBe(false);
      enforcer.setEnabled(true);
      expect(enforcer.isEnabled()).toBe(true);
    });
  });

  describe('canSpawnSubassistant', () => {
    test('allows when enforcement disabled', () => {
      const enforcer = new CapabilityEnforcer();
      const result = enforcer.canSpawnSubassistant({ depth: 0 });
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('disabled');
    });

    test('denies when orchestration level is none', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'none',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canSpawnSubassistant({ depth: 0 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    test('denies when max depth reached', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'limited',
        maxSubassistantDepth: 1,
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canSpawnSubassistant({ depth: 1 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });

    test('allows within limits', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'standard',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canSpawnSubassistant({ depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('denies when concurrent subassistant limit reached', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'limited',
        maxConcurrentSubassistants: 2,
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canSpawnSubassistant({ depth: 0, activeSubassistants: 2 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('concurrent');
    });

    test('warns when approaching limits', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'limited',
        maxConcurrentSubassistants: 2,
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canSpawnSubassistant({ depth: 0, activeSubassistants: 1 });
      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('canUseTool', () => {
    test('allows when enforcement disabled', () => {
      const enforcer = new CapabilityEnforcer();
      const result = enforcer.canUseTool('bash', { depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('allows all tools with allow_all policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'allow_all',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('bash', { depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('denies unlisted tools with allow_list policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'allow_list',
        allowedTools: ['file:read', 'file:write'],
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('bash', { depth: 0 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the allowed list');
    });

    test('allows listed tools with allow_list policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'allow_list',
        allowedTools: ['file:read', 'file:write'],
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('file:read', { depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('denies listed tools with deny_list policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'deny_list',
        deniedTools: ['bash'],
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('bash', { depth: 0 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('deny list');
    });

    test('allows unlisted tools with deny_list policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'deny_list',
        deniedTools: ['bash'],
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('file:read', { depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('requires approval for all tools with require_approval policy', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        toolPolicy: 'require_approval' as any,
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canUseTool('file:read', { depth: 0 });
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe('canDelegate', () => {
    test('allows when enforcement disabled', () => {
      const enforcer = new CapabilityEnforcer();
      const result = enforcer.canDelegate('assistant-1', { depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('denies when delegation is disabled', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'none',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canDelegate('assistant-1', { depth: 0 });
      expect(result.allowed).toBe(false);
    });

    test('allows when delegation is enabled', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'standard',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canDelegate('assistant-1', { depth: 0 });
      expect(result.allowed).toBe(true);
    });
  });

  describe('canCoordinateSwarm', () => {
    test('allows when enforcement disabled', () => {
      const enforcer = new CapabilityEnforcer();
      const result = enforcer.canCoordinateSwarm({ depth: 0 });
      expect(result.allowed).toBe(true);
    });

    test('denies when swarm coordination is disabled', () => {
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'standard', // standard doesn't allow swarms
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canCoordinateSwarm({ depth: 0 });
      expect(result.allowed).toBe(false);
    });

    test('restrictive merge prevents swarm coordination from config alone', () => {
      // Even with orchestrationLevel: 'full', swarm coordination is denied
      // because the default base (standard) doesn't allow it, and the merge
      // logic uses AND (most restrictive wins)
      const config: CapabilitiesConfigShared = {
        enabled: true,
        orchestrationLevel: 'full',
      };
      const enforcer = new CapabilityEnforcer(config);
      const result = enforcer.canCoordinateSwarm({ depth: 0 });
      // Cannot grant more permissions than the base allows
      expect(result.allowed).toBe(false);
    });
  });

  describe('global singleton', () => {
    test('returns same instance', () => {
      const enforcer1 = getGlobalCapabilityEnforcer();
      const enforcer2 = getGlobalCapabilityEnforcer();
      expect(enforcer1).toBe(enforcer2);
    });

    test('updates config on subsequent calls', () => {
      const enforcer1 = getGlobalCapabilityEnforcer();
      expect(enforcer1.isEnabled()).toBe(false);

      getGlobalCapabilityEnforcer({ enabled: true });
      expect(enforcer1.isEnabled()).toBe(true);
    });

    test('reset creates new instance', () => {
      const enforcer1 = getGlobalCapabilityEnforcer({ enabled: true });
      resetGlobalCapabilityEnforcer();
      const enforcer2 = getGlobalCapabilityEnforcer();
      expect(enforcer2).not.toBe(enforcer1);
      expect(enforcer2.isEnabled()).toBe(false);
    });
  });
});

describe('Capability Storage', () => {
  describe('configToCapabilities', () => {
    test('converts orchestration level', () => {
      const config: CapabilitiesConfigShared = {
        orchestrationLevel: 'limited',
      };
      const caps = configToCapabilities(config);
      expect(caps.orchestration?.level).toBe('limited');
      expect(caps.orchestration?.maxConcurrentSubassistants).toBe(2);
    });

    test('converts tool policy', () => {
      const config: CapabilitiesConfigShared = {
        toolPolicy: 'allow_list',
        allowedTools: ['bash', 'file:*'],
      };
      const caps = configToCapabilities(config);
      expect(caps.tools?.policy).toBe('allow_list');
      expect(caps.tools?.capabilities.length).toBe(2);
    });

    test('converts deny list', () => {
      const config: CapabilitiesConfigShared = {
        toolPolicy: 'deny_list',
        deniedTools: ['bash'],
      };
      const caps = configToCapabilities(config);
      expect(caps.tools?.policy).toBe('deny_list');
      expect(caps.tools?.capabilities[0].allowed).toBe(false);
    });

    test('converts max limits', () => {
      const config: CapabilitiesConfigShared = {
        maxConcurrentSubassistants: 10,
        maxSubassistantDepth: 5,
      };
      const caps = configToCapabilities(config);
      expect(caps.orchestration?.maxConcurrentSubassistants).toBe(10);
      expect(caps.orchestration?.maxSubassistantDepth).toBe(5);
    });
  });

  describe('getDefaultCapabilities', () => {
    test('returns empty for system scope', () => {
      const caps = getDefaultCapabilities('system');
      expect(Object.keys(caps).length).toBe(0);
    });

    test('returns default set for assistant scope', () => {
      const caps = getDefaultCapabilities('assistant');
      expect(caps.orchestration).toBeDefined();
    });

    test('returns empty for session scope', () => {
      const caps = getDefaultCapabilities('session');
      expect(Object.keys(caps).length).toBe(0);
    });
  });

  describe('getCapabilityPreset', () => {
    test('returns default preset', () => {
      const preset = getCapabilityPreset('default');
      expect(preset.orchestration?.level).toBe('standard');
    });

    test('returns restricted preset', () => {
      const preset = getCapabilityPreset('restricted');
      expect(preset.orchestration?.level).toBe('none');
    });

    test('returns coordinator preset', () => {
      const preset = getCapabilityPreset('coordinator');
      expect(preset.orchestration?.level).toBe('coordinator');
    });
  });

  describe('CapabilityStorage', () => {
    test('creates with default config', () => {
      const storage = new CapabilityStorage({ enabled: false });
      expect(storage.listEntities()).toEqual([]);
    });

    test('stores and retrieves chain', () => {
      const storage = new CapabilityStorage({ enabled: false });
      const chain: CapabilityChain = {
        assistant: { orchestration: { ...ORCHESTRATION_DEFAULTS.limited } },
      };
      storage.setChain('test-entity', chain);
      const retrieved = storage.getChain('test-entity');
      expect(retrieved?.assistant?.orchestration?.level).toBe('limited');
    });

    test('stores and retrieves override', () => {
      const storage = new CapabilityStorage({ enabled: false });
      storage.setOverride('test-entity', { orchestration: { ...ORCHESTRATION_DEFAULTS.none } });
      const override = storage.getOverride('test-entity');
      expect(override?.orchestration?.level).toBe('none');
    });

    test('removes chain', () => {
      const storage = new CapabilityStorage({ enabled: false });
      storage.setChain('test-entity', {});
      expect(storage.removeChain('test-entity')).toBe(true);
      expect(storage.getChain('test-entity')).toBeNull();
    });

    test('removes override', () => {
      const storage = new CapabilityStorage({ enabled: false });
      storage.setOverride('test-entity', {});
      expect(storage.removeOverride('test-entity')).toBe(true);
      expect(storage.getOverride('test-entity')).toBeNull();
    });

    test('lists all entities', () => {
      const storage = new CapabilityStorage({ enabled: false });
      storage.setChain('entity-1', {});
      storage.setOverride('entity-2', {});
      const entities = storage.listEntities();
      expect(entities).toContain('entity-1');
      expect(entities).toContain('entity-2');
    });

    test('clears all data', () => {
      const storage = new CapabilityStorage({ enabled: false });
      storage.setChain('entity-1', {});
      storage.setOverride('entity-2', {});
      storage.clear();
      expect(storage.listEntities()).toEqual([]);
    });
  });

  describe('global storage singleton', () => {
    test('returns same instance', () => {
      const storage1 = getGlobalCapabilityStorage({ enabled: false });
      const storage2 = getGlobalCapabilityStorage();
      expect(storage1).toBe(storage2);
    });

    test('reset creates new instance', () => {
      const storage1 = getGlobalCapabilityStorage({ enabled: false });
      storage1.setChain('test', {});
      resetGlobalCapabilityStorage();
      const storage2 = getGlobalCapabilityStorage({ enabled: false });
      expect(storage2).not.toBe(storage1);
      expect(storage2.listEntities()).toEqual([]);
    });
  });
});
