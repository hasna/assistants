import { existsSync, readdirSync, statSync } from 'fs';
import { join, relative, basename, extname } from 'path';
import { homedir } from 'os';
import type { Command, CommandFrontmatter } from './types';
import { getRuntime } from '../runtime';

/**
 * CommandLoader - discovers and loads slash commands from disk
 *
 * Command locations (in priority order):
 * 1. Project-level: .assistants/commands/
 * 2. Global-level: ~/.assistants/commands/
 *
 * File format:
 * - Markdown files (.md) with optional YAML frontmatter
 * - Filename becomes command name (e.g., commit.md -> /commit)
 * - Nested directories create namespaced commands (e.g., git/commit.md -> /git:commit)
 */
export class CommandLoader {
  private commands: Map<string, Command> = new Map();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  /**
   * Load all commands from disk
   */
  async loadAll(): Promise<void> {
    this.commands.clear();

    // Load global commands first (lower priority)
    const envHome = process.env.HOME || process.env.USERPROFILE;
    const homeDir = envHome && envHome.trim().length > 0 ? envHome : homedir();
    const globalDir = join(homeDir, '.assistants', 'commands');
    await this.loadFromDirectory(globalDir, 'global');

    // Load project commands (higher priority, will override global)
    const projectDir = join(this.cwd, '.assistants', 'commands');
    await this.loadFromDirectory(projectDir, 'project');
  }

  /**
   * Load commands from a directory recursively
   */
  private async loadFromDirectory(dir: string, source: 'global' | 'project', prefix: string = ''): Promise<void> {
    if (!existsSync(dir)) return;

    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        // Recurse into subdirectory with namespace prefix
        const newPrefix = prefix ? `${prefix}:${entry}` : entry;
        await this.loadFromDirectory(fullPath, source, newPrefix);
      } else if (stat.isFile() && extname(entry) === '.md') {
        // Load markdown command file
        const command = await this.loadCommandFile(fullPath, prefix);
        if (command) {
          this.commands.set(command.name, command);
        }
      }
    }
  }

  /**
   * Load a single command file
   */
  private async loadCommandFile(filePath: string, prefix: string): Promise<Command | null> {
    try {
      const runtime = getRuntime();
      const content = await runtime.file(filePath).text();
      const { frontmatter, body } = this.parseFrontmatter(content);

      // Derive command name from filename or frontmatter
      const fileName = basename(filePath, '.md');
      const name = frontmatter.name || (prefix ? `${prefix}:${fileName}` : fileName);

      const allowedToolsRaw = frontmatter['allowed-tools'];
      const allowedTools = Array.isArray(allowedToolsRaw)
        ? allowedToolsRaw.map((t) => String(t).trim()).filter(Boolean)
        : typeof allowedToolsRaw === 'string'
          ? allowedToolsRaw.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;

      return {
        name,
        description: frontmatter.description || `Run the ${name} command`,
        tags: frontmatter.tags,
        allowedTools,
        content: body,
        filePath,
        builtin: false,
      };
    } catch (error) {
      console.error(`Failed to load command from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: CommandFrontmatter; body: string } {
    const frontmatterRegex = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return { frontmatter: {}, body: content };
    }

    const [, yamlContent, body] = match;
    const frontmatter: CommandFrontmatter = {};

    const lines = yamlContent.split(/\r?\n/);
    let currentListKey: string | null = null;
    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim() || line.trim().startsWith('#')) continue;

      const listMatch = line.match(/^\s*-\s+(.+)$/);
      if (listMatch && currentListKey) {
        const list = (frontmatter[currentListKey] as unknown[] | undefined) ?? [];
        list.push(this.parseYamlValue(listMatch[1]));
        frontmatter[currentListKey] = list as any;
        continue;
      }

      const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
      if (!keyMatch) continue;

      const key = keyMatch[1];
      const valueRaw = keyMatch[2] ?? '';
      if (valueRaw.trim() === '') {
        currentListKey = key;
        if (!frontmatter[key]) {
          frontmatter[key] = [];
        }
        continue;
      }

      currentListKey = null;
      frontmatter[key] = this.parseYamlValue(valueRaw);
    }

    return { frontmatter, body: body.trim() };
  }

  private parseYamlValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (!Number.isNaN(Number(trimmed)) && trimmed !== '') return Number(trimmed);
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map((item) => this.parseYamlValue(item));
    }
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  /**
   * Register a command programmatically (for built-in commands)
   */
  register(command: Command): void {
    this.commands.set(command.name, command);
    // Also register any aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias, command);
      }
    }
  }

  /**
   * Get a command by name (or alias)
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all loaded commands (deduplicated, excludes alias entries)
   */
  getCommands(): Command[] {
    // Deduplicate since aliases point to the same command
    const seen = new Set<string>();
    const result: Command[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  /**
   * Check if a command exists (by name or alias)
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Find commands matching a partial name (for autocomplete)
   */
  findMatching(partial: string): Command[] {
    const lower = partial.toLowerCase();
    return this.getCommands().filter(cmd =>
      cmd.name.toLowerCase().startsWith(lower) ||
      cmd.description.toLowerCase().includes(lower) ||
      cmd.aliases?.some(alias => alias.toLowerCase().startsWith(lower))
    );
  }
}
