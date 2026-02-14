import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { withTempDir } from './fixtures/helpers';

let spawnSyncMock = mock(() => ({ status: 0, stdout: '/usr/bin/foo\n' }));

mock.module('child_process', () => ({
  spawnSync: (...args: any[]) => spawnSyncMock(...args),
  spawn: () => ({ on: () => {}, kill: () => {} }),
}));

const { loadApiKeyFromSecrets, findExecutable } = await import('../src/voice/utils?voice-utils-test');

describe('voice utils', () => {
  beforeEach(() => {
    spawnSyncMock = mock(() => ({ status: 0, stdout: '/usr/bin/foo\n' }));
  });

  afterAll(() => {
    mock.restore();
  });

  test('loadApiKeyFromSecrets reads from ~/.secrets', async () => {
    await withTempDir(async (dir) => {
      const secretsPath = join(dir, '.secrets');
      await writeFile(secretsPath, 'export TEST_KEY="value"\n', 'utf-8');

      const originalHome = process.env.HOME;
      process.env.HOME = dir;
      const value = loadApiKeyFromSecrets('TEST_KEY');
      process.env.HOME = originalHome;

      expect(value).toBe('value');
    });
  });

  test('loadApiKeyFromSecrets returns undefined when missing', async () => {
    await withTempDir(async (dir) => {
      const originalHome = process.env.HOME;
      process.env.HOME = dir;
      const value = loadApiKeyFromSecrets('MISSING_KEY');
      process.env.HOME = originalHome;

      expect(value).toBeUndefined();
    });
  });

  test('findExecutable returns first path or null', () => {
    spawnSyncMock = mock(() => ({ status: 0, stdout: '/usr/bin/foo\n' }));
    expect(findExecutable('foo')).toBe('/usr/bin/foo');

    spawnSyncMock = mock(() => ({ status: 1, stdout: '' }));
    expect(findExecutable('foo')).toBeNull();
  });
});
