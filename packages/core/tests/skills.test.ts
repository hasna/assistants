import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { SkillLoader } from '../src/skills/loader';
import { SkillExecutor } from '../src/skills/executor';
import type { Skill } from '@hasna/assistants-shared';
import { join } from 'path';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';

describe('SkillLoader', () => {
  let loader: SkillLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new SkillLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'assistants-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('loadSkillFile', () => {
    test('should load skill with full frontmatter', async () => {
      const skillDir = join(tempDir, 'test-skill');
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: my-skill
description: A test skill
argument-hint: [arg1] [arg2]
allowed-tools: bash, notion
user-invocable: true
model: claude-3-opus
---

# My Skill

Instructions for the skill.
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });

      expect(skill).not.toBeNull();
      expect(skill?.name).toBe('my-skill');
      expect(skill?.description).toBe('A test skill');
      expect(skill?.argumentHint).toBe('[arg1] [arg2]');
      expect(skill?.allowedTools).toEqual(['bash', 'notion']);
      expect(skill?.userInvocable).toBe(true);
      expect(skill?.model).toBe('claude-3-opus');
      expect(skill?.content).toContain('My Skill');
    });

    test('should parse allowed-tools as array', async () => {
      const skillDir = join(tempDir, 'array-skill');
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: array-skill
allowed-tools: [bash, "notion"]
---

Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });
      expect(skill?.allowedTools).toEqual(['bash', 'notion']);
    });

    test('should format argument-hint when provided as array', async () => {
      const skillDir = join(tempDir, 'hint-array');
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
name: hint-array
argument-hint: [one, two]
---

Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });
      expect(skill?.argumentHint).toBe('[one, two]');
    });

    test('should infer name from directory when not in frontmatter', async () => {
      const skillDir = join(tempDir, 'calendar');
      await mkdir(skillDir, { recursive: true });

      const skillContent = `---
description: Calendar management
---

View and manage calendar events.
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });

      expect(skill?.name).toBe('calendar');
    });

    test('should infer description from first paragraph when not in frontmatter', async () => {
      const skillDir = join(tempDir, 'notes');
      await mkdir(skillDir, { recursive: true });

      // Content without heading - first paragraph becomes description
      const skillContent = `---
name: notes
---

Quick note management tool.

## Usage

More instructions here.
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });

      // First paragraph after frontmatter
      expect(skill?.description).toBe('Quick note management tool.');
    });

    test('should handle skill without frontmatter', async () => {
      const skillDir = join(tempDir, 'simple');
      await mkdir(skillDir, { recursive: true });

      const skillContent = `# Simple Skill

Just some instructions without frontmatter.
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true });

      expect(skill?.name).toBe('simple');
      expect(skill?.content).toContain('Simple Skill');
    });

    test('should return null for non-existent file', async () => {
      const skill = await loader.loadSkillFile(join(tempDir, 'non-existent', 'SKILL.md'), { includeContent: true });
      expect(skill).toBeNull();
    });

    test('should set source, packageName, and version from extra param', async () => {
      const skillDir = join(tempDir, 'npm-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: research
description: Deep research
---
Content`);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: true }, {
        source: 'npm',
        packageName: '@hasnaxyz/skill-research',
        version: '1.2.3',
      });

      expect(skill?.source).toBe('npm');
      expect(skill?.packageName).toBe('@hasnaxyz/skill-research');
      expect(skill?.version).toBe('1.2.3');
    });
  });

  describe('loadFromDirectory', () => {
    test('should load multiple skills from directory', async () => {
      const skillsDir = join(tempDir, 'skills');
      await mkdir(join(skillsDir, 'skill1'), { recursive: true });
      await mkdir(join(skillsDir, 'skill2'), { recursive: true });

      await writeFile(join(skillsDir, 'skill1', 'SKILL.md'), `---
name: skill1
description: First skill
---
Content 1`);

      await writeFile(join(skillsDir, 'skill2', 'SKILL.md'), `---
name: skill2
description: Second skill
---
Content 2`);

      await loader.loadFromDirectory(skillsDir);

      const skills = loader.getSkills();
      expect(skills.length).toBe(2);
      expect(skills.map((s) => s.name).sort()).toEqual(['skill1', 'skill2']);
    });

    test('should load skills from skill-* directories', async () => {
      const skillsDir = join(tempDir, 'skills');
      await mkdir(join(skillsDir, 'skill-alpha'), { recursive: true });
      await writeFile(join(skillsDir, 'skill-alpha', 'SKILL.md'), `---
name: alpha
description: Alpha skill
---
Content`);

      await loader.loadFromDirectory(skillsDir);
      expect(loader.getSkill('alpha')).toBeDefined();
    });

    test('should handle non-existent directory gracefully', async () => {
      // Should not throw, just silently skip
      await loader.loadFromDirectory(join(tempDir, 'non-existent'));
      expect(loader.getSkills()).toEqual([]);
    });
  });

  describe('metadata-only loading', () => {
    test('should load descriptions without content', async () => {
      const skillDir = join(tempDir, 'meta-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: meta-skill
description: Metadata only
---

Full content here.`);

      const skill = await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: false });
      expect(skill?.description).toBe('Metadata only');
      expect(skill?.content).toBe('');
      expect(skill?.contentLoaded).toBe(false);
    });

    test('should hydrate content when requested', async () => {
      const skillDir = join(tempDir, 'hydrate-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: hydrate-skill
description: Needs content
---

Hydrated content.`);

      await loader.loadSkillFile(join(skillDir, 'SKILL.md'), { includeContent: false });
      const hydrated = await loader.ensureSkillContent('hydrate-skill');
      expect(hydrated?.contentLoaded).toBe(true);
      expect(hydrated?.content).toContain('Hydrated content');
    });
  });

  describe('loadAll', () => {
    test('should load global and project skills from .skill/ directories', async () => {
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      // Global local skill
      const globalSkillDir = join(tempDir, '.skill', 'skill-global-tool');
      await mkdir(globalSkillDir, { recursive: true });
      await writeFile(join(globalSkillDir, 'SKILL.md'), `---
name: global-tool
description: Global skill
---
Content`);

      // Project local skill
      const projectDir = join(tempDir, 'project');
      const projectSkillDir = join(projectDir, '.skill', 'skill-project-tool');
      await mkdir(projectSkillDir, { recursive: true });
      await writeFile(join(projectSkillDir, 'SKILL.md'), `---
name: project-tool
description: Project skill
---
Content`);

      await loader.loadAll(projectDir, { includeContent: true });

      const skills = loader.getSkills().map((s) => s.name).sort();
      expect(skills).toEqual(['global-tool', 'project-tool']);

      process.env.HOME = originalHome;
    });

    test('should discover npm skills from node_modules/@hasnaxyz/skill-*', async () => {
      const originalHome = process.env.HOME;
      process.env.HOME = tempDir;

      // Simulate an npm-installed skill in project .skill/
      const projectDir = join(tempDir, 'project');
      const npmSkillDir = join(projectDir, '.skill', 'node_modules', '@hasnaxyz', 'skill-deepresearch');
      await mkdir(npmSkillDir, { recursive: true });
      await writeFile(join(npmSkillDir, 'SKILL.md'), `---
name: deepresearch
description: Deep research skill
---
Content`);
      await writeFile(join(npmSkillDir, 'package.json'), JSON.stringify({
        name: '@hasnaxyz/skill-deepresearch',
        version: '0.2.1',
      }));

      await loader.loadAll(projectDir, { includeContent: true });

      const skill = loader.getSkill('deepresearch');
      expect(skill).toBeDefined();
      expect(skill?.source).toBe('npm');
      expect(skill?.packageName).toBe('@hasnaxyz/skill-deepresearch');
      expect(skill?.version).toBe('0.2.1');

      process.env.HOME = originalHome;
    });
  });

  describe('getSkill and getSkills', () => {
    test('should return undefined for non-existent skill', () => {
      expect(loader.getSkill('non-existent')).toBeUndefined();
    });

    test('should return empty array when no skills loaded', () => {
      expect(loader.getSkills()).toEqual([]);
    });
  });

  describe('getUserInvocableSkills', () => {
    test('should filter out non-user-invocable skills', async () => {
      const skillsDir = join(tempDir, 'skills');
      await mkdir(join(skillsDir, 'public'), { recursive: true });
      await mkdir(join(skillsDir, 'internal'), { recursive: true });

      await writeFile(join(skillsDir, 'public', 'SKILL.md'), `---
name: public
description: Public skill
user-invocable: true
---
Content`);

      await writeFile(join(skillsDir, 'internal', 'SKILL.md'), `---
name: internal
description: Internal skill
user-invocable: false
---
Content`);

      await loader.loadFromDirectory(skillsDir);

      const allSkills = loader.getSkills();
      const userSkills = loader.getUserInvocableSkills();

      expect(allSkills.length).toBe(2);
      expect(userSkills.length).toBe(1);
      expect(userSkills[0].name).toBe('public');
    });
  });

  describe('getSkillDescriptions', () => {
    test('should format skill descriptions', async () => {
      const skillsDir = join(tempDir, 'skills');
      await mkdir(join(skillsDir, 'calendar'), { recursive: true });

      await writeFile(join(skillsDir, 'calendar', 'SKILL.md'), `---
name: calendar
description: View and manage calendar
argument-hint: [today|tomorrow|week]
---
Content`);

      await loader.loadFromDirectory(skillsDir);

      const descriptions = loader.getSkillDescriptions();

      expect(descriptions).toContain('Available skills');
      expect(descriptions).toContain('/calendar');
      expect(descriptions).toContain('[today|tomorrow|week]');
      expect(descriptions).toContain('View and manage calendar');
    });

    test('should return empty string when no skills', () => {
      expect(loader.getSkillDescriptions()).toBe('');
    });
  });
});

describe('SkillExecutor', () => {
  let executor: SkillExecutor;

  beforeEach(() => {
    executor = new SkillExecutor();
  });

  const createSkill = (overrides: Partial<Skill> = {}): Skill => ({
    name: 'test',
    description: 'Test skill',
    content: 'Default content',
    filePath: '/path/to/skill.md',
    ...overrides,
  });

  describe('prepare', () => {
    test('should substitute $ARGUMENTS with all args', async () => {
      const skill = createSkill({
        content: 'Search for: $ARGUMENTS',
      });

      const result = await executor.prepare(skill, ['hello', 'world']);

      expect(result).toBe('Search for: hello world');
    });

    test('should substitute positional args $0, $1', async () => {
      // Include $ARGUMENTS to prevent auto-append
      const skill = createSkill({
        content: 'First: $0, Second: $1 (all: $ARGUMENTS)',
      });

      const result = await executor.prepare(skill, ['one', 'two']);

      expect(result).toBe('First: one, Second: two (all: one two)');
    });

    test('should substitute $ARGUMENTS[n]', async () => {
      // $ARGUMENTS[n] doesn't count as $ARGUMENTS for auto-append check
      // so we need to test this expects the appended ARGUMENTS
      const skill = createSkill({
        content: 'A: $ARGUMENTS[0], B: $ARGUMENTS[1]',
      });

      const result = await executor.prepare(skill, ['first', 'second']);

      // $ARGUMENTS[n] gets substituted, but $ARGUMENTS is not in content
      // So the implementation checks for literal $ARGUMENTS, not $ARGUMENTS[n]
      expect(result).toContain('A: first, B: second');
    });

    test('should append arguments if $ARGUMENTS not in content', async () => {
      const skill = createSkill({
        content: 'Static content',
      });

      const result = await executor.prepare(skill, ['arg1', 'arg2']);

      expect(result).toContain('Static content');
      expect(result).toContain('ARGUMENTS: arg1 arg2');
    });

    test('should not append arguments if no args provided', async () => {
      const skill = createSkill({
        content: 'Static content',
      });

      const result = await executor.prepare(skill, []);

      expect(result).toBe('Static content');
    });

    test('should handle dynamic context markers', async () => {
      // Use a real directory so the cd command works
      const skill = createSkill({
        // Pattern is !`command` - exclamation before backtick
        content: 'Files: !`echo test`',
        filePath: `${process.cwd()}/test-skill.md`,
      });

      const result = await executor.prepare(skill, []);

      // The command output replaces the marker
      expect(result).toContain('Files: test');
    });

    test('should handle multiple dynamic context markers', async () => {
      // Use a real directory so the cd command works
      const skill = createSkill({
        // Pattern is !`command` - exclamation before backtick
        content: 'A: !`echo first` and B: !`echo second`',
        filePath: `${process.cwd()}/test-skill.md`,
      });

      const result = await executor.prepare(skill, []);

      expect(result).toContain('A: first');
      expect(result).toContain('B: second');
    });

    test('should include error message when dynamic context command fails', async () => {
      const skill = createSkill({
        content: 'Result: !`nonexistent_command_xyz`',
        filePath: `${process.cwd()}/test-skill.md`,
      });

      const result = await executor.prepare(skill, []);

      expect(result).toContain('Command failed');
    });

    test('should return content unchanged when no dynamic context markers exist', async () => {
      const result = await (executor as any).executeDynamicContext(
        'No dynamic content here',
        `${process.cwd()}/test-skill.md`
      );
      expect(result).toBe('No dynamic content here');
    });
  });

  describe('shouldAutoInvoke', () => {
    test('should return false if disableModelInvocation is true', () => {
      const skill = createSkill({
        description: 'Calendar events today tomorrow',
        disableModelInvocation: true,
      });

      const result = executor.shouldAutoInvoke(skill, 'show me my calendar events for today');

      expect(result).toBe(false);
    });

    test('should return true when keywords match', () => {
      const skill = createSkill({
        description: 'View calendar events for today',
      });

      const result = executor.shouldAutoInvoke(skill, 'show calendar events today');

      // Should match 'calendar', 'events', 'today'
      expect(result).toBe(true);
    });

    test('should return false when not enough keywords match', () => {
      const skill = createSkill({
        description: 'View calendar events for today',
      });

      const result = executor.shouldAutoInvoke(skill, 'what is the weather');

      expect(result).toBe(false);
    });

    test('should be case insensitive', () => {
      const skill = createSkill({
        description: 'Search Notion pages',
      });

      const result = executor.shouldAutoInvoke(skill, 'SEARCH my NOTION PAGES');

      expect(result).toBe(true);
    });

    test('should ignore short keywords', () => {
      const skill = createSkill({
        description: 'a to do app for task management',
      });

      // 'a' and 'to' are too short (<=3), only 'task' and 'management' count
      const result = executor.shouldAutoInvoke(skill, 'a to task management app');

      expect(result).toBe(true);
    });
  });
});
