import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { join } from 'path';
import { createSkill } from '../src/skills/create';

describe('createSkill', () => {
  test('normalizes skill names and strips unsafe characters', async () => {
    const tmp = await mkdtemp('/tmp/assistants-skill-');
    try {
      const result = await createSkill({
        name: 'My @ Tool!',
        cwd: tmp,
        scope: 'project',
        description: 'Test skill',
      });
      expect(result.name).toBe('my-tool');
      expect(result.directory.endsWith('skill-my-tool')).toBe(true);
      const stats = await stat(result.filePath);
      expect(stats.isFile()).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('creates skill in .skill/ for project scope', async () => {
    const tmp = await mkdtemp('/tmp/assistants-skill-');
    try {
      const result = await createSkill({
        name: 'my-helper',
        cwd: tmp,
        scope: 'project',
      });
      expect(result.directory).toBe(join(tmp, '.skill', 'skill-my-helper'));
      expect(result.filePath).toBe(join(tmp, '.skill', 'skill-my-helper', 'SKILL.md'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('handles skill prefix and writes frontmatter', async () => {
    const tmp = await mkdtemp('/tmp/assistants-skill-');
    try {
      const result = await createSkill({
        name: 'skill-demo',
        cwd: tmp,
        scope: 'project',
        description: 'Demo',
        allowedTools: ['read'],
        argumentHint: '[path]',
      });
      const content = await readFile(result.filePath, 'utf8');
      expect(content).toContain('name: demo');
      expect(content).toContain('description: Demo');
      expect(content).toContain('allowed-tools:');
      expect(content).toContain('- read');
      expect(content).toContain('argument-hint: [path]');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('accepts case-insensitive skill prefix', async () => {
    const tmp = await mkdtemp('/tmp/assistants-skill-');
    try {
      const result = await createSkill({
        name: 'Skill-Example',
        cwd: tmp,
        scope: 'project',
      });
      expect(result.name).toBe('example');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('rejects names containing the word skill', async () => {
    const tmp = await mkdtemp('/tmp/assistants-skill-');
    try {
      await expect(
        createSkill({
          name: 'skill builder',
          cwd: tmp,
          scope: 'project',
        })
      ).rejects.toThrow('Skill name should not include the word "skill".');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
