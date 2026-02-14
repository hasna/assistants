/**
 * Webhook tools for assistant use
 * Tools that allow assistants to create, manage, and inspect webhooks
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { WebhooksManager } from './manager';

// ============================================
// Tool Definitions
// ============================================

/**
 * webhook_create - Create a new webhook
 */
export const webhookCreateTool: Tool = {
  name: 'webhook_create',
  description:
    'Create a new webhook endpoint. Returns the URL and secret needed for the external source to send events. The secret is used for HMAC-SHA256 signature verification.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the webhook (e.g., "Gmail notifications")',
      },
      source: {
        type: 'string',
        description: 'Source identifier (e.g., "gmail", "notion", "github", "custom")',
      },
      description: {
        type: 'string',
        description: 'Description of what this webhook handles (optional)',
      },
      eventsFilter: {
        type: 'array',
        description: 'Event types to accept (optional, empty = accept all). Example: ["message.received", "issue.opened"]',
        items: { type: 'string', description: 'Event type name' },
      },
    },
    required: ['name', 'source'],
  },
};

/**
 * webhook_list - List all registered webhooks
 */
export const webhookListTool: Tool = {
  name: 'webhook_list',
  description: 'List all registered webhooks with their status, source, and delivery counts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

/**
 * webhook_get - Get details of a specific webhook
 */
export const webhookGetTool: Tool = {
  name: 'webhook_get',
  description: 'Get full details of a webhook including its secret, URL, events filter, and delivery count.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The webhook ID (e.g., whk_abc123)',
      },
    },
    required: ['id'],
  },
};

/**
 * webhook_update - Update a webhook
 */
export const webhookUpdateTool: Tool = {
  name: 'webhook_update',
  description: 'Update a webhook registration. Can change name, description, events filter, or status (active/paused).',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The webhook ID to update',
      },
      name: {
        type: 'string',
        description: 'New name (optional)',
      },
      description: {
        type: 'string',
        description: 'New description (optional)',
      },
      eventsFilter: {
        type: 'array',
        description: 'New events filter (optional)',
        items: { type: 'string', description: 'Event type name' },
      },
      status: {
        type: 'string',
        description: 'New status: active or paused (optional)',
        enum: ['active', 'paused'],
      },
    },
    required: ['id'],
  },
};

/**
 * webhook_delete - Delete a webhook
 */
export const webhookDeleteTool: Tool = {
  name: 'webhook_delete',
  description: 'Delete a webhook registration and all its event history.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The webhook ID to delete',
      },
    },
    required: ['id'],
  },
};

/**
 * webhook_events - List recent events for a webhook
 */
export const webhookEventsTool: Tool = {
  name: 'webhook_events',
  description: 'List recent events received by a webhook. Shows event type, payload preview, and status.',
  parameters: {
    type: 'object',
    properties: {
      webhookId: {
        type: 'string',
        description: 'The webhook ID to list events for',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of events to return (default: 20)',
      },
      pendingOnly: {
        type: 'boolean',
        description: 'Only show pending (unprocessed) events (default: false)',
      },
    },
    required: ['webhookId'],
  },
};

/**
 * webhook_test - Send a test event to a webhook
 */
export const webhookTestTool: Tool = {
  name: 'webhook_test',
  description: 'Send a test event to a webhook to verify it is working correctly.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The webhook ID to send a test event to',
      },
    },
    required: ['id'],
  },
};

// ============================================
// Tool Executors
// ============================================

/**
 * Create executors for webhook tools
 */
export function createWebhookToolExecutors(
  getWebhooksManager: () => WebhooksManager | null
): Record<string, ToolExecutor> {
  return {
    webhook_create: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured. Set webhooks.enabled: true in config.';
      }

      const name = String(input.name || '').trim();
      const source = String(input.source || '').trim();
      const description = input.description ? String(input.description).trim() : undefined;
      const eventsFilter = Array.isArray(input.eventsFilter) ? input.eventsFilter.map(String) : undefined;

      if (!name) return 'Error: Webhook name is required.';
      if (!source) return 'Error: Source identifier is required.';

      const result = await manager.create({ name, source, description, eventsFilter });

      if (result.success) {
        const lines: string[] = [];
        lines.push(`Webhook created successfully!`);
        lines.push('');
        lines.push(`**ID:** ${result.webhookId}`);
        lines.push(`**URL:** ${result.url}`);
        lines.push(`**Secret:** ${result.secret}`);
        lines.push('');
        lines.push('**Setup instructions for the external source:**');
        lines.push(`1. Set webhook URL to: \`<your-base-url>${result.url}\``);
        lines.push(`2. Set signing secret to: \`${result.secret}\``);
        lines.push('3. Include these headers with each POST:');
        lines.push('   - `X-Webhook-Signature`: HMAC-SHA256 hex digest of the JSON body');
        lines.push('   - `X-Webhook-Timestamp`: ISO 8601 timestamp');
        lines.push('   - `X-Webhook-Event`: Event type name');
        return lines.join('\n');
      }
      return `Error: ${result.message}`;
    },

    webhook_list: async () => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      try {
        const webhooks = await manager.list();

        if (webhooks.length === 0) {
          return 'No webhooks registered. Use webhook_create to create one.';
        }

        const lines: string[] = [];
        lines.push(`## Webhooks (${webhooks.length})`);
        lines.push('');

        for (const wh of webhooks) {
          const statusIcon = wh.status === 'active' ? '●' : wh.status === 'paused' ? '◐' : '✗';
          const statusColor = wh.status === 'active' ? '' : ` [${wh.status}]`;
          const lastDelivery = wh.lastDeliveryAt
            ? new Date(wh.lastDeliveryAt).toLocaleDateString()
            : 'never';

          lines.push(`${statusIcon} **${wh.name}** (${wh.id})${statusColor}`);
          lines.push(`   Source: ${wh.source} | Events: ${wh.deliveryCount} | Last: ${lastDelivery}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing webhooks: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    webhook_get: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) return 'Error: Webhook ID is required.';

      try {
        const webhook = await manager.get(id);
        if (!webhook) {
          return `Webhook ${id} not found.`;
        }

        const lines: string[] = [];
        lines.push(`## Webhook: ${webhook.name}`);
        lines.push('');
        lines.push(`**ID:** ${webhook.id}`);
        lines.push(`**Source:** ${webhook.source}`);
        lines.push(`**Status:** ${webhook.status}`);
        if (webhook.description) {
          lines.push(`**Description:** ${webhook.description}`);
        }
        lines.push(`**Secret:** ${webhook.secret}`);
        lines.push(`**URL:** /api/v1/webhooks/receive/${webhook.id}`);
        lines.push(`**Events Filter:** ${webhook.eventsFilter.length > 0 ? webhook.eventsFilter.join(', ') : 'all'}`);
        lines.push(`**Deliveries:** ${webhook.deliveryCount}`);
        lines.push(`**Created:** ${new Date(webhook.createdAt).toLocaleString()}`);
        if (webhook.lastDeliveryAt) {
          lines.push(`**Last Delivery:** ${new Date(webhook.lastDeliveryAt).toLocaleString()}`);
        }

        return lines.join('\n');
      } catch (error) {
        return `Error getting webhook: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    webhook_update: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) return 'Error: Webhook ID is required.';

      const name = input.name ? String(input.name).trim() : undefined;
      const description = input.description ? String(input.description).trim() : undefined;
      const eventsFilter = Array.isArray(input.eventsFilter) ? input.eventsFilter.map(String) : undefined;
      const status = input.status as 'active' | 'paused' | undefined;

      const result = await manager.update({ id, name, description, eventsFilter, status });
      return result.message;
    },

    webhook_delete: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) return 'Error: Webhook ID is required.';

      const result = await manager.delete(id);
      return result.message;
    },

    webhook_events: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      const webhookId = String(input.webhookId || '').trim();
      if (!webhookId) return 'Error: Webhook ID is required.';

      const limit = typeof input.limit === 'number' ? input.limit : 20;
      const pendingOnly = input.pendingOnly === true;

      try {
        const events = await manager.listEvents(webhookId, { limit, pendingOnly });

        if (events.length === 0) {
          return pendingOnly
            ? 'No pending events for this webhook.'
            : 'No events received for this webhook.';
        }

        const lines: string[] = [];
        lines.push(`## Events for ${webhookId} (${events.length})`);
        lines.push('');

        for (const evt of events) {
          const statusIcon = evt.status === 'pending' ? '⏳' : evt.status === 'injected' ? '📨' : evt.status === 'processed' ? '✓' : '✗';
          const date = new Date(evt.timestamp).toLocaleString();

          lines.push(`${statusIcon} **${evt.eventType}** (${evt.id})`);
          lines.push(`   Source: ${evt.source} | Status: ${evt.status} | ${date}`);
          lines.push(`   Preview: ${evt.preview}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing events: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    webhook_test: async (input) => {
      const manager = getWebhooksManager();
      if (!manager) {
        return 'Error: Webhooks are not enabled or configured.';
      }

      const id = String(input.id || '').trim();
      if (!id) return 'Error: Webhook ID is required.';

      const result = await manager.sendTestEvent(id);
      if (result.success) {
        return `Test event sent successfully! Event ID: ${result.eventId}, Delivery ID: ${result.deliveryId}`;
      }
      return `Error: ${result.message}`;
    },
  };
}

/**
 * All webhook tools
 */
export const webhookTools: Tool[] = [
  webhookCreateTool,
  webhookListTool,
  webhookGetTool,
  webhookUpdateTool,
  webhookDeleteTool,
  webhookEventsTool,
  webhookTestTool,
];

/**
 * Register webhook tools with a tool registry
 */
export function registerWebhookTools(
  registry: ToolRegistry,
  getWebhooksManager: () => WebhooksManager | null
): void {
  const executors = createWebhookToolExecutors(getWebhooksManager);

  for (const tool of webhookTools) {
    registry.register(tool, executors[tool.name]);
  }
}
