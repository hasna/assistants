import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from './registry';
import { ConnectorAutoRefreshManager, type ConnectorAutoRefreshSchedule } from '../connectors/auto-refresh';

export const connectorAutoRefreshTool: Tool = {
  name: 'connector_autorefresh',
  description: 'Enable, disable, list, or update global auto-refresh schedules for connector auth tokens. Runs in the background and is not tied to a session.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['enable', 'disable', 'remove', 'status', 'list'],
        description: 'Action to perform',
      },
      connector: {
        type: 'string',
        description: 'Connector name (e.g., "notion", "gmail")',
      },
      cron: {
        type: 'string',
        description: 'Cron expression for refresh schedule (e.g., "0 * * * *")',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for cron schedules (optional)',
      },
      intervalMinutes: {
        type: 'number',
        description: 'Interval in minutes (alternative to cron)',
      },
      intervalHours: {
        type: 'number',
        description: 'Interval in hours (alternative to cron)',
      },
      command: {
        type: 'string',
        description: 'Connector command to run (default: "auth refresh")',
      },
    },
    required: ['action'],
  },
};

function buildSchedule(input: Record<string, unknown>): ConnectorAutoRefreshSchedule | undefined {
  if (typeof input.cron === 'string' && input.cron.trim()) {
    const schedule: ConnectorAutoRefreshSchedule = {
      kind: 'cron',
      cron: input.cron.trim(),
    };
    if (typeof input.timezone === 'string' && input.timezone.trim()) {
      schedule.timezone = input.timezone.trim();
    }
    return schedule;
  }
  if (typeof input.intervalHours === 'number' && input.intervalHours > 0) {
    return { kind: 'interval', interval: input.intervalHours, unit: 'hours' };
  }
  if (typeof input.intervalMinutes === 'number' && input.intervalMinutes > 0) {
    return { kind: 'interval', interval: input.intervalMinutes, unit: 'minutes' };
  }
  return undefined;
}

export function createConnectorAutoRefreshExecutor(): ToolExecutor {
  return async (input: Record<string, unknown>): Promise<string> => {
    const action = String(input.action || '').toLowerCase();
    const connector = typeof input.connector === 'string' ? input.connector.trim() : '';
    const manager = ConnectorAutoRefreshManager.getInstance();
    await manager.start();

    if (!action) {
      return JSON.stringify({ error: 'Missing action. Use enable, disable, remove, status, or list.' });
    }

    if (action === 'list') {
      return JSON.stringify({
        count: manager.list().length,
        entries: manager.list(),
      }, null, 2);
    }

    if (!connector) {
      return JSON.stringify({ error: 'Connector name is required for this action.' });
    }

    if (action === 'status') {
      const entry = manager.get(connector);
      return JSON.stringify({
        connector,
        configured: Boolean(entry),
        entry,
      }, null, 2);
    }

    if (action === 'disable') {
      const entry = await manager.disable(connector);
      return JSON.stringify({
        connector,
        disabled: Boolean(entry),
        entry,
      }, null, 2);
    }

    if (action === 'remove') {
      const removed = await manager.remove(connector);
      return JSON.stringify({
        connector,
        removed,
      }, null, 2);
    }

    if (action === 'enable') {
      const schedule = buildSchedule(input);
      const command = typeof input.command === 'string' ? input.command.trim() : undefined;
      const entry = await manager.enable(connector, schedule, command);
      return JSON.stringify({
        connector,
        enabled: true,
        entry,
      }, null, 2);
    }

    return JSON.stringify({ error: `Unknown action: ${action}` });
  };
}

export function registerConnectorAutoRefreshTool(registry: ToolRegistry): void {
  const executor = createConnectorAutoRefreshExecutor();
  registry.register(connectorAutoRefreshTool, executor);
}
