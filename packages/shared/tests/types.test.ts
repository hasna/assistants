import { describe, expect, test } from 'bun:test';
import type {
  Message,
  MessageRole,
  StreamChunk,
  Tool,
  ToolCall,
  ToolResult,
  ToolParameters,
  ToolProperty,
  Connector,
  ConnectorCommand,
  ConnectorArg,
  ConnectorOption,
  ConnectorAuth,
  Skill,
  SkillFrontmatter,
  HookEvent,
  HookConfig,
  HookMatcher,
  HookHandler,
  HookInput,
  HookOutput,
  Session,
  AssistantsConfig,
  LLMConfig,
  VoiceConfig,
  AssistantClient,
} from '../src/types';

// Type-level tests - these verify the types are correctly exported and structured

describe('Message types', () => {
  test('Message should have required fields', () => {
    const message: Message = {
      id: 'test-id',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    };
    expect(message.id).toBe('test-id');
    expect(message.role).toBe('user');
    expect(message.content).toBe('Hello');
    expect(typeof message.timestamp).toBe('number');
  });

  test('Message should allow optional toolCalls and toolResults', () => {
    const message: Message = {
      id: 'test-id',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [{ id: 'tc1', name: 'test', input: {} }],
      toolResults: [{ toolCallId: 'tc1', content: 'result' }],
    };
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolResults).toHaveLength(1);
  });

  test('MessageRole should be union type', () => {
    const roles: MessageRole[] = ['user', 'assistant', 'system'];
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    expect(roles).toContain('system');
  });
});

describe('StreamChunk types', () => {
  test('text chunk', () => {
    const chunk: StreamChunk = { type: 'text', content: 'Hello' };
    expect(chunk.type).toBe('text');
  });

  test('tool_use chunk', () => {
    const chunk: StreamChunk = {
      type: 'tool_use',
      toolCall: { id: 'tc1', name: 'test', input: {} },
    };
    expect(chunk.type).toBe('tool_use');
  });

  test('error chunk', () => {
    const chunk: StreamChunk = { type: 'error', error: 'Something went wrong' };
    expect(chunk.type).toBe('error');
  });

  test('done chunk', () => {
    const chunk: StreamChunk = { type: 'done' };
    expect(chunk.type).toBe('done');
  });
});

describe('Tool types', () => {
  test('Tool should have name, description, and parameters', () => {
    const tool: Tool = {
      name: 'read_file',
      description: 'Read a file from disk',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    };
    expect(tool.name).toBe('read_file');
    expect(tool.parameters.type).toBe('object');
  });

  test('ToolProperty should support various types', () => {
    const properties: Record<string, ToolProperty> = {
      stringProp: { type: 'string', description: 'A string' },
      numberProp: { type: 'number', description: 'A number' },
      boolProp: { type: 'boolean', description: 'A boolean' },
      arrayProp: {
        type: 'array',
        description: 'An array',
        items: { type: 'string', description: 'Item' },
      },
      unionProp: {
        type: ['array', 'string'],
        description: 'Array or comma-separated string',
        items: { type: 'string', description: 'Item' },
      },
      enumProp: { type: 'string', description: 'Enum', enum: ['a', 'b', 'c'] },
    };
    expect(properties.stringProp.type).toBe('string');
    expect(Array.isArray(properties.unionProp.type)).toBe(true);
    expect(properties.enumProp.enum).toContain('b');
  });
});

describe('Connector types', () => {
  test('Connector should have required fields', () => {
    const connector: Connector = {
      name: 'notion',
      cli: 'connect-notion',
      description: 'Notion integration',
      commands: [
        {
          name: 'search',
          description: 'Search pages',
          args: [{ name: 'query', required: true }],
          options: [{ name: 'limit', type: 'number', default: 10 }],
        },
      ],
    };
    expect(connector.name).toBe('notion');
    expect(connector.commands).toHaveLength(1);
  });

  test('ConnectorAuth types', () => {
    const authTypes: ConnectorAuth['type'][] = ['oauth2', 'api_key', 'none'];
    expect(authTypes).toContain('oauth2');
  });
});

describe('Skill types', () => {
  test('Skill should have required fields', () => {
    const skill: Skill = {
      name: 'calendar',
      description: 'View calendar',
      content: '# Calendar\n\nShow events',
      filePath: '/skills/calendar/SKILL.md',
    };
    expect(skill.name).toBe('calendar');
    expect(skill.content).toContain('Calendar');
  });

  test('SkillFrontmatter optional fields', () => {
    const frontmatter: SkillFrontmatter = {
      name: 'test',
      description: 'Test skill',
      'argument-hint': '[arg]',
      'allowed-tools': 'bash, notion',
      'user-invocable': true,
      model: 'claude-3-opus',
      context: 'fork',
    };
    expect(frontmatter['user-invocable']).toBe(true);
    expect(frontmatter.context).toBe('fork');
  });
});

describe('Hook types', () => {
  test('HookEvent should be valid event names', () => {
    const events: HookEvent[] = [
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Stop',
    ];
    expect(events).toHaveLength(7);
  });

  test('HookConfig structure', () => {
    const config: HookConfig = {
      PreToolUse: [
        {
          matcher: 'bash',
          hooks: [{ type: 'command', command: './validate.sh' }],
        },
      ],
    };
    expect(config.PreToolUse).toHaveLength(1);
  });

  test('HookHandler types', () => {
    const handlers: HookHandler[] = [
      { type: 'command', command: 'echo test' },
      { type: 'prompt', prompt: 'Is this safe?' },
      { type: 'assistant', prompt: 'Validate input', model: 'claude-3-haiku' },
    ];
    expect(handlers[0].type).toBe('command');
    expect(handlers[1].type).toBe('prompt');
    expect(handlers[2].type).toBe('assistant');
  });

  test('HookInput structure', () => {
    const input: HookInput = {
      session_id: 'sess-123',
      hook_event_name: 'PreToolUse',
      cwd: '/home/user',
      tool_name: 'bash',
      tool_input: { command: 'ls' },
    };
    expect(input.hook_event_name).toBe('PreToolUse');
  });

  test('HookOutput options', () => {
    const outputs: HookOutput[] = [
      { continue: true },
      { continue: false, stopReason: 'Blocked' },
      { permissionDecision: 'allow' },
      { additionalContext: 'Extra info' },
    ];
    expect(outputs[0].continue).toBe(true);
    expect(outputs[1].stopReason).toBe('Blocked');
    expect(outputs[2].permissionDecision).toBe('allow');
  });
});

describe('Config types', () => {
  test('AssistantsConfig structure', () => {
    const config: AssistantsConfig = {
      llm: {
        provider: 'anthropic',
        model: 'claude-3-opus',
        maxTokens: 4096,
      },
      connectors: ['notion', 'gmail'],
      skills: ['calendar', 'notes'],
    };
    expect(config.llm.provider).toBe('anthropic');
    expect(config.connectors).toContain('notion');
  });

  test('VoiceConfig structure', () => {
    const voice: VoiceConfig = {
      enabled: true,
      stt: { provider: 'whisper', model: 'base', language: 'en' },
      tts: { provider: 'elevenlabs', voiceId: 'voice-123' },
      wake: { enabled: true, word: 'hey assistants' },
    };
    expect(voice.enabled).toBe(true);
    expect(voice.wake?.word).toBe('hey assistants');
  });
});

describe('Session type', () => {
  test('Session structure', () => {
    const session: Session = {
      id: 'sess-123',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        { id: 'msg-1', role: 'user', content: 'Hi', timestamp: Date.now() },
      ],
      metadata: { source: 'terminal' },
    };
    expect(session.messages).toHaveLength(1);
    expect(session.metadata?.source).toBe('terminal');
  });
});
