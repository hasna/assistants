import { describe, expect, test } from 'bun:test';
import {
  ErrorCodes,
  ToolExecutionError,
  toolError,
  toolTimeout,
  toolPermissionDenied,
  toolValidationError,
  toolNotFound,
} from '../src/errors';

describe('toolError', () => {
  test('creates a ToolExecutionError with defaults', () => {
    const err = toolError('bash', 'something failed');

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.toolName).toBe('bash');
    expect(err.message).toBe('something failed');
    expect(err.code).toBe(ErrorCodes.TOOL_EXECUTION_FAILED);
    expect(err.recoverable).toBe(true);
    expect(err.retryable).toBe(false);
    expect(err.toolInput).toEqual({});
  });

  test('accepts custom options', () => {
    const input = { command: 'rm -rf /' };
    const err = toolError('bash', 'blocked', {
      code: ErrorCodes.TOOL_PERMISSION_DENIED,
      input,
      recoverable: false,
      retryable: false,
      suggestion: 'Use a safe command.',
    });

    expect(err.code).toBe(ErrorCodes.TOOL_PERMISSION_DENIED);
    expect(err.toolInput).toEqual(input);
    expect(err.recoverable).toBe(false);
    expect(err.retryable).toBe(false);
    expect(err.suggestion).toBe('Use a safe command.');
  });

  test('serializes via toJSON', () => {
    const err = toolError('read', 'file missing', {
      suggestion: 'Check the path.',
    });
    const json = err.toJSON();

    expect(json.name).toBe('ToolExecutionError');
    expect(json.code).toBe(ErrorCodes.TOOL_EXECUTION_FAILED);
    expect(json.message).toBe('file missing');
    expect(json.suggestion).toBe('Check the path.');
    expect(json.recoverable).toBe(true);
    expect(json.retryable).toBe(false);
  });
});

describe('toolTimeout', () => {
  test('creates a timeout error with correct defaults', () => {
    const err = toolTimeout('bash', 30000);

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.toolName).toBe('bash');
    expect(err.message).toBe("Tool 'bash' timed out after 30000ms");
    expect(err.code).toBe(ErrorCodes.TOOL_TIMEOUT);
    expect(err.recoverable).toBe(true);
    expect(err.retryable).toBe(true);
    expect(err.suggestion).toBe('Try again with a longer timeout or a simpler input.');
    expect(err.toolInput).toEqual({});
  });

  test('includes input when provided', () => {
    const input = { command: 'find / -name foo' };
    const err = toolTimeout('bash', 5000, input);

    expect(err.toolInput).toEqual(input);
    expect(err.message).toContain('5000ms');
  });
});

describe('toolPermissionDenied', () => {
  test('creates a permission denied error', () => {
    const err = toolPermissionDenied('bash', 'Command not allowed');

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.toolName).toBe('bash');
    expect(err.message).toBe('Command not allowed');
    expect(err.code).toBe(ErrorCodes.TOOL_PERMISSION_DENIED);
    expect(err.recoverable).toBe(false);
    expect(err.retryable).toBe(false);
    expect(err.toolInput).toEqual({});
  });

  test('includes input when provided', () => {
    const input = { command: 'sudo rm -rf /' };
    const err = toolPermissionDenied('bash', 'Dangerous command', input);

    expect(err.toolInput).toEqual(input);
  });
});

describe('toolValidationError', () => {
  test('creates a validation error', () => {
    const err = toolValidationError('read', 'File path is required');

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.toolName).toBe('read');
    expect(err.message).toBe('File path is required');
    expect(err.code).toBe(ErrorCodes.VALIDATION_OUT_OF_RANGE);
    expect(err.recoverable).toBe(false);
    expect(err.retryable).toBe(false);
    expect(err.toolInput).toEqual({});
  });

  test('includes input when provided', () => {
    const input = { path: '' };
    const err = toolValidationError('read', 'Path cannot be empty', input);

    expect(err.toolInput).toEqual(input);
  });
});

describe('toolNotFound', () => {
  test('creates a not found error', () => {
    const err = toolNotFound('nonexistent_tool');

    expect(err).toBeInstanceOf(ToolExecutionError);
    expect(err.toolName).toBe('nonexistent_tool');
    expect(err.message).toBe("Tool 'nonexistent_tool' not found");
    expect(err.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
    expect(err.recoverable).toBe(false);
    expect(err.retryable).toBe(false);
    expect(err.suggestion).toBe("Check that tool 'nonexistent_tool' is registered and spelled correctly.");
    expect(err.toolInput).toEqual({});
  });
});

describe('error hierarchy', () => {
  test('all factory errors are instanceof ToolExecutionError', () => {
    const errors = [
      toolError('t', 'msg'),
      toolTimeout('t', 1000),
      toolPermissionDenied('t', 'denied'),
      toolValidationError('t', 'invalid'),
      toolNotFound('t'),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('ToolExecutionError');
    }
  });

  test('errors can be caught as ToolExecutionError', () => {
    const throwAndCatch = () => {
      try {
        throw toolPermissionDenied('bash', 'not allowed');
      } catch (e) {
        if (e instanceof ToolExecutionError) {
          return e.code;
        }
        return null;
      }
    };

    expect(throwAndCatch()).toBe(ErrorCodes.TOOL_PERMISSION_DENIED);
  });
});
