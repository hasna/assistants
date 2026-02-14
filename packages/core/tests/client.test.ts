import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Message, Tool, Skill, StreamChunk } from '@hasna/assistants-shared';
import type { Command } from '../src/commands';
import { EmbeddedClient } from '../src/client';

class MockContext {
  private messages: Message[] = [];

  import(messages: Message[]) {
    this.messages = [...messages];
  }

  addUserMessage(content: string) {
    this.messages.push({
      id: `u-${this.messages.length + 1}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(content: string) {
    this.messages.push({
      id: `a-${this.messages.length + 1}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }
}

class TruncatingContext {
  private messages: Message[] = [];

  addUserMessage(content: string) {
    this.messages.push({
      id: `u-${this.messages.length + 1}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  addAssistantMessage(content: string) {
    this.messages.push({
      id: `a-${this.messages.length + 1}`,
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  prune(limit: number) {
    if (this.messages.length > limit) {
      this.messages = this.messages.slice(-limit);
    }
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  clear() {
    this.messages = [];
  }
}

let lastOptions: any;
let shutdownCalled = false;

class MockAssistantLoop {
  private context = new MockContext();
  private processing = false;

  constructor(options: any) {
    lastOptions = options;
  }

  async initialize() {}

  async process(message: string) {
    if (message === 'fail') {
      throw new Error('boom');
    }
    if (message === 'fail-stream') {
      lastOptions?.onChunk?.({ type: 'error', error: 'boom' } as StreamChunk);
      lastOptions?.onChunk?.({ type: 'done' } as StreamChunk);
      throw new Error('boom');
    }
    this.processing = true;
    this.context.addUserMessage(message);
    this.context.addAssistantMessage('ok');
    const toolCall = { id: 't1', name: 'bash', input: { command: 'ls' } };
    lastOptions?.onToolStart?.(toolCall);
    lastOptions?.onToolEnd?.(toolCall, { toolCallId: 't1', content: 'ok', isError: false });
    lastOptions?.onChunk?.({ type: 'text', content: 'ok' } as StreamChunk);
    lastOptions?.onChunk?.({ type: 'done' } as StreamChunk);
    this.processing = false;
  }

  getContext() {
    return this.context;
  }

  getTools(): Tool[] {
    return [{ name: 'tool', description: 't', parameters: { type: 'object', properties: {} } }];
  }

  getSkills(): Skill[] {
    return [{ name: 'skill', description: 's' }];
  }

  getCommands(): Command[] {
    return [{ name: 'cmd', description: 'c', content: '', builtin: true }];
  }

  getTokenUsage() {
    return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 10 };
  }

  stop() {
    this.processing = false;
  }

  isProcessing() {
    return this.processing;
  }

  clearConversation() {
    this.context.clear();
  }

  shutdown() {
    shutdownCalled = true;
  }
}

class TruncatingAssistantLoop {
  private context = new TruncatingContext();
  private processing = false;

  constructor(options: any) {
    lastOptions = options;
  }

  async initialize() {}

  async process(message: string) {
    this.processing = true;
    this.context.addUserMessage(message);
    this.context.addAssistantMessage('ok');
    this.context.prune(2);
    lastOptions?.onChunk?.({ type: 'text', content: 'ok' } as StreamChunk);
    lastOptions?.onChunk?.({ type: 'done' } as StreamChunk);
    this.processing = false;
  }

  getContext() {
    return this.context;
  }

  getTools(): Tool[] {
    return [{ name: 'tool', description: 't', parameters: { type: 'object', properties: {} } }];
  }

  getSkills(): Skill[] {
    return [{ name: 'skill', description: 's' }];
  }

  getCommands(): Command[] {
    return [{ name: 'cmd', description: 'c', content: '', builtin: true }];
  }

  getTokenUsage() {
    return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 10 };
  }

  stop() {
    this.processing = false;
  }

  isProcessing() {
    return this.processing;
  }

  clearConversation() {
    this.context.clear();
  }
}

class BlockingAssistantLoop {
  private context = new MockContext();
  private processing = false;
  private block = true;
  private releaseBlock: (() => void) | null = null;
  private blocker: Promise<void>;

  constructor(options: any) {
    lastOptions = options;
    this.blocker = new Promise((resolve) => {
      this.releaseBlock = resolve;
    });
  }

  async initialize() {}

  async process(message: string) {
    this.processing = true;
    this.context.addUserMessage(message);
    this.context.addAssistantMessage('ok');
    lastOptions?.onChunk?.({ type: 'text', content: 'ok' } as StreamChunk);

    if (this.block) {
      await this.blocker;
      this.block = false;
    }

    this.processing = false;
    lastOptions?.onChunk?.({ type: 'done' } as StreamChunk);
  }

  release() {
    this.releaseBlock?.();
  }

  getContext() {
    return this.context;
  }

  getTools(): Tool[] {
    return [{ name: 'tool', description: 't', parameters: { type: 'object', properties: {} } }];
  }

  getSkills(): Skill[] {
    return [{ name: 'skill', description: 's' }];
  }

  getCommands(): Command[] {
    return [{ name: 'cmd', description: 'c', content: '', builtin: true }];
  }

  getTokenUsage() {
    return { inputTokens: 1, outputTokens: 2, totalTokens: 3, maxContextTokens: 10 };
  }

  stop() {
    this.processing = false;
  }

  isProcessing() {
    return this.processing;
  }

  clearConversation() {
    this.context.clear();
  }
}

let tempDir: string;
let originalAssistantsDir: string | undefined;

beforeEach(() => {
  originalAssistantsDir = process.env.ASSISTANTS_DIR;
  tempDir = mkdtempSync(join(tmpdir(), 'assistants-client-'));
  process.env.ASSISTANTS_DIR = tempDir;
});

afterEach(() => {
  process.env.ASSISTANTS_DIR = originalAssistantsDir;
  rmSync(tempDir, { recursive: true, force: true });
});

describe('EmbeddedClient', () => {
  test('disconnect calls shutdown when available', async () => {
    shutdownCalled = false;
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    await client.initialize();
    client.disconnect();
    expect(shutdownCalled).toBe(true);
  });
  test('uses default assistant factory when none provided', () => {
    const client = new EmbeddedClient(tempDir, { sessionId: 'sess-default' });
    expect(client.getSessionId()).toBe('sess-default');
  });

  test('initializes with initial messages', async () => {
    const initialMessages: Message[] = [
      { id: '1', role: 'user', content: 'hi', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'hello', timestamp: 2 },
    ];

    const client = new EmbeddedClient(tempDir, {
      initialMessages,
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    await client.initialize();

    const messages = client.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('hi');
  });

  test('send updates messages and emits chunks', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    const chunks: StreamChunk[] = [];
    client.onChunk((chunk) => chunks.push(chunk));

    await client.send('ping');

    expect(chunks.length).toBeGreaterThan(0);
    const messages = client.getMessages();
    expect(messages.at(-1)?.role).toBe('assistant');
    expect(messages.at(-1)?.content).toBe('ok');
  });

  test('retains full history even if context prunes', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new TruncatingAssistantLoop(options) as any,
    });

    await client.send('one');
    await client.send('two');

    const messages = client.getMessages();
    expect(messages.map((m) => m.content)).toEqual(['one', 'ok', 'two', 'ok']);
  });

  test('clearConversation resets messages', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    await client.send('hello');
    expect(client.getMessages().length).toBeGreaterThan(0);
    client.clearConversation();
    expect(client.getMessages()).toHaveLength(0);
  });

  test('proxies tools, skills, and commands', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    expect((await client.getTools())[0].name).toBe('tool');
    expect((await client.getSkills())[0].name).toBe('skill');
    expect((await client.getCommands())[0].name).toBe('cmd');
  });

  test('stop, disconnect, and token usage work', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    await client.send('hello');
    expect(client.getTokenUsage().totalTokens).toBe(3);

    client.stop();
    expect(client.isProcessing()).toBe(false);

    client.disconnect();
    expect(client.getSessionId()).toBe('sess');
    expect(client.getCwd()).toBe(tempDir);
    expect(typeof client.getStartedAt()).toBe('string');
  });

  test('propagates errors to callbacks', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    const errors: Error[] = [];
    client.onError((err) => errors.push(err));

    await client.send('fail');

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('boom');
  });

  test('does not propagate errors when error chunk already emitted', async () => {
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => new MockAssistantLoop(options) as any,
    });
    const errors: Error[] = [];
    const chunks: StreamChunk[] = [];
    client.onError((err) => errors.push(err));
    client.onChunk((chunk) => chunks.push(chunk));

    await client.send('fail-stream');

    expect(errors.length).toBe(0);
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true);
  });

  test('drains queued messages when assistant finishes', async () => {
    let assistant: BlockingAssistantLoop | null = null;
    const client = new EmbeddedClient(tempDir, {
      sessionId: 'sess',
      assistantFactory: (options) => {
        assistant = new BlockingAssistantLoop(options);
        return assistant as any;
      },
    });
    await client.initialize();

    const first = client.send('first');
    await new Promise((resolve) => setTimeout(resolve, 0));

    await client.send('second');
    expect(client.getQueueLength()).toBe(1);

    assistant?.release();
    await first;

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueueLength()).toBe(0);
    expect(client.getMessages().some((msg) => msg.role === 'assistant')).toBe(true);
  });
});
