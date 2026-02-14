import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { resolve, join } from 'path';
import type { ProjectRecord, ProjectContextEntry, ProjectPlan } from './store';
import { validatePath } from '../validation/paths';

export interface ProjectContextConnector {
  name: string;
  description?: string;
  cli?: string;
  commands?: Array<{ name: string; description: string }>;
}

export interface BuildProjectContextOptions {
  cwd: string;
  connectors?: ProjectContextConnector[];
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 12_000;

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function formatPlan(plan: ProjectPlan): string {
  const lines: string[] = [];
  lines.push(`- ${singleLine(plan.title)} (${plan.steps.length} steps)`);
  for (const step of plan.steps) {
    lines.push(`  - [${step.status}] ${singleLine(step.text)}`);
  }
  return lines.join('\n');
}

function normalizeEntryLabel(entry: ProjectContextEntry): string {
  return entry.label ? singleLine(entry.label) : singleLine(entry.value);
}

async function renderFileEntry(entry: ProjectContextEntry, options: BuildProjectContextOptions): Promise<string> {
  const rawPath = entry.value.trim();
  const expandedPath = rawPath === '~'
    ? homedir()
    : rawPath.startsWith('~/')
      ? join(homedir(), rawPath.slice(2))
      : rawPath;
  const resolved = resolve(options.cwd, expandedPath);
  const validation = await validatePath(resolved, { allowedPaths: [options.cwd] });
  if (!validation.valid) {
    return `- File: ${rawPath} (unavailable: ${validation.error || 'invalid path'})`;
  }

  let content = '';
  try {
    const data = await readFile(validation.resolved, 'utf-8');
    const limit = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (data.length > limit) {
      content = `${data.slice(0, limit)}\n\n... [truncated ${data.length - limit} chars]`;
    } else {
      content = data;
    }
  } catch (error) {
    return `- File: ${rawPath} (unavailable: ${error instanceof Error ? error.message : String(error)})`;
  }

  return `- File: ${rawPath}\n\`\`\`\n${content}\n\`\`\``;
}

function renderConnectorEntry(entry: ProjectContextEntry, connectors?: ProjectContextConnector[]): string {
  const name = entry.value.trim();
  const connector = connectors?.find((c) => c.name === name);
  if (!connector) {
    return `- Connector: ${name}`;
  }
  const lines: string[] = [];
  lines.push(`- Connector: ${connector.name}`);
  if (connector.description) {
    lines.push(`  - ${connector.description}`);
  }
  if (connector.cli) {
    lines.push(`  - CLI: ${connector.cli}`);
  }
  if (connector.commands && connector.commands.length > 0) {
    const subset = connector.commands.slice(0, 5);
    for (const cmd of subset) {
      lines.push(`  - ${cmd.name}: ${cmd.description}`);
    }
    if (connector.commands.length > subset.length) {
      lines.push(`  - ... ${connector.commands.length - subset.length} more commands`);
    }
  }
  return lines.join('\n');
}

function renderGenericEntry(entry: ProjectContextEntry): string {
  const label = normalizeEntryLabel(entry);
  return `- ${entry.type}: ${label}`;
}

export async function buildProjectContext(
  project: ProjectRecord,
  options: BuildProjectContextOptions
): Promise<string> {
  const lines: string[] = [];
  lines.push(`## Project: ${project.name}`);
  if (project.description) {
    lines.push(`Description: ${project.description}`);
  }

  if (project.context.length > 0) {
    lines.push('');
    lines.push('### Project Context');
    for (const entry of project.context) {
      if (entry.type === 'file') {
        lines.push(await renderFileEntry(entry, options));
        continue;
      }
      if (entry.type === 'connector') {
        lines.push(renderConnectorEntry(entry, options.connectors));
        continue;
      }
      lines.push(renderGenericEntry(entry));
    }
  }

  if (project.plans.length > 0) {
    lines.push('');
    lines.push('### Plans');
    for (const plan of project.plans) {
      lines.push(formatPlan(plan));
    }
  }

  return lines.join('\n');
}
