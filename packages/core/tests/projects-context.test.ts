import { describe, expect, test } from 'bun:test';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { withTempDir } from './fixtures/helpers';
import { buildProjectContext } from '../src/projects/context';
import type { ProjectRecord } from '../src/projects/store';

const buildProject = (overrides?: Partial<ProjectRecord>): ProjectRecord => ({
  id: 'project-1',
  name: 'Demo Project',
  description: 'A test project',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  context: [],
  plans: [],
  ...overrides,
});

describe('buildProjectContext', () => {
  test('renders file, connector, generic entries, and plans', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'notes.txt');
      await writeFile(filePath, 'Line 1\nLine 2', 'utf-8');

      const project = buildProject({
        context: [
          { id: 'file-1', type: 'file', value: 'notes.txt', addedAt: Date.now() },
          { id: 'conn-1', type: 'connector', value: 'db', addedAt: Date.now() },
          { id: 'note-1', type: 'note', value: 'Remember to test', label: 'Reminder', addedAt: Date.now() },
        ],
        plans: [
          {
            id: 'plan-1',
            title: 'Launch',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            steps: [
              { id: 'step-1', text: 'Build', status: 'doing', createdAt: Date.now(), updatedAt: Date.now() },
            ],
          },
        ],
      });

      const context = await buildProjectContext(project, {
        cwd: dir,
        connectors: [
          {
            name: 'db',
            description: 'Database connector',
            cli: 'dbctl',
            commands: [
              { name: 'list', description: 'List databases' },
              { name: 'status', description: 'Check status' },
            ],
          },
        ],
      });

      expect(context).toContain('## Project: Demo Project');
      expect(context).toContain('### Project Context');
      expect(context).toContain('- File: notes.txt');
      expect(context).toContain('Database connector');
      expect(context).toContain('- note: Reminder');
      expect(context).toContain('### Plans');
      expect(context).toContain('- Launch (1 steps)');
      expect(context).toContain('[doing] Build');
    });
  });

  test('handles invalid file paths and truncation', async () => {
    await withTempDir(async (dir) => {
      const filePath = join(dir, 'large.txt');
      await writeFile(filePath, 'x'.repeat(20), 'utf-8');

      const project = buildProject({
        context: [
          { id: 'file-1', type: 'file', value: 'large.txt', addedAt: Date.now() },
          { id: 'file-2', type: 'file', value: '../outside.txt', addedAt: Date.now() },
        ],
      });

      const context = await buildProjectContext(project, { cwd: dir, maxFileBytes: 5 });

      expect(context).toContain('... [truncated');
      expect(context).toContain('unavailable');
    });
  });

  test('expands home shortcut in file paths', async () => {
    await withTempDir(async (dir) => {
      const homeFile = join(dir, 'home.txt');
      await writeFile(homeFile, 'home', 'utf-8');

      const project = buildProject({
        context: [
          { id: 'file-1', type: 'file', value: '~/home.txt', addedAt: Date.now() },
        ],
      });

      const originalHome = process.env.HOME;
      process.env.HOME = dir;
      const context = await buildProjectContext(project, { cwd: dir });
      process.env.HOME = originalHome;

      expect(context).toContain('- File: ~/home.txt');
      expect(context).toContain('home');
    });
  });
});
