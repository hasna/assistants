import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readFile, writeFile, stat } from 'fs/promises';

export type InstallScope = 'project' | 'global';

export interface InstallSkillOptions {
  name: string;
  scope?: InstallScope;
  cwd?: string;
}

export interface InstallSkillResult {
  name: string;
  packageName: string;
  version: string;
  skillDir: string;
}

export interface InstalledSkillInfo {
  packageName: string;
  version: string;
}

/**
 * Resolve the .skill/ root directory for a given scope.
 */
export function resolveSkillRoot(scope: InstallScope, cwd?: string): string {
  if (scope === 'global') {
    return join(homedir(), '.skill');
  }
  return join(cwd || process.cwd(), '.skill');
}

/**
 * Ensure .skill/package.json exists with minimal scaffold.
 * Also creates a .gitignore for node_modules/.
 */
export async function ensurePackageJson(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });

  const pkgPath = join(dir, 'package.json');
  try {
    await stat(pkgPath);
  } catch {
    await writeFile(
      pkgPath,
      JSON.stringify(
        { name: 'assistants-skills', private: true, dependencies: {} },
        null,
        2,
      ) + '\n',
    );
  }

  const gitignorePath = join(dir, '.gitignore');
  try {
    await stat(gitignorePath);
  } catch {
    await writeFile(gitignorePath, 'node_modules/\n');
  }
}

/**
 * Install an npm skill package into .skill/.
 */
export async function install(options: InstallSkillOptions): Promise<InstallSkillResult> {
  const scope: InstallScope = options.scope ?? 'project';
  const root = resolveSkillRoot(scope, options.cwd);
  await ensurePackageJson(root);

  const rawName = options.name.replace(/^@hasnaxyz\/skill-/, '').replace(/^skill-/, '');
  const packageName = `@hasnaxyz/skill-${rawName}`;

  const result = Bun.spawnSync(['bun', 'add', packageName], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to install ${packageName}: ${stderr || 'unknown error'}`);
  }

  // Read installed version from the package's own package.json
  const skillDir = join(root, 'node_modules', '@hasnaxyz', `skill-${rawName}`);
  let version = 'unknown';
  try {
    const pkgJson = JSON.parse(await readFile(join(skillDir, 'package.json'), 'utf-8'));
    version = pkgJson.version || 'unknown';
  } catch {
    // Version read failed, keep 'unknown'
  }

  return { name: rawName, packageName, version, skillDir };
}

/**
 * Uninstall an npm skill package from .skill/.
 */
export async function uninstall(name: string, scope?: InstallScope, cwd?: string): Promise<void> {
  const resolvedScope: InstallScope = scope ?? 'project';
  const root = resolveSkillRoot(resolvedScope, cwd);

  const rawName = name.replace(/^@hasnaxyz\/skill-/, '').replace(/^skill-/, '');
  const packageName = `@hasnaxyz/skill-${rawName}`;

  const result = Bun.spawnSync(['bun', 'remove', packageName], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`Failed to uninstall ${packageName}: ${stderr || 'unknown error'}`);
  }
}

/**
 * List installed npm skill packages from .skill/package.json.
 */
export async function listInstalled(scope?: InstallScope, cwd?: string): Promise<InstalledSkillInfo[]> {
  const resolvedScope: InstallScope = scope ?? 'project';
  const root = resolveSkillRoot(resolvedScope, cwd);
  const pkgPath = join(root, 'package.json');

  try {
    const pkgJson = JSON.parse(await readFile(pkgPath, 'utf-8'));
    const deps = pkgJson.dependencies || {};
    const results: InstalledSkillInfo[] = [];
    for (const [name, version] of Object.entries(deps)) {
      results.push({ packageName: name, version: String(version) });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * SkillInstaller namespace — groups all installer functions.
 */
export const SkillInstaller = {
  resolveSkillRoot,
  ensurePackageJson,
  install,
  uninstall,
  listInstalled,
};
