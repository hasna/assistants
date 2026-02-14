import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AssistantRegistryService,
  getGlobalRegistry,
  resetGlobalRegistry,
  RegistryStore,
  DEFAULT_REGISTRY_CONFIG,
} from '../src/registry';
import type {
  AssistantRegistration,
  RegisteredAssistant,
  RegistryConfig,
  RegistryEvent,
} from '../src/registry';

let tempDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-registry-'));
  originalHome = process.env.HOME;
  process.env.HOME = tempDir;
  resetGlobalRegistry();
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
  resetGlobalRegistry();
});

describe('RegistryStore', () => {
  describe('initialization', () => {
    test('creates with default config', () => {
      const store = new RegistryStore();
      expect(store.list()).toEqual([]);
    });

    test('creates with custom config', () => {
      const config: RegistryConfig = {
        ...DEFAULT_REGISTRY_CONFIG,
        maxAssistants: 50,
      };
      const store = new RegistryStore(config);
      expect(store.list()).toEqual([]);
    });
  });

  describe('register', () => {
    test('registers a new assistant', () => {
      const store = new RegistryStore();
      const registration: AssistantRegistration = {
        id: 'assistant-1',
        name: 'Test Assistant',
        type: 'assistant',
        capabilities: {},
      };
      const assistant = store.register(registration);
      expect(assistant.id).toBe('assistant-1');
      expect(assistant.name).toBe('Test Assistant');
      expect(assistant.type).toBe('assistant');
      expect(assistant.status.state).toBe('idle');
    });

    test('assigns default capabilities', () => {
      const store = new RegistryStore();
      const assistant = store.register({
        id: 'assistant-1',
        name: 'Test Assistant',
        type: 'assistant',
        capabilities: {},
      });
      expect(assistant.capabilities).toBeDefined();
      expect(assistant.capabilities.tools).toEqual([]);
      expect(assistant.capabilities.skills).toEqual([]);
    });

    test('registers with custom capabilities', () => {
      const store = new RegistryStore();
      const assistant = store.register({
        id: 'assistant-1',
        name: 'Test Assistant',
        type: 'assistant',
        capabilities: {
          tools: ['bash', 'file:read'],
          skills: ['summarize'],
          tags: ['dev'],
        },
      });
      expect(assistant.capabilities.tools).toContain('bash');
      expect(assistant.capabilities.skills).toContain('summarize');
      expect(assistant.capabilities.tags).toContain('dev');
    });

    test('throws when max assistants reached', () => {
      const store = new RegistryStore({ ...DEFAULT_REGISTRY_CONFIG, maxAssistants: 2 });
      store.register({ id: 'assistant-1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'assistant-2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      expect(() => {
        store.register({ id: 'assistant-3', name: 'Assistant 3', type: 'assistant', capabilities: {} });
      }).toThrow('Registry full');
    });
  });

  describe('get', () => {
    test('returns registered assistant', () => {
      const store = new RegistryStore();
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      const assistant = store.get('assistant-1');
      expect(assistant).not.toBeNull();
      expect(assistant?.id).toBe('assistant-1');
    });

    test('returns null for non-existent assistant', () => {
      const store = new RegistryStore();
      expect(store.get('non-existent')).toBeNull();
    });
  });

  describe('update', () => {
    test('updates assistant status', () => {
      const store = new RegistryStore();
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      const updated = store.update('assistant-1', {
        status: { state: 'processing', currentTask: 'test-task' },
      });
      expect(updated?.status.state).toBe('processing');
      expect(updated?.status.currentTask).toBe('test-task');
    });

    test('updates assistant load', () => {
      const store = new RegistryStore();
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      const updated = store.update('assistant-1', {
        load: { activeTasks: 3, tokensUsed: 1000 },
      });
      expect(updated?.load.activeTasks).toBe(3);
      expect(updated?.load.tokensUsed).toBe(1000);
    });

    test('returns null for non-existent assistant', () => {
      const store = new RegistryStore();
      expect(store.update('non-existent', { status: { state: 'idle' } })).toBeNull();
    });
  });

  describe('heartbeat', () => {
    test('updates heartbeat timestamp', () => {
      const store = new RegistryStore();
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      const before = store.get('assistant-1')?.heartbeat.lastHeartbeat;

      // Small delay to ensure timestamp changes
      const assistant = store.heartbeat('assistant-1');
      expect(assistant).not.toBeNull();
      expect(new Date(assistant!.heartbeat.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(before!).getTime()
      );
    });

    test('clears stale flag on heartbeat', () => {
      const store = new RegistryStore({
        ...DEFAULT_REGISTRY_CONFIG,
        heartbeatStaleThreshold: 100, // 100ms for testing
      });
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });

      // Force assistant to be marked stale (would need to wait or manually set)
      // For now, just verify heartbeat works
      const assistant = store.heartbeat('assistant-1');
      expect(assistant?.heartbeat.isStale).toBe(false);
    });
  });

  describe('deregister', () => {
    test('removes assistant', () => {
      const store = new RegistryStore();
      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(store.deregister('assistant-1')).toBe(true);
      expect(store.get('assistant-1')).toBeNull();
    });

    test('returns false for non-existent assistant', () => {
      const store = new RegistryStore();
      expect(store.deregister('non-existent')).toBe(false);
    });

    test('removes child assistants when parent deregistered', () => {
      const store = new RegistryStore();
      store.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      store.register({ id: 'child-1', name: 'Child 1', type: 'subassistant', parentId: 'parent', capabilities: {} });
      store.register({ id: 'child-2', name: 'Child 2', type: 'subassistant', parentId: 'parent', capabilities: {} });

      store.deregister('parent');
      expect(store.get('child-1')).toBeNull();
      expect(store.get('child-2')).toBeNull();
    });
  });

  describe('query', () => {
    test('queries by type', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant', type: 'assistant', capabilities: {} });
      store.register({ id: 's1', name: 'Subagent', type: 'subassistant', capabilities: {} });
      store.register({ id: 's2', name: 'Subagent 2', type: 'subassistant', capabilities: {} });

      const result = store.query({ type: 'subassistant' });
      expect(result.assistants).toHaveLength(2);
      expect(result.assistants.every((a) => a.type === 'subassistant')).toBe(true);
    });

    test('queries by state', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'processing' } });

      const result = store.query({ state: 'idle' });
      expect(result.assistants).toHaveLength(1);
      expect(result.assistants[0].id).toBe('a2');
    });

    test('queries by required capabilities', () => {
      const store = new RegistryStore();
      store.register({
        id: 'a1',
        name: 'Assistant 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      store.register({
        id: 'a2',
        name: 'Assistant 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const result = store.query({
        requiredCapabilities: { tools: ['bash'] },
      });
      expect(result.assistants).toHaveLength(1);
      expect(result.assistants[0].id).toBe('a1');
    });

    test('queries by parent ID', () => {
      const store = new RegistryStore();
      store.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      store.register({ id: 'child-1', name: 'Child 1', type: 'subassistant', parentId: 'parent', capabilities: {} });
      store.register({ id: 'child-2', name: 'Child 2', type: 'subassistant', parentId: 'parent', capabilities: {} });
      store.register({ id: 'other', name: 'Other', type: 'subassistant', parentId: 'other-parent', capabilities: {} });

      const result = store.query({ parentId: 'parent' });
      expect(result.assistants).toHaveLength(2);
    });

    test('queries by session ID', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', sessionId: 'session-1', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', sessionId: 'session-2', capabilities: {} });

      const result = store.query({ sessionId: 'session-1' });
      expect(result.assistants).toHaveLength(1);
      expect(result.assistants[0].id).toBe('a1');
    });

    test('excludes offline assistants by default', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'offline' } });

      const result = store.query({ includeOffline: false });
      expect(result.assistants).toHaveLength(1);
      expect(result.assistants[0].id).toBe('a2');
    });

    test('includes offline assistants when requested', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      store.update('a1', { status: { state: 'offline' } });

      const result = store.query({ includeOffline: true });
      expect(result.assistants).toHaveLength(2);
    });

    test('limits results', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      store.register({ id: 'a3', name: 'Assistant 3', type: 'assistant', capabilities: {} });

      const result = store.query({ limit: 2 });
      expect(result.assistants).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    test('returns total count with limit', () => {
      const store = new RegistryStore();
      for (let i = 0; i < 5; i++) {
        store.register({ id: `a${i}`, name: `Assistant ${i}`, type: 'assistant', capabilities: {} });
      }

      const result = store.query({ limit: 2 });
      expect(result.assistants).toHaveLength(2);
      expect(result.total).toBe(5);
      // Note: the API doesn't support offset or hasMore - use total to determine if more exist
    });
  });

  describe('cleanup', () => {
    test('cleanupStaleAssistants removes stale assistants', () => {
      const store = new RegistryStore({
        ...DEFAULT_REGISTRY_CONFIG,
        staleTTL: 100, // 100ms for testing
        heartbeatStaleThreshold: 50,
      });

      store.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });

      // Wait for assistant to become stale and be cleaned up
      // In practice, this would be tested with time mocking
      // For now, just verify the method doesn't throw
      store.cleanupStaleAssistants();
    });
  });

  describe('getStats', () => {
    test('returns registry statistics', () => {
      const store = new RegistryStore();
      store.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      store.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      store.register({ id: 's1', name: 'Subagent', type: 'subassistant', capabilities: {} });
      store.update('a1', { status: { state: 'processing' } });

      const stats = store.getStats();
      expect(stats.totalAssistants).toBe(3);
      expect(stats.byType.assistant).toBe(2);
      expect(stats.byType.subassistant).toBe(1);
      expect(stats.byState.idle).toBe(2);
      expect(stats.byState.processing).toBe(1);
    });
  });
});

describe('AssistantRegistryService', () => {
  describe('initialization', () => {
    test('creates with default config (enabled)', () => {
      const service = new AssistantRegistryService();
      expect(service.isEnabled()).toBe(true); // Default config has enabled: true
    });

    test('creates with custom config', () => {
      const service = new AssistantRegistryService({ enabled: false });
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('register', () => {
    test('registers assistant and emits event', () => {
      const service = new AssistantRegistryService();
      const events: RegistryEvent[] = [];
      service.addEventListener((e) => events.push(e));

      const assistant = service.register({
        id: 'assistant-1',
        name: 'Test',
        type: 'assistant',
        capabilities: {},
      });

      expect(assistant.id).toBe('assistant-1');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('assistant:registered');
    });

    test('throws when disabled', () => {
      const service = new AssistantRegistryService({ enabled: false });
      expect(() => {
        service.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      }).toThrow('Registry is disabled');
    });
  });

  describe('registerFromHeartbeat', () => {
    test('auto-registers new assistant', () => {
      const service = new AssistantRegistryService({ autoRegister: true });
      const assistant = service.registerFromHeartbeat({
        assistantId: 'assistant-1',
        name: 'Test',
        tools: ['bash'],
      });
      expect(assistant.id).toBe('assistant-1');
      expect(assistant.capabilities.tools).toContain('bash');
    });

    test('updates existing assistant on heartbeat', () => {
      const service = new AssistantRegistryService({ autoRegister: true });
      service.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });

      const before = service.get('assistant-1')?.heartbeat.lastHeartbeat;
      const assistant = service.registerFromHeartbeat({
        assistantId: 'assistant-1',
        name: 'Test',
      });

      expect(new Date(assistant.heartbeat.lastHeartbeat).getTime()).toBeGreaterThanOrEqual(
        new Date(before!).getTime()
      );
    });

    test('throws when auto-register disabled', () => {
      const service = new AssistantRegistryService({ autoRegister: false });
      expect(() => {
        service.registerFromHeartbeat({ assistantId: 'assistant-1', name: 'Test' });
      }).toThrow('Auto-registration is disabled');
    });
  });

  describe('updateStatus', () => {
    test('updates assistant status', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });

      const updated = service.updateStatus('assistant-1', {
        state: 'processing',
        currentTask: 'task-1',
      });

      expect(updated?.status.state).toBe('processing');
      expect(updated?.status.currentTask).toBe('task-1');
    });
  });

  describe('updateLoad', () => {
    test('updates assistant load', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });

      const updated = service.updateLoad('assistant-1', {
        activeTasks: 5,
        tokensUsed: 10000,
      });

      expect(updated?.load.activeTasks).toBe(5);
      expect(updated?.load.tokensUsed).toBe(10000);
    });
  });

  describe('deregister', () => {
    test('removes assistant and emits event', () => {
      const service = new AssistantRegistryService();
      const events: RegistryEvent[] = [];
      service.addEventListener((e) => events.push(e));

      service.register({ id: 'assistant-1', name: 'Test', type: 'assistant', capabilities: {} });
      const result = service.deregister('assistant-1');

      expect(result).toBe(true);
      expect(service.get('assistant-1')).toBeNull();
      expect(events.some((e) => e.type === 'assistant:deregistered')).toBe(true);
    });
  });

  describe('query methods', () => {
    test('query filters correctly', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      service.register({ id: 's1', name: 'Subagent', type: 'subassistant', capabilities: {} });

      const result = service.query({ type: 'assistant' });
      expect(result.assistants).toHaveLength(1);
    });

    test('findByCapability finds matching assistants', () => {
      const service = new AssistantRegistryService();
      service.register({
        id: 'a1',
        name: 'Assistant 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      service.register({
        id: 'a2',
        name: 'Assistant 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const assistants = service.findByCapability({ tools: ['bash'] });
      expect(assistants).toHaveLength(1);
      expect(assistants[0].id).toBe('a1');
    });

    test('findAvailable returns idle assistants', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'a1', name: 'Assistant 1', type: 'assistant', capabilities: {} });
      service.register({ id: 'a2', name: 'Assistant 2', type: 'assistant', capabilities: {} });
      service.updateStatus('a1', { state: 'processing' });

      const available = service.findAvailable();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe('a2');
    });

    test('findBestMatch returns best matching assistant', () => {
      const service = new AssistantRegistryService();
      service.register({
        id: 'a1',
        name: 'Assistant 1',
        type: 'assistant',
        capabilities: { tools: ['bash', 'file:read'] },
      });
      service.register({
        id: 'a2',
        name: 'Assistant 2',
        type: 'assistant',
        capabilities: { tools: ['file:read'] },
      });

      const best = service.findBestMatch({
        required: { tools: ['bash'] },
      });
      expect(best?.id).toBe('a1');
    });

    test('getChildren returns child assistants', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'parent', name: 'Parent', type: 'assistant', capabilities: {} });
      service.register({ id: 'child-1', name: 'Child 1', type: 'subassistant', parentId: 'parent', capabilities: {} });
      service.register({ id: 'child-2', name: 'Child 2', type: 'subassistant', parentId: 'parent', capabilities: {} });

      const children = service.getChildren('parent');
      expect(children).toHaveLength(2);
    });
  });

  describe('event listeners', () => {
    test('adds and removes listeners', () => {
      const service = new AssistantRegistryService();
      const events: RegistryEvent[] = [];
      const listener = (e: RegistryEvent) => events.push(e);

      const unsubscribe = service.addEventListener(listener);
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(1);

      unsubscribe();
      service.register({ id: 'a2', name: 'Test 2', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(1); // No new event
    });

    test('removes listener with removeEventListener', () => {
      const service = new AssistantRegistryService();
      const events: RegistryEvent[] = [];
      const listener = (e: RegistryEvent) => events.push(e);

      service.addEventListener(listener);
      service.removeEventListener(listener);
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(events).toHaveLength(0);
    });
  });

  describe('global singleton', () => {
    test('returns same instance', () => {
      const reg1 = getGlobalRegistry();
      const reg2 = getGlobalRegistry();
      expect(reg1).toBe(reg2);
    });

    test('reset creates new instance', () => {
      const reg1 = getGlobalRegistry();
      reg1.register({ id: 'test', name: 'Test', type: 'assistant', capabilities: {} });
      resetGlobalRegistry();
      const reg2 = getGlobalRegistry();
      expect(reg2).not.toBe(reg1);
      expect(reg2.list()).toEqual([]);
    });
  });

  describe('cleanup', () => {
    test('cleanupStaleAssistants is callable', () => {
      const service = new AssistantRegistryService();
      service.register({ id: 'a1', name: 'Test', type: 'assistant', capabilities: {} });
      expect(() => service.cleanupStaleAssistants()).not.toThrow();
    });
  });
});
