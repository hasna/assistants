import { describe, expect, test } from 'bun:test';
import { BudgetTracker } from '../src/budget/tracker';
import { createBudgetToolExecutors } from '../src/budget/tools';

function setupTracker() {
  const tracker = new BudgetTracker('budget-tools-test', {
    enabled: true,
    persist: false,
    session: { maxTotalTokens: 1000, maxLlmCalls: 10 },
    swarm: { maxTotalTokens: 5000 },
    project: { maxTotalTokens: 10000 },
  });
  const executors = createBudgetToolExecutors(() => tracker);
  return { tracker, executors };
}

describe('budget tool executors', () => {
  test('budget_set updates the correct config scope key', async () => {
    const { tracker, executors } = setupTracker();
    const result = await executors.budget_set({
      scope: 'session',
      maxTotalTokens: 1500,
      maxToolCalls: 25,
    });

    expect(result).toContain('Budget limits updated for session scope');
    const config = tracker.getConfig();
    expect(config.session?.maxTotalTokens).toBe(1500);
    expect(config.session?.maxToolCalls).toBe(25);
    expect(config.swarm?.maxTotalTokens).toBe(5000);
  });

  test('budget_set treats 0 as unlimited', async () => {
    const { tracker, executors } = setupTracker();
    const result = await executors.budget_set({
      scope: 'session',
      maxLlmCalls: 0,
    });

    expect(result).toContain('unlimited');
    const config = tracker.getConfig();
    expect(config.session?.maxLlmCalls).toBeUndefined();
  });

  test('budget_set validates scope and numeric values', async () => {
    const { tracker, executors } = setupTracker();

    expect(await executors.budget_set({ scope: 'assistant', maxTotalTokens: 123 }))
      .toContain('Invalid scope');
    expect(await executors.budget_set({ scope: 'session', maxTotalTokens: -1 }))
      .toContain('Values must be numbers >= 0');
    expect(await executors.budget_set({ scope: 'session', maxTotalTokens: 'not-a-number' }))
      .toContain('Values must be numbers >= 0');

    expect(tracker.getConfig().session?.maxTotalTokens).toBe(1000);
  });

  test('budget_status validates scope', async () => {
    const { executors } = setupTracker();
    expect(await executors.budget_status({ scope: 'assistant' })).toContain('Invalid scope');
  });

  test('budget_reset validates scope and supports project/all', async () => {
    const { tracker, executors } = setupTracker();
    tracker.setActiveProject('project-alpha');
    tracker.recordUsage(
      {
        inputTokens: 100,
        totalTokens: 100,
      },
      'project',
      'project-alpha'
    );
    tracker.recordUsage(
      {
        inputTokens: 300,
        totalTokens: 300,
      },
      'swarm'
    );

    expect(await executors.budget_reset({ scope: 'assistant' })).toContain('Invalid scope');

    const projectReset = await executors.budget_reset({ scope: 'project' });
    expect(projectReset).toContain('project');
    expect(tracker.getUsage('project', 'project-alpha').totalTokens).toBe(0);

    await executors.budget_reset({ scope: 'all' });
    expect(tracker.getUsage('session').totalTokens).toBe(0);
    expect(tracker.getUsage('swarm').totalTokens).toBe(0);
  });

  test('executors return disabled message when tracker is missing', async () => {
    const executors = createBudgetToolExecutors(() => null);
    expect(await executors.budget_get({})).toContain('not enabled');
    expect(await executors.budget_status({ scope: 'session' })).toContain('not enabled');
    expect(await executors.budget_set({ scope: 'session', maxTotalTokens: 100 })).toContain('not enabled');
    expect(await executors.budget_reset({ scope: 'session' })).toContain('not enabled');
  });
});
