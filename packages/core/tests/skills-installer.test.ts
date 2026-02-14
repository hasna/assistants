import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { resolveSkillRoot, ensurePackageJson, listInstalled } from '../src/skills/installer';

describe('SkillInstaller', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-installer-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('resolveSkillRoot', () => {
    test('returns .skill/ for project scope', () => {
      const root = resolveSkillRoot('project', tempDir);
      expect(root).toBe(join(tempDir, '.skill'));
    });

    test('returns ~/.skill/ for global scope', () => {
      const root = resolveSkillRoot('global');
      expect(root).toBe(join(homedir(), '.skill'));
    });

    test('uses cwd if provided for project scope', () => {
      const root = resolveSkillRoot('project', '/some/project');
      expect(root).toBe('/some/project/.skill');
    });
  });

  describe('ensurePackageJson', () => {
    test('creates package.json if missing', async () => {
      const dir = join(tempDir, '.skill');
      await ensurePackageJson(dir);

      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('assistants-skills');
      expect(pkg.private).toBe(true);
      expect(pkg.dependencies).toEqual({});
    });

    test('creates .gitignore with node_modules/', async () => {
      const dir = join(tempDir, '.skill');
      await ensurePackageJson(dir);

      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('node_modules/');
    });

    test('does not overwrite existing package.json', async () => {
      const dir = join(tempDir, '.skill');
      await mkdir(dir, { recursive: true });
      const pkgPath = join(dir, 'package.json');
      await writeFile(pkgPath, JSON.stringify({ name: 'custom', private: true, dependencies: { foo: '1.0.0' } }));

      await ensurePackageJson(dir);

      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('custom');
      expect(pkg.dependencies.foo).toBe('1.0.0');
    });

    test('does not overwrite existing .gitignore', async () => {
      const dir = join(tempDir, '.skill');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, '.gitignore'), '*.log\n');

      await ensurePackageJson(dir);

      const gitignore = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(gitignore).toBe('*.log\n');
    });
  });

  describe('listInstalled', () => {
    test('returns empty array when no package.json exists', async () => {
      const result = await listInstalled('project', tempDir);
      expect(result).toEqual([]);
    });

    test('returns installed packages from package.json', async () => {
      const dir = join(tempDir, '.skill');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({
        name: 'assistants-skills',
        private: true,
        dependencies: {
          '@hasnaxyz/skill-deepresearch': '^0.2.0',
          '@hasnaxyz/skill-npmpublish': '^0.1.0',
        },
      }));

      const result = await listInstalled('project', tempDir);
      expect(result.length).toBe(2);
      expect(result[0].packageName).toBe('@hasnaxyz/skill-deepresearch');
      expect(result[0].version).toBe('^0.2.0');
      expect(result[1].packageName).toBe('@hasnaxyz/skill-npmpublish');
    });
  });
});
