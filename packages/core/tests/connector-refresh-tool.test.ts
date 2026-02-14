import { describe, expect, test } from 'bun:test';
import { ConnectorAutoRefreshManager } from '../src/connectors/auto-refresh';
import { createConnectorAutoRefreshExecutor } from '../src/tools/connector-refresh';
import { withTempDir } from './fixtures/helpers';

describe('connector_autorefresh tool', () => {
  test('enables and lists schedules', async () => {
    await withTempDir(async (dir) => {
      const previousDir = process.env.ASSISTANTS_DIR;
      process.env.ASSISTANTS_DIR = dir;
      (ConnectorAutoRefreshManager as any).instance = null;

      const executor = createConnectorAutoRefreshExecutor();
      const enableRaw = await executor({
        action: 'enable',
        connector: 'slack',
        intervalMinutes: 10,
      });
      const enable = JSON.parse(enableRaw);

      expect(enable.enabled).toBe(true);
      expect(enable.entry.connector).toBe('slack');

      const listRaw = await executor({ action: 'list' });
      const list = JSON.parse(listRaw);

      expect(list.count).toBeGreaterThan(0);
      expect(list.entries.some((entry: any) => entry.connector === 'slack')).toBe(true);

      await ConnectorAutoRefreshManager.getInstance().stop();

      if (previousDir === undefined) {
        delete process.env.ASSISTANTS_DIR;
      } else {
        process.env.ASSISTANTS_DIR = previousDir;
      }
    });
  });
});
