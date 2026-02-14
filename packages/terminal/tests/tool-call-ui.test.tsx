import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { Messages } from '../src/components/Messages';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';
import type { DisplayMessage } from '../src/components/messageLines';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

const createInkTestEnv = () => {
  const stdout = new PassThrough();
  (stdout as any).columns = 100;
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

const wait = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Tool Call UI - New Style', () => {
  test('single running tool call shows "Calling ToolName(context)"', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'read', input: { file_path: '/src/components/App.tsx' } } as any,
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults: [],
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show "Calling Read(App.tsx)" format
    expect(output).toContain('Calling');
    expect(output).toContain('Read');
    expect(output).toContain('App.tsx');
    // Should NOT have old bordered panel headers
    expect(output).not.toContain('Tool Calls');
  });

  test('single completed tool call shows "ToolName(context)" without Calling prefix', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'read', input: { file_path: '/src/factory.ts' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'file contents here\nline 2\nline 3', isError: false, toolName: 'read' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show "Read(factory.ts)" without "Calling"
    expect(output).toContain('Read');
    expect(output).toContain('factory.ts');
    expect(output).not.toContain('Calling');
    // Should have tree connector for result
    expect(output).toContain('└');
    // Should NOT have old style
    expect(output).not.toContain('Tool Calls');
    expect(output).not.toContain('[succeeded]');
  });

  test('2+ tool calls show compact summary when not verbose', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'grep', input: { pattern: 'createAgentLoop' } } as any,
      { id: 'tc2', name: 'grep', input: { pattern: 'ToolCallPanel' } } as any,
      { id: 'tc3', name: 'read', input: { file_path: '/src/Messages.tsx' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'found 3 matches', isError: false, toolName: 'grep' },
      { toolCallId: 'tc2', content: 'found 5 matches', isError: false, toolName: 'grep' },
      { toolCallId: 'tc3', content: 'file contents', isError: false, toolName: 'read' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show compact summary
    expect(output).toContain('Searched 2 patterns');
    expect(output).toContain('read 1 file');
    expect(output).toContain('ctrl+o to expand');
  });

  test('2+ running tool calls show "…" suffix', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'grep', input: { pattern: 'pattern1' } } as any,
      { id: 'tc2', name: 'read', input: { file_path: '/src/file.ts' } } as any,
    ];
    // Only first result completed
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'found 3 matches', isError: false, toolName: 'grep' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show running summary with ellipsis
    expect(output).toContain('…');
    expect(output).toContain('ctrl+o to expand');
  });

  test('memory tool calls show compact memory summary', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'memory_recall', input: { key: 'user.timezone' } } as any,
      { id: 'tc2', name: 'memory_save', input: { key: 'project.stack', value: 'bun', category: 'fact' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: JSON.stringify({ found: true }), isError: false, toolName: 'memory_recall' },
      { toolCallId: 'tc2', content: JSON.stringify({ success: true }), isError: false, toolName: 'memory_save' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show memory-specific compact summary
    expect(output).toContain('Recalled 1 memory');
    expect(output).toContain('wrote 1 memory');
    expect(output).toContain('ctrl+o to expand');
  });

  test('verbose mode shows individual tool calls instead of summary', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'grep', input: { pattern: 'createAgentLoop' } } as any,
      { id: 'tc2', name: 'read', input: { file_path: '/src/Messages.tsx' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'found 3 matches', isError: false, toolName: 'grep' },
      { toolCallId: 'tc2', content: 'file contents', isError: false, toolName: 'read' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} verboseTools={true} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show individual tool calls, not compact summary
    expect(output).toContain('Grep');
    expect(output).toContain('Read');
    expect(output).toContain('Messages.tsx');
    // Should NOT show grouped summary
    expect(output).not.toContain('ctrl+o to expand');
  });

  test('no border characters in tool output', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'bash', input: { command: 'git status' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'On branch main\nnothing to commit', isError: false, toolName: 'bash' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should NOT have any border characters from old panels
    expect(output).not.toContain('╭');
    expect(output).not.toContain('╰');
    // Should show the tool name in new clean format
    expect(output).toContain('Bash');
    expect(output).toContain('git status');
  });

  test('params shown with tree connector for running tools', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'grep', input: { pattern: 'ToolCallPanel', path: '/src/' } } as any,
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults: [],
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show params with tree connector
    expect(output).toContain('└');
    expect(output).toContain('pattern:');
    expect(output).toContain('ToolCallPanel');
  });

  test('error tool call shows red X icon', async () => {
    const env = createInkTestEnv();
    const toolCalls: ToolCall[] = [
      { id: 'tc1', name: 'read', input: { file_path: '/nonexistent.ts' } } as any,
    ];
    const toolResults: ToolResult[] = [
      { toolCallId: 'tc1', content: 'ENOENT: no such file or directory', isError: true, toolName: 'read' },
    ];
    const messages: DisplayMessage[] = [
      {
        id: 'msg1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        toolCalls,
        toolResults,
      },
    ];

    const instance = render(
      <Messages messages={messages} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await wait();
    const output = env.getOutput();
    instance.unmount();

    // Should show error icon
    expect(output).toContain('✗');
    expect(output).toContain('Read');
    // Should NOT have old style labels
    expect(output).not.toContain('[failed]');
  });
});
