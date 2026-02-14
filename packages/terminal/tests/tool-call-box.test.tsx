import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render, Text } from 'ink';
import { PassThrough } from 'stream';
import { ToolCallBox, useToolCallExpansion } from '../src/components/ToolCallBox';

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

function ExpansionProbe({ forceExpand }: { forceExpand?: boolean }) {
  const { isExpanded, setIsExpanded } = useToolCallExpansion();
  React.useEffect(() => {
    if (forceExpand) {
      setIsExpanded(true);
    }
  }, [forceExpand, setIsExpanded]);
  return <Text>{isExpanded ? 'expanded' : 'collapsed'}</Text>;
}

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

describe('ToolCallBox', () => {
  test('renders tool call summaries and hidden count', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ToolCallBox
        entries={[
          { toolCall: { id: 't1', name: 'bash', input: { command: 'ls -la' }, type: 'tool' } as any },
          { toolCall: { id: 't2', name: 'schedule', input: { action: 'list' }, type: 'tool' } as any },
          { toolCall: { id: 't3', name: 'connect_slack', input: { action: 'post' }, type: 'tool' } as any },
        ]}
        maxVisible={2}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Tools');
    expect(frame).toContain('Listing scheduled tasks');
    expect(frame).toContain('more above');
    instance.unmount();
  });

  test('useToolCallExpansion defaults to collapsed', async () => {
    const env = createInkTestEnv();
    const instance = render(<ExpansionProbe />, { stdin: env.stdin, stdout: env.stdout });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(env.getOutput()).toContain('collapsed');

    instance.unmount();
  });
});
