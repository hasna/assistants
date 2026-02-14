import { describe, expect, test, beforeEach } from 'bun:test';
import { AssistantContext } from '../src/agent/context';
import { AssistantLoop } from '../src/agent/loop';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';

describe('AssistantContext', () => {
  let context: AssistantContext;

  beforeEach(() => {
    context = new AssistantContext();
  });

  describe('addUserMessage', () => {
    test('should add user message', () => {
      const message = context.addUserMessage('Hello');

      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
      expect(message.id).toBeDefined();
      expect(message.timestamp).toBeDefined();
    });

    test('should store message in context', () => {
      context.addUserMessage('Hello');

      const messages = context.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });
  });

  describe('addAssistantMessage', () => {
    test('should add assistant message', () => {
      const message = context.addAssistantMessage('Hi there!');

      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hi there!');
    });

    test('should include tool calls', () => {
      const toolCalls: ToolCall[] = [
        { id: 'tc1', name: 'bash', input: { command: 'ls' } },
      ];
      const message = context.addAssistantMessage('Checking...', toolCalls);

      expect(message.toolCalls).toHaveLength(1);
      expect(message.toolCalls?.[0].name).toBe('bash');
    });

    test('should handle undefined tool calls', () => {
      const message = context.addAssistantMessage('Simple response');

      expect(message.toolCalls).toBeUndefined();
    });
  });

  describe('addToolResults', () => {
    test('should add tool results as user message', () => {
      const results: ToolResult[] = [
        { toolCallId: 'tc1', content: 'file1.txt\nfile2.txt' },
      ];
      const message = context.addToolResults(results);

      expect(message.role).toBe('user');
      expect(message.content).toBe('');
      expect(message.toolResults).toHaveLength(1);
    });

    test('should preserve isError flag', () => {
      const results: ToolResult[] = [
        { toolCallId: 'tc1', content: 'Error: not found', isError: true },
      ];
      const message = context.addToolResults(results);

      expect(message.toolResults?.[0].isError).toBe(true);
    });
  });

  describe('addSystemMessage', () => {
    test('should add system message', () => {
      const message = context.addSystemMessage('You are a helpful assistant');

      expect(message.role).toBe('system');
      expect(message.content).toBe('You are a helpful assistant');
    });

    test('should not be pruned like other messages', () => {
      // Create context with small limit
      const smallContext = new AssistantContext(5);

      // Add system message
      smallContext.addSystemMessage('System prompt');

      // Add more messages than the limit
      for (let i = 0; i < 10; i++) {
        smallContext.addUserMessage(`Message ${i}`);
      }

      const messages = smallContext.getMessages();
      // System message should still be there
      const systemMessages = messages.filter((m) => m.role === 'system');
      expect(systemMessages).toHaveLength(1);
    });
  });

  describe('getMessages', () => {
    test('should return copy of messages', () => {
      context.addUserMessage('Hello');

      const messages = context.getMessages();
      messages.push({
        id: 'fake',
        role: 'user',
        content: 'Fake',
        timestamp: Date.now(),
      });

      expect(context.getMessages()).toHaveLength(1);
    });
  });

  describe('getLastMessages', () => {
    test('should return last N messages', () => {
      context.addUserMessage('First');
      context.addAssistantMessage('Second');
      context.addUserMessage('Third');

      const last2 = context.getLastMessages(2);

      expect(last2).toHaveLength(2);
      expect(last2[0].content).toBe('Second');
      expect(last2[1].content).toBe('Third');
    });

    test('should return all messages if N is larger', () => {
      context.addUserMessage('Only one');

      const messages = context.getLastMessages(100);

      expect(messages).toHaveLength(1);
    });
  });

  describe('clear', () => {
    test('should remove all messages', () => {
      context.addUserMessage('Hello');
      context.addAssistantMessage('Hi');

      context.clear();

      expect(context.getMessages()).toHaveLength(0);
    });
  });

  describe('pruning', () => {
    test('should prune old messages when over limit', () => {
      const smallContext = new AssistantContext(5);

      for (let i = 0; i < 10; i++) {
        smallContext.addUserMessage(`Message ${i}`);
      }

      const messages = smallContext.getMessages();
      expect(messages.length).toBeLessThanOrEqual(5);
    });

    test('should preserve system messages during pruning', () => {
      const smallContext = new AssistantContext(5);

      smallContext.addSystemMessage('Important system prompt');
      smallContext.addSystemMessage('Another system message');

      for (let i = 0; i < 10; i++) {
        smallContext.addUserMessage(`Message ${i}`);
      }

      const messages = smallContext.getMessages();
      const systemMessages = messages.filter((m) => m.role === 'system');

      expect(systemMessages).toHaveLength(2);
    });
  });

  describe('export and import', () => {
    test('should export messages', () => {
      context.addUserMessage('Hello');
      context.addAssistantMessage('Hi');

      const exported = context.export();

      expect(exported).toHaveLength(2);
    });

    test('should import messages', () => {
      const messages = [
        { id: '1', role: 'user' as const, content: 'Imported', timestamp: Date.now() },
      ];

      context.import(messages);

      expect(context.getMessages()).toHaveLength(1);
      expect(context.getMessages()[0].content).toBe('Imported');
    });

    test('should replace existing messages on import', () => {
      context.addUserMessage('Original');

      context.import([
        { id: '1', role: 'user' as const, content: 'Imported', timestamp: Date.now() },
      ]);

      expect(context.getMessages()).toHaveLength(1);
      expect(context.getMessages()[0].content).toBe('Imported');
    });
  });
});

describe('AssistantLoop', () => {
  describe('constructor', () => {
    test('should create assistant with default options', () => {
      const assistant = new AssistantLoop();
      expect(assistant).toBeDefined();
    });

    test('should accept custom cwd', () => {
      const assistant = new AssistantLoop({ cwd: '/tmp' });
      expect(assistant).toBeDefined();
    });
  });

  describe('isProcessing', () => {
    test('should return false initially', () => {
      const assistant = new AssistantLoop();
      expect(assistant.isProcessing()).toBe(false);
    });
  });

  describe('getContext', () => {
    test('should return context instance', () => {
      const assistant = new AssistantLoop();
      const context = assistant.getContext();

      expect(context).toBeDefined();
      expect(context).toBeInstanceOf(AssistantContext);
    });
  });

  describe('getTools', () => {
    test('should return empty array before initialization', () => {
      const assistant = new AssistantLoop();
      const tools = assistant.getTools();

      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('getSkills and getCommands', () => {
    test('should return arrays for skills and commands', () => {
      const assistant = new AssistantLoop();
      expect(Array.isArray(assistant.getSkills())).toBe(true);
      expect(Array.isArray(assistant.getCommands())).toBe(true);
    });
  });

  describe('token usage', () => {
    test('should update token usage and invoke callback', () => {
      let lastUsage: any = null;
      const assistant = new AssistantLoop({
        onTokenUsage: (usage) => {
          lastUsage = usage;
        },
      });

      assistant.updateTokenUsage({ outputTokens: 5, inputTokens: 2 });
      const usage = assistant.getTokenUsage();

      expect(usage.outputTokens).toBeGreaterThan(0);
      expect(lastUsage).not.toBeNull();
    });
  });

  describe('session id', () => {
    test('should return provided session id', () => {
      const assistant = new AssistantLoop({ sessionId: 'session-123' });
      expect(assistant.getSessionId()).toBe('session-123');
    });
  });

  describe('clearConversation', () => {
    test('should reapply system prompts on clear', () => {
      const assistant = new AssistantLoop();
      (assistant as any).systemPrompt = 'System prompt';
      (assistant as any).extraSystemPrompt = 'Extra prompt';

      assistant.clearConversation();

      const systemMessages = assistant.getContext().getMessages().filter((m) => m.role === 'system');
      const combined = systemMessages.map((m) => m.content).join('\n');
      expect(combined).toContain('System prompt');
      expect(combined).toContain('Extra prompt');
    });
  });

  describe('stop', () => {
    test('should not throw when called', () => {
      const assistant = new AssistantLoop();
      expect(() => assistant.stop()).not.toThrow();
    });
  });

  describe('process', () => {
    test('should throw when not initialized', async () => {
      const assistant = new AssistantLoop();

      await expect(assistant.process('Hello')).rejects.toThrow('Assistant not initialized');
    });
  });

  describe('skill invocation detection', () => {
    test('should recognize skill pattern', () => {
      // Test the regex pattern used for skill detection
      const pattern = /^\/(\S+)(?:\s+(.*))?$/;

      expect('/search hello'.match(pattern)).toBeTruthy();
      expect('/calendar'.match(pattern)).toBeTruthy();
      expect('/notes take a note'.match(pattern)).toBeTruthy();
      expect('not a skill'.match(pattern)).toBeFalsy();
      expect('/'.match(pattern)).toBeFalsy();
    });

    test('should extract skill name and args', () => {
      const pattern = /^\/(\S+)(?:\s+(.*))?$/;

      const match1 = '/search hello world'.match(pattern);
      expect(match1?.[1]).toBe('search');
      expect(match1?.[2]).toBe('hello world');

      const match2 = '/calendar'.match(pattern);
      expect(match2?.[1]).toBe('calendar');
      expect(match2?.[2]).toBeUndefined();
    });
  });
});
