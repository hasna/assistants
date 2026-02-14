import { describe, expect, test, beforeEach, mock } from 'bun:test';

let mockChunks: any[] = [];
let mockClientError: Error | null = null;
let latestMessage: string | null = null;
let stopped = false;
let disconnected = false;
let mockHasLatestSession = true;
let capturedClientCwd: string | null = null;
let capturedClientOptions: any = null;
let mockResumeSessionData: { cwd: string; messages: any[]; startedAt: number } | null = null;

class MockCommandHistory {
  async load() {
    return;
  }
  async add() {
    return;
  }
  resetIndex() {
    return;
  }
  previous() {
    return null;
  }
  next() {
    return null;
  }
  isNavigating() {
    return false;
  }
}

mock.module('@hasna/assistants-core', () => ({
  CommandHistory: MockCommandHistory,
  getCommandHistory: () => new MockCommandHistory(),
  EmbeddedClient: class EmbeddedClient {
    private sessionId: string;
    private chunkHandlers: Array<(chunk: any) => void> = [];
    private errorHandlers: Array<(err: Error) => void> = [];

    constructor(cwd: string, options: { sessionId?: string; initialMessages?: any[]; systemPrompt?: string; allowedTools?: string[] }) {
      capturedClientCwd = cwd;
      capturedClientOptions = options;
      this.sessionId = options.sessionId ?? 'session-new';
    }

    async initialize() {
      return;
    }

    onChunk(cb: (chunk: any) => void) {
      this.chunkHandlers.push(cb);
    }

    onError(cb: (err: Error) => void) {
      this.errorHandlers.push(cb);
    }

    async send(message: string) {
      latestMessage = message;
      // Trigger client error if set
      if (mockClientError) {
        for (const handler of this.errorHandlers) {
          handler(mockClientError);
        }
      }
      for (const chunk of mockChunks) {
        for (const handler of this.chunkHandlers) {
          handler(chunk);
        }
      }
    }

    getSessionId() {
      return this.sessionId;
    }

    getTokenUsage() {
      return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 100 };
    }

    stop() {
      stopped = true;
    }

    disconnect() {
      disconnected = true;
    }
  },
  SessionStorage: {
    loadSession: (id: string) => {
      if (id === 'exists') {
        return { cwd: '/tmp/session-cwd', messages: [{ role: 'user', content: 'previous' }], startedAt: 12345 };
      }
      if (id === 'resume-session' && mockResumeSessionData) {
        return mockResumeSessionData;
      }
      return null;
    },
    getLatestSession: () => (mockHasLatestSession ? { id: 'exists' } : null),
  },
}));

const { runHeadless } = await import('../src/headless');

describe('runHeadless', () => {
  beforeEach(() => {
    mockChunks = [];
    mockClientError = null;
    latestMessage = null;
    stopped = false;
    disconnected = false;
    mockHasLatestSession = true;
    capturedClientCwd = null;
    capturedClientOptions = null;
    mockResumeSessionData = null;
  });

  test('outputs JSON with tool calls and structured output', async () => {
    const originalLog = console.log;
    let captured = '';
    console.log = (msg?: any) => {
      captured = String(msg ?? '');
    };

    mockChunks = [
      { type: 'text', content: '{"ok":true}' },
      { type: 'tool_use', toolCall: { id: 't1', name: 'bash', input: { command: 'ls' } } },
      { type: 'done' },
    ];

    const result = await runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'json',
      jsonSchema: '{"type":"object"}',
    });

    const parsed = JSON.parse(captured);
    expect(parsed.result).toBe('{"ok":true}');
    expect(parsed.tool_calls.length).toBe(1);
    expect(parsed.structured_output.ok).toBe(true);
    expect(latestMessage).toContain('IMPORTANT:');
    expect(disconnected).toBe(true);

    // Check return value
    expect(result.success).toBe(true);
    expect(result.result).toBe('{"ok":true}');
    expect(result.toolCalls.length).toBe(1);
    expect(result.structuredOutput).toEqual({ ok: true });

    console.log = originalLog;
  });

  test('stream-json outputs events and returns success=false on error', async () => {
    const originalWrite = process.stdout.write;
    let stdout = '';
    (process.stdout as any).write = (chunk: any) => {
      stdout += String(chunk);
    };

    mockChunks = [
      { type: 'text', content: 'hello' },
      { type: 'tool_result', toolResult: { toolCallId: 't1', content: 'boom', isError: true } },
      { type: 'done' },
    ];

    const result = await runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'stream-json',
    });

    expect(stdout).toContain('text_delta');
    expect(stdout).toContain('tool_result');
    // Check return value indicates failure
    expect(result.success).toBe(false);
    expect(result.error).toBe('boom');

    process.stdout.write = originalWrite;
  });

  test('throws for missing resume session', async () => {
    await expect(runHeadless({
      prompt: 'Test',
      cwd: '/tmp',
      outputFormat: 'text',
      resume: 'missing',
    })).rejects.toThrow('Session missing not found');
  });

  describe('--continue with no sessions', () => {
    test('uses provided cwd when no latest session exists', async () => {
      mockHasLatestSession = false;
      mockChunks = [
        { type: 'text', content: 'hello' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Test prompt',
        cwd: '/my/custom/cwd',
        outputFormat: 'text',
        continue: true,
      });

      process.stdout.write = originalWrite;

      // Should use the provided cwd since no session exists
      expect(capturedClientCwd).toBe('/my/custom/cwd');
      // Should not have a sessionId
      expect(capturedClientOptions.sessionId).toBeUndefined();
      // Should not have initialMessages
      expect(capturedClientOptions.initialMessages).toBeUndefined();
    });

    test('starts new session without initial messages when no latest session exists', async () => {
      mockHasLatestSession = false;
      mockChunks = [
        { type: 'text', content: 'response' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'New conversation',
        cwd: '/workspace',
        outputFormat: 'text',
        continue: true,
      });

      process.stdout.write = originalWrite;

      // Should create a new session (no sessionId passed)
      expect(capturedClientOptions.sessionId).toBeUndefined();
      // Should have no initial messages
      expect(capturedClientOptions.initialMessages).toBeUndefined();
      // Should use provided cwd
      expect(capturedClientCwd).toBe('/workspace');
    });

    test('does not throw when --continue finds no sessions', async () => {
      mockHasLatestSession = false;
      mockChunks = [
        { type: 'text', content: 'ok' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      // Should not throw - just start a new session and return HeadlessResult
      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
        continue: true,
      });

      expect(result.success).toBe(true);
      expect(result.result).toBe('ok');

      process.stdout.write = originalWrite;
    });
  });

  describe('--continue with existing session', () => {
    test('uses session cwd when cwdProvided is false', async () => {
      mockHasLatestSession = true;
      mockChunks = [
        { type: 'text', content: 'continued' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Continue prompt',
        cwd: '/fallback/cwd',
        outputFormat: 'text',
        continue: true,
        cwdProvided: false,
      });

      process.stdout.write = originalWrite;

      // Should use session's cwd (/tmp/session-cwd) since cwdProvided is false
      expect(capturedClientCwd).toBe('/tmp/session-cwd');
      // Should have the existing session ID
      expect(capturedClientOptions.sessionId).toBe('exists');
      // Should have initial messages from the session
      expect(capturedClientOptions.initialMessages).toEqual([{ role: 'user', content: 'previous' }]);
    });

    test('uses provided cwd when cwdProvided is true', async () => {
      mockHasLatestSession = true;
      mockChunks = [
        { type: 'text', content: 'continued' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Continue prompt',
        cwd: '/explicit/cwd',
        outputFormat: 'text',
        continue: true,
        cwdProvided: true,
      });

      process.stdout.write = originalWrite;

      // Should use explicit cwd since cwdProvided is true
      expect(capturedClientCwd).toBe('/explicit/cwd');
      // Should still have the session context
      expect(capturedClientOptions.sessionId).toBe('exists');
    });
  });

  describe('JSON output format', () => {
    test('tool_result error adds error field and returns success=false', async () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg?: any) => {
        captured = String(msg ?? '');
      };

      mockChunks = [
        { type: 'text', content: 'partial response' },
        { type: 'tool_result', toolResult: { toolCallId: 't1', content: 'Tool failed', isError: true } },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
      });

      const parsed = JSON.parse(captured);
      expect(parsed.error).toBe('Tool failed');
      // Check return value indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool failed');

      console.log = originalLog;
    });

    test('error chunk adds error field and returns success=false', async () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg?: any) => {
        captured = String(msg ?? '');
      };

      mockChunks = [
        { type: 'text', content: 'some text' },
        { type: 'error', error: 'API rate limit exceeded' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
      });

      const parsed = JSON.parse(captured);
      expect(parsed.error).toBe('API rate limit exceeded');
      // Check return value indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('API rate limit exceeded');

      console.log = originalLog;
    });

    test('usage is included in JSON output', async () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg?: any) => {
        captured = String(msg ?? '');
      };

      mockChunks = [
        { type: 'text', content: 'response' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
      });

      const parsed = JSON.parse(captured);
      // Usage comes from getTokenUsage() mock
      expect(parsed.usage).toBeDefined();
      expect(parsed.usage.inputTokens).toBe(1);
      expect(parsed.usage.outputTokens).toBe(2);
      expect(parsed.usage.totalTokens).toBe(3);

      console.log = originalLog;
    });

    test('invalid JSON with jsonSchema does not throw and leaves structured_output undefined', async () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg?: any) => {
        captured = String(msg ?? '');
      };

      mockChunks = [
        { type: 'text', content: 'This is not valid JSON at all' },
        { type: 'done' },
      ];

      // Should not throw - returns HeadlessResult
      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
        jsonSchema: '{"type":"object"}',
      });

      const parsed = JSON.parse(captured);
      expect(parsed.result).toBe('This is not valid JSON at all');
      expect(parsed.structured_output).toBeUndefined();

      // Return value should also have undefined structuredOutput
      expect(result.success).toBe(true);
      expect(result.structuredOutput).toBeUndefined();

      console.log = originalLog;
    });

    test('partial JSON with jsonSchema does not throw', async () => {
      const originalLog = console.log;
      let captured = '';
      console.log = (msg?: any) => {
        captured = String(msg ?? '');
      };

      mockChunks = [
        { type: 'text', content: '{"incomplete": true' }, // Missing closing brace
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
        jsonSchema: '{"type":"object"}',
      });

      const parsed = JSON.parse(captured);
      expect(parsed.result).toBe('{"incomplete": true');
      expect(parsed.structured_output).toBeUndefined();

      // Return value should also have undefined structuredOutput
      expect(result.success).toBe(true);
      expect(result.structuredOutput).toBeUndefined();

      console.log = originalLog;
    });
  });

  describe('stream-json output format', () => {
    test('emits usage event with correct shape', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'hello' },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      // Parse each line
      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      // Find usage event
      const usageEvent = lines.find((e) => e.type === 'usage');
      expect(usageEvent).toBeDefined();
      expect(usageEvent.type).toBe('usage');
      expect(usageEvent.usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
      expect(typeof usageEvent.timestamp).toBe('number');
    });

    test('emits done event with timestamp', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'response' },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      const doneEvent = lines.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      expect(doneEvent.type).toBe('done');
      expect(typeof doneEvent.timestamp).toBe('number');
    });

    test('emits error event with correct shape', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'partial' },
        { type: 'error', error: 'Connection lost' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      const errorEvent = lines.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.type).toBe('error');
      expect(errorEvent.error).toBe('Connection lost');
      expect(typeof errorEvent.timestamp).toBe('number');

      // Check return value indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection lost');
    });

    test('emits text_delta events for text chunks', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'hello ' },
        { type: 'text', content: 'world' },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      const textEvents = lines.filter((e) => e.type === 'text_delta');
      expect(textEvents.length).toBe(2);
      expect(textEvents[0].text).toBe('hello ');
      expect(textEvents[1].text).toBe('world');
      expect(typeof textEvents[0].timestamp).toBe('number');
    });

    test('emits tool_use events with correct shape', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'tool_use', toolCall: { id: 'call-1', name: 'Read', input: { file: 'test.txt' } } },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      const toolUseEvent = lines.find((e) => e.type === 'tool_use');
      expect(toolUseEvent).toBeDefined();
      expect(toolUseEvent.tool_call.id).toBe('call-1');
      expect(toolUseEvent.tool_call.name).toBe('Read');
      expect(toolUseEvent.tool_call.input).toEqual({ file: 'test.txt' });
      expect(typeof toolUseEvent.timestamp).toBe('number');
    });

    test('emits tool_result events with correct shape', async () => {
      const originalWrite = process.stdout.write;
      let stdout = '';
      (process.stdout as any).write = (chunk: any) => {
        stdout += String(chunk);
        return true;
      };

      mockChunks = [
        { type: 'tool_result', toolResult: { toolCallId: 'call-1', content: 'file contents', isError: false } },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'stream-json',
      });

      process.stdout.write = originalWrite;

      const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));

      const toolResultEvent = lines.find((e) => e.type === 'tool_result');
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent.tool_result.tool_call_id).toBe('call-1');
      expect(toolResultEvent.tool_result.content).toBe('file contents');
      expect(toolResultEvent.tool_result.is_error).toBe(false);
      expect(typeof toolResultEvent.timestamp).toBe('number');

      // Non-error tool result should not affect success
      expect(result.success).toBe(true);
    });
  });

  describe('text output format', () => {
    test('streams text chunks to stdout as they arrive', async () => {
      const originalWrite = process.stdout.write;
      const writes: string[] = [];
      (process.stdout as any).write = (chunk: any) => {
        writes.push(String(chunk));
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'Hello' },
        { type: 'text', content: ' ' },
        { type: 'text', content: 'World' },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      // Each text chunk should be written separately (streaming behavior)
      expect(writes).toContain('Hello');
      expect(writes).toContain(' ');
      expect(writes).toContain('World');
    });

    test('appends trailing newline when missing', async () => {
      const originalWrite = process.stdout.write;
      const writes: string[] = [];
      (process.stdout as any).write = (chunk: any) => {
        writes.push(String(chunk));
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'No newline at end' },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      // Should have the text plus a trailing newline
      expect(writes).toContain('No newline at end');
      expect(writes).toContain('\n');
    });

    test('does not add extra newline when already present', async () => {
      const originalWrite = process.stdout.write;
      const writes: string[] = [];
      (process.stdout as any).write = (chunk: any) => {
        writes.push(String(chunk));
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'Has newline\n' },
        { type: 'done' },
      ];

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      // Count newlines - should only be one
      const allOutput = writes.join('');
      expect(allOutput).toBe('Has newline\n');
    });

    test('writes tool_result errors to stderr', async () => {
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      const stderrWrites: string[] = [];
      (process.stdout as any).write = () => true;
      (process.stderr as any).write = (chunk: any) => {
        stderrWrites.push(String(chunk));
        return true;
      };

      mockChunks = [
        { type: 'text', content: 'partial' },
        { type: 'tool_result', toolResult: { toolCallId: 't1', content: 'Command failed', isError: true } },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;

      // Error should be written to stderr
      const stderrOutput = stderrWrites.join('');
      expect(stderrOutput).toContain('Error: Command failed');

      // Check return value indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed');
    });

    test('returns success=false on tool_result error', async () => {
      const originalWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      (process.stdout as any).write = () => true;
      (process.stderr as any).write = () => true;

      mockChunks = [
        { type: 'tool_result', toolResult: { toolCallId: 't1', content: 'Error', isError: true } },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;
      process.stderr.write = originalStderrWrite;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Error');
    });

    test('writes error chunks to stderr in text mode', async () => {
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      const stderrWrites: string[] = [];
      (process.stdout as any).write = () => true;
      (process.stderr as any).write = (chunk: any) => {
        stderrWrites.push(String(chunk));
        return true;
      };

      mockChunks = [
        { type: 'error', error: 'API Error occurred' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;

      const stderrOutput = stderrWrites.join('');
      expect(stderrOutput).toContain('Error: API Error occurred');

      // Check return value indicates failure
      expect(result.success).toBe(false);
      expect(result.error).toBe('API Error occurred');
    });
  });

  describe('EmbeddedClient options', () => {
    test('passes allowedTools to EmbeddedClient', async () => {
      mockChunks = [
        { type: 'text', content: 'ok' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
        allowedTools: ['Read', 'Edit', 'Bash'],
      });

      process.stdout.write = originalWrite;

      expect(capturedClientOptions.allowedTools).toEqual(['Read', 'Edit', 'Bash']);
    });

    test('passes systemPrompt to EmbeddedClient', async () => {
      mockChunks = [
        { type: 'text', content: 'ok' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
        systemPrompt: 'You are a helpful assistant',
      });

      process.stdout.write = originalWrite;

      expect(capturedClientOptions.systemPrompt).toBe('You are a helpful assistant');
    });

    test('passes both allowedTools and systemPrompt together', async () => {
      mockChunks = [
        { type: 'text', content: 'ok' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
        allowedTools: ['Glob'],
        systemPrompt: 'Be concise',
      });

      process.stdout.write = originalWrite;

      expect(capturedClientOptions.allowedTools).toEqual(['Glob']);
      expect(capturedClientOptions.systemPrompt).toBe('Be concise');
    });
  });

  describe('--resume overrides --continue', () => {
    test('uses resume session when both resume and continue are provided', async () => {
      mockHasLatestSession = true;
      mockResumeSessionData = {
        cwd: '/resume/cwd',
        messages: [{ role: 'user', content: 'resume message' }],
        startedAt: 99999,
      };

      mockChunks = [
        { type: 'text', content: 'ok' },
        { type: 'done' },
      ];

      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      await runHeadless({
        prompt: 'Test',
        cwd: '/fallback/cwd',
        outputFormat: 'text',
        continue: true,
        resume: 'resume-session',
      });

      process.stdout.write = originalWrite;

      // Should use resume session, not latest session
      expect(capturedClientCwd).toBe('/resume/cwd');
      expect(capturedClientOptions.sessionId).toBe('resume-session');
      expect(capturedClientOptions.initialMessages).toEqual([{ role: 'user', content: 'resume message' }]);
    });
  });

  describe('client.onError', () => {
    test('client error returns success=false', async () => {
      const originalLog = console.log;
      const originalError = console.error;
      console.log = () => {};
      console.error = () => {};

      mockClientError = new Error('Network connection lost');
      mockChunks = [
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
      });

      console.log = originalLog;
      console.error = originalError;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network connection lost');
    });

    test('client error outputs error message in text mode', async () => {
      const originalWrite = process.stdout.write;
      const originalError = console.error;
      let errorOutput = '';
      (process.stdout as any).write = () => true;
      console.error = (msg?: any) => {
        errorOutput += String(msg ?? '');
      };

      mockClientError = new Error('API key invalid');
      mockChunks = [
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;
      console.error = originalError;

      expect(errorOutput).toContain('API key invalid');
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key invalid');
    });

    test('client error outputs JSON error in json mode', async () => {
      const originalError = console.error;
      let errorOutput = '';
      console.error = (msg?: any) => {
        errorOutput += String(msg ?? '');
      };

      mockClientError = new Error('Rate limit exceeded');
      mockChunks = [
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'json',
      });

      console.error = originalError;

      const parsed = JSON.parse(errorOutput);
      expect(parsed.error).toBe('Rate limit exceeded');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
    });
  });

  describe('HeadlessResult return value', () => {
    test('includes sessionId in result', async () => {
      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      mockChunks = [
        { type: 'text', content: 'hello' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      expect(result.sessionId).toBe('session-new');
    });

    test('includes usage in result', async () => {
      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      mockChunks = [
        { type: 'text', content: 'hello' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      expect(result.usage).toBeDefined();
      expect(result.usage?.inputTokens).toBe(1);
      expect(result.usage?.outputTokens).toBe(2);
      expect(result.usage?.totalTokens).toBe(3);
    });

    test('includes toolCalls in result', async () => {
      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      mockChunks = [
        { type: 'tool_use', toolCall: { id: 't1', name: 'Bash', input: { command: 'ls' } } },
        { type: 'tool_use', toolCall: { id: 't2', name: 'Read', input: { file: 'test.txt' } } },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      expect(result.toolCalls.length).toBe(2);
      expect(result.toolCalls[0].name).toBe('Bash');
      expect(result.toolCalls[1].name).toBe('Read');
    });

    test('success is true when no errors occur', async () => {
      const originalWrite = process.stdout.write;
      (process.stdout as any).write = () => true;

      mockChunks = [
        { type: 'text', content: 'All good' },
        { type: 'done' },
      ];

      const result = await runHeadless({
        prompt: 'Test',
        cwd: '/tmp',
        outputFormat: 'text',
      });

      process.stdout.write = originalWrite;

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
