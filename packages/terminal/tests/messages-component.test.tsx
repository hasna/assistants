import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { Messages } from '../src/components/Messages';
import type { DisplayMessage } from '../src/components/messageLines';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

const createInkTestEnv = () => {
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const stdin = new PassThrough() as any;
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  return { stdout, stdin, getOutput: () => stripAnsi(output) };
};

describe('Messages component', () => {
  test('renders user and assistant messages with tool panels', async () => {
    const user: DisplayMessage = {
      id: 'u1',
      role: 'user',
      content: 'Run command',
      timestamp: 0,
      toolResults: [{ toolCallId: 't1', toolName: 'bash', content: 'ok', isError: false } as any],
    };
    const assistant: DisplayMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'Here you go',
      timestamp: 0,
      toolCalls: [{ id: 't1', name: 'bash', input: { command: 'ls' }, type: 'tool' } as any],
      toolResults: [{ toolCallId: 't1', toolName: 'bash', content: 'done', isError: false } as any],
    };

    const activityLog = [
      { id: 'act1', type: 'text' as const, content: 'Thinking', timestamp: 0 },
      { id: 'act2', type: 'tool_call' as const, toolCall: { id: 't2', name: 'read', input: { path: 'file' }, type: 'tool' } as ToolCall, timestamp: 0 },
      { id: 'act3', type: 'tool_result' as const, toolResult: { toolCallId: 't2', toolName: 'read', content: 'data', isError: false } as ToolResult, timestamp: 1000 },
    ];

    const env = createInkTestEnv();
    const instance = render(
      <Messages
        messages={[user, assistant]}
        currentResponse="Streaming response"
        activityLog={activityLog}
        queuedMessageIds={new Set(['u1'])}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await Promise.resolve();
    const frame = env.getOutput();
    expect(frame).toContain('Run command');
    expect(frame).toContain('Bash');
    expect(frame).toContain('ok');
    expect(frame).toContain('Here you go');
    expect(frame).toContain('Streaming response');
    instance.unmount();
  });

  test('renders streaming messages list', async () => {
    const streaming: DisplayMessage = {
      id: 's1',
      role: 'assistant',
      content: 'partial',
      timestamp: 0,
    };

    const env = createInkTestEnv();
    const instance = render(
      <Messages
        messages={[]}
        streamingMessages={[streaming]}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await Promise.resolve();
    const frame = env.getOutput();
    expect(frame).toContain('partial');
    instance.unmount();
  });

  test('renders listening draft label for draft messages', async () => {
    const draft: DisplayMessage = {
      id: 'listening-draft',
      role: 'user',
      content: 'dictating now',
      timestamp: 0,
    };

    const env = createInkTestEnv();
    const instance = render(
      <Messages
        messages={[]}
        streamingMessages={[draft]}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await Promise.resolve();
    const frame = env.getOutput();
    expect(frame).toContain('Live dictation');
    expect(frame).toContain('dictating now');
    instance.unmount();
  });
});
