import type { Tool, ToolCall } from '@hasna/assistants-shared';
import { ErrorCodes, ValidationError } from '../errors';
import { validateToolInput } from './schema';

export interface LLMResponseValidation {
  validated: Map<string, ToolCall>;
  errors: ValidationError[];
}

export function validateToolCalls(toolCalls: ToolCall[], tools: Tool[]): LLMResponseValidation {
  const toolMap = new Map<string, Tool>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  const validated = new Map<string, ToolCall>();
  const errors: ValidationError[] = [];

  for (const call of toolCalls) {
    const tool = toolMap.get(call.name);
    if (!tool) {
      errors.push(new ValidationError(`Unknown tool: ${call.name}`, {
        code: ErrorCodes.VALIDATION_SCHEMA_ERROR,
        field: call.name,
        expected: 'known tool',
        received: call.name,
        recoverable: false,
        retryable: false,
        suggestion: 'Use a supported tool name.',
      }));
      continue;
    }

    const validation = validateToolInput(call.name, tool.parameters, call.input);
    if (!validation.valid) {
      if (validation.errors) {
        errors.push(...validation.errors);
      } else {
        errors.push(new ValidationError(`Invalid input for ${call.name}`, {
          code: ErrorCodes.VALIDATION_SCHEMA_ERROR,
          field: call.name,
          expected: 'valid input',
          received: typeof call.input,
          recoverable: false,
          retryable: false,
        }));
      }
      continue;
    }

    validated.set(call.id, {
      ...call,
      input: validation.coerced ?? call.input,
    });
  }

  return { validated, errors };
}
