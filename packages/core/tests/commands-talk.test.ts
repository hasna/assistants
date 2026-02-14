import { describe, expect, test, beforeEach } from 'bun:test';
import { CommandLoader } from '../src/commands/loader';
import { CommandExecutor } from '../src/commands/executor';
import { BuiltinCommands } from '../src/commands/builtin';
import type { CommandContext } from '../src/commands/types';

describe('/talk command', () => {
  let loader: CommandLoader;
  let executor: CommandExecutor;
  let emittedChunks: Array<{ type: string; content?: string }>;

  function makeContext(overrides?: Partial<CommandContext>): CommandContext {
    return {
      cwd: process.cwd(),
      sessionId: 'test-session',
      messages: [],
      tools: [],
      skills: [],
      connectors: [],
      clearMessages: () => {},
      addSystemMessage: () => {},
      emit: (type, content) => {
        emittedChunks.push({ type, content });
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    loader = new CommandLoader();
    executor = new CommandExecutor(loader);
    emittedChunks = [];

    const builtins = new BuiltinCommands();
    builtins.registerAll(loader);
  });

  test('/talk command is registered', () => {
    const cmd = loader.getCommand('talk');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('talk');
    expect(cmd?.selfHandled).toBe(true);
    expect(cmd?.description).toContain('voice conversation');
  });

  test('returns handled:true when voice not available', async () => {
    const context = makeContext();
    const result = await executor.execute('/talk', context);

    expect(result.handled).toBe(true);
    expect(emittedChunks.some(c => c.content?.includes('not available'))).toBe(true);
    expect(emittedChunks.some(c => c.type === 'done')).toBe(true);
  });

  test('returns handled:true when talk is available but processForTalk is missing', async () => {
    const context = makeContext({
      talk: async () => {},
      // processForTalk is missing
    });
    const result = await executor.execute('/talk', context);

    expect(result.handled).toBe(true);
    expect(emittedChunks.some(c => c.content?.includes('not available'))).toBe(true);
  });

  test('emits talk mode start/end messages when talk succeeds', async () => {
    let talkCallCount = 0;

    const context = makeContext({
      talk: async (options) => {
        talkCallCount++;
        // Simulate one transcript + response cycle, then exit
        options.onTranscript('hello there');
        const resp = await options.sendMessage('hello there');
        options.onResponse(resp);
      },
      processForTalk: async (text) => `response to ${text}`,
    });

    const result = await executor.execute('/talk', context);

    expect(result.handled).toBe(true);
    expect(talkCallCount).toBe(1);

    // Should emit start message
    expect(emittedChunks.some(c => c.content?.includes('Talk Mode') || c.content?.includes('Live conversation'))).toBe(true);
    // Should emit transcript
    expect(emittedChunks.some(c => c.content?.includes('hello there'))).toBe(true);
    // Should emit end message
    expect(emittedChunks.some(c => c.content?.includes('Talk mode ended'))).toBe(true);
    // Should emit done
    expect(emittedChunks.some(c => c.type === 'done')).toBe(true);
  });

  test('handles errors in talk loop gracefully', async () => {
    const context = makeContext({
      talk: async () => {
        throw new Error('Microphone not found');
      },
      processForTalk: async () => '',
    });

    const result = await executor.execute('/talk', context);

    expect(result.handled).toBe(true);
    expect(emittedChunks.some(c => c.type === 'error' && c.content?.includes('Microphone not found'))).toBe(true);
    expect(emittedChunks.some(c => c.content?.includes('Talk mode ended'))).toBe(true);
  });

  test('does not emit error for "Talk mode stopped" message', async () => {
    const context = makeContext({
      talk: async () => {
        throw new Error('Talk mode stopped');
      },
      processForTalk: async () => '',
    });

    const result = await executor.execute('/talk', context);

    expect(result.handled).toBe(true);
    // Should NOT emit error for this specific message
    expect(emittedChunks.some(c => c.type === 'error')).toBe(false);
    // Should still emit end message
    expect(emittedChunks.some(c => c.content?.includes('Talk mode ended'))).toBe(true);
  });

  test('sendMessage callback uses processForTalk', async () => {
    const processForTalkCalls: string[] = [];

    const context = makeContext({
      talk: async (options) => {
        const resp = await options.sendMessage('test message');
        expect(resp).toBe('processed: test message');
      },
      processForTalk: async (text) => {
        processForTalkCalls.push(text);
        return `processed: ${text}`;
      },
    });

    await executor.execute('/talk', context);

    expect(processForTalkCalls).toEqual(['test message']);
  });
});
