import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { MemoryStore } from '../src/memory/store';
import { SessionManager } from '../src/memory/sessions';
import type { Message } from '@hasna/assistants-shared';
import { generateId, now } from '@hasna/assistants-shared';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDatabase } from './fixtures/test-db';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    const db = createTestDatabase();
    store = new MemoryStore(db);
  });

  afterEach(() => {
    store.close();
  });

  describe('set and get', () => {
    test('should store and retrieve string value', () => {
      store.set('key1', 'value1');
      expect(store.get('key1')).toBe('value1');
    });

    test('should store and retrieve object value', () => {
      const obj = { name: 'test', count: 42, nested: { foo: 'bar' } };
      store.set('key2', obj);
      expect(store.get('key2')).toEqual(obj);
    });

    test('should store and retrieve array value', () => {
      const arr = [1, 2, 3, 'four', { five: 5 }];
      store.set('key3', arr);
      expect(store.get('key3')).toEqual(arr);
    });

    test('should return null for non-existent key', () => {
      expect(store.get('non-existent')).toBeNull();
    });

    test('should overwrite existing value', () => {
      store.set('key', 'first');
      store.set('key', 'second');
      expect(store.get('key')).toBe('second');
    });
  });

  describe('TTL (time-to-live)', () => {
    test('should respect TTL expiration', async () => {
      store.set('expiring', 'value', 50); // 50ms TTL
      expect(store.get('expiring')).toBe('value');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(store.get('expiring')).toBeNull();
    });

    test('should not expire key without TTL', async () => {
      store.set('permanent', 'value');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.get('permanent')).toBe('value');
    });
  });

  describe('delete', () => {
    test('should delete existing key', () => {
      store.set('to-delete', 'value');
      expect(store.get('to-delete')).toBe('value');

      store.delete('to-delete');
      expect(store.get('to-delete')).toBeNull();
    });

    test('should handle deleting non-existent key', () => {
      expect(() => store.delete('non-existent')).not.toThrow();
    });
  });

  describe('has', () => {
    test('should return true for existing key', () => {
      store.set('exists', 'value');
      expect(store.has('exists')).toBe(true);
    });

    test('should return false for non-existent key', () => {
      expect(store.has('non-existent')).toBe(false);
    });
  });

  describe('keys', () => {
    test('should return all keys', () => {
      store.set('key1', 'value1');
      store.set('key2', 'value2');
      store.set('key3', 'value3');

      const keys = store.keys();
      expect(keys.sort()).toEqual(['key1', 'key2', 'key3']);
    });

    test('should filter keys by pattern', () => {
      store.set('user:1', 'alice');
      store.set('user:2', 'bob');
      store.set('session:1', 'sess1');

      const userKeys = store.keys('user:*');
      expect(userKeys.sort()).toEqual(['user:1', 'user:2']);
    });

    test('should return empty array when no keys', () => {
      expect(store.keys()).toEqual([]);
    });
  });

  describe('clearExpired', () => {
    test('should remove expired entries', async () => {
      store.set('expiring1', 'value1', 30);
      store.set('expiring2', 'value2', 30);
      store.set('permanent', 'value3');

      await new Promise((resolve) => setTimeout(resolve, 40));

      const cleared = store.clearExpired();
      expect(cleared).toBe(2);
      expect(store.get('permanent')).toBe('value3');
    });
  });
});

describe('SessionManager', () => {
  let manager: SessionManager;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-test-'));
    manager = new SessionManager(join(tempDir, 'test.db'));
  });

  afterEach(async () => {
    manager.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    test('should create session with generated ID', () => {
      const session = manager.create();

      expect(session.id).toBeDefined();
      expect(session.id.length).toBeGreaterThan(0);
      expect(session.messages).toEqual([]);
    });

    test('should create session with metadata', () => {
      const metadata = { source: 'terminal', version: '1.0' };
      const session = manager.create(metadata);

      expect(session.metadata).toEqual(metadata);
    });

    test('should set timestamps', () => {
      const before = now();
      const session = manager.create();
      const after = now();

      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
      expect(session.updatedAt).toBeGreaterThanOrEqual(before);
      expect(session.updatedAt).toBeLessThanOrEqual(after);
    });
  });

  describe('get', () => {
    test('should retrieve created session', () => {
      const created = manager.create({ test: true });
      const retrieved = manager.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.metadata).toEqual({ test: true });
    });

    test('should return null for non-existent session', () => {
      expect(manager.get('non-existent')).toBeNull();
    });
  });

  describe('addMessage', () => {
    test('should add message to session', () => {
      const session = manager.create();
      const message: Message = {
        id: generateId(),
        role: 'user',
        content: 'Hello!',
        timestamp: now(),
      };

      manager.addMessage(session.id, message);

      const retrieved = manager.get(session.id);
      expect(retrieved?.messages).toHaveLength(1);
      expect(retrieved?.messages[0].content).toBe('Hello!');
      expect(retrieved?.messages[0].role).toBe('user');
    });

    test('should preserve message order', () => {
      const session = manager.create();

      const msg1: Message = { id: generateId(), role: 'user', content: 'First', timestamp: now() };
      const msg2: Message = { id: generateId(), role: 'assistant', content: 'Second', timestamp: now() + 1 };
      const msg3: Message = { id: generateId(), role: 'user', content: 'Third', timestamp: now() + 2 };

      manager.addMessage(session.id, msg1);
      manager.addMessage(session.id, msg2);
      manager.addMessage(session.id, msg3);

      const retrieved = manager.get(session.id);
      expect(retrieved?.messages).toHaveLength(3);
      expect(retrieved?.messages[0].content).toBe('First');
      expect(retrieved?.messages[1].content).toBe('Second');
      expect(retrieved?.messages[2].content).toBe('Third');
    });

    test('should store tool calls and results', () => {
      const session = manager.create();
      const message: Message = {
        id: generateId(),
        role: 'assistant',
        content: '',
        timestamp: now(),
        toolCalls: [{ id: 'tc1', name: 'bash', input: { command: 'ls' } }],
        toolResults: [{ toolCallId: 'tc1', content: 'file1.txt\nfile2.txt' }],
      };

      manager.addMessage(session.id, message);

      const retrieved = manager.get(session.id);
      expect(retrieved?.messages[0].toolCalls).toHaveLength(1);
      expect(retrieved?.messages[0].toolCalls?.[0].name).toBe('bash');
      expect(retrieved?.messages[0].toolResults).toHaveLength(1);
    });

    test('should update session updated_at', async () => {
      const session = manager.create();
      const originalUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      const message: Message = { id: generateId(), role: 'user', content: 'Test', timestamp: now() };
      manager.addMessage(session.id, message);

      const retrieved = manager.get(session.id);
      expect(retrieved?.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('list', () => {
    test('should list sessions ordered by updated_at desc', async () => {
      const s1 = manager.create({ name: 'first' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const s2 = manager.create({ name: 'second' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const s3 = manager.create({ name: 'third' });

      const sessions = manager.list();
      expect(sessions).toHaveLength(3);
      expect(sessions[0].id).toBe(s3.id); // Most recent
      expect(sessions[2].id).toBe(s1.id); // Oldest
    });

    test('should respect limit', () => {
      for (let i = 0; i < 5; i++) {
        manager.create();
      }

      const limited = manager.list(2);
      expect(limited).toHaveLength(2);
    });

    test('should return sessions without messages', () => {
      const session = manager.create();
      manager.addMessage(session.id, {
        id: generateId(),
        role: 'user',
        content: 'Test',
        timestamp: now(),
      });

      const sessions = manager.list();
      expect(sessions[0].messages).toEqual([]); // Messages not loaded in list
    });
  });

  describe('delete', () => {
    test('should delete session and its messages', () => {
      const session = manager.create();
      manager.addMessage(session.id, {
        id: generateId(),
        role: 'user',
        content: 'Test',
        timestamp: now(),
      });

      manager.delete(session.id);

      expect(manager.get(session.id)).toBeNull();
    });
  });

  describe('getLatest', () => {
    test('should return most recent session', async () => {
      manager.create({ name: 'old' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const latest = manager.create({ name: 'latest' });

      const retrieved = manager.getLatest();
      expect(retrieved?.id).toBe(latest.id);
    });

    test('should return null when no sessions', () => {
      expect(manager.getLatest()).toBeNull();
    });
  });
});
