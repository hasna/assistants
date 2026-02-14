import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  PolicyEvaluator,
  GuardrailsStore,
  DEFAULT_GUARDRAILS_CONFIG,
  DEFAULT_SYSTEM_POLICY,
  PERMISSIVE_POLICY,
  RESTRICTIVE_POLICY,
  POLICY_SCOPE_PRECEDENCE,
} from '../src/guardrails';
import type { GuardrailsConfig, GuardrailsPolicy, ToolPolicyRule } from '../src/guardrails/types';

let tempDir: string;
let homeDir: string;
let projectDir: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-guardrails-'));
  homeDir = join(tempDir, 'home');
  projectDir = join(tempDir, 'project');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  originalHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PolicyEvaluator', () => {
  describe('initialization', () => {
    test('creates with default config', () => {
      const evaluator = new PolicyEvaluator();
      expect(evaluator.isEnabled()).toBe(false);
    });

    test('creates with custom config', () => {
      const config: GuardrailsConfig = {
        enabled: true,
        policies: [DEFAULT_SYSTEM_POLICY],
        defaultAction: 'allow',
      };
      const evaluator = new PolicyEvaluator(config);
      expect(evaluator.isEnabled()).toBe(true);
    });

    test('can enable and disable enforcement', () => {
      const evaluator = new PolicyEvaluator();
      expect(evaluator.isEnabled()).toBe(false);
      evaluator.setEnabled(true);
      expect(evaluator.isEnabled()).toBe(true);
      evaluator.setEnabled(false);
      expect(evaluator.isEnabled()).toBe(false);
    });
  });

  describe('policy evaluation', () => {
    test('allows everything when disabled', () => {
      const evaluator = new PolicyEvaluator({ enabled: false, policies: [], defaultAction: 'deny' });
      const result = evaluator.evaluateToolUse({ toolName: 'dangerous-tool' });
      expect(result.allowed).toBe(true);
      expect(result.reasons).toContain('Guardrails disabled');
    });

    test('uses default action when no rules match', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'deny',
            rules: [],
          },
        }],
        defaultAction: 'deny',
      });
      const result = evaluator.evaluateToolUse({ toolName: 'unknown-tool' });
      expect(result.allowed).toBe(false);
    });

    test('matches tool by exact name', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: 'bash', action: 'deny' }],
          },
        }],
        defaultAction: 'allow',
      });
      const result = evaluator.evaluateToolUse({ toolName: 'bash' });
      expect(result.allowed).toBe(false);
      expect(result.action).toBe('deny');
    });

    test('matches tool by glob pattern', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: 'connector:*', action: 'require_approval' }],
          },
        }],
        defaultAction: 'allow',
      });
      const result = evaluator.evaluateToolUse({ toolName: 'connector:notion' });
      expect(result.requiresApproval).toBe(true);
    });

    test('matches tool by regex pattern', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: '/^file:.*/', action: 'warn' }],
          },
        }],
        defaultAction: 'allow',
      });
      const result = evaluator.evaluateToolUse({ toolName: 'file:write' });
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('evaluates conditions', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{
              pattern: 'bash',
              action: 'deny',
              conditions: [{ type: 'input_contains', value: 'rm -rf' }],
            }],
          },
        }],
        defaultAction: 'allow',
      });

      // Without dangerous input - should be allowed
      const safe = evaluator.evaluateToolUse({
        toolName: 'bash',
        toolInput: { command: 'ls -la' },
      });
      expect(safe.allowed).toBe(true);

      // With dangerous input - should be denied
      const dangerous = evaluator.evaluateToolUse({
        toolName: 'bash',
        toolInput: { command: 'rm -rf /' },
      });
      expect(dangerous.allowed).toBe(false);
    });
  });

  describe('policy precedence', () => {
    test('higher precedence policies override lower', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [
          {
            id: 'session-policy',
            scope: 'session',
            enabled: true,
            tools: {
              defaultAction: 'allow',
              rules: [{ pattern: 'bash', action: 'allow' }],
            },
          },
          {
            id: 'system-policy',
            scope: 'system',
            enabled: true,
            tools: {
              defaultAction: 'allow',
              rules: [{ pattern: 'bash', action: 'deny' }],
            },
          },
        ],
        defaultAction: 'allow',
      });

      // System policy should take precedence
      const result = evaluator.evaluateToolUse({ toolName: 'bash' });
      expect(result.allowed).toBe(false);
    });

    test('disabled policies are skipped', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [
          {
            id: 'disabled-policy',
            scope: 'system',
            enabled: false,
            tools: {
              defaultAction: 'allow',
              rules: [{ pattern: 'bash', action: 'deny' }],
            },
          },
          {
            id: 'enabled-policy',
            scope: 'session',
            enabled: true,
            tools: {
              defaultAction: 'allow',
              rules: [{ pattern: 'bash', action: 'allow' }],
            },
          },
        ],
        defaultAction: 'allow',
      });

      const result = evaluator.evaluateToolUse({ toolName: 'bash' });
      expect(result.allowed).toBe(true);
    });
  });

  describe('depth limits', () => {
    test('enforces max depth', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          depth: { maxDepth: 3, onExceeded: 'deny' },
        }],
        defaultAction: 'allow',
      });

      // Within limits
      const withinLimits = evaluator.evaluateToolUse({ toolName: 'tool', depth: 2 });
      expect(withinLimits.allowed).toBe(true);

      // Exceeds limits
      const exceeds = evaluator.evaluateToolUse({ toolName: 'tool', depth: 5 });
      expect(exceeds.allowed).toBe(false);
      expect(exceeds.reasons).toContain('Max depth 3 exceeded');
    });

    test('warns on depth exceeded with warn action', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          depth: { maxDepth: 2, onExceeded: 'warn' },
        }],
        defaultAction: 'allow',
      });

      const result = evaluator.evaluateToolUse({ toolName: 'tool', depth: 3 });
      expect(result.allowed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('policy management', () => {
    test('adds policy', () => {
      const evaluator = new PolicyEvaluator();
      evaluator.addPolicy({
        id: 'new-policy',
        scope: 'session',
        enabled: true,
        tools: {
          defaultAction: 'deny',
          rules: [],
        },
      });

      const policies = evaluator.getPolicies();
      expect(policies.some(p => p.id === 'new-policy')).toBe(true);
    });

    test('removes policy', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'removable',
          scope: 'session',
          enabled: true,
        }],
        defaultAction: 'allow',
      });

      expect(evaluator.removePolicy('removable')).toBe(true);
      expect(evaluator.getPolicies().some(p => p.id === 'removable')).toBe(false);
    });

    test('updates config', () => {
      const evaluator = new PolicyEvaluator();
      evaluator.updateConfig({ enabled: true, defaultAction: 'deny' });

      const config = evaluator.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.defaultAction).toBe('deny');
    });
  });

  describe('helper methods', () => {
    test('isToolAllowed checks permission', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: 'blocked', action: 'deny' }],
          },
        }],
        defaultAction: 'allow',
      });

      expect(evaluator.isToolAllowed('allowed-tool')).toBe(true);
      expect(evaluator.isToolAllowed('blocked')).toBe(false);
    });

    test('requiresApproval checks approval requirement', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: 'sensitive', action: 'require_approval' }],
          },
        }],
        defaultAction: 'allow',
      });

      expect(evaluator.requiresApproval('normal-tool')).toBe(false);
      expect(evaluator.requiresApproval('sensitive')).toBe(true);
    });

    test('getWarnings returns warnings', () => {
      const evaluator = new PolicyEvaluator({
        enabled: true,
        policies: [{
          id: 'test',
          scope: 'session',
          enabled: true,
          tools: {
            defaultAction: 'allow',
            rules: [{ pattern: 'warn-me', action: 'warn', reason: 'Be careful!' }],
          },
        }],
        defaultAction: 'allow',
      });

      const warnings = evaluator.getWarnings('warn-me');
      expect(warnings).toContain('Be careful!');
    });
  });
});

describe('GuardrailsStore', () => {
  describe('persistence', () => {
    test('saves and loads config', () => {
      const store = new GuardrailsStore(projectDir);
      const config: GuardrailsConfig = {
        enabled: true,
        policies: [{
          id: 'test-policy',
          scope: 'session',
          enabled: true,
        }],
        defaultAction: 'allow',
      };

      store.save('project', config);
      const loaded = store.loadAll();

      expect(loaded.policies.some(p => p.id === 'test-policy')).toBe(true);
    });

    test('merges configs from multiple locations', () => {
      const store = new GuardrailsStore(projectDir);

      store.save('user', {
        enabled: true,
        policies: [{ id: 'user-policy', scope: 'session', enabled: true }],
        defaultAction: 'allow',
      });

      store.save('project', {
        enabled: true,
        policies: [{ id: 'project-policy', scope: 'project', enabled: true }],
        defaultAction: 'allow',
      });

      const loaded = store.loadAll();
      expect(loaded.policies.some(p => p.id === 'user-policy')).toBe(true);
      expect(loaded.policies.some(p => p.id === 'project-policy')).toBe(true);
    });

    test('adds policy to specific location', () => {
      const store = new GuardrailsStore(projectDir);
      const policyId = store.addPolicy({
        id: 'added-policy',
        scope: 'session',
        enabled: true,
      }, 'project');

      expect(policyId).toBe('added-policy');
      const policy = store.getPolicy('added-policy');
      expect(policy).not.toBeNull();
      expect(policy?.location).toBe('project');
    });

    test('removes policy', () => {
      const store = new GuardrailsStore(projectDir);
      store.addPolicy({
        id: 'removable',
        scope: 'session',
        enabled: true,
      }, 'project');

      expect(store.removePolicy('removable')).toBe(true);
      expect(store.getPolicy('removable')).toBeNull();
    });

    test('enables/disables policy', () => {
      const store = new GuardrailsStore(projectDir);
      store.addPolicy({
        id: 'toggleable',
        scope: 'session',
        enabled: true,
      }, 'project');

      expect(store.setPolicyEnabled('toggleable', false)).toBe(true);
      const disabled = store.getPolicy('toggleable');
      expect(disabled?.enabled).toBe(false);

      expect(store.setPolicyEnabled('toggleable', true)).toBe(true);
      const enabled = store.getPolicy('toggleable');
      expect(enabled?.enabled).toBe(true);
    });
  });

  describe('policy listing', () => {
    test('lists all policies', () => {
      const store = new GuardrailsStore(projectDir);
      store.addPolicy({ id: 'policy-1', scope: 'session', enabled: true }, 'user');
      store.addPolicy({ id: 'policy-2', scope: 'project', enabled: true }, 'project');

      const policies = store.listPolicies();
      // Should include system default + added policies
      expect(policies.length).toBeGreaterThanOrEqual(2);
      expect(policies.some(p => p.id === 'policy-1')).toBe(true);
      expect(policies.some(p => p.id === 'policy-2')).toBe(true);
    });

    test('includes system default policy', () => {
      const store = new GuardrailsStore(projectDir);
      const policies = store.listPolicies();
      expect(policies.some(p => p.id === 'system-default')).toBe(true);
    });
  });

  describe('enabled state', () => {
    test('sets enabled state', () => {
      const store = new GuardrailsStore(projectDir);
      store.setEnabled(true, 'project');
      expect(store.isEnabled()).toBe(true);

      store.setEnabled(false, 'project');
      expect(store.isEnabled()).toBe(false);
    });

    test('local overrides project and user', () => {
      const store = new GuardrailsStore(projectDir);
      store.setEnabled(true, 'user');
      store.setEnabled(false, 'project');
      store.setEnabled(true, 'local');

      expect(store.isEnabled()).toBe(true);
    });
  });
});

describe('preset policies', () => {
  test('permissive policy allows most operations', () => {
    const evaluator = new PolicyEvaluator({
      enabled: true,
      policies: [PERMISSIVE_POLICY],
      defaultAction: 'allow',
    });

    expect(evaluator.isToolAllowed('file:write')).toBe(true);
    expect(evaluator.isToolAllowed('connector:notion')).toBe(true);
  });

  test('permissive policy denies dangerous commands', () => {
    const evaluator = new PolicyEvaluator({
      enabled: true,
      policies: [PERMISSIVE_POLICY],
      defaultAction: 'allow',
    });

    const result = evaluator.evaluateToolUse({
      toolName: 'bash',
      toolInput: { command: 'rm -rf /' },
    });
    expect(result.allowed).toBe(false);
  });

  test('restrictive policy requires approval for most', () => {
    const evaluator = new PolicyEvaluator({
      enabled: true,
      policies: [RESTRICTIVE_POLICY],
      defaultAction: 'allow',
    });

    // Read operations should be allowed
    expect(evaluator.isToolAllowed('file:read')).toBe(true);
    expect(evaluator.isToolAllowed('file:list')).toBe(true);

    // Bash should be denied
    expect(evaluator.isToolAllowed('bash')).toBe(false);
  });
});

describe('policy scope precedence', () => {
  test('system has highest precedence', () => {
    expect(POLICY_SCOPE_PRECEDENCE.system).toBeLessThan(POLICY_SCOPE_PRECEDENCE.organization);
    expect(POLICY_SCOPE_PRECEDENCE.organization).toBeLessThan(POLICY_SCOPE_PRECEDENCE.project);
    expect(POLICY_SCOPE_PRECEDENCE.project).toBeLessThan(POLICY_SCOPE_PRECEDENCE.session);
  });
});
