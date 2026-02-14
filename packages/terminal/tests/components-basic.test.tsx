import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { AskUserPanel } from '../src/components/AskUserPanel';
import { ErrorBanner } from '../src/components/ErrorBanner';
import { Spinner } from '../src/components/Spinner';
import { WelcomeBanner } from '../src/components/WelcomeBanner';
import { QueueIndicator } from '../src/components/QueueIndicator';
import { EnergyBar } from '../src/components/EnergyBar';
import { ProcessingIndicator } from '../src/components/ProcessingIndicator';
import { Status } from '../src/components/Status';

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

describe('terminal basic components', () => {
  test('AskUserPanel renders question and options', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <AskUserPanel
        sessionId="session-1"
        request={{
          id: 'req-1',
          title: 'Questionnaire',
          description: 'Please answer',
          questions: [
            { id: 'q1', question: 'What is your name?', options: ['Ada', 'Grace'], multiline: true },
          ],
        } as any}
        question={{ id: 'q1', question: 'What is your name?', options: ['Ada', 'Grace'], multiline: true } as any}
        index={0}
        total={1}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Questionnaire');
    expect(frame).toContain('What is your name?');
    expect(frame).toContain('Ada');
    expect(frame).toContain('Multi-line answer allowed');
    expect(frame).toContain('session-1');
    instance.unmount();
  });

  test('ErrorBanner parses codes and suggestions', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ErrorBanner
        error={'RATE_LIMITED: Too many requests\nSuggestion: try later'}
        showErrorCodes
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('RATE_LIMITED: Too many requests');
    expect(frame).toContain('Suggestion: try later');
    instance.unmount();
  });

  test('Spinner renders label when provided', async () => {
    const env = createInkTestEnv();
    const instance = render(<Spinner label="Loading" />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Loading');
    instance.unmount();
  });

  test('WelcomeBanner abbreviates home directory', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/home/tester';

    const env = createInkTestEnv();
    const instance = render(
      <WelcomeBanner version="1.2.3" model="gpt" directory="/home/tester/project" />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Assistants');
    expect(frame).toContain('v1.2.3');
    expect(frame).toContain('model');
    expect(frame).toContain('~/project');
    instance.unmount();

    process.env.HOME = originalHome;
  });

  test('WelcomeBanner displays friendly model name instead of raw ID', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WelcomeBanner version="1.0.0" model="claude-sonnet-4-20250514" directory="/tmp" />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    // Should display "Claude Sonnet 4" not "claude-sonnet-4-20250514"
    expect(frame).toContain('Claude Sonnet 4');
    expect(frame).not.toContain('claude-sonnet-4-20250514');
    instance.unmount();
  });

  test('WelcomeBanner falls back to raw ID for unknown models', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WelcomeBanner version="1.0.0" model="custom-model-xyz" directory="/tmp" />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    // Unknown model should show the raw ID
    expect(frame).toContain('custom-model-xyz');
    instance.unmount();
  });

  test('QueueIndicator summarizes queued messages', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <QueueIndicator
        messages={[
          { id: 'm1', content: 'first', mode: 'inline', queuedAt: 1 },
          { id: 'm2', content: 'second', mode: 'queued', queuedAt: 2 },
          { id: 'm3', content: 'third message is quite long'.repeat(5), mode: 'queued', queuedAt: 3 },
          { id: 'm4', content: 'fourth', mode: 'queued', queuedAt: 4 },
        ]}
        maxPreview={2}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('pending');
    expect(frame).toContain('in-stream');
    expect(frame).toContain('+2 more');
    instance.unmount();
  });

  test('EnergyBar renders percentage and color segments', async () => {
    const env = createInkTestEnv();
    const instance = render(<EnergyBar current={3} max={10} />, { stdout: env.stdout, stdin: env.stdin });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('30%');
    instance.unmount();
  });

  test('ProcessingIndicator renders when active', async () => {
    const originalNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    Date.now = () => 6000;
    globalThis.setInterval = ((cb: () => void) => {
      cb();
      return 1 as any;
    }) as any;
    globalThis.clearInterval = (() => {}) as any;

    const env = createInkTestEnv();
    const instance = render(
      <ProcessingIndicator isProcessing startTime={1000} tokenCount={1200} isThinking />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('esc');
    expect(frame).toContain('1.2k');
    expect(frame).toContain('tokens');
    instance.unmount();

    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  test('Status shows context, queue, session, and verbose state', async () => {
    const originalNow = Date.now;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    Date.now = () => 9000;
    globalThis.setInterval = ((cb: () => void) => {
      cb();
      return 1 as any;
    }) as any;
    globalThis.clearInterval = (() => {}) as any;

    const env = createInkTestEnv();
    const instance = render(
      <Status
        isProcessing
        cwd="/tmp"
        queueLength={2}
        tokenUsage={{ inputTokens: 10, outputTokens: 10, totalTokens: 20, maxContextTokens: 40 }}
        sessionIndex={0}
        sessionCount={2}
        backgroundProcessingCount={1}
        sessionId="s1"
        processingStartTime={1000}
        verboseTools
        voiceState={{ enabled: true, isListening: true } as any}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('50%');
    expect(frame).toContain('verbose');
    expect(frame).toContain('2q');
    expect(frame).toContain('1/2');
    expect(frame).toContain('esc');
    instance.unmount();

    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });
});
