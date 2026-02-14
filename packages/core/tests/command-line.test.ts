import { describe, expect, test } from 'bun:test';
import { splitCommandLine, buildCommandArgs } from '../src/utils/command-line';

describe('splitCommandLine', () => {
  test('splits simple arguments', () => {
    expect(splitCommandLine('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  test('handles double quotes', () => {
    expect(splitCommandLine('foo "bar baz"')).toEqual(['foo', 'bar baz']);
  });

  test('handles single quotes', () => {
    expect(splitCommandLine("foo 'bar baz'")).toEqual(['foo', 'bar baz']);
  });

  test('handles escaped characters in double quotes', () => {
    expect(splitCommandLine('foo "bar\\"baz"')).toEqual(['foo', 'bar"baz']);
  });

  test('preserves backslash in single quotes', () => {
    expect(splitCommandLine("foo 'bar\\baz'")).toEqual(['foo', 'bar\\baz']);
  });

  test('handles empty input', () => {
    expect(splitCommandLine('')).toEqual([]);
  });

  test('handles multiple spaces', () => {
    expect(splitCommandLine('foo   bar')).toEqual(['foo', 'bar']);
  });

  test('handles trailing backslash', () => {
    expect(splitCommandLine('foo\\')).toEqual(['foo\\']);
  });

  test('handles mixed quotes', () => {
    expect(splitCommandLine('foo "bar" \'baz\'')).toEqual(['foo', 'bar', 'baz']);
  });
});

describe('buildCommandArgs', () => {
  test('splits command and appends args', () => {
    expect(buildCommandArgs('git commit', ['-m', 'msg'])).toEqual(['git', 'commit', '-m', 'msg']);
  });

  test('handles quoted command', () => {
    expect(buildCommandArgs('"my cli" run', ['arg'])).toEqual(['my cli', 'run', 'arg']);
  });

  test('handles empty args', () => {
    expect(buildCommandArgs('echo hello', [])).toEqual(['echo', 'hello']);
  });
});
