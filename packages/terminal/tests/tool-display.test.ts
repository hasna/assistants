import { describe, expect, test } from 'bun:test';
import type { ToolResult } from '@hasna/assistants-shared';
import {
  truncateToolResult,
  truncateToolResultWithInfo,
  parseErrorInfo,
  formatErrorConcise,
  formatTruncationInfo,
} from '../src/components/toolDisplay';

function makeResult(overrides: Partial<ToolResult>): ToolResult {
  return {
    toolCallId: 'tool-1',
    toolName: 'bash',
    content: '',
    isError: false,
    ...overrides,
  };
}

describe('truncateToolResult', () => {
  test('returns verbose content with ansi stripped and tabs expanded', () => {
    const result = makeResult({
      content: '\u001b[31mHello\tWorld\u001b[0m',
      rawContent: '\u001b[31mHello\tWorld\u001b[0m',
    });
    const output = truncateToolResult(result, 15, 3000, { verbose: true });
    expect(output).toBe('Hello  World');
  });

  test('formats common error messages with hints', () => {
    const enoent = truncateToolResult(makeResult({ isError: true, content: 'ENOENT: no such file' }));
    expect(enoent).toContain('File or directory not found');
    expect(enoent).toContain('→'); // includes hint

    const eacces = truncateToolResult(makeResult({ isError: true, content: 'EACCES permission denied' }));
    expect(eacces).toContain('Permission denied');

    const etimedout = truncateToolResult(makeResult({ isError: true, content: 'ETIMEDOUT: timeout' }));
    expect(etimedout).toContain('timed out');
  });

  test('formats schedule results', () => {
    const res = (content: string) =>
      truncateToolResult(makeResult({ toolName: 'schedule', content }));
    expect(res('No schedules found.')).toBe('📅 No scheduled tasks');
    expect(res('Scheduled task created.')).toBe('✓ Schedule created');
    expect(res('Removed schedule')).toBe('✓ Schedule deleted');
    expect(res('Paused schedule')).toBe('⏸ Schedule paused');
    expect(res('Resumed schedule')).toBe('▶ Schedule resumed');
    expect(res('id: 1\ncommand: echo')).toBe('📅 2 scheduled tasks');
  });

  test('formats feedback results', () => {
    const output = truncateToolResult(makeResult({ toolName: 'submit_feedback', content: 'submitted' }));
    expect(output).toBe('✓ Feedback submitted');
  });

  test('formats read/write/glob/grep/bash/search results', () => {
    const readOutput = truncateToolResult(makeResult({ toolName: 'read', content: Array.from({ length: 25 }, (_, i) => String(i)).join('\n') }));
    expect(readOutput).toBe('📄 Read 25 lines');

    const writeOutput = truncateToolResult(makeResult({ toolName: 'write', content: 'saved file' }));
    expect(writeOutput).toBe('✓ File saved');

    const globEmpty = truncateToolResult(makeResult({ toolName: 'glob', content: '' }));
    expect(globEmpty).toBe('🔍 No files found');
    const globMany = truncateToolResult(makeResult({ toolName: 'glob', content: Array.from({ length: 11 }, (_, i) => `file-${i}`).join('\n') }));
    expect(globMany).toBe('🔍 Found 11 files');

    const grepEmpty = truncateToolResult(makeResult({ toolName: 'grep', content: '\n\n' }));
    expect(grepEmpty).toBe('🔍 No matches found');
    const grepMany = truncateToolResult(makeResult({ toolName: 'grep', content: Array.from({ length: 12 }, (_, i) => `match-${i}`).join('\n') }));
    expect(grepMany).toBe('🔍 Found 12 matches');

    const bashEmpty = truncateToolResult(makeResult({ toolName: 'bash', content: '' }));
    expect(bashEmpty).toBe('✓ Command completed');
    const bashShort = truncateToolResult(makeResult({ toolName: 'bash', content: 'ok' }));
    expect(bashShort).toBe('ok');
    const bashLong = truncateToolResult(makeResult({ toolName: 'bash', content: Array.from({ length: 25 }, (_, i) => `line-${i}`).join('\n') }));
    expect(bashLong).toBe('✓ Output: 25 lines');

    const searchOutput = truncateToolResult(makeResult({ toolName: 'web_search', content: 'https://example.com\nhttps://test.com' }));
    expect(searchOutput).toBe('🔍 Found 2 results');
  });

  test('falls back to raw content when formatter returns null', () => {
    expect(truncateToolResult(makeResult({ toolName: 'unknown', content: 'raw' }))).toBe('raw');
    expect(truncateToolResult(makeResult({ toolName: 'schedule', content: 'neutral message' }))).toBe('neutral message');
    expect(truncateToolResult(makeResult({ toolName: 'submit_feedback', content: 'ok' }))).toBe('ok');
    expect(truncateToolResult(makeResult({ toolName: 'read', content: 'short\nfile' }))).toBe('short\nfile');
    expect(truncateToolResult(makeResult({ toolName: 'write', content: 'noop' }))).toBe('noop');
    expect(truncateToolResult(makeResult({ toolName: 'glob', content: 'a.txt\nb.txt' }))).toBe('a.txt\nb.txt');
    expect(truncateToolResult(makeResult({ toolName: 'grep', content: 'match' }))).toBe('match');
    expect(truncateToolResult(makeResult({ toolName: 'web_search', content: 'no urls' }))).toBe('no urls');
  });

  test('falls back to truncation with prefix for errors', () => {
    const content = Array.from({ length: 5 }, (_, i) => `line-${i}`).join('\n');
    const output = truncateToolResult(makeResult({ toolName: 'unknown', content, isError: true }), 3, 20);
    // Errors now get formatted with parseErrorInfo, which provides concise messages
    expect(output).toContain('✗');
  });
});

describe('parseErrorInfo', () => {
  test('parses file not found errors', () => {
    const info = parseErrorInfo('ENOENT: no such file or directory');
    expect(info.type).toBe('not_found');
    expect(info.message).toBe('File or directory not found');
    expect(info.hint).toContain('path');
  });

  test('parses permission denied errors', () => {
    const info = parseErrorInfo('EACCES: permission denied');
    expect(info.type).toBe('permission');
    expect(info.message).toBe('Permission denied');
  });

  test('parses timeout errors', () => {
    const info = parseErrorInfo('Request timed out after 30s');
    expect(info.type).toBe('timeout');
    expect(info.message).toBe('Request timed out');
    expect(info.hint?.toLowerCase()).toContain('try again');
  });

  test('parses connection refused errors', () => {
    const info = parseErrorInfo('ECONNREFUSED: connection refused');
    expect(info.type).toBe('connection_refused');
    expect(info.message).toBe('Connection refused');
  });

  test('parses HTTP errors', () => {
    const info401 = parseErrorInfo('HTTP 401 Unauthorized');
    expect(info401.type).toBe('http');
    expect(info401.message).toBe('Unauthorized');
    expect(info401.exitCode).toBe(401);

    const info404 = parseErrorInfo('HTTP 404 Not Found');
    expect(info404.message).toBe('Not found');
    expect(info404.exitCode).toBe(404);
  });

  test('parses command not found errors', () => {
    const info = parseErrorInfo('bash: foo: command not found');
    expect(info.type).toBe('command_not_found');
    expect(info.message).toBe('Command not found');
    expect(info.exitCode).toBe(127);
  });

  test('extracts exit codes', () => {
    const info = parseErrorInfo('Process exited with code 1');
    expect(info.exitCode).toBe(1);

    const info2 = parseErrorInfo('exit code: 42');
    expect(info2.exitCode).toBe(42);
  });

  test('parses tool denied errors', () => {
    const info = parseErrorInfo('Tool call denied: bash not allowed');
    expect(info.type).toBe('denied');
    expect(info.message).toBe('Tool call denied');
  });
});

describe('formatErrorConcise', () => {
  test('formats error with message and hint', () => {
    const output = formatErrorConcise('ENOENT: no such file');
    expect(output).toContain('✗');
    expect(output).toContain('File or directory not found');
    expect(output).toContain('→');
  });

  test('includes exit code when present', () => {
    const output = formatErrorConcise('Process exited with code 1');
    expect(output).toContain('[1]');
  });

  test('formats HTTP errors with code', () => {
    const output = formatErrorConcise('HTTP 403 Forbidden');
    expect(output).toContain('[403]');
    expect(output).toContain('Forbidden');
  });
});

describe('formatTruncationInfo', () => {
  test('returns empty string when not truncated', () => {
    const info = formatTruncationInfo({
      wasTruncated: false,
      originalLines: 10,
      displayedLines: 10,
      originalChars: 100,
      displayedChars: 100,
    });
    expect(info).toBe('');
  });

  test('shows line truncation info', () => {
    const info = formatTruncationInfo({
      wasTruncated: true,
      originalLines: 100,
      displayedLines: 15,
      originalChars: 1000,
      displayedChars: 1000,
    });
    expect(info).toContain('100→15 lines');
  });

  test('shows char truncation info', () => {
    const info = formatTruncationInfo({
      wasTruncated: true,
      originalLines: 10,
      displayedLines: 10,
      originalChars: 5000,
      displayedChars: 400,
    });
    expect(info).toContain('5000→400 chars');
  });

  test('shows both line and char truncation', () => {
    const info = formatTruncationInfo({
      wasTruncated: true,
      originalLines: 50,
      displayedLines: 15,
      originalChars: 5000,
      displayedChars: 400,
    });
    expect(info).toContain('50→15 lines');
    expect(info).toContain('5000→400 chars');
  });
});

describe('truncateToolResultWithInfo', () => {
  test('returns truncation metadata', () => {
    const content = Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n');
    const result = truncateToolResultWithInfo(
      makeResult({ toolName: 'unknown', content }),
      15,
      3000
    );
    expect(result.truncation.wasTruncated).toBe(true);
    expect(result.truncation.originalLines).toBe(30);
    expect(result.truncation.displayedLines).toBe(15);
    expect(result.content).toContain('truncated');
  });

  test('reports no truncation for small content', () => {
    const result = truncateToolResultWithInfo(
      makeResult({ toolName: 'unknown', content: 'short' }),
      15,
      3000
    );
    expect(result.truncation.wasTruncated).toBe(false);
    expect(result.truncation.originalLines).toBe(1);
    expect(result.truncation.displayedLines).toBe(1);
  });
});
