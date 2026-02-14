/**
 * Guardrails tools for assistant use (read-only)
 * Allows assistants to inspect guardrails policies and status
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { GuardrailsStore } from './store';

/**
 * guardrails_list - List all guardrail policies
 */
export const guardrailsListTool: Tool = {
  name: 'guardrails_list',
  description: 'List all guardrail policies with their status, scope, and source location.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * guardrails_get - Get specific policy details
 */
export const guardrailsGetTool: Tool = {
  name: 'guardrails_get',
  description: 'Get detailed information about a specific guardrail policy by ID.',
  parameters: {
    type: 'object',
    properties: {
      policyId: {
        type: 'string',
        description: 'The policy ID to retrieve',
      },
    },
    required: ['policyId'],
  },
};

/**
 * guardrails_status - Get guardrails enabled/disabled status
 */
export const guardrailsStatusTool: Tool = {
  name: 'guardrails_status',
  description: 'Get the current guardrails configuration status: enabled state, default action, and policy count.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * Create executors for guardrails tools
 */
export function createGuardrailsToolExecutors(
  getGuardrailsStore: () => GuardrailsStore | null
): Record<string, ToolExecutor> {
  return {
    guardrails_list: async () => {
      const store = getGuardrailsStore();
      if (!store) {
        return 'Guardrails store is not available.';
      }

      const policies = store.listPolicies();

      if (policies.length === 0) {
        return 'No guardrail policies configured. Only the default system policy is active.';
      }

      const lines: string[] = [];
      lines.push(`## Guardrail Policies (${policies.length})`);
      lines.push('');

      for (const p of policies) {
        const status = p.enabled ? 'enabled' : 'disabled';
        lines.push(`**${p.name || p.id}** (${p.id})`);
        lines.push(`  Status: ${status}`);
        lines.push(`  Scope: ${p.scope}`);
        lines.push(`  Location: ${p.location}`);

        const policy = p.policy;
        if (policy.tools?.rules) {
          const allowRules = policy.tools.rules.filter(r => r.action === 'allow').length;
          const denyRules = policy.tools.rules.filter(r => r.action === 'deny').length;
          if (allowRules > 0) lines.push(`  Allow rules: ${allowRules}`);
          if (denyRules > 0) lines.push(`  Deny rules: ${denyRules}`);
        }
        lines.push('');
      }

      return lines.join('\n');
    },

    guardrails_get: async (input) => {
      const store = getGuardrailsStore();
      if (!store) {
        return 'Guardrails store is not available.';
      }

      const policyId = String(input.policyId || '').trim();
      if (!policyId) {
        return 'Error: policyId is required.';
      }

      const info = store.getPolicy(policyId);
      if (!info) {
        return `Policy ${policyId} not found.`;
      }

      return JSON.stringify({
        id: info.id,
        name: info.name,
        scope: info.scope,
        enabled: info.enabled,
        location: info.location,
        filePath: info.filePath,
        policy: info.policy,
      }, null, 2);
    },

    guardrails_status: async () => {
      const store = getGuardrailsStore();
      if (!store) {
        return 'Guardrails store is not available.';
      }

      const config = store.loadAll();
      const policies = store.listPolicies();

      const lines: string[] = [];
      lines.push('## Guardrails Status');
      lines.push('');
      lines.push(`Enabled: ${config.enabled ? 'yes' : 'no'}`);
      lines.push(`Default action: ${config.defaultAction || 'allow'}`);
      lines.push(`Policies: ${policies.length}`);
      lines.push(`  Enabled: ${policies.filter(p => p.enabled).length}`);
      lines.push(`  Disabled: ${policies.filter(p => !p.enabled).length}`);

      return lines.join('\n');
    },
  };
}

/**
 * All guardrails tools
 */
export const guardrailsTools: Tool[] = [
  guardrailsListTool,
  guardrailsGetTool,
  guardrailsStatusTool,
];

/**
 * Register guardrails tools with a tool registry
 */
export function registerGuardrailsTools(
  registry: ToolRegistry,
  getGuardrailsStore: () => GuardrailsStore | null
): void {
  const executors = createGuardrailsToolExecutors(getGuardrailsStore);

  for (const tool of guardrailsTools) {
    registry.register(tool, executors[tool.name]);
  }
}
