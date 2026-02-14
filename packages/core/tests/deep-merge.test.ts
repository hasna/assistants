import { describe, expect, test } from 'bun:test';
import { deepMerge } from '../src/utils/deep-merge';

describe('deepMerge', () => {
  // --- Basic behavior ---

  test('should return base when override is undefined', () => {
    const base = { a: 1, b: 'hello' };
    const result = deepMerge(base, undefined);
    expect(result).toEqual({ a: 1, b: 'hello' });
  });

  test('should return base when override is empty object', () => {
    const base = { a: 1, b: 2 };
    const result = deepMerge(base, {});
    expect(result).toEqual({ a: 1, b: 2 });
  });

  test('should not mutate the base object', () => {
    const base = { a: 1, nested: { x: 10 } };
    const override = { a: 2, nested: { x: 20 } };
    deepMerge(base, override);
    expect(base.a).toBe(1);
    expect(base.nested.x).toBe(10);
  });

  // --- Primitive handling ---

  test('should override primitive values', () => {
    const base = { a: 1, b: 'hello', c: true };
    const override = { a: 42, b: 'world', c: false };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: 42, b: 'world', c: false });
  });

  test('should keep base value when override value is undefined', () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined } as Partial<typeof base>;
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  // --- Null handling ---

  test('should set value to null when override value is null', () => {
    const base = { a: 1, b: { nested: true } } as Record<string, unknown>;
    const override = { a: null, b: null };
    const result = deepMerge(base, override);
    expect(result.a).toBeNull();
    expect(result.b).toBeNull();
  });

  test('should distinguish between null and undefined in override', () => {
    const base = { a: 'keep', b: 'replace', c: 'nullify' } as Record<string, unknown>;
    const override = { a: undefined, b: 'new', c: null } as Record<string, unknown>;
    const result = deepMerge(base, override);
    expect(result.a).toBe('keep');
    expect(result.b).toBe('new');
    expect(result.c).toBeNull();
  });

  // --- Nested object merging ---

  test('should recursively merge nested objects', () => {
    const base = {
      level1: {
        a: 1,
        level2: {
          b: 2,
          c: 3,
        },
      },
    };
    const override = {
      level1: {
        level2: {
          c: 30,
        },
      },
    };
    const result = deepMerge(base, override as typeof base);
    expect(result).toEqual({
      level1: {
        a: 1,
        level2: {
          b: 2,
          c: 30,
        },
      },
    });
  });

  test('should add new keys from override at any depth', () => {
    const base = { a: { x: 1 } } as Record<string, unknown>;
    const override = { a: { y: 2 }, b: { z: 3 } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: { x: 1, y: 2 }, b: { z: 3 } });
  });

  test('should handle override introducing a nested object where base has none', () => {
    const base = { a: 1 } as Record<string, unknown>;
    const override = { b: { nested: true } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: 1, b: { nested: true } });
  });

  // --- Array replacement ---

  test('should replace arrays entirely instead of merging elements', () => {
    const base = { items: [1, 2, 3], tags: ['a', 'b'] };
    const override = { items: [4, 5] };
    const result = deepMerge(base, override as typeof base);
    expect(result.items).toEqual([4, 5]);
    expect(result.tags).toEqual(['a', 'b']);
  });

  test('should replace with empty array when override provides empty array', () => {
    const base = { items: [1, 2, 3] };
    const override = { items: [] as number[] };
    const result = deepMerge(base, override);
    expect(result.items).toEqual([]);
  });

  test('should replace arrays even when nested inside objects', () => {
    const base = {
      config: {
        tools: ['read', 'write', 'bash'],
        settings: { verbose: true },
      },
    };
    const override = {
      config: {
        tools: ['grep'],
      },
    };
    const result = deepMerge(base, override as typeof base);
    expect(result.config.tools).toEqual(['grep']);
    expect(result.config.settings).toEqual({ verbose: true });
  });

  // --- Empty objects ---

  test('should merge with empty base object', () => {
    const base = {} as Record<string, unknown>;
    const override = { a: 1, b: { c: 2 } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: 1, b: { c: 2 } });
  });

  // --- Type mismatches ---

  test('should override when types differ (object in base, primitive in override)', () => {
    const base = { a: { nested: true } } as Record<string, unknown>;
    const override = { a: 42 } as Record<string, unknown>;
    const result = deepMerge(base, override);
    expect(result.a).toBe(42);
  });

  test('should override when types differ (primitive in base, object in override)', () => {
    const base = { a: 42 } as Record<string, unknown>;
    const override = { a: { nested: true } };
    const result = deepMerge(base, override);
    expect(result.a).toEqual({ nested: true });
  });

  test('should override when types differ (array in base, object in override)', () => {
    const base = { a: [1, 2, 3] } as Record<string, unknown>;
    const override = { a: { key: 'value' } };
    const result = deepMerge(base, override);
    expect(result.a).toEqual({ key: 'value' });
  });

  // --- Config-like structures ---

  test('should correctly merge a config-like structure with nested sections', () => {
    const base = {
      llm: { provider: 'anthropic', model: 'claude-3', maxTokens: 8192 },
      voice: {
        enabled: false,
        stt: { provider: 'whisper', model: 'whisper-1', language: 'en' },
        tts: { provider: 'elevenlabs', voiceId: '', model: 'eleven_v3' },
      },
      scheduler: { enabled: true, heartbeatIntervalMs: 30000 },
    };

    const override = {
      llm: { model: 'gpt-4' },
      voice: { enabled: true, tts: { voiceId: 'voice-123' } },
    };

    const result = deepMerge(base, override as typeof base);

    // llm: model overridden, rest preserved
    expect(result.llm.provider).toBe('anthropic');
    expect(result.llm.model).toBe('gpt-4');
    expect(result.llm.maxTokens).toBe(8192);

    // voice: enabled overridden, nested stt preserved, tts voiceId overridden
    expect(result.voice.enabled).toBe(true);
    expect(result.voice.stt.provider).toBe('whisper');
    expect(result.voice.stt.model).toBe('whisper-1');
    expect(result.voice.tts.voiceId).toBe('voice-123');
    expect(result.voice.tts.provider).toBe('elevenlabs');
    expect(result.voice.tts.model).toBe('eleven_v3');

    // scheduler: untouched
    expect(result.scheduler.enabled).toBe(true);
    expect(result.scheduler.heartbeatIntervalMs).toBe(30000);
  });

  test('should handle subassistants config with array replacement for tools', () => {
    const base = {
      subassistants: {
        maxDepth: 3,
        maxConcurrent: 5,
        defaultTools: ['read', 'write', 'bash', 'grep'],
        forbiddenTools: ['wallet_get', 'secrets_get'],
      },
    };

    const override = {
      subassistants: {
        maxDepth: 5,
        defaultTools: ['read'],
      },
    };

    const result = deepMerge(base, override as typeof base);

    expect(result.subassistants.maxDepth).toBe(5);
    expect(result.subassistants.maxConcurrent).toBe(5);
    // Arrays replaced entirely
    expect(result.subassistants.defaultTools).toEqual(['read']);
    expect(result.subassistants.forbiddenTools).toEqual(['wallet_get', 'secrets_get']);
  });

  test('should handle deeply nested config merging (3+ levels)', () => {
    const base = {
      context: {
        enabled: true,
        injection: {
          enabled: true,
          maxTokens: 200,
          injections: {
            datetime: { enabled: true, format: 'ISO' },
            cwd: { enabled: true, truncate: 100 },
            os: { enabled: false },
          },
        },
      },
    };

    const override = {
      context: {
        injection: {
          maxTokens: 500,
          injections: {
            os: { enabled: true },
            custom: { enabled: true, text: 'hello' },
          },
        },
      },
    };

    const result = deepMerge(base, override as typeof base);

    expect(result.context.enabled).toBe(true);
    expect(result.context.injection.enabled).toBe(true);
    expect(result.context.injection.maxTokens).toBe(500);
    expect(result.context.injection.injections.datetime).toEqual({ enabled: true, format: 'ISO' });
    expect(result.context.injection.injections.cwd).toEqual({ enabled: true, truncate: 100 });
    expect(result.context.injection.injections.os).toEqual({ enabled: true });
    expect((result.context.injection.injections as Record<string, unknown>).custom).toEqual({ enabled: true, text: 'hello' });
  });

  test('should handle Date objects as non-plain objects (override, not merge)', () => {
    const base = { created: new Date('2024-01-01') } as Record<string, unknown>;
    const override = { created: new Date('2025-06-15') } as Record<string, unknown>;
    const result = deepMerge(base, override);
    expect(result.created).toEqual(new Date('2025-06-15'));
  });
});
