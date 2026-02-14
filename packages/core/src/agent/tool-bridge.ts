/**
 * Tool Bridge
 *
 * Converts the app's internal Tool format (JSON Schema-based) to formats
 * required by external SDKs:
 * - JSON Schema ToolProperty → Zod schema (for Claude Agent SDK MCP tools)
 * - Tool → MCP tool definition
 */

import type { Tool, ToolProperty } from '@hasna/assistants-shared';
import type { ToolRegistry } from '../tools/registry';

/**
 * Convert a ToolProperty (JSON Schema) to a Zod-compatible schema descriptor.
 * Returns a plain object describing the Zod type to construct.
 */
export interface ZodDescriptor {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'union';
  description?: string;
  enum?: string[];
  items?: ZodDescriptor;
  properties?: Record<string, ZodDescriptor>;
  required?: string[];
  variants?: ZodDescriptor[];
}

export function toolPropertyToZodDescriptor(prop: ToolProperty): ZodDescriptor {
  const baseType = Array.isArray(prop.type) ? prop.type[0] : prop.type;

  if (prop.enum && prop.enum.length > 0) {
    return {
      type: 'string',
      description: prop.description,
      enum: prop.enum,
    };
  }

  switch (baseType) {
    case 'string':
      return { type: 'string', description: prop.description };
    case 'number':
      return { type: 'number', description: prop.description };
    case 'boolean':
      return { type: 'boolean', description: prop.description };
    case 'array':
      return {
        type: 'array',
        description: prop.description,
        items: prop.items ? toolPropertyToZodDescriptor(prop.items) : { type: 'string' },
      };
    case 'object':
      if (prop.properties) {
        const properties: Record<string, ZodDescriptor> = {};
        for (const [key, value] of Object.entries(prop.properties)) {
          properties[key] = toolPropertyToZodDescriptor(value);
        }
        return {
          type: 'object',
          description: prop.description,
          properties,
          required: prop.required,
        };
      }
      return { type: 'object', description: prop.description };
    default:
      return { type: 'string', description: prop.description };
  }
}

/**
 * Convert a Tool to an MCP-compatible tool definition object.
 * This returns a plain descriptor — the actual MCP server tool registration
 * happens in the SDK-specific agent loop where zod is available.
 */
export interface McpToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, ZodDescriptor>;
  required: string[];
}

export function toolToMcpDescriptor(tool: Tool): McpToolDescriptor {
  const parameters: Record<string, ZodDescriptor> = {};

  for (const [key, prop] of Object.entries(tool.parameters.properties)) {
    parameters[key] = toolPropertyToZodDescriptor(prop);
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters,
    required: tool.parameters.required || [],
  };
}

/**
 * Get all tools from a ToolRegistry as MCP descriptors.
 */
export function getAllMcpDescriptors(registry: ToolRegistry): McpToolDescriptor[] {
  return registry.getTools().map(toolToMcpDescriptor);
}

/**
 * Build a system prompt section describing available app tools.
 * Used by Codex SDK which cannot inject custom tools directly.
 */
export function buildToolsSystemPrompt(registry: ToolRegistry): string {
  const tools = registry.getTools();
  if (tools.length === 0) return '';

  const lines = [
    'You have access to the following custom tools via bash commands.',
    'To use a tool, run: assistants-tool <tool_name> \'<json_input>\'',
    '',
  ];

  for (const tool of tools) {
    const params = Object.entries(tool.parameters.properties)
      .map(([name, prop]) => {
        const req = tool.parameters.required?.includes(name) ? ' (required)' : '';
        return `    ${name}: ${Array.isArray(prop.type) ? prop.type.join('|') : prop.type}${req} - ${prop.description}`;
      })
      .join('\n');
    lines.push(`- ${tool.name}: ${tool.description}`);
    if (params) lines.push(params);
    lines.push('');
  }

  return lines.join('\n');
}
