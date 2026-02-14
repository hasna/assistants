import { join, dirname } from 'path';
import { homedir } from 'os';
import { mkdir, stat, writeFile, rm } from 'fs/promises';

export type SkillScope = 'project' | 'global';

export interface CreateSkillOptions {
  name: string;
  scope?: SkillScope;
  description?: string;
  content?: string;
  allowedTools?: string[];
  argumentHint?: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  cwd: string;
  overwrite?: boolean;
}

export interface CreateSkillResult {
  name: string;
  directory: string;
  filePath: string;
  scope: SkillScope;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeName(rawName: string): { skillName: string; dirName: string } {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new Error('Skill name is required.');
  }
  const prefixMatch = trimmed.match(/^skill-/i);
  const withoutPrefix = prefixMatch ? trimmed.slice(prefixMatch[0].length) : trimmed;
  if (/skill/i.test(withoutPrefix)) {
    throw new Error('Skill name should not include the word "skill".');
  }
  const slug = slugify(withoutPrefix);
  if (!slug) {
    throw new Error('Skill name is invalid after normalization.');
  }
  return { skillName: slug, dirName: `skill-${slug}` };
}

function buildFrontmatter(options: CreateSkillOptions, skillName: string): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`name: ${skillName}`);
  if (options.description) {
    lines.push(`description: ${options.description}`);
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    lines.push('allowed-tools:');
    for (const tool of options.allowedTools) {
      lines.push(`  - ${tool}`);
    }
  }
  if (options.argumentHint) {
    lines.push(`argument-hint: ${options.argumentHint}`);
  }
  if (options.userInvocable === false) {
    lines.push('user-invocable: false');
  }
  if (options.disableModelInvocation === true) {
    lines.push('disable-model-invocation: true');
  }
  lines.push('---');
  return lines.join('\n');
}

function buildDefaultContent(): string {
  return [
    'Describe what this skill does.',
    '',
    'Use $ARGUMENTS to accept user input.',
  ].join('\n');
}

function resolveSkillRoot(scope: SkillScope, cwd: string): string {
  if (scope === 'global') {
    return join(homedir(), '.skill');
  }
  return join(cwd, '.skill');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile() || stats.isDirectory();
  } catch {
    return false;
  }
}

export async function deleteSkill(filePath: string): Promise<void> {
  const skillDir = dirname(filePath);
  await rm(skillDir, { recursive: true });
}

export async function createSkill(options: CreateSkillOptions): Promise<CreateSkillResult> {
  const scope: SkillScope = options.scope ?? 'project';
  const { skillName, dirName } = normalizeName(options.name);
  const root = resolveSkillRoot(scope, options.cwd);
  const directory = join(root, dirName);
  const filePath = join(directory, 'SKILL.md');

  if (!options.overwrite && await pathExists(filePath)) {
    throw new Error(`Skill already exists at ${filePath}`);
  }

  await mkdir(directory, { recursive: true });

  const frontmatter = buildFrontmatter(options, skillName);
  const content = options.content && options.content.trim().length > 0
    ? options.content.trim()
    : buildDefaultContent();
  const body = `${frontmatter}\n\n${content}\n`;

  await writeFile(filePath, body);

  return {
    name: skillName,
    directory,
    filePath,
    scope,
  };
}
