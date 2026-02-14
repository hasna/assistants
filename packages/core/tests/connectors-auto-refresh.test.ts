import { describe, expect, test } from 'bun:test';
import type { Connector } from '@hasna/assistants-shared';
import { ConnectorAutoRefreshManager } from '../src/connectors/auto-refresh';
import { withTempDir } from './fixtures/helpers';

describe('ConnectorAutoRefreshManager', () => {
  test('enable, disable, remove lifecycle', async () => {
    await withTempDir(async (dir) => {
      const previousDir = process.env.ASSISTANTS_DIR;
      process.env.ASSISTANTS_DIR = dir;
      (ConnectorAutoRefreshManager as any).instance = null;

      const manager = ConnectorAutoRefreshManager.getInstance();
      const entry = await manager.enable('notion', { kind: 'interval', interval: 15, unit: 'minutes' });

      expect(entry.enabled).toBe(true);
      expect(entry.connector).toBe('notion');
      expect(manager.list().length).toBe(1);

      const disabled = await manager.disable('notion');
      expect(disabled?.enabled).toBe(false);

      const removed = await manager.remove('notion');
      expect(removed).toBe(true);

      if (previousDir === undefined) {
        delete process.env.ASSISTANTS_DIR;
      } else {
        process.env.ASSISTANTS_DIR = previousDir;
      }
    });
  });

  test('buildPromptSection summarizes configured connectors', async () => {
    await withTempDir(async (dir) => {
      const previousDir = process.env.ASSISTANTS_DIR;
      process.env.ASSISTANTS_DIR = dir;
      (ConnectorAutoRefreshManager as any).instance = null;

      const manager = ConnectorAutoRefreshManager.getInstance();
      await manager.enable('gmail', { kind: 'interval', interval: 30, unit: 'minutes' });

      const connectors: Connector[] = [
        {
          name: 'gmail',
          cli: 'connect-gmail',
          description: 'Gmail connector',
          commands: [],
        },
      ];

      const prompt = manager.buildPromptSection(connectors);
      expect(prompt).toBeTruthy();
      expect(prompt).toContain('Connector Auto-Refresh');
      expect(prompt).toContain('gmail');
      expect(prompt).toContain('enabled');
      expect(prompt).toContain('connector_autorefresh');

      if (previousDir === undefined) {
        delete process.env.ASSISTANTS_DIR;
      } else {
        process.env.ASSISTANTS_DIR = previousDir;
      }
    });
  });

  test('supports cron schedules', async () => {
    await withTempDir(async (dir) => {
      const previousDir = process.env.ASSISTANTS_DIR;
      process.env.ASSISTANTS_DIR = dir;
      (ConnectorAutoRefreshManager as any).instance = null;

      const manager = ConnectorAutoRefreshManager.getInstance();
      const entry = await manager.enable('notion', { kind: 'cron', cron: '*/5 * * * *' });

      expect(entry.schedule.kind).toBe('cron');
      expect(entry.nextRunAt).toBeDefined();

      if (previousDir === undefined) {
        delete process.env.ASSISTANTS_DIR;
      } else {
        process.env.ASSISTANTS_DIR = previousDir;
      }
    });
  });
});
