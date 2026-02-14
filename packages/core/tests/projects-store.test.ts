import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { deleteProject, readProject } from '../src/projects/store';
import { closeDatabase, resetDatabaseSingleton } from '../src/database';

describe('Project store', () => {
  let tempDir: string;
  let originalAssistantsDir: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-projects-'));
    originalAssistantsDir = process.env.ASSISTANTS_DIR;
    process.env.ASSISTANTS_DIR = tempDir;
    resetDatabaseSingleton();
  });

  afterEach(async () => {
    closeDatabase();
    resetDatabaseSingleton();
    process.env.ASSISTANTS_DIR = originalAssistantsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  test('handles non-existent project ids', async () => {
    const badId = '../escape';
    const read = await readProject(tempDir, badId);
    expect(read).toBeNull();
    const deleted = await deleteProject(tempDir, badId);
    expect(deleted).toBe(false);
  });
});
