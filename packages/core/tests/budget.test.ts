import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  BudgetTracker,
  DEFAULT_BUDGET_CONFIG,
  DEFAULT_SESSION_LIMITS,
  DEFAULT_ASSISTANT_LIMITS,
  DEFAULT_SWARM_LIMITS,
  WARNING_THRESHOLD,
} from '../src/budget';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';
import type { BudgetConfig } from '@hasna/assistants-shared';

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-budget-'));
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  process.env.ASSISTANTS_DIR = tempDir;
  resetDatabaseSingleton();
});

afterEach(() => {
  closeDatabase();
  resetDatabaseSingleton();
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('BudgetTracker', () => {
  describe('initialization', () => {
    test('creates with default config', () => {
      const tracker = new BudgetTracker('test-session');
      expect(tracker.isEnabled()).toBe(false);
    });

    test('creates with custom config', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 100000 },
      };
      const tracker = new BudgetTracker('test-session', config);
      expect(tracker.isEnabled()).toBe(true);
    });

    test('can enable and disable enforcement', () => {
      const tracker = new BudgetTracker('test-session');
      expect(tracker.isEnabled()).toBe(false);
      tracker.setEnabled(true);
      expect(tracker.isEnabled()).toBe(true);
      tracker.setEnabled(false);
      expect(tracker.isEnabled()).toBe(false);
    });
  });

  describe('usage tracking', () => {
    test('records LLM calls', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordLlmCall(1000, 500, 100);

      const usage = tracker.getUsage('session');
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
      expect(usage.totalTokens).toBe(1500);
      expect(usage.llmCalls).toBe(1);
    });

    test('records tool calls', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordToolCall(50);
      tracker.recordToolCall(100);

      const usage = tracker.getUsage('session');
      expect(usage.toolCalls).toBe(2);
      expect(usage.durationMs).toBe(150);
    });

    test('accumulates usage across multiple calls', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordLlmCall(1000, 500, 100);
      tracker.recordLlmCall(2000, 1000, 200);

      const usage = tracker.getUsage('session');
      expect(usage.inputTokens).toBe(3000);
      expect(usage.outputTokens).toBe(1500);
      expect(usage.llmCalls).toBe(2);
    });

    test('tracks assistant-specific usage', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordUsage({
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        llmCalls: 1,
      }, 'assistant', 'assistant-1');

      const assistantUsage = tracker.getUsage('assistant', 'assistant-1');
      expect(assistantUsage.inputTokens).toBe(1000);
      expect(assistantUsage.llmCalls).toBe(1);

      // Session usage should also be updated
      const sessionUsage = tracker.getUsage('session');
      expect(sessionUsage.inputTokens).toBe(1000);
    });

    test('tracks swarm-level usage', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordUsage({
        inputTokens: 5000,
        outputTokens: 2500,
        totalTokens: 7500,
        llmCalls: 5,
      }, 'swarm');

      const swarmUsage = tracker.getUsage('swarm');
      expect(swarmUsage.inputTokens).toBe(5000);
      expect(swarmUsage.llmCalls).toBe(5);
    });
  });

  describe('budget checking', () => {
    test('detects budget exceeded', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 1000 },
      };
      const tracker = new BudgetTracker('test-session', config);

      // Record usage that exceeds the limit
      tracker.recordLlmCall(800, 300, 100);

      expect(tracker.isExceeded('session')).toBe(true);

      const status = tracker.checkBudget('session');
      expect(status.overallExceeded).toBe(true);
      expect(status.checks.totalTokens?.exceeded).toBe(true);
    });

    test('returns warnings when approaching limit', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 1000 },
      };
      const tracker = new BudgetTracker('test-session', config);

      // Record usage at 85% (above warning threshold)
      tracker.recordLlmCall(600, 250, 100);

      const status = tracker.checkBudget('session');
      expect(status.overallExceeded).toBe(false);
      expect(status.checks.totalTokens?.warning).toBeDefined();
      expect(status.warningsCount).toBeGreaterThan(0);
    });

    test('does not exceed when disabled', () => {
      const config: BudgetConfig = {
        enabled: false,
        session: { maxTotalTokens: 100 },
      };
      const tracker = new BudgetTracker('test-session', config);

      // Record usage way over the limit
      tracker.recordLlmCall(1000, 500, 100);

      // Should not be considered exceeded when disabled
      expect(tracker.isExceeded('session')).toBe(false);
    });

    test('checks multiple limit types', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: {
          maxTotalTokens: 10000,
          maxLlmCalls: 5,
          maxToolCalls: 10,
        },
      };
      const tracker = new BudgetTracker('test-session', config);

      // Record 6 LLM calls (exceeds maxLlmCalls)
      for (let i = 0; i < 6; i++) {
        tracker.recordLlmCall(100, 50, 10);
      }

      const status = tracker.checkBudget('session');
      expect(status.overallExceeded).toBe(true);
      expect(status.checks.llmCalls?.exceeded).toBe(true);
      expect(status.checks.totalTokens?.exceeded).toBe(false);
    });
  });

  describe('usage reset', () => {
    test('resets session usage', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordLlmCall(1000, 500, 100);

      tracker.resetUsage('session');

      const usage = tracker.getUsage('session');
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.llmCalls).toBe(0);
    });

    test('resets assistant-specific usage', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordUsage({
        inputTokens: 1000,
        llmCalls: 1,
      }, 'assistant', 'assistant-1');

      tracker.resetUsage('assistant', 'assistant-1');

      const usage = tracker.getUsage('assistant', 'assistant-1');
      expect(usage.inputTokens).toBe(0);
    });

    test('resets all assistant usage when no assistant id is provided', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordUsage({ inputTokens: 100 }, 'assistant', 'assistant-1');
      tracker.recordUsage({ inputTokens: 200 }, 'assistant', 'assistant-2');

      tracker.resetUsage('assistant');

      expect(tracker.getAssistantUsages().size).toBe(0);
    });

    test('resets tracked project usage when no active project is set', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.setActiveProject('project-a');
      tracker.recordUsage({ inputTokens: 100, totalTokens: 100 }, 'project', 'project-a');
      tracker.setActiveProject('project-b');
      tracker.recordUsage({ inputTokens: 200, totalTokens: 200 }, 'project', 'project-b');

      tracker.setActiveProject(null);
      tracker.resetUsage('project');

      expect(tracker.getUsage('project', 'project-a').totalTokens).toBe(0);
      expect(tracker.getUsage('project', 'project-b').totalTokens).toBe(0);
    });

    test('resets all usage', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordLlmCall(1000, 500, 100);
      tracker.recordUsage({
        inputTokens: 500,
      }, 'assistant', 'assistant-1');
      tracker.recordUsage({
        inputTokens: 2000,
      }, 'swarm');

      tracker.resetAll();

      expect(tracker.getUsage('session').inputTokens).toBe(0);
      expect(tracker.getUsage('swarm').inputTokens).toBe(0);
      expect(tracker.getAssistantUsages().size).toBe(0);
    });
  });

  describe('summary', () => {
    test('returns comprehensive summary', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 10000 },
      };
      const tracker = new BudgetTracker('test-session', config);
      tracker.recordLlmCall(5000, 2500, 100);

      const summary = tracker.getSummary();
      expect(summary.enabled).toBe(true);
      expect(summary.session.usage.totalTokens).toBe(7500);
      expect(summary.anyExceeded).toBe(false);
    });

    test('counts assistant usages', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.recordUsage({ inputTokens: 100 }, 'assistant', 'assistant-1');
      tracker.recordUsage({ inputTokens: 200 }, 'assistant', 'assistant-2');

      const summary = tracker.getSummary();
      expect(summary.assistantCount).toBe(2);
    });
  });

  describe('config', () => {
    test('returns current config', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 50000 },
      };
      const tracker = new BudgetTracker('test-session', config);

      const returnedConfig = tracker.getConfig();
      expect(returnedConfig.enabled).toBe(true);
      expect(returnedConfig.session?.maxTotalTokens).toBe(50000);
    });

    test('updates config', () => {
      const tracker = new BudgetTracker('test-session');
      tracker.updateConfig({ enabled: true });

      expect(tracker.isEnabled()).toBe(true);
    });
  });

  describe('persistence', () => {
    test('persists and loads state', () => {
      const config: BudgetConfig = {
        enabled: true,
        persist: true,
        session: { maxTotalTokens: 10000 },
      };

      // Create tracker and record usage
      const tracker1 = new BudgetTracker('persist-test', config);
      tracker1.recordLlmCall(1000, 500, 100);

      // Create new tracker with same session ID - should load state
      const tracker2 = new BudgetTracker('persist-test', config);

      const usage = tracker2.getUsage('session');
      expect(usage.inputTokens).toBe(1000);
      expect(usage.outputTokens).toBe(500);
    });

    test('stores budget data in the database', () => {
      const config: BudgetConfig = {
        enabled: true,
        persist: true,
      };

      const tracker = new BudgetTracker('new-session', config);
      tracker.recordLlmCall(100, 50, 10);

      // Verify data was stored in the DB by creating a new tracker
      const tracker2 = new BudgetTracker('new-session', config);
      const usage = tracker2.getUsage('session');
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
    });
  });

  describe('format output', () => {
    test('formats usage for display', () => {
      const config: BudgetConfig = {
        enabled: true,
        session: { maxTotalTokens: 10000, maxLlmCalls: 100 },
      };
      const tracker = new BudgetTracker('test-session', config);
      tracker.recordLlmCall(5000, 2500, 60000);

      const formatted = tracker.formatUsage('session');
      expect(formatted).toContain('Budget Status');
      expect(formatted).toContain('session');
      expect(formatted).toContain('7,500');
      expect(formatted).toContain('10,000');
    });
  });
});

describe('Default configs', () => {
  test('DEFAULT_BUDGET_CONFIG has expected structure', () => {
    expect(DEFAULT_BUDGET_CONFIG.enabled).toBe(false);
    expect(DEFAULT_BUDGET_CONFIG.session).toBeDefined();
    expect(DEFAULT_BUDGET_CONFIG.assistant).toBeDefined();
    expect(DEFAULT_BUDGET_CONFIG.swarm).toBeDefined();
    expect(DEFAULT_BUDGET_CONFIG.onExceeded).toBe('warn');
  });

  test('DEFAULT_SESSION_LIMITS has sensible values', () => {
    expect(DEFAULT_SESSION_LIMITS.maxTotalTokens).toBe(1_000_000);
    expect(DEFAULT_SESSION_LIMITS.maxLlmCalls).toBe(500);
    expect(DEFAULT_SESSION_LIMITS.maxToolCalls).toBe(1000);
  });

  test('DEFAULT_ASSISTANT_LIMITS is more restrictive than session', () => {
    expect(DEFAULT_ASSISTANT_LIMITS.maxTotalTokens).toBeLessThan(DEFAULT_SESSION_LIMITS.maxTotalTokens!);
    expect(DEFAULT_ASSISTANT_LIMITS.maxLlmCalls).toBeLessThan(DEFAULT_SESSION_LIMITS.maxLlmCalls!);
  });

  test('WARNING_THRESHOLD is at 80%', () => {
    expect(WARNING_THRESHOLD).toBe(0.8);
  });
});
