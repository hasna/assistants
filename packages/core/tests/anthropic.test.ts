import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { AnthropicClient } from '../src/llm/anthropic';
import type { Message, Tool, LLMConfig } from '@hasna/assistants-shared';

describe('AnthropicClient', () => {
  const mockConfig: LLMConfig = {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    apiKey: 'test-api-key',
    maxTokens: 4096,
  };

  describe('constructor', () => {
    test('should use provided API key', () => {
      const client = new AnthropicClient(mockConfig);
      expect(client).toBeDefined();
    });

    test('should use provided model', () => {
      const client = new AnthropicClient(mockConfig);
      expect(client.getModel()).toBe('claude-3-haiku-20240307');
    });
  });

  describe('convertMessages', () => {
    // Access private method for testing
    const createClient = () => new AnthropicClient(mockConfig);

    test('should convert simple user message', () => {
      const client = createClient();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('user');
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[0].text).toBe('Hello');
    });

    test('should convert assistant message', () => {
      const client = createClient();
      const messages: Message[] = [
        { id: '1', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('assistant');
    });

    test('should skip system messages', () => {
      const client = createClient();
      const messages: Message[] = [
        { id: '1', role: 'system', content: 'System prompt', timestamp: Date.now() },
        { id: '2', role: 'user', content: 'Hello', timestamp: Date.now() },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(1);
      expect(converted[0].role).toBe('user');
    });

    test('should include tool calls in assistant message', () => {
      const client = createClient();
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Let me check that',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc1', name: 'bash', input: { command: 'ls' } },
          ],
        },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted[0].content).toHaveLength(2);
      expect(converted[0].content[0].type).toBe('text');
      expect(converted[0].content[1].type).toBe('tool_use');
      expect(converted[0].content[1].name).toBe('bash');
    });

    test('should include tool results in user message', () => {
      const client = createClient();
      // Tool results need a preceding assistant message with the corresponding tool_use
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Let me list the files.',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc1', name: 'bash', input: { command: 'ls' } },
          ],
        },
        {
          id: '2',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          toolResults: [
            { toolCallId: 'tc1', content: 'file1.txt\nfile2.txt' },
          ],
        },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(2);
      expect(converted[1].content).toHaveLength(1);
      expect(converted[1].content[0].type).toBe('tool_result');
      expect(converted[1].content[0].tool_use_id).toBe('tc1');
    });

    test('should handle message with both text and tool results', () => {
      const client = createClient();
      // Tool results need a preceding assistant message with the corresponding tool_use
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Running the command.',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc1', name: 'bash', input: { command: 'echo test' } },
          ],
        },
        {
          id: '2',
          role: 'user',
          content: 'Here are the results',
          timestamp: Date.now(),
          toolResults: [
            { toolCallId: 'tc1', content: 'Success' },
          ],
        },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(2);
      expect(converted[1].content).toHaveLength(2);
      expect(converted[1].content[0].type).toBe('text');
      expect(converted[1].content[1].type).toBe('tool_result');
    });

    test('should handle error in tool results', () => {
      const client = createClient();
      // Tool results need a preceding assistant message with the corresponding tool_use
      const messages: Message[] = [
        {
          id: '1',
          role: 'assistant',
          content: 'Trying to read the file.',
          timestamp: Date.now(),
          toolCalls: [
            { id: 'tc1', name: 'read', input: { path: '/nonexistent' } },
          ],
        },
        {
          id: '2',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          toolResults: [
            { toolCallId: 'tc1', content: 'Error: file not found', isError: true },
          ],
        },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(2);
      expect(converted[1].content[0].is_error).toBe(true);
    });

    test('should handle conversation with multiple turns', () => {
      const client = createClient();
      const messages: Message[] = [
        { id: '1', role: 'user', content: 'Hello', timestamp: Date.now() },
        { id: '2', role: 'assistant', content: 'Hi!', timestamp: Date.now() },
        { id: '3', role: 'user', content: 'How are you?', timestamp: Date.now() },
        { id: '4', role: 'assistant', content: 'I am good!', timestamp: Date.now() },
      ];

      const converted = (client as any).convertMessages(messages);

      expect(converted).toHaveLength(4);
      expect(converted[0].role).toBe('user');
      expect(converted[1].role).toBe('assistant');
      expect(converted[2].role).toBe('user');
      expect(converted[3].role).toBe('assistant');
    });
  });

  describe('convertTools', () => {
    const createClient = () => new AnthropicClient(mockConfig);

    test('should convert tool definition', () => {
      const client = createClient();
      const tools: Tool[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path' },
            },
            required: ['path'],
          },
        },
      ];

      const converted = (client as any).convertTools(tools);

      expect(converted).toHaveLength(1);
      expect(converted[0].name).toBe('read_file');
      expect(converted[0].description).toBe('Read a file');
      expect(converted[0].input_schema.type).toBe('object');
      expect(converted[0].input_schema.properties.path.type).toBe('string');
      expect(converted[0].input_schema.required).toContain('path');
    });

    test('should convert multiple tools', () => {
      const client = createClient();
      const tools: Tool[] = [
        {
          name: 'tool1',
          description: 'First tool',
          parameters: { type: 'object', properties: {} },
        },
        {
          name: 'tool2',
          description: 'Second tool',
          parameters: { type: 'object', properties: {} },
        },
      ];

      const converted = (client as any).convertTools(tools);

      expect(converted).toHaveLength(2);
      expect(converted[0].name).toBe('tool1');
      expect(converted[1].name).toBe('tool2');
    });

    test('should handle tool with array parameter', () => {
      const client = createClient();
      const tools: Tool[] = [
        {
          name: 'search',
          description: 'Search files',
          parameters: {
            type: 'object',
            properties: {
              patterns: {
                type: 'array',
                description: 'Patterns to search',
                items: { type: 'string', description: 'Pattern' },
              },
            },
          },
        },
      ];

      const converted = (client as any).convertTools(tools);

      expect(converted[0].input_schema.properties.patterns.type).toBe('array');
    });

    test('should handle tool with optional parameters', () => {
      const client = createClient();
      const tools: Tool[] = [
        {
          name: 'write',
          description: 'Write file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path' },
              content: { type: 'string', description: 'Content' },
              append: { type: 'boolean', description: 'Append', default: false },
            },
            required: ['path', 'content'],
          },
        },
      ];

      const converted = (client as any).convertTools(tools);

      expect(converted[0].input_schema.required).toHaveLength(2);
      expect(converted[0].input_schema.required).not.toContain('append');
    });
  });

  describe('getDefaultSystemPrompt', () => {
    test('should return a system prompt', () => {
      const client = new AnthropicClient(mockConfig);
      const prompt = (client as any).getDefaultSystemPrompt();

      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('personal AI assistant');
    });

    test('should include current date', () => {
      const client = new AnthropicClient(mockConfig);
      const prompt = (client as any).getDefaultSystemPrompt();

      const today = new Date().toISOString().split('T')[0];
      expect(prompt).toContain(today);
    });
  });
});
