import { describe, expect, test } from 'bun:test';
import { buildLayout, moveCursorVertical } from '../src/components/inputLayout';

describe('input layout', () => {
  test('wraps long lines to width', () => {
    const layout = buildLayout('hello world', 0, 5);
    expect(layout.displayLines.map((line) => line.text)).toEqual(['hello', ' worl', 'd']);
  });

  test('maps cursor to correct row and column', () => {
    const layout = buildLayout('abcdef', 3, 4);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorCol).toBe(3);
  });

  test('moves cursor vertically across wrapped rows', () => {
    const layout = buildLayout('abcdefgh', 1, 4);
    const moved = moveCursorVertical(layout, null, 1);
    expect(moved).not.toBeNull();
    expect(moved?.cursor).toBe(5);
  });

  test('moves cursor vertically with preferred column', () => {
    const layout = buildLayout('abc\ndefgh', 2, 10);
    const moved = moveCursorVertical(layout, 2, 1);
    expect(moved).not.toBeNull();
    expect(moved?.cursor).toBe(6);
  });

  test('handles empty input', () => {
    const layout = buildLayout('', 0, 10);
    expect(layout.displayLines).toHaveLength(1);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorCol).toBe(0);
  });

  test('maps cursor across newline boundaries', () => {
    const layout = buildLayout('a\nb', 2, 10);
    expect(layout.cursorRow).toBe(1);
    expect(layout.cursorCol).toBe(0);
  });

  test('maps cursor at end of line to that line', () => {
    const layout = buildLayout('abc\ndef', 3, 10);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorCol).toBe(3);
  });

  test('maps cursor at wrapped segment boundary to next segment', () => {
    const layout = buildLayout('abcdef', 4, 2);
    expect(layout.displayLines.map((line) => line.text)).toEqual(['ab', 'cd', 'ef']);
    expect(layout.cursorRow).toBe(2);
    expect(layout.cursorCol).toBe(0);
  });

  test('falls back to last line when cursor at end', () => {
    const layout = buildLayout('one', 3, 10);
    expect(layout.cursorRow).toBe(0);
    expect(layout.cursorCol).toBe(3);
  });

  test('keeps empty lines when building layout', () => {
    const layout = buildLayout('a\n\nb', 0, 10);
    expect(layout.displayLines.map((line) => line.text)).toEqual(['a', '', 'b']);
  });

  test('returns null when moving past bounds', () => {
    const layout = buildLayout('abc', 0, 10);
    expect(moveCursorVertical(layout, null, -1)).toBeNull();
    expect(moveCursorVertical(layout, null, 1)).toBeNull();
  });
});
