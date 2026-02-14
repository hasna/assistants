import { describe, expect, test } from 'bun:test';
import { WaitTool } from '../src/tools/wait';

describe('WaitTool', () => {
  test('returns immediately for zero duration', async () => {
    const result = await WaitTool.executor({ seconds: 0 });
    expect(result).toContain('Waited 0s');
  });

  test('handles zero-length ranges deterministically', async () => {
    const result = await WaitTool.executor({ minSeconds: 0, maxSeconds: 0 });
    expect(result).toContain('Waited 0s');
    expect(result).toContain('range 0-0s');
  });

  test('rejects incomplete ranges', async () => {
    await expect(WaitTool.executor({ minSeconds: 1 })).rejects.toThrow('minSeconds and maxSeconds');
  });

  test('rejects negative durations', async () => {
    await expect(WaitTool.executor({ seconds: -1 })).rejects.toThrow('non-negative');
  });

  test('accepts minutes input', async () => {
    const result = await WaitTool.executor({ minutes: 0 });
    expect(result).toContain('Waited 0s');
  });
});
