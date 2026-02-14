import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { SessionSelector } from '../src/components/SessionSelector';

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

describe('SessionSelector', () => {
  test('renders sessions with active marker and abbreviated path', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/home/tester';

    const env = createInkTestEnv();
    const instance = render(
      <SessionSelector
        sessions={[
          { id: 's1', cwd: '/home/tester/project', updatedAt: Date.now(), isProcessing: false } as any,
          { id: 's2', cwd: '/tmp/other', updatedAt: Date.now(), isProcessing: true } as any,
        ]}
        activeSessionId="s2"
        onSelect={() => {}}
        onNew={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Sessions');
    expect(frame).toContain('[*]');
    expect(frame).toContain('~/project');
    expect(frame).toContain('New session');
    instance.unmount();

    process.env.HOME = originalHome;
  });
});
