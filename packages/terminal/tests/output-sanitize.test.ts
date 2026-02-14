import { describe, expect, test } from 'bun:test';
import { sanitizeTerminalOutput, CLEAR_SCREEN_TOKEN } from '../src/output/sanitize';

describe('sanitizeTerminalOutput', () => {
  test('removes clear scrollback sequences', () => {
    const input = `line1\x1b[2J\x1b[3J\x1b[Hline2`;
    const output = sanitizeTerminalOutput(input);
    expect(output).toBe(`line1line2`);
  });

  test('leaves output unchanged when no clear scrollback present', () => {
    const input = '\x1b[2Jhello';
    expect(sanitizeTerminalOutput(input)).toBe(input);
  });

  test('allows explicit clear token substitution', () => {
    const input = `hello${CLEAR_SCREEN_TOKEN}world`;
    const output = sanitizeTerminalOutput(input);
    expect(output).toBe(`hello\x1b[2J\x1b[3J\x1b[Hworld`);
  });
});
