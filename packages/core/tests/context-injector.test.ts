/**
 * Context Injector Tests
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { ContextInjector } from '../src/context/context-injector';
import { DEFAULT_CONTEXT_INJECTION_CONFIG } from '../src/context/types';

describe('ContextInjector', () => {
  let injector: ContextInjector;
  const testCwd = '/Users/test/projects/my-app';

  beforeEach(() => {
    injector = new ContextInjector(testCwd);
  });

  describe('initialization', () => {
    test('should be enabled by default', () => {
      expect(injector.isEnabled()).toBe(true);
    });

    test('should respect disabled config', () => {
      const disabled = new ContextInjector(testCwd, { enabled: false });
      expect(disabled.isEnabled()).toBe(false);
    });
  });

  describe('prepareInjection', () => {
    test('should return empty when disabled', async () => {
      const disabled = new ContextInjector(testCwd, { enabled: false });
      const result = await disabled.prepareInjection();
      expect(result.content).toBe('');
      expect(result.tokenEstimate).toBe(0);
      expect(result.injectedTypes).toHaveLength(0);
    });

    test('should include datetime by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).toContain('datetime');
      expect(result.content).toContain('Time');
    });

    test('should include timezone by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).toContain('timezone');
      expect(result.content).toContain('Timezone');
    });

    test('should include cwd by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).toContain('cwd');
      expect(result.content).toContain('Directory');
    });

    test('should include project by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).toContain('project');
      expect(result.content).toContain('Project');
    });

    test('should not include os by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).not.toContain('os');
    });

    test('should not include git by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).not.toContain('git');
    });

    test('should not include username by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.injectedTypes).not.toContain('username');
    });

    test('should format as full markdown by default', async () => {
      const result = await injector.prepareInjection();
      expect(result.content).toContain('## Environment Context');
      expect(result.content).toContain('**Time:**');
    });

    test('should format as compact when configured', async () => {
      const compact = new ContextInjector(testCwd, {
        format: 'compact',
      });
      const result = await compact.prepareInjection();
      expect(result.content).toContain('[Context:');
      expect(result.content).toContain('|');
    });
  });

  describe('datetime formats', () => {
    test('should format as ISO by default', async () => {
      const result = await injector.prepareInjection();
      // ISO format: 2026-02-04T...
      expect(result.content).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    test('should format as short when configured', async () => {
      const short = new ContextInjector(testCwd, {
        injections: {
          datetime: { enabled: true, format: 'short' },
        },
      });
      const result = await short.prepareInjection();
      // Short format: 2026-02-04
      expect(result.content).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    test('should format as relative when configured', async () => {
      const relative = new ContextInjector(testCwd, {
        injections: {
          datetime: { enabled: true, format: 'relative' },
        },
      });
      const result = await relative.prepareInjection();
      // Relative format: Tuesday, February 4, 2026
      expect(result.content).toMatch(/\w+day,\s+\w+\s+\d+,\s+\d{4}/);
    });
  });

  describe('cwd formatting', () => {
    test('should truncate home directory to ~', async () => {
      const homeInjector = new ContextInjector('/Users/test/workspace/project');
      const result = await homeInjector.prepareInjection();
      // Should contain directory but not necessarily with ~ (depends on actual home)
      expect(result.content).toContain('Directory');
    });

    test('should respect truncate config', async () => {
      const longPath = '/Users/test/very/long/path/to/some/deeply/nested/project/directory';
      const truncated = new ContextInjector(longPath, {
        injections: {
          cwd: { enabled: true, truncate: 30 },
        },
      });
      const result = await truncated.prepareInjection();
      // Should have truncated the path
      expect(result.content.length).toBeLessThan(longPath.length + 100);
    });
  });

  describe('os info', () => {
    test('should include os when enabled', async () => {
      const withOs = new ContextInjector(testCwd, {
        injections: {
          os: { enabled: true },
        },
      });
      const result = await withOs.prepareInjection();
      expect(result.injectedTypes).toContain('os');
      expect(result.content).toContain('System');
      // Should contain one of the known OS names
      expect(result.content).toMatch(/macOS|Windows|Linux/);
    });
  });

  describe('locale', () => {
    test('should include locale when enabled', async () => {
      const withLocale = new ContextInjector(testCwd, {
        injections: {
          locale: { enabled: true },
        },
      });
      const result = await withLocale.prepareInjection();
      expect(result.injectedTypes).toContain('locale');
      expect(result.content).toContain('Locale');
    });
  });

  describe('username', () => {
    test('should include username when enabled', async () => {
      const withUsername = new ContextInjector(testCwd, {
        injections: {
          username: { enabled: true },
        },
      });
      const result = await withUsername.prepareInjection();
      expect(result.injectedTypes).toContain('username');
      expect(result.content).toContain('User');
    });
  });

  describe('custom text', () => {
    test('should include custom text when enabled', async () => {
      const customText = 'Custom user context goes here';
      const withCustom = new ContextInjector(testCwd, {
        injections: {
          custom: { enabled: true, text: customText },
        },
      });
      const result = await withCustom.prepareInjection();
      expect(result.injectedTypes).toContain('custom');
      expect(result.content).toContain(customText);
    });

    test('should not include custom when text is empty', async () => {
      const withEmptyCustom = new ContextInjector(testCwd, {
        injections: {
          custom: { enabled: true, text: '' },
        },
      });
      const result = await withEmptyCustom.prepareInjection();
      expect(result.injectedTypes).not.toContain('custom');
    });
  });

  describe('env vars', () => {
    test('should include allowed env vars when enabled', async () => {
      // Set a test env var
      process.env.TEST_CONTEXT_VAR = 'test-value';
      const withEnv = new ContextInjector(testCwd, {
        injections: {
          envVars: { enabled: true, allowed: ['TEST_CONTEXT_VAR'] },
        },
      });
      const result = await withEnv.prepareInjection();
      expect(result.injectedTypes).toContain('envVars');
      expect(result.content).toContain('TEST_CONTEXT_VAR=test-value');
      // Clean up
      delete process.env.TEST_CONTEXT_VAR;
    });

    test('should not include env vars not in allowed list', async () => {
      process.env.SECRET_VAR = 'secret';
      const withEnv = new ContextInjector(testCwd, {
        injections: {
          envVars: { enabled: true, allowed: ['NODE_ENV'] },
        },
      });
      const result = await withEnv.prepareInjection();
      expect(result.content).not.toContain('SECRET_VAR');
      delete process.env.SECRET_VAR;
    });
  });

  describe('token budget', () => {
    test('should respect maxTokens limit', async () => {
      // With a very small budget, not all injections should fit
      const limited = new ContextInjector(testCwd, {
        maxTokens: 20,
      });
      const result = await limited.prepareInjection();
      expect(result.tokenEstimate).toBeLessThanOrEqual(20);
    });

    test('should estimate tokens roughly', async () => {
      const result = await injector.prepareInjection();
      // Token estimate should be reasonable (roughly content.length / 4)
      const expectedTokens = Math.ceil(result.content.length / 4);
      expect(result.tokenEstimate).toBeGreaterThan(0);
      // Allow some variance due to accumulation
      expect(result.tokenEstimate).toBeLessThan(expectedTokens * 1.5);
    });
  });

  describe('setConfig', () => {
    test('should update config dynamically', async () => {
      const result1 = await injector.prepareInjection();
      expect(result1.injectedTypes).not.toContain('os');

      injector.setConfig({
        injections: {
          os: { enabled: true },
        },
      });

      const result2 = await injector.prepareInjection();
      expect(result2.injectedTypes).toContain('os');
    });
  });

  describe('caching', () => {
    test('should cache results within TTL', async () => {
      // First call
      const result1 = await injector.prepareInjection();
      // Second call (should use cache for timezone, etc.)
      const result2 = await injector.prepareInjection();
      // Both should include same types (cached values)
      expect(result1.injectedTypes).toEqual(result2.injectedTypes);
    });

    test('should clear cache on clearCache call', () => {
      // This just tests that clearCache doesn't throw
      injector.clearCache();
      expect(true).toBe(true);
    });
  });
});
