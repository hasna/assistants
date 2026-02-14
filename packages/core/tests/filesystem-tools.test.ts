import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { FilesystemTools } from '../src/tools/filesystem';

describe('Filesystem tools', () => {
  test('read normalizes CRLF line endings', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'assistants-fs-'));
    try {
      const filePath = join(tempDir, 'sample.txt');
      await writeFile(filePath, 'line1\r\nline2\r\n');
      const output = await FilesystemTools.readExecutor({ path: filePath, cwd: tempDir } as any);
      expect(output).not.toContain('\r');
      expect(output).toContain('line1');
      expect(output).toContain('line2');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('read expands home directory paths', async () => {
    const originalHome = process.env.HOME;
    const homeDir = await mkdtemp(join(tmpdir(), 'assistants-home-'));
    try {
      process.env.HOME = homeDir;
      const filePath = join(homeDir, 'note.txt');
      await writeFile(filePath, 'hello');
      const output = await FilesystemTools.readExecutor({ path: '~/note.txt', cwd: '/' } as any);
      expect(output).toContain('hello');
    } finally {
      process.env.HOME = originalHome;
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});
