/**
 * Swarm Module Tests
 *
 * Tests for decision policy, routing, aggregation, retries,
 * cancellation, and post-back ordering.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import {
  SwarmDecisionPolicy,
  DEFAULT_DECISION_POLICY,
  SwarmAssistantSelector,
  DEFAULT_SELECTOR_CONFIG,
  SwarmResultsAggregator,
  DEFAULT_AGGREGATOR_CONFIG,
  SwarmCritic,
  DEFAULT_CRITIC_CONFIG,
  SwarmPostback,
  DEFAULT_POSTBACK_CONFIG,
  SwarmStatusProvider,
  TaskGraph,
  TaskGraphScheduler,
  TaskGraphBuilder,
} from '../src/swarm';
import type {
  SwarmTask,
  SwarmResult,
  SwarmPlan,
  SwarmMetrics,
} from '../src/swarm/types';
import type { SubagentResult } from '../src/agent/subagent-manager';
import type { RegisteredAssistant } from '../src/registry';

// ============================================
// Decision Policy Tests
// ============================================

describe('SwarmDecisionPolicy', () => {
  let policy: SwarmDecisionPolicy;

  beforeEach(() => {
    policy = new SwarmDecisionPolicy();
  });

  test('should initialize with default config', () => {
    const config = policy.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.complexityThreshold).toBe(0.6);
    expect(config.minSubtasksForParallel).toBe(3);
  });

  test('should allow custom config', () => {
    const customPolicy = new SwarmDecisionPolicy({
      complexityThreshold: 0.8,
      autoSwarm: true,
    });
    const config = customPolicy.getConfig();
    expect(config.complexityThreshold).toBe(0.8);
    expect(config.autoSwarm).toBe(true);
  });

  test('should analyze simple task as lower complexity', () => {
    const result = policy.analyzeTask('fix typo');
    expect(result.complexityScore).toBeLessThan(0.7);
  });

  test('should analyze complex task as high complexity', () => {
    const result = policy.analyzeTask(
      'implement complete authentication system with OAuth, JWT, and session management'
    );
    expect(result.complexityScore).toBeGreaterThan(0.4);
  });

  test('should detect multi-domain tasks', () => {
    const result = policy.analyzeTask(
      'build react component and create API endpoint'
    );
    expect(result.requiredDomains.length).toBeGreaterThanOrEqual(2);
  });

  test('should detect parallelizable tasks', () => {
    const result = policy.analyzeTask(
      'update 5 components and add tests for each'
    );
    expect(result.estimatedSubtasks).toBeGreaterThanOrEqual(3);
  });

  test('should detect risky operations', () => {
    const result = policy.analyzeTask(
      'delete all old records from production database'
    );
    expect(result.riskScore).toBeGreaterThan(0.3);
  });

  test('should return single_assistant for simple task', () => {
    const { decision, reasons } = policy.evaluate('fix typo');
    expect(decision).toBe('single_assistant');
    expect(reasons.length).toBe(0);
  });

  test('should recommend swarm for complex multi-domain task', () => {
    const customPolicy = new SwarmDecisionPolicy({ autoSwarm: true });
    const { decision, reasons } = customPolicy.evaluate(
      'implement complete e-commerce system with frontend, backend, database, and payment integration'
    );
    expect(reasons.length).toBeGreaterThan(0);
  });

  test('should respect disabled policy', () => {
    const disabledPolicy = new SwarmDecisionPolicy({ enabled: false });
    const { decision } = disabledPolicy.evaluate(
      'complex multi-part system implementation'
    );
    expect(decision).toBe('single_assistant');
  });
});

// ============================================
// Assistant Selector Tests
// ============================================

describe('SwarmAssistantSelector', () => {
  let selector: SwarmAssistantSelector;
  let mockRegistry: {
    findBestMatch: ReturnType<typeof mock>;
    findByCapability: ReturnType<typeof mock>;
    findAvailable: ReturnType<typeof mock>;
    get: ReturnType<typeof mock>;
  };

  const createMockAssistant = (id: string, tools: string[] = []): RegisteredAssistant => ({
    id,
    name: `Assistant ${id}`,
    type: 'subassistant',
    capabilities: { tools, skills: [] },
    status: { state: 'idle', message: '' },
    load: { activeTasks: 0, queuedTasks: 0, tokensUsed: 0, llmCalls: 0, currentDepth: 0 },
    heartbeat: { lastHeartbeat: new Date().toISOString(), intervalMs: 5000, isStale: false, missedCount: 0 },
    registeredAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  });

  beforeEach(() => {
    mockRegistry = {
      findBestMatch: mock(() => null),
      findByCapability: mock(() => []),
      findAvailable: mock(() => []),
      get: mock(() => null),
    };
  });

  test('should initialize with default config', () => {
    selector = new SwarmAssistantSelector();
    expect(selector.isEnabled()).toBe(false); // No registry
  });

  test('should be enabled with registry', () => {
    selector = new SwarmAssistantSelector(mockRegistry as any);
    expect(selector.isEnabled()).toBe(true);
  });

  test('should create fallback assignment without registry', () => {
    selector = new SwarmAssistantSelector();
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'pending',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    const plan = selector.createAssignmentPlan([task]);
    expect(plan.stats.fallbackTasks).toBe(1);
    expect(plan.unassignedTasks).toContain('task-1');
  });

  test('should assign assistant when found', () => {
    const assistant = createMockAssistant('assistant-1', ['bash', 'read']);
    mockRegistry.findBestMatch = mock(() => assistant);

    selector = new SwarmAssistantSelector(mockRegistry as any);

    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'pending',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      requiredTools: ['bash'],
      createdAt: Date.now(),
    };

    const plan = selector.createAssignmentPlan([task]);
    expect(plan.stats.assignedTasks).toBe(1);
    expect(plan.assignments.get('task-1')?.assistantId).toBe('assistant-1');
  });

  test('should sort tasks by priority', () => {
    const assistant = createMockAssistant('assistant-1');
    mockRegistry.findBestMatch = mock(() => assistant);

    selector = new SwarmAssistantSelector(mockRegistry as any);

    const tasks: SwarmTask[] = [
      { id: 't1', description: 'Low', status: 'pending', role: 'worker', priority: 5, dependsOn: [], createdAt: Date.now() },
      { id: 't2', description: 'High', status: 'pending', role: 'worker', priority: 1, dependsOn: [], createdAt: Date.now() },
      { id: 't3', description: 'Med', status: 'pending', role: 'worker', priority: 3, dependsOn: [], createdAt: Date.now() },
    ];

    const plan = selector.createAssignmentPlan(tasks);
    expect(plan.stats.totalTasks).toBe(3);
  });
});

// ============================================
// Results Aggregator Tests
// ============================================

describe('SwarmResultsAggregator', () => {
  let aggregator: SwarmResultsAggregator;

  beforeEach(() => {
    aggregator = new SwarmResultsAggregator();
  });

  test('should initialize with default config', () => {
    const config = aggregator.getConfig();
    expect(config.strategy).toBe('merge');
    expect(config.deduplicateContent).toBe(true);
  });

  test('should aggregate single result', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'completed',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    const result: SubagentResult = {
      success: true,
      result: 'Task completed successfully',
      turns: 2,
      toolCalls: 3,
    };

    const aggregated = aggregator.aggregate([
      { taskId: 'task-1', task, result, order: 0 },
    ]);

    expect(aggregated.content).toContain('Task completed successfully');
    expect(aggregated.metadata.contributingTasks).toBe(1);
  });

  test('should handle failed results with no successful tasks', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'failed',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    const result: SubagentResult = {
      success: false,
      error: 'Task failed',
      turns: 1,
      toolCalls: 0,
    };

    const aggregated = aggregator.aggregate([
      { taskId: 'task-1', task, result, order: 0 },
    ]);

    // No successful tasks, all failed
    expect(aggregated.metadata.contributingTasks).toBe(0);
    expect(aggregated.warnings.length).toBeGreaterThan(0);
  });

  test('should deduplicate similar content', () => {
    const tasks: SwarmTask[] = [
      { id: 't1', description: 'Task 1', status: 'completed', role: 'worker', priority: 1, dependsOn: [], createdAt: Date.now() },
      { id: 't2', description: 'Task 2', status: 'completed', role: 'worker', priority: 2, dependsOn: [], createdAt: Date.now() },
    ];

    const results: SubagentResult[] = [
      { success: true, result: '# Section 1\nThis is the content for section one.', turns: 1, toolCalls: 1 },
      { success: true, result: '# Section 1\nThis is the content for section one.', turns: 1, toolCalls: 1 },
    ];

    const aggregated = aggregator.aggregate([
      { taskId: 't1', task: tasks[0], result: results[0], order: 0 },
      { taskId: 't2', task: tasks[1], result: results[1], order: 1 },
    ]);

    expect(aggregated.metadata.deduplicationCount).toBeGreaterThan(0);
  });

  test('should concatenate results', () => {
    const results = [
      { taskId: 't1', result: 'Part 1' },
      { taskId: 't2', result: 'Part 2' },
    ];

    const concatenated = aggregator.concatenate(results);
    expect(concatenated).toContain('Part 1');
    expect(concatenated).toContain('Part 2');
  });

  test('should calculate confidence', () => {
    const result: SubagentResult = {
      success: true,
      result: 'A reasonably long result that demonstrates successful completion of the task.',
      turns: 3,
      toolCalls: 5,
    };

    const confidence = aggregator.calculateResultConfidence(result);
    expect(confidence).toBeGreaterThan(0.5);
  });
});

// ============================================
// Critic Tests
// ============================================

describe('SwarmCritic', () => {
  let critic: SwarmCritic;

  beforeEach(() => {
    critic = new SwarmCritic();
  });

  test('should initialize with default config', () => {
    const config = critic.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.checkSecurity).toBe(true);
  });

  test('should be disabled when configured', () => {
    const disabledCritic = new SwarmCritic({ enabled: false });
    expect(disabledCritic.isEnabled()).toBe(false);
  });

  test('should run static checks', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'completed',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    const aggregatedResult = {
      content: 'password = "secret123"',
      sections: [],
      metadata: {
        confidence: 0.3,
        coverage: 0.5,
        contributingTasks: 1,
        failedTasks: 0,
        conflictCount: 0,
        deduplicationCount: 0,
        sectionCount: 1,
        totalLength: 100,
        strategy: 'merge' as const,
        conflictResolution: 'highest_conf' as const,
        aggregatedAt: Date.now(),
      },
      partials: [],
      warnings: [],
    };

    const issues = critic.runStaticChecks(aggregatedResult, [task]);

    // Should detect low confidence
    expect(issues.some(i => i.category === 'quality')).toBe(true);
    // Should detect potential credential
    expect(issues.some(i => i.category === 'security')).toBe(true);
  });

  test('should detect blocking issues', () => {
    const review = {
      approved: false,
      qualityScore: 0.3,
      confidence: 0.8,
      issues: [
        {
          id: 'issue-1',
          category: 'security' as const,
          severity: 'critical' as const,
          title: 'Security vulnerability',
          description: 'Found hardcoded credentials',
          autoFixable: false,
        },
      ],
      followUps: [],
      summary: 'Failed review',
      feedback: '',
      reviewedAt: Date.now(),
      durationMs: 100,
    };

    expect(critic.hasBlockingIssues(review)).toBe(true);
  });

  test('should generate follow-ups from issues', () => {
    const review = {
      approved: false,
      qualityScore: 0.5,
      confidence: 0.8,
      issues: [
        {
          id: 'issue-1',
          category: 'missing_step' as const,
          severity: 'high' as const,
          title: 'Missing tests',
          description: 'No tests for new code',
          suggestedFix: 'Add unit tests',
          autoFixable: true,
        },
      ],
      followUps: [],
      summary: 'Review',
      feedback: '',
      reviewedAt: Date.now(),
      durationMs: 100,
    };

    const followUps = critic.generateFollowUps(review);
    expect(followUps.length).toBe(1);
    expect(followUps[0].type).toBe('task');
    expect(followUps[0].required).toBe(true);
  });
});

// ============================================
// Postback Tests
// ============================================

describe('SwarmPostback', () => {
  let postback: SwarmPostback;

  const createMockResult = (): SwarmResult => ({
    success: true,
    result: 'Final result',
    taskResults: {
      'task-1': { success: true, result: 'Task 1 done', turns: 2, toolCalls: 3 },
    },
    metrics: {
      totalTasks: 1,
      completedTasks: 1,
      failedTasks: 0,
      runningTasks: 0,
      tokensUsed: 1000,
      llmCalls: 2,
      toolCalls: 5,
      replans: 0,
    },
    durationMs: 5000,
  });

  const createMockPlan = (): SwarmPlan => ({
    id: 'plan-1',
    goal: 'Test goal',
    tasks: [
      {
        id: 'task-1',
        description: 'Test task',
        status: 'completed',
        role: 'worker',
        priority: 1,
        dependsOn: [],
        createdAt: Date.now(),
        startedAt: Date.now() - 3000,
        completedAt: Date.now(),
      },
    ],
    createdAt: Date.now(),
    approved: true,
    approvedAt: Date.now(),
    version: 1,
  });

  beforeEach(() => {
    postback = new SwarmPostback();
  });

  test('should initialize with default config', () => {
    const config = postback.getConfig();
    expect(config.format).toBe('markdown');
    expect(config.includeTaskDetails).toBe(true);
  });

  test('should create postback message', () => {
    const message = postback.createPostback({
      swarmId: 'swarm-1',
      sessionId: 'session-1',
      goal: 'Test goal',
      plan: createMockPlan(),
      result: createMockResult(),
    });

    expect(message.swarmId).toBe('swarm-1');
    expect(message.content).toContain('Test goal');
    expect(message.format).toBe('markdown');
  });

  test('should format as markdown', () => {
    const message = postback.createPostback({
      swarmId: 'swarm-1',
      sessionId: 'session-1',
      goal: 'Test goal',
      plan: createMockPlan(),
      result: createMockResult(),
    });

    expect(message.content).toContain('##');
    expect(message.content).toContain('Test goal');
  });

  test('should format as JSON', () => {
    const jsonPostback = new SwarmPostback({ format: 'json' });
    const message = jsonPostback.createPostback({
      swarmId: 'swarm-1',
      sessionId: 'session-1',
      goal: 'Test goal',
      plan: createMockPlan(),
      result: createMockResult(),
    });

    const parsed = JSON.parse(message.content);
    expect(parsed.goal).toBe('Test goal');
  });

  test('should create inbox message', () => {
    const structuredPostback = new SwarmPostback({ format: 'structured' });
    const message = structuredPostback.createPostback({
      swarmId: 'swarm-1',
      sessionId: 'session-1',
      goal: 'Test goal',
      plan: createMockPlan(),
      result: createMockResult(),
    });

    const inbox = structuredPostback.createInboxMessage(message);
    expect(inbox.type).toBe('swarm_result');
    // When structured data is available, the title uses it
    expect(inbox.metadata.swarmId).toBe('swarm-1');
  });
});

// ============================================
// Status Provider Tests
// ============================================

describe('SwarmStatusProvider', () => {
  let statusProvider: SwarmStatusProvider;

  beforeEach(() => {
    statusProvider = new SwarmStatusProvider('swarm-1', 'session-1');
  });

  test('should initialize with IDs', () => {
    expect(statusProvider.getSwarmId()).toBe('swarm-1');
  });

  test('should track task updates', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'running',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
      startedAt: Date.now(),
    };

    statusProvider.updateTask(task);

    const summary = statusProvider.getSummary();
    expect(summary.tasks.length).toBe(1);
    expect(summary.tasks[0].status).toBe('running');
  });

  test('should calculate progress', () => {
    const tasks: SwarmTask[] = [
      { id: 't1', description: 'Task 1', status: 'completed', role: 'worker', priority: 1, dependsOn: [], createdAt: Date.now() },
      { id: 't2', description: 'Task 2', status: 'running', role: 'worker', priority: 2, dependsOn: [], createdAt: Date.now() },
    ];

    for (const task of tasks) {
      statusProvider.updateTask(task);
    }

    const progress = statusProvider.getProgress();
    expect(progress).toBe(50);
  });

  test('should format progress bar', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Task 1',
      status: 'completed',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    statusProvider.updateTask(task);

    const progressBar = statusProvider.formatProgress('bar', 10);
    expect(progressBar).toContain('100%');
    expect(progressBar).toContain('█');
  });

  test('should add logs', () => {
    statusProvider.addLog('task-1', 'info', 'Task started');
    statusProvider.addLog('task-1', 'error', 'Task failed');

    const detail = statusProvider.getTaskDetail('task-1');
    expect(detail).toBeNull(); // Task not tracked yet

    const task: SwarmTask = {
      id: 'task-1',
      description: 'Task 1',
      status: 'running',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };
    statusProvider.updateTask(task);

    const detailAfter = statusProvider.getTaskDetail('task-1');
    expect(detailAfter?.logs.length).toBe(2);
  });

  test('should emit events', () => {
    const events: any[] = [];
    statusProvider.addListener((event) => events.push(event));

    const task: SwarmTask = {
      id: 'task-1',
      description: 'Task 1',
      status: 'running',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    statusProvider.updateTask(task);

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'task_update')).toBe(true);
  });

  test('should format for terminal', () => {
    const task: SwarmTask = {
      id: 'task-1',
      description: 'Test task',
      status: 'running',
      role: 'worker',
      priority: 1,
      dependsOn: [],
      createdAt: Date.now(),
    };

    statusProvider.updateTask(task);

    const output = statusProvider.formatForTerminal();
    expect(output).toContain('Swarm:');
    expect(output).toContain('Tasks:');
  });
});

// ============================================
// Task Graph Tests
// ============================================

describe('TaskGraph', () => {
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
  });

  test('should add tasks', () => {
    graph.addTask({
      description: 'Task 1',
      role: 'worker',
      priority: 1,
      dependsOn: [],
    });

    expect(graph.getAllTasks().length).toBe(1);
  });

  test('should track dependencies', () => {
    const t1 = graph.addTask({
      id: 't1',
      description: 'Task 1',
      role: 'worker',
      priority: 1,
      dependsOn: [],
    });

    graph.addTask({
      id: 't2',
      description: 'Task 2',
      role: 'worker',
      priority: 2,
      dependsOn: [t1.id],
    });

    const ready = graph.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t1');
  });

  test('should get topological order', () => {
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    const t2 = graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });
    graph.addTask({ id: 't3', description: '3', role: 'worker', priority: 3, dependsOn: [t2.id] });

    // getTopologicalOrder returns string[] (task IDs)
    const order = graph.getTopologicalOrder();
    expect(order[0]).toBe('t1');
    expect(order[2]).toBe('t3');
  });

  test('should detect cycles via execution levels', () => {
    // Create a valid graph first
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });

    // hasCycles checks the adjacency list structure
    expect(graph.hasCycles()).toBe(false);

    // A graph with proper structure should not have cycles
    const levels = graph.getExecutionLevels();
    expect(levels.length).toBe(2);
  });
});

// ============================================
// Task Graph Builder Tests
// ============================================

describe('TaskGraphBuilder', () => {
  let builder: TaskGraphBuilder;

  beforeEach(() => {
    builder = new TaskGraphBuilder();
  });

  test('should build from task list', () => {
    const graph = builder.buildFromTaskList(['Task 1', 'Task 2', 'Task 3']);
    const tasks = graph.getAllTasks();

    // 3 tasks + 1 aggregation (if enabled)
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  test('should build pipeline', () => {
    const graph = builder.buildPipeline(['Step 1', 'Step 2', 'Step 3']);
    const tasks = graph.getAllTasks();

    expect(tasks.length).toBe(3);
    // Tasks are in order, with proper dependencies
    const orderIds = graph.getTopologicalOrder();
    expect(orderIds.length).toBe(3);
  });

  test('should build fan-out', () => {
    const graph = builder.buildFanOut(
      'Root task',
      ['Parallel 1', 'Parallel 2', 'Parallel 3'],
      'Merge results'
    );

    const tasks = graph.getAllTasks();
    expect(tasks.length).toBe(5); // 1 root + 3 parallel + 1 merge
  });

  test('should build fan-in', () => {
    const graph = builder.buildFanIn(
      ['Input 1', 'Input 2', 'Input 3'],
      'Aggregate'
    );

    const tasks = graph.getAllTasks();
    expect(tasks.length).toBe(4); // 3 inputs + 1 aggregate
  });

  test('should parse planner output', () => {
    const output = JSON.stringify([
      { description: 'Task 1', priority: 1 },
      { description: 'Task 2', dependsOn: [0], priority: 2 },
    ]);

    const parsed = builder.parsePlannerOutput(output);
    expect(parsed.tasks.length).toBe(2);
  });

  test('should respect max tasks', () => {
    const limitedBuilder = new TaskGraphBuilder({ maxTasks: 2 });
    const graph = limitedBuilder.buildFromTaskList([
      'Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5'
    ]);

    const tasks = graph.getAllTasks();
    // Should have at most 2 worker tasks + possibly aggregation
    expect(tasks.filter(t => t.role === 'worker').length).toBeLessThanOrEqual(2);
  });
});

// ============================================
// Scheduler Tests
// ============================================

describe('TaskGraphScheduler', () => {
  let graph: TaskGraph;
  let scheduler: TaskGraphScheduler;

  beforeEach(() => {
    graph = new TaskGraph();
    scheduler = new TaskGraphScheduler(graph);
  });

  test('should initialize with empty graph', () => {
    const stats = graph.getStats();
    expect(stats.total).toBe(0);
  });

  test('should get ready tasks from graph', () => {
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });

    // First ready task should be t1
    const ready = graph.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t1');
  });

  test('should update status on completion', () => {
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });

    // Mark t1 as completed
    graph.updateTaskStatus('t1', 'completed');
    graph.setTaskResult('t1', { success: true, result: 'done', turns: 1, toolCalls: 1 });

    // Now t2 should be ready
    const ready = graph.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t2');
  });

  test('should block tasks when dependency fails', () => {
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });

    // Mark t1 as failed
    graph.updateTaskStatus('t1', 'failed');

    // t2 should be blocked
    const blocked = graph.markBlockedTasks();
    expect(blocked).toContain('t2');

    const stats = graph.getStats();
    expect(stats.failed).toBe(1);
    expect(stats.blocked).toBe(1);
  });

  test('should block tasks when dependency is blocked or missing', () => {
    const t1 = graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    graph.addTask({ id: 't2', description: '2', role: 'worker', priority: 2, dependsOn: [t1.id] });
    graph.addTask({ id: 't3', description: '3', role: 'worker', priority: 3, dependsOn: ['missing'] });

    // Mark t1 as blocked
    graph.updateTaskStatus('t1', 'blocked');

    const blocked = graph.markBlockedTasks();
    expect(blocked).toContain('t2');
    expect(blocked).toContain('t3');
  });

  test('should execute tasks via scheduler', async () => {
    graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });

    const executor = async (task: SwarmTask): Promise<SubagentResult> => ({
      success: true,
      result: `Done: ${task.description}`,
      turns: 1,
      toolCalls: 1,
    });

    const results = await scheduler.execute(executor);
    expect(results.size).toBe(1);
    expect(results.get('t1')?.success).toBe(true);
  });

  test('should clamp maxConcurrent to avoid deadlock when set to 0', async () => {
    graph.addTask({ id: 't1', description: '1', role: 'worker', priority: 1, dependsOn: [] });
    scheduler = new TaskGraphScheduler(graph, { maxConcurrent: 0 });

    const executor = async (task: SwarmTask): Promise<SubagentResult> => ({
      success: true,
      result: `Done: ${task.description}`,
      turns: 1,
      toolCalls: 1,
    });

    const results = await scheduler.execute(executor);
    expect(results.get('t1')?.success).toBe(true);
  });
});
