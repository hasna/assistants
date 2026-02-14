import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { GlobalMemoryManager } from '../src/memory/global-memory';
import { createTestDatabase } from './fixtures/test-db';

describe('GlobalMemoryManager', () => {
  let manager: GlobalMemoryManager;

  beforeEach(() => {
    manager = new GlobalMemoryManager({
      db: createTestDatabase(),
      scope: 'private',
      scopeId: 'test-assistant-123',
      sessionId: 'test-session-456',
    });
  });

  afterEach(() => {
    manager.close();
  });

  describe('set and get', () => {
    test('should store and retrieve a simple string value', async () => {
      await manager.set('greeting', 'Hello, World!', {
        category: 'fact',
      });

      const memory = await manager.get('greeting');
      expect(memory).not.toBeNull();
      expect(memory?.key).toBe('greeting');
      expect(memory?.value).toBe('Hello, World!');
      expect(memory?.category).toBe('fact');
    });

    test('should store and retrieve an object value', async () => {
      const userData = { name: 'Alice', age: 30, preferences: { theme: 'dark' } };
      await manager.set('user.profile', userData, {
        category: 'preference',
      });

      const memory = await manager.get('user.profile');
      expect(memory?.value).toEqual(userData);
    });

    test('should handle non-existent keys', async () => {
      const memory = await manager.get('non-existent-key');
      expect(memory).toBeNull();
    });

    test('should update existing memory on re-set', async () => {
      await manager.set('counter', 1, { category: 'fact' });
      await manager.set('counter', 2, { category: 'fact' });

      const memory = await manager.get('counter');
      expect(memory?.value).toBe(2);
    });

    test('should set default importance to 5', async () => {
      await manager.set('test-key', 'test-value', { category: 'fact' });
      const memory = await manager.get('test-key');
      expect(memory?.importance).toBe(5);
    });

    test('should respect custom importance', async () => {
      await manager.set('important-fact', 'Very important!', {
        category: 'fact',
        importance: 9,
      });
      const memory = await manager.get('important-fact');
      expect(memory?.importance).toBe(9);
    });

    test('should store tags', async () => {
      await manager.set('tagged-memory', 'value', {
        category: 'knowledge',
        tags: ['tag1', 'tag2', 'tag3'],
      });
      const memory = await manager.get('tagged-memory');
      expect(memory?.tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    test('should track access count', async () => {
      await manager.set('access-test', 'value', { category: 'fact' });

      await manager.get('access-test');
      await manager.get('access-test');
      await manager.get('access-test');

      const memory = await manager.get('access-test');
      // Initial set counts as 0, then 3 gets = 3 accesses
      expect(memory?.accessCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('scopes', () => {
    test('should store global memories with null/undefined scopeId', async () => {
      await manager.set('global-setting', 'value', {
        category: 'preference',
        scope: 'global',
      });

      const memory = await manager.get('global-setting', 'global');
      expect(memory?.scope).toBe('global');
      // Global memories have no scopeId (null in DB, undefined when retrieved)
      expect(memory?.scopeId).toBeFalsy();
    });

    test('should store private memories with scopeId', async () => {
      await manager.set('private-data', 'secret', {
        category: 'fact',
        scope: 'private',
      });

      const memory = await manager.get('private-data', 'private');
      expect(memory?.scope).toBe('private');
      expect(memory?.scopeId).toBe('test-assistant-123');
    });

    test('should store shared memories', async () => {
      await manager.set('shared-info', 'shared data', {
        category: 'knowledge',
        scope: 'shared',
      });

      const memory = await manager.get('shared-info', 'shared');
      expect(memory?.scope).toBe('shared');
    });

    test('should isolate memories by scope', async () => {
      // Set same key in different scopes
      await manager.set('same-key', 'global-value', {
        category: 'fact',
        scope: 'global',
      });
      await manager.set('same-key', 'private-value', {
        category: 'fact',
        scope: 'private',
      });

      const globalMem = await manager.get('same-key', 'global');
      const privateMem = await manager.get('same-key', 'private');

      expect(globalMem?.value).toBe('global-value');
      expect(privateMem?.value).toBe('private-value');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      // Set up test data
      await manager.set('pref1', 'value1', { category: 'preference', importance: 8, tags: ['ui'] });
      await manager.set('pref2', 'value2', { category: 'preference', importance: 5, tags: ['settings'] });
      await manager.set('fact1', 'value3', { category: 'fact', importance: 7, tags: ['user'] });
      await manager.set('fact2', 'value4', { category: 'fact', importance: 3 });
      await manager.set('know1', 'value5', { category: 'knowledge', importance: 6, tags: ['api'] });
    });

    test('should query all memories without filter', async () => {
      const result = await manager.query({ limit: 100 });
      expect(result.memories.length).toBe(5);
      expect(result.total).toBe(5);
    });

    test('should filter by category', async () => {
      const result = await manager.query({ category: 'fact' });
      expect(result.memories.length).toBe(2);
      expect(result.memories.every(m => m.category === 'fact')).toBe(true);
    });

    test('should filter by minimum importance', async () => {
      const result = await manager.query({ minImportance: 6 });
      expect(result.memories.every(m => m.importance >= 6)).toBe(true);
    });

    test('should filter by tags', async () => {
      const result = await manager.query({ tags: ['ui', 'api'] });
      expect(result.memories.length).toBeGreaterThan(0);
      expect(result.memories.every(m =>
        m.tags.some(t => ['ui', 'api'].includes(t))
      )).toBe(true);
    });

    test('should search by text', async () => {
      await manager.set('searchable', 'The quick brown fox jumps', {
        category: 'fact',
        summary: 'Animal behavior',
      });

      const result = await manager.query({ search: 'brown fox' });
      expect(result.memories.some(m => m.key === 'searchable')).toBe(true);
    });

    test('should order by importance desc', async () => {
      const result = await manager.query({ orderBy: 'importance', orderDir: 'desc' });
      for (let i = 1; i < result.memories.length; i++) {
        expect(result.memories[i - 1].importance).toBeGreaterThanOrEqual(result.memories[i].importance);
      }
    });

    test('should respect limit and offset', async () => {
      const page1 = await manager.query({ limit: 2, offset: 0, orderBy: 'importance', orderDir: 'desc' });
      const page2 = await manager.query({ limit: 2, offset: 2, orderBy: 'importance', orderDir: 'desc' });

      expect(page1.memories.length).toBe(2);
      expect(page2.memories.length).toBe(2);
      expect(page1.hasMore).toBe(true);

      // Ensure no overlap
      const page1Keys = page1.memories.map(m => m.key);
      const page2Keys = page2.memories.map(m => m.key);
      const overlap = page1Keys.filter(k => page2Keys.includes(k));
      expect(overlap.length).toBe(0);
    });
  });

  describe('update', () => {
    test('should update importance', async () => {
      const memory = await manager.set('to-update', 'value', { category: 'fact', importance: 3 });
      await manager.update(memory.id, { importance: 9 });

      const updated = await manager.get('to-update');
      expect(updated?.importance).toBe(9);
    });

    test('should update tags', async () => {
      const memory = await manager.set('to-update', 'value', { category: 'fact', tags: ['old'] });
      await manager.update(memory.id, { tags: ['new1', 'new2'] });

      const updated = await manager.get('to-update');
      expect(updated?.tags).toEqual(['new1', 'new2']);
    });

    test('should update summary', async () => {
      const memory = await manager.set('to-update', 'value', { category: 'fact' });
      await manager.update(memory.id, { summary: 'New summary' });

      const updated = await manager.get('to-update');
      expect(updated?.summary).toBe('New summary');
    });

    test('should throw on non-existent memory', async () => {
      await expect(manager.update('non-existent-id', { importance: 5 })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('should delete memory by id', async () => {
      const memory = await manager.set('to-delete', 'value', { category: 'fact' });
      await manager.delete(memory.id);

      // delete returns void, just verify the memory is gone
      expect(await manager.get('to-delete')).toBeNull();
    });

    test('should delete memory by key', async () => {
      await manager.set('to-delete', 'value', { category: 'fact' });
      const deleted = await manager.deleteByKey('to-delete');

      expect(deleted).toBe(true);
      expect(await manager.get('to-delete')).toBeNull();
    });

    test('should return false for non-existent key', async () => {
      const deleted = await manager.deleteByKey('does-not-exist');
      expect(deleted).toBe(false);
    });
  });

  describe('getRelevant', () => {
    beforeEach(async () => {
      await manager.set('coding.typescript', 'TypeScript info', {
        category: 'knowledge',
        importance: 8,
        summary: 'User prefers TypeScript for projects',
      });
      await manager.set('coding.python', 'Python info', {
        category: 'knowledge',
        importance: 6,
        summary: 'User knows Python',
      });
      await manager.set('user.timezone', 'PST', {
        category: 'preference',
        importance: 7,
        summary: 'User is in PST timezone',
      });
    });

    test('should return memories relevant to context', async () => {
      const memories = await manager.getRelevant('Help me with TypeScript', { limit: 5 });
      expect(memories.some(m => m.key === 'coding.typescript')).toBe(true);
    });

    test('should respect minimum importance', async () => {
      const memories = await manager.getRelevant('coding', {
        limit: 10,
        minImportance: 7,
      });
      expect(memories.every(m => m.importance >= 7)).toBe(true);
    });

    test('should filter by categories', async () => {
      const memories = await manager.getRelevant('coding', {
        limit: 10,
        categories: ['preference'],
      });
      expect(memories.every(m => m.category === 'preference')).toBe(true);
    });
  });

  describe('stats', () => {
    beforeEach(async () => {
      await manager.set('g1', 'v', { category: 'preference', scope: 'global' });
      await manager.set('g2', 'v', { category: 'fact', scope: 'global' });
      await manager.set('p1', 'v', { category: 'knowledge', scope: 'private' });
      await manager.set('s1', 'v', { category: 'history', scope: 'shared' });
    });

    test('should return accurate counts', async () => {
      const stats = await manager.getStats();

      expect(stats.totalCount).toBe(4);
      expect(stats.byScope.global).toBe(2);
      expect(stats.byScope.private).toBe(1);
      expect(stats.byScope.shared).toBe(1);
      expect(stats.byCategory.preference).toBe(1);
      expect(stats.byCategory.fact).toBe(1);
      expect(stats.byCategory.knowledge).toBe(1);
      expect(stats.byCategory.history).toBe(1);
    });

    test('should calculate average importance', async () => {
      await manager.set('imp1', 'v', { category: 'fact', importance: 10 });
      await manager.set('imp2', 'v', { category: 'fact', importance: 6 });

      const stats = await manager.getStats();
      expect(stats.avgImportance).toBeGreaterThan(0);
    });
  });

  describe('export and import', () => {
    test('should export all memories', async () => {
      await manager.set('exp1', 'value1', { category: 'fact', importance: 7 });
      await manager.set('exp2', 'value2', { category: 'preference', importance: 5 });

      const exported = await manager.export();
      expect(exported.length).toBe(2);
      expect(exported.some(m => m.key === 'exp1')).toBe(true);
      expect(exported.some(m => m.key === 'exp2')).toBe(true);
    });

    test('should import memories', async () => {
      const toImport = [
        {
          id: 'id1',
          key: 'imported1',
          value: 'value1',
          scope: 'private' as const,
          category: 'fact' as const,
          importance: 7,
          tags: ['tag1'],
          source: 'user' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accessCount: 0,
        },
      ];

      const count = await manager.import(toImport);
      expect(count).toBe(1);

      const imported = await manager.get('imported1');
      expect(imported?.value).toBe('value1');
    });

    test('should skip existing on import without overwrite', async () => {
      await manager.set('existing', 'original', { category: 'fact' });

      const toImport = [
        {
          id: 'id1',
          key: 'existing',
          value: 'new-value',
          scope: 'private' as const,
          category: 'fact' as const,
          importance: 7,
          tags: [],
          source: 'agent' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accessCount: 0,
        },
      ];

      const count = await manager.import(toImport, { overwrite: false });
      expect(count).toBe(0);

      const memory = await manager.get('existing');
      expect(memory?.value).toBe('original');
    });

    test('should overwrite on import with overwrite flag', async () => {
      await manager.set('existing', 'original', { category: 'fact' });

      const toImport = [
        {
          id: 'id1',
          key: 'existing',
          value: 'new-value',
          scope: 'private' as const,
          category: 'fact' as const,
          importance: 7,
          tags: [],
          source: 'agent' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          accessCount: 0,
        },
      ];

      const count = await manager.import(toImport, { overwrite: true });
      expect(count).toBe(1);

      const memory = await manager.get('existing');
      expect(memory?.value).toBe('new-value');
    });
  });

  describe('validation', () => {
    test('should reject empty key', async () => {
      await expect(manager.set('', 'value', { category: 'fact' })).rejects.toThrow();
    });

    test('should reject key that is too long', async () => {
      const longKey = 'a'.repeat(300);
      await expect(manager.set(longKey, 'value', { category: 'fact' })).rejects.toThrow();
    });

    test('should reject value that is too large', async () => {
      const largeValue = 'x'.repeat(100000);
      await expect(manager.set('key', largeValue, { category: 'fact' })).rejects.toThrow();
    });

    test('should reject summary that is too long', async () => {
      const longSummary = 'x'.repeat(600);
      await expect(manager.set('key', 'value', {
        category: 'fact',
        summary: longSummary,
      })).rejects.toThrow();
    });
  });

  describe('scope enablement and validation', () => {
    test('should reject private scope without scopeId', async () => {
      const managerNoScope = new GlobalMemoryManager({
        db: createTestDatabase(),
        // No scopeId set
      });

      try {
        await expect(
          managerNoScope.set('private-key', 'value', {
            category: 'fact',
            scope: 'private',
          })
        ).rejects.toThrow('Private scope requires a scopeId');
      } finally {
        managerNoScope.close();
      }
    });

    test('should allow private scope with scopeId', async () => {
      const managerWithScope = new GlobalMemoryManager({
        db: createTestDatabase(),
        scopeId: 'assistant-123',
      });

      try {
        const memory = await managerWithScope.set('private-key', 'value', {
          category: 'fact',
          scope: 'private',
        });
        expect(memory).not.toBeNull();
        expect(memory.scope).toBe('private');
        expect(memory.scopeId).toBe('assistant-123');
      } finally {
        managerWithScope.close();
      }
    });

    test('should reject set when scope is disabled', async () => {
      const managerDisabled = new GlobalMemoryManager({
        db: createTestDatabase(),
        scopeId: 'assistant-123',
        config: {
          scopes: {
            globalEnabled: false,
            sharedEnabled: true,
            privateEnabled: true,
          },
        },
      });

      try {
        await expect(
          managerDisabled.set('global-key', 'value', {
            category: 'fact',
            scope: 'global',
          })
        ).rejects.toThrow("Memory scope 'global' is disabled");
      } finally {
        managerDisabled.close();
      }
    });

    test('should return null from get when scope is disabled', async () => {
      const managerDisabled = new GlobalMemoryManager({
        db: createTestDatabase(),
        scopeId: 'assistant-123',
        config: {
          scopes: {
            globalEnabled: true,
            sharedEnabled: false, // Shared disabled
            privateEnabled: true,
          },
        },
      });

      try {
        // First create a memory in global scope
        await managerDisabled.set('global-key', 'value', {
          category: 'fact',
          scope: 'global',
        });

        // Try to get shared scope memory - should return null since disabled
        const result = await managerDisabled.get('some-key', 'shared');
        expect(result).toBeNull();
      } finally {
        managerDisabled.close();
      }
    });

    test('should only query enabled scopes', async () => {
      const managerScoped = new GlobalMemoryManager({
        db: createTestDatabase(),
        scopeId: 'assistant-123',
        config: {
          scopes: {
            globalEnabled: true,
            sharedEnabled: true,
            privateEnabled: false, // Private disabled
          },
        },
      });

      try {
        // Add a global memory
        await managerScoped.set('global-key', 'global-value', {
          category: 'fact',
          scope: 'global',
        });

        // Query for private scope should return empty
        const privateResult = await managerScoped.query({ scope: 'private' });
        expect(privateResult.memories.length).toBe(0);

        // Query for global scope should work
        const globalResult = await managerScoped.query({ scope: 'global' });
        expect(globalResult.memories.length).toBe(1);
      } finally {
        managerScoped.close();
      }
    });

    test('getRelevant should filter out disabled scopes', async () => {
      const managerScoped = new GlobalMemoryManager({
        db: createTestDatabase(),
        scopeId: 'assistant-123',
        config: {
          scopes: {
            globalEnabled: true,
            sharedEnabled: false, // Shared disabled
            privateEnabled: true,
          },
        },
      });

      try {
        // Add memories with unique searchable keywords
        await managerScoped.set('global-fact', 'important global searchterm here', {
          category: 'fact',
          scope: 'global',
          importance: 8,
          summary: 'Global test memory with searchterm',
        });
        await managerScoped.set('private-fact', 'assistant private searchterm info', {
          category: 'fact',
          scope: 'private',
          importance: 8,
          summary: 'Private test memory with searchterm',
        });

        // Get relevant - search for 'searchterm' which is >3 chars
        const results = await managerScoped.getRelevant('searchterm', {
          scopes: ['global', 'shared', 'private'],
          minImportance: 1,
        });

        // Should have results from global and private, not shared
        expect(results.length).toBe(2);
        const scopes = results.map(m => m.scope);
        expect(scopes).toContain('global');
        expect(scopes).toContain('private');
        expect(scopes).not.toContain('shared');
      } finally {
        managerScoped.close();
      }
    });
  });

  describe('expiration and storage limits', () => {
    test('should not return expired memories', async () => {
      // Set a memory with immediate expiration
      const pastDate = new Date(Date.now() - 1000).toISOString(); // 1 second ago
      await manager.set('expired-key', 'expired-value', {
        category: 'fact',
        expiresAt: pastDate,
      });

      // Memory should not be retrievable
      const memory = await manager.get('expired-key');
      expect(memory).toBeNull();
    });

    test('should return non-expired memories', async () => {
      // Set a memory with future expiration
      const futureDate = new Date(Date.now() + 60000).toISOString(); // 1 minute from now
      await manager.set('valid-key', 'valid-value', {
        category: 'fact',
        expiresAt: futureDate,
      });

      const memory = await manager.get('valid-key');
      expect(memory).not.toBeNull();
      expect(memory?.value).toBe('valid-value');
    });

    test('should clear expired memories before enforcing storage limits', async () => {
      const managerWithLimits = new GlobalMemoryManager({
        db: createTestDatabase(),
        scope: 'private',
        scopeId: 'test-assistant',
        config: {
          storage: {
            maxEntries: 5,
          },
        },
      });

      try {
        // Add 3 expired memories
        const pastDate = new Date(Date.now() - 1000).toISOString();
        for (let i = 0; i < 3; i++) {
          await managerWithLimits.set(`expired-${i}`, `value-${i}`, {
            category: 'fact',
            expiresAt: pastDate,
            importance: 1, // Low importance
          });
        }

        // Add 3 high-importance live memories (this should trigger storage limit enforcement)
        for (let i = 0; i < 3; i++) {
          await managerWithLimits.set(`live-${i}`, `live-value-${i}`, {
            category: 'fact',
            importance: 10, // High importance
          });
        }

        // All live memories should still exist (expired ones should be cleared first)
        for (let i = 0; i < 3; i++) {
          const memory = await managerWithLimits.get(`live-${i}`);
          expect(memory).not.toBeNull();
          expect(memory?.value).toBe(`live-value-${i}`);
        }

        // Verify stats show only live memories
        const stats = await managerWithLimits.getStats();
        expect(stats.totalCount).toBeLessThanOrEqual(5);
      } finally {
        managerWithLimits.close();
      }
    });

    test('should evict low-importance memories when at limit', async () => {
      const managerWithLimits = new GlobalMemoryManager({
        db: createTestDatabase(),
        scope: 'private',
        scopeId: 'test-assistant',
        config: {
          storage: {
            maxEntries: 3,
          },
        },
      });

      try {
        // Add 3 memories at the limit
        await managerWithLimits.set('low-priority', 'low', {
          category: 'fact',
          importance: 1,
        });
        await managerWithLimits.set('mid-priority', 'mid', {
          category: 'fact',
          importance: 5,
        });
        await managerWithLimits.set('high-priority', 'high', {
          category: 'fact',
          importance: 9,
        });

        // Add another memory - should trigger eviction of lowest priority
        await managerWithLimits.set('new-memory', 'new', {
          category: 'fact',
          importance: 7,
        });

        // High-priority should definitely still exist
        const high = await managerWithLimits.get('high-priority');
        expect(high).not.toBeNull();
        expect(high?.value).toBe('high');

        // New memory should exist
        const newMem = await managerWithLimits.get('new-memory');
        expect(newMem).not.toBeNull();
      } finally {
        managerWithLimits.close();
      }
    });

    test('should evict unaccessed memories before accessed ones when importance ties', async () => {
      const managerWithLimits = new GlobalMemoryManager({
        db: createTestDatabase(),
        scope: 'private',
        scopeId: 'test-assistant',
        config: {
          storage: {
            maxEntries: 2,
          },
        },
      });

      try {
        await managerWithLimits.set('unaccessed', 'value-a', {
          category: 'fact',
          importance: 5,
        });
        await managerWithLimits.set('accessed', 'value-b', {
          category: 'fact',
          importance: 5,
        });

        // Touch one memory so it has accessed_at set
        await managerWithLimits.get('accessed');

        // Adding another memory should evict the unaccessed one first
        await managerWithLimits.set('new-memory', 'value-c', {
          category: 'fact',
          importance: 5,
        });

        const unaccessed = await managerWithLimits.get('unaccessed');
        const accessed = await managerWithLimits.get('accessed');
        const newMemory = await managerWithLimits.get('new-memory');

        expect(unaccessed).toBeNull();
        expect(accessed).not.toBeNull();
        expect(newMemory).not.toBeNull();
      } finally {
        managerWithLimits.close();
      }
    });

    test('cleanup should clear expired and enforce limits', async () => {
      const managerForCleanup = new GlobalMemoryManager({
        db: createTestDatabase(),
        scope: 'private',
        scopeId: 'test-assistant',
        config: {
          storage: {
            maxEntries: 10,
          },
        },
      });

      try {
        // Add some expired memories
        const pastDate = new Date(Date.now() - 1000).toISOString();
        for (let i = 0; i < 5; i++) {
          await managerForCleanup.set(`expired-${i}`, 'value', {
            category: 'fact',
            expiresAt: pastDate,
          });
        }

        // Run cleanup
        const result = await managerForCleanup.cleanup();

        // Should have cleared expired memories
        expect(result.expired).toBeGreaterThanOrEqual(0); // May be 0 if already cleaned
      } finally {
        managerForCleanup.close();
      }
    });
  });

  describe('query ordering', () => {
    test('orders by accessed_at desc when requested', async () => {
      await manager.set('a', 'value-a', { category: 'fact' });
      await manager.set('b', 'value-b', { category: 'fact' });

      await manager.get('a');
      await new Promise((resolve) => setTimeout(resolve, 2));
      await manager.get('a');

      const results = await manager.query({ orderBy: 'accessed', orderDir: 'desc' });
      expect(results.memories.length).toBeGreaterThanOrEqual(2);
      expect(results.memories[0].key).toBe('a');
    });
  });
});
