import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { readFile, stat } from 'fs/promises';
import fg from 'fast-glob';
import type { Skill, SkillFrontmatter } from '@hasna/assistants-shared';
import { parseFrontmatter } from '@hasna/assistants-shared';

/**
 * Skill loader - discovers and loads SKILL.md files from .skill/ directories
 */
export interface SkillLoadOptions {
  includeContent?: boolean;
}

export class SkillLoader {
  private skills: Map<string, Skill> = new Map();

  /**
   * Load all skills from global and project .skill/ directories.
   *
   * Discovery order (later overrides earlier):
   * 1. ~/.skill/node_modules/@hasnaxyz/skill-* /SKILL.md  — global npm
   * 2. ~/.skill/skill-* /SKILL.md                         — global local
   * 3. {cwd}/.skill/node_modules/@hasnaxyz/skill-* /SKILL.md — project npm
   * 4. {cwd}/.skill/skill-* /SKILL.md                     — project local
   */
  async loadAll(projectDir: string = process.cwd(), options: SkillLoadOptions = {}): Promise<void> {
    const includeContent = options.includeContent ?? true;

    const envHome = process.env.HOME || process.env.USERPROFILE;
    const userHome = envHome && envHome.trim().length > 0 ? envHome : homedir();
    const globalRoot = join(userHome, '.skill');
    const projectRoot = join(projectDir, '.skill');

    // 1. Global npm skills
    await this.loadNpmSkills(globalRoot, { includeContent });
    // 2. Global local skills
    await this.loadLocalSkills(globalRoot, { includeContent });
    // 3. Project npm skills
    await this.loadNpmSkills(projectRoot, { includeContent });
    // 4. Project local skills
    await this.loadLocalSkills(projectRoot, { includeContent });
  }

  /**
   * Load npm-installed skills from node_modules/@hasnaxyz/skill-* /SKILL.md
   */
  private async loadNpmSkills(skillRoot: string, options: SkillLoadOptions): Promise<void> {
    const includeContent = options.includeContent ?? true;
    try {
      const nmDir = join(skillRoot, 'node_modules', '@hasnaxyz');
      try {
        const stats = await stat(nmDir);
        if (!stats.isDirectory()) return;
      } catch {
        return;
      }

      const files = await fg('skill-*/SKILL.md', { cwd: nmDir });
      const tasks: Array<Promise<Skill | null>> = [];
      for (const file of files) {
        const fullPath = join(nmDir, file);
        const dirName = file.split(/[\\/]/)[0]; // e.g. skill-deepresearch
        const packageName = `@hasnaxyz/${dirName}`;

        // Read version from package.json sibling
        const pkgJsonPath = join(nmDir, dirName, 'package.json');
        tasks.push(
          this.loadNpmSkillFile(fullPath, pkgJsonPath, packageName, { includeContent }),
        );
      }
      await Promise.all(tasks);
    } catch {
      // Directory doesn't exist or error reading, skip
    }
  }

  /**
   * Load a single npm skill file with package metadata.
   */
  private async loadNpmSkillFile(
    filePath: string,
    pkgJsonPath: string,
    packageName: string,
    options: SkillLoadOptions,
  ): Promise<Skill | null> {
    let version: string | undefined;
    try {
      const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
      version = pkgJson.version;
    } catch {
      // No package.json or invalid
    }
    return this.loadSkillFile(filePath, options, {
      source: 'npm',
      packageName,
      version,
    });
  }

  /**
   * Load local skills from skill-* /SKILL.md (ignoring node_modules)
   */
  private async loadLocalSkills(skillRoot: string, options: SkillLoadOptions): Promise<void> {
    const includeContent = options.includeContent ?? true;
    try {
      try {
        const stats = await stat(skillRoot);
        if (!stats.isDirectory()) return;
      } catch {
        return;
      }

      const files = await fg('skill-*/SKILL.md', {
        cwd: skillRoot,
        ignore: ['node_modules/**'],
      });
      const tasks: Array<Promise<Skill | null>> = [];
      for (const file of files) {
        tasks.push(
          this.loadSkillFile(join(skillRoot, file), { includeContent }, { source: 'local' }),
        );
      }
      await Promise.all(tasks);
    } catch {
      // Directory doesn't exist or error reading, skip
    }
  }

  /**
   * Load skills from a directory (used for backwards compat and direct calls).
   * Supports both `skill-name/SKILL.md` and `name/SKILL.md` patterns.
   */
  async loadFromDirectory(dir: string, options: SkillLoadOptions = {}): Promise<void> {
    const includeContent = options.includeContent ?? true;
    try {
      try {
        const stats = await stat(dir);
        if (!stats.isDirectory()) return;
      } catch {
        return;
      }

      const filesToLoad: string[] = [];

      // Load skills from skill-* directories (preferred convention)
      const skillPrefixFiles = await fg('skill-*/SKILL.md', { cwd: dir });
      for (const file of skillPrefixFiles) {
        filesToLoad.push(join(dir, file));
      }

      // Also load from regular directories (for backwards compatibility)
      const regularFiles = await fg('*/SKILL.md', { cwd: dir });
      for (const file of regularFiles) {
        const dirName = file.split(/[\\/]/)[0];
        if (!dirName.startsWith('skill-')) {
          filesToLoad.push(join(dir, file));
        }
      }

      const loadTasks: Array<Promise<Skill | null>> = [];
      for (const file of filesToLoad) {
        loadTasks.push(this.loadSkillFile(file, { includeContent }));
      }
      await Promise.all(loadTasks);
    } catch {
      // Directory doesn't exist or error reading, skip
    }
  }

  /**
   * Load a single skill file
   */
  async loadSkillFile(
    filePath: string,
    options: SkillLoadOptions = {},
    extra?: { source?: 'local' | 'npm'; packageName?: string; version?: string },
  ): Promise<Skill | null> {
    try {
      const content = await readFile(filePath, 'utf-8');
      const { frontmatter, content: markdownContent } = parseFrontmatter<SkillFrontmatter>(content);
      const includeContent = options.includeContent ?? true;

      // Get skill name from frontmatter or directory name
      const dirName = basename(dirname(filePath));
      const name = frontmatter.name || dirName;

      // Get description from frontmatter or first paragraph
      let description = frontmatter.description || '';
      if (!description && markdownContent) {
        const firstParagraph = markdownContent.split('\n\n')[0];
        description = firstParagraph.replace(/^#.*\n?/, '').trim();
      }

      const allowedToolsRaw = frontmatter['allowed-tools'];
      let allowedTools: string[] | undefined;
      if (Array.isArray(allowedToolsRaw)) {
        const parsed: string[] = [];
        for (const entry of allowedToolsRaw) {
          const value = String(entry).trim();
          if (value) parsed.push(value);
        }
        if (parsed.length > 0) {
          allowedTools = parsed;
        }
      } else if (typeof allowedToolsRaw === 'string') {
        const parsed: string[] = [];
        for (const entry of allowedToolsRaw.split(',')) {
          const value = entry.trim();
          if (value) parsed.push(value);
        }
        if (parsed.length > 0) {
          allowedTools = parsed;
        }
      }

      const argumentHintRaw = frontmatter['argument-hint'];
      const argumentHint = Array.isArray(argumentHintRaw)
        ? `[${argumentHintRaw.join(', ')}]`
        : typeof argumentHintRaw === 'string'
          ? argumentHintRaw
          : undefined;

      const skill: Skill = {
        name,
        description,
        argumentHint,
        allowedTools,
        disableModelInvocation: frontmatter['disable-model-invocation'],
        userInvocable: frontmatter['user-invocable'] !== false,
        model: frontmatter.model,
        context: frontmatter.context,
        assistant: frontmatter.assistant,
        hooks: frontmatter.hooks,
        content: includeContent ? markdownContent : '',
        filePath,
        contentLoaded: includeContent,
        source: extra?.source,
        packageName: extra?.packageName,
        version: extra?.version,
      };

      this.skills.set(name, skill);
      return skill;
    } catch (error) {
      console.error(`Failed to load skill from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Remove a skill from the loaded map
   */
  removeSkill(name: string): void {
    this.skills.delete(name);
  }

  /**
   * Get a skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all loaded skills
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Ensure full content is loaded for a skill
   */
  async ensureSkillContent(name: string): Promise<Skill | null> {
    const skill = this.skills.get(name);
    if (!skill) return null;
    if (skill.contentLoaded) return skill;
    return this.loadSkillFile(skill.filePath, { includeContent: true }, {
      source: skill.source,
      packageName: skill.packageName,
      version: skill.version,
    });
  }

  /**
   * Get user-invocable skills (for slash command menu)
   */
  getUserInvocableSkills(): Skill[] {
    const skills = this.getSkills();
    const userSkills: Skill[] = [];
    for (const skill of skills) {
      if (skill.userInvocable !== false) {
        userSkills.push(skill);
      }
    }
    return userSkills;
  }

  /**
   * Get skill descriptions for context (helps LLM know what's available)
   */
  getSkillDescriptions(): string {
    const skills = this.getSkills();
    if (skills.length === 0) return '';

    const lines = ['Available skills (invoke with /skill-name):'];
    for (const skill of skills) {
      const hint = skill.argumentHint ? ` ${skill.argumentHint}` : '';
      lines.push(`- /${skill.name}${hint}: ${skill.description}`);
    }
    return lines.join('\n');
  }
}
