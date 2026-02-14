import { describe, expect, test } from 'bun:test';
import type { Tool, ToolCall } from '@hasna/assistants-shared';
import { validateToolCalls } from '../src/validation/llm-response';

const countTool: Tool = {
  name: 'count',
  description: 'Count tool',
  parameters: {
    type: 'object',
    properties: {
      count: { type: 'number' },
      label: { type: 'string' },
    },
    required: ['count', 'label'],
  },
};

describe('validateToolCalls', () => {
  test('flags unknown tools', () => {
    const toolCalls: ToolCall[] = [{ id: '1', name: 'unknown', input: {} }];
    const result = validateToolCalls(toolCalls, [countTool]);
    expect(result.validated.size).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].message).toContain('Unknown tool');
  });

  test('returns validation errors for invalid input', () => {
    const toolCalls: ToolCall[] = [{ id: '1', name: 'count', input: { count: 1 } }];
    const result = validateToolCalls(toolCalls, [countTool]);
    expect(result.validated.size).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('coerces valid input and returns validated call', () => {
    const toolCalls: ToolCall[] = [{ id: '1', name: 'count', input: { count: '5', label: 'x' } }];
    const result = validateToolCalls(toolCalls, [countTool]);
    expect(result.errors.length).toBe(0);
    const validated = result.validated.get('1');
    expect(validated).toBeDefined();
    expect(typeof validated?.input.count).toBe('number');
    expect(validated?.input.count).toBe(5);
  });
});
