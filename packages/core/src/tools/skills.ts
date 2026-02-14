import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor } from './registry';
import { ToolExecutionError, ErrorCodes } from '../errors';
import { createSkill, type SkillScope } from '../skills/create';
import type { SkillLoader } from '../skills/loader';
import { SkillExecutor } from '../skills/executor';
import { SkillInstaller, type InstallScope } from '../skills/installer';

function normalizeScope(input: unknown): SkillScope | null {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  if (value === 'project' || value === 'global') return value;
  return null;
}

function normalizeAllowedTools(input: unknown): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    const tools = input.map((tool) => String(tool).trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  if (typeof input === 'string') {
    const tools = input.split(',').map((tool) => tool.trim()).filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  return undefined;
}

export class SkillTool {
  static readonly tool: Tool = {
    name: 'skill_create',
    description: 'Create a skill (SKILL.md). Requires explicit scope (project or global).',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name without the "skill-" prefix.',
        },
        scope: {
          type: 'string',
          description: 'Where to create the skill.',
          enum: ['project', 'global'],
        },
        description: {
          type: 'string',
          description: 'Short description for the skill.',
        },
        content: {
          type: 'string',
          description: 'Skill body content (markdown).',
        },
        allowed_tools: {
          type: ['array', 'string'],
          description: 'Allowed tools for the skill (array or comma-separated string).',
          items: { type: 'string', description: 'Tool name' },
        },
        argument_hint: {
          type: 'string',
          description: 'Argument hint for invocation.',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite if skill already exists.',
          default: false,
        },
        cwd: {
          type: 'string',
          description: 'Working directory for project scope (autofilled).',
        },
      },
      required: ['name'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const rawName = String(input.name || '').trim();
    if (!rawName) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_create',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Provide a skill name without the "skill-" prefix.',
      });
    }

    const scope = normalizeScope(input.scope);
    if (!scope) {
      throw new ToolExecutionError('Scope is required (project or global).', {
        toolName: 'skill_create',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Ask the user: project (default) or global?',
      });
    }

    const cwd = String(input.cwd || process.cwd());
    const allowedTools = normalizeAllowedTools(input.allowed_tools ?? input.allowedTools);

    const result = await createSkill({
      name: rawName,
      scope,
      description: input.description ? String(input.description) : undefined,
      content: input.content ? String(input.content) : undefined,
      allowedTools,
      argumentHint: input.argument_hint ? String(input.argument_hint) : undefined,
      overwrite: Boolean(input.overwrite),
      cwd,
    });

    return [
      `Created skill "${result.name}" (${result.scope}).`,
      `Location: ${result.filePath}`,
      `Invoke with: $${result.name} [args] or /${result.name} [args]`,
    ].join('\n');
  };
}

export function createSkillListTool(getLoader: () => SkillLoader | null) {
  const tool: Tool = {
    name: 'skills_list',
    description: 'List available skills and their descriptions.',
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Project directory to scan for skills.',
        },
      },
    },
  };

  const executor: ToolExecutor = async (input) => {
    const loader = getLoader();
    if (!loader) {
      throw new ToolExecutionError('Skill loader is not available.', {
        toolName: 'skills_list',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
    const cwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0 ? input.cwd : process.cwd();
    await loader.loadAll(cwd, { includeContent: false });
    const descriptions = loader.getSkillDescriptions();
    return descriptions || 'No skills loaded.';
  };

  return { tool, executor };
}

export function createSkillReadTool(getLoader: () => SkillLoader | null) {
  const tool: Tool = {
    name: 'skill_read',
    description: 'Load and return the full content of a skill.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to load.',
        },
      },
      required: ['name'],
    },
  };

  const executor: ToolExecutor = async (input) => {
    const loader = getLoader();
    if (!loader) {
      throw new ToolExecutionError('Skill loader is not available.', {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }
    const name = String(input.name || '').trim();
    if (!name) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
      });
    }
    const skill = await loader.ensureSkillContent(name);
    if (!skill) {
      throw new ToolExecutionError(`Skill "${name}" not found.`, {
        toolName: 'skill_read',
        toolInput: input,
        code: ErrorCodes.TOOL_NOT_FOUND,
        recoverable: true,
        retryable: false,
      });
    }
    return skill.content || '(empty skill content)';
  };

  return { tool, executor };
}

export function createSkillExecuteTool(getLoader: () => SkillLoader | null) {
  const skillExecutor = new SkillExecutor();

  const tool: Tool = {
    name: 'skill_execute',
    description: 'Execute a skill by name with optional arguments. Returns the prepared skill content for you to follow.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to execute (e.g., "commit", "review-pr").',
        },
        arguments: {
          type: 'string',
          description: 'Arguments to pass to the skill (replaces $ARGUMENTS in skill content).',
        },
      },
      required: ['name'],
    },
  };

  const executor: ToolExecutor = async (input) => {
    const loader = getLoader();
    if (!loader) {
      throw new ToolExecutionError('Skill loader is not available.', {
        toolName: 'skill_execute',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }

    const name = String(input.name || '').trim();
    if (!name) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_execute',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: false,
        retryable: false,
        suggestion: 'Use skills_list to see available skills.',
      });
    }

    // Ensure skill content is loaded
    const skill = await loader.ensureSkillContent(name);
    if (!skill) {
      throw new ToolExecutionError(`Skill "${name}" not found.`, {
        toolName: 'skill_execute',
        toolInput: input,
        code: ErrorCodes.TOOL_NOT_FOUND,
        recoverable: true,
        retryable: false,
        suggestion: 'Use skills_list to see available skills.',
      });
    }

    // Parse arguments into array
    const argsString = String(input.arguments || '').trim();
    const args = argsString ? argsString.split(/\s+/) : [];

    // Prepare skill content with argument substitution
    const preparedContent = await skillExecutor.prepare(skill, args);

    // Build response with skill metadata and content
    const lines: string[] = [
      `## Executing Skill: ${skill.name}`,
      '',
    ];

    if (skill.description) {
      lines.push(`**Description:** ${skill.description}`);
      lines.push('');
    }

    if (skill.allowedTools && skill.allowedTools.length > 0) {
      lines.push(`**Allowed Tools:** ${skill.allowedTools.join(', ')}`);
      lines.push('');
    }

    if (args.length > 0) {
      lines.push(`**Arguments:** ${args.join(' ')}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## Skill Instructions');
    lines.push('');
    lines.push(preparedContent);

    return lines.join('\n');
  };

  return { tool, executor };
}

export class SkillInstallTool {
  static readonly tool: Tool = {
    name: 'skill_install',
    description: 'Install an npm skill package (@hasnaxyz/skill-*) into .skill/.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (e.g. "deepresearch") — automatically prefixed with @hasnaxyz/skill-.',
        },
        scope: {
          type: 'string',
          description: 'Where to install: project (.skill/) or global (~/.skill/).',
          enum: ['project', 'global'],
        },
        cwd: {
          type: 'string',
          description: 'Working directory for project scope (autofilled).',
        },
      },
      required: ['name'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const rawName = String(input.name || '').trim();
    if (!rawName) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_install',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
        suggestion: 'Provide a skill name, e.g. "deepresearch".',
      });
    }

    const scope: InstallScope = (String(input.scope || '').trim().toLowerCase() as InstallScope) || 'project';
    if (scope !== 'project' && scope !== 'global') {
      throw new ToolExecutionError('Scope must be "project" or "global".', {
        toolName: 'skill_install',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }

    const cwd = String(input.cwd || process.cwd());

    const result = await SkillInstaller.install({ name: rawName, scope, cwd });

    return [
      `Installed skill "${result.name}" (${result.packageName}@${result.version}).`,
      `Location: ${result.skillDir}`,
      `Scope: ${scope}`,
      `Invoke with: /${result.name} [args]`,
    ].join('\n');
  };
}

export class SkillUninstallTool {
  static readonly tool: Tool = {
    name: 'skill_uninstall',
    description: 'Uninstall an npm skill package from .skill/.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill name to uninstall (e.g. "deepresearch").',
        },
        scope: {
          type: 'string',
          description: 'Where to uninstall from: project (.skill/) or global (~/.skill/).',
          enum: ['project', 'global'],
        },
        cwd: {
          type: 'string',
          description: 'Working directory for project scope (autofilled).',
        },
      },
      required: ['name'],
    },
  };

  static readonly executor: ToolExecutor = async (input) => {
    const rawName = String(input.name || '').trim();
    if (!rawName) {
      throw new ToolExecutionError('Skill name is required.', {
        toolName: 'skill_uninstall',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }

    const scope: InstallScope = (String(input.scope || '').trim().toLowerCase() as InstallScope) || 'project';
    if (scope !== 'project' && scope !== 'global') {
      throw new ToolExecutionError('Scope must be "project" or "global".', {
        toolName: 'skill_uninstall',
        toolInput: input,
        code: ErrorCodes.TOOL_EXECUTION_FAILED,
        recoverable: true,
        retryable: false,
      });
    }

    const cwd = String(input.cwd || process.cwd());

    await SkillInstaller.uninstall(rawName, scope, cwd);

    return `Uninstalled skill "${rawName}" from ${scope} scope.`;
  };
}
