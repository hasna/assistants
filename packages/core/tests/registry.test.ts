import { describe, expect, test, beforeEach } from 'bun:test';
import { ToolRegistry, __test__ as registryTest } from '../src/tools/registry';
import type { Tool, ToolCall } from '@hasna/assistants-shared';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  const mockTool: Tool = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message' },
      },
      required: ['message'],
    },
  };

  const mockExecutor = async (input: Record<string, unknown>): Promise<string> => {
    return `Echo: ${input.message}`;
  };

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('register', () => {
    test('should register a tool', () => {
      registry.register(mockTool, mockExecutor);
      expect(registry.hasTool('test_tool')).toBe(true);
    });

    test('should allow retrieving registered tool', () => {
      registry.register(mockTool, mockExecutor);
      const tool = registry.getTool('test_tool');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test_tool');
      expect(tool?.description).toBe('A test tool');
    });
  });

  describe('unregister', () => {
    test('should unregister a tool', () => {
      registry.register(mockTool, mockExecutor);
      expect(registry.hasTool('test_tool')).toBe(true);
      registry.unregister('test_tool');
      expect(registry.hasTool('test_tool')).toBe(false);
    });

    test('should handle unregistering non-existent tool', () => {
      expect(() => registry.unregister('non_existent')).not.toThrow();
    });
  });

  describe('getTools', () => {
    test('should return empty array when no tools registered', () => {
      expect(registry.getTools()).toEqual([]);
    });

    test('should return all registered tools', () => {
      const tool2: Tool = {
        name: 'another_tool',
        description: 'Another tool',
        parameters: { type: 'object', properties: {} },
      };

      registry.register(mockTool, mockExecutor);
      registry.register(tool2, mockExecutor);

      const tools = registry.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain('test_tool');
      expect(tools.map((t) => t.name)).toContain('another_tool');
    });
  });

  describe('hasTool', () => {
    test('should return false for non-existent tool', () => {
      expect(registry.hasTool('non_existent')).toBe(false);
    });

    test('should return true for registered tool', () => {
      registry.register(mockTool, mockExecutor);
      expect(registry.hasTool('test_tool')).toBe(true);
    });
  });

  describe('execute', () => {
    test('should execute registered tool', async () => {
      registry.register(mockTool, mockExecutor);

      const toolCall: ToolCall = {
        id: 'tc-1',
        name: 'test_tool',
        input: { message: 'Hello' },
      };

      const result = await registry.execute(toolCall);
      expect(result.toolCallId).toBe('tc-1');
      expect(result.content).toBe('Echo: Hello');
      expect(result.isError).toBe(false);
    });

    test('should return error for non-existent tool', async () => {
      const toolCall: ToolCall = {
        id: 'tc-1',
        name: 'non_existent',
        input: {},
      };

      const result = await registry.execute(toolCall);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool "non_existent" not found');
    });

    test('should handle executor errors', async () => {
      const failingExecutor = async (): Promise<string> => {
        throw new Error('Tool execution failed');
      };

      registry.register(mockTool, failingExecutor);

      const toolCall: ToolCall = {
        id: 'tc-1',
        name: 'test_tool',
        input: { message: 'Hello' },
      };

      const result = await registry.execute(toolCall);
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Tool execution failed');
    });

    test('should mark error when executor returns error string', async () => {
      const errorExecutor = async (): Promise<string> => {
        return 'Error: something went wrong';
      };

      registry.register(mockTool, errorExecutor);

      const toolCall: ToolCall = {
        id: 'tc-1',
        name: 'test_tool',
        input: {},
      };

      const result = await registry.execute(toolCall);
      expect(result.isError).toBe(true);
    });
  });

  describe('executeAll', () => {
    test('should execute multiple tools in parallel', async () => {
      registry.register(mockTool, mockExecutor);

      const tool2: Tool = {
        name: 'uppercase_tool',
        description: 'Uppercase tool',
        parameters: { type: 'object', properties: {} },
      };
      registry.register(tool2, async (input) => {
        return String(input.text).toUpperCase();
      });

      const toolCalls: ToolCall[] = [
        { id: 'tc-1', name: 'test_tool', input: { message: 'hello' } },
        { id: 'tc-2', name: 'uppercase_tool', input: { text: 'world' } },
      ];

      const results = await registry.executeAll(toolCalls);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe('Echo: hello');
      expect(results[1].content).toBe('WORLD');
    });

    test('should handle mixed success and failure', async () => {
      registry.register(mockTool, mockExecutor);

      const toolCalls: ToolCall[] = [
        { id: 'tc-1', name: 'test_tool', input: { message: 'hello' } },
        { id: 'tc-2', name: 'non_existent', input: {} },
      ];

      const results = await registry.executeAll(toolCalls);
      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(false);
      expect(results[1].isError).toBe(true);
    });
  });

  describe('wait timeout helpers', () => {
    test('deriveWaitTimeoutMs returns null for non-wait tools', () => {
      expect(registryTest.deriveWaitTimeoutMs('bash', { seconds: 10 })).toBeNull();
    });

    test('deriveWaitTimeoutMs honors seconds', () => {
      const timeout = registryTest.deriveWaitTimeoutMs('wait', { seconds: 2 });
      expect(timeout).toBe(2000 + 5000);
    });

    test('deriveWaitTimeoutMs uses max of ranges', () => {
      const timeout = registryTest.deriveWaitTimeoutMs('sleep', { minSeconds: 1, maxSeconds: 3 });
      expect(timeout).toBe(3000 + 5000);
    });
  });
});
