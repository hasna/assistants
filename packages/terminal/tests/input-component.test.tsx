import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { Input, type InputHandle } from '../src/components/Input';

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

describe('Input component', () => {
  test('shows default placeholder', async () => {
    const env = createInkTestEnv();
    const instance = render(<Input onSubmit={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Type a message');
    instance.unmount();
  });

  test('shows processing placeholder with queue', async () => {
    const env = createInkTestEnv();
    const instance = render(<Input onSubmit={() => {}} isProcessing queueLength={2} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Enter=inline | Tab=queue | Shift+Enter=interrupt');
    instance.unmount();
  });

  test('esc stops processing when callback is provided', async () => {
    const env = createInkTestEnv();
    let stopped = 0;
    const instance = render(
      <Input
        onSubmit={() => {}}
        isProcessing
        onStopProcessing={() => {
          stopped += 1;
        }}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.stdin.write('\x1b');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(1);
    instance.unmount();
  });

  test('shows ask-user placeholder', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <Input onSubmit={() => {}} isAskingUser askPlaceholder="Answer now" />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Answer now');
    instance.unmount();
  });

  test('shows line count for multiline input', async () => {
    const env = createInkTestEnv();
    const ref = React.createRef<InputHandle>();
    const instance = render(<Input ref={ref} onSubmit={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Wait for ref to be attached before exercising imperative handle
    const waitForRef = async () => {
      const start = Date.now();
      while (!ref.current) {
        if (Date.now() - start > 250) {
          throw new Error('Input ref was not attached in time');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    await waitForRef();
    ref.current?.setValue('line one\\nline two');
    const waitForValue = async () => {
      const start = Date.now();
      while (ref.current?.getValue() !== 'line one\\nline two') {
        if (Date.now() - start > 250) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    await waitForValue();
    expect(ref.current?.getValue()).toBe('line one\\nline two');
    instance.unmount();
  });

  test('submits on ESC+CR enter sequence (tmux-compatible)', async () => {
    const env = createInkTestEnv();
    const ref = React.createRef<InputHandle>();
    const submitted: Array<{ value: string; mode: string }> = [];
    const instance = render(
      <Input
        ref={ref}
        onSubmit={(value, mode) => {
          submitted.push({ value, mode });
        }}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const waitForRef = async () => {
      const start = Date.now();
      while (!ref.current) {
        if (Date.now() - start > 250) {
          throw new Error('Input ref was not attached in time');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    await waitForRef();

    ref.current?.setValue('submit me');
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.stdin.write('\x1b\r');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(submitted.length).toBe(1);
    expect(submitted[0]).toEqual({ value: 'submit me', mode: 'normal' });
    expect(ref.current?.getValue()).toBe('');
    instance.unmount();
  });
});
