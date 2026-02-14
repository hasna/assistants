import { describe, expect, test } from 'bun:test';
import {
  generateId,
  now,
  sleep,
  parseFrontmatter,
  substituteVariables,
  truncate,
  formatBytes,
  formatDuration,
} from '@hasna/assistants-shared';

describe('shared utils coverage', () => {
  test('covers utility helpers', async () => {
    const id = generateId();
    expect(id).toMatch(/[0-9a-f-]{36}/);

    const timestamp = now();
    expect(typeof timestamp).toBe('number');

    await sleep(1);

    const parsed = parseFrontmatter(`---\ncount: 1\nlist: []\nquoted: "value"\n---\nBody`);
    expect(parsed.frontmatter.count).toBe(1);
    expect(parsed.frontmatter.list).toEqual([]);
    expect(parsed.frontmatter.quoted).toBe('value');
    expect(parsed.content).toBe('Body');

    const substituted = substituteVariables('Hi $0 $ARGUMENTS ${ENV}', ['a', 'b'], { ENV: 'c' });
    expect(substituted).toBe('Hi a a b c');

    expect(truncate('hello world', 5)).toBe('he...');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(3600000 + 60000)).toBe('1h 1m');
  });
});
