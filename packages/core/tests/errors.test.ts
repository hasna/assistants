import { describe, expect, test } from 'bun:test';
import { AssistantError, ErrorAggregator, ErrorCodes, ToolExecutionError } from '../src/errors';

describe('AssistantError', () => {
  test('should include required fields and serialize', () => {
    const error = new AssistantError('Something broke', {
      code: ErrorCodes.UNKNOWN_ERROR,
      recoverable: false,
      retryable: false,
      userFacing: true,
      suggestion: 'Try again later.',
    });

    expect(error.code).toBe(ErrorCodes.UNKNOWN_ERROR);
    expect(error.recoverable).toBe(false);
    expect(error.retryable).toBe(false);
    expect(error.userFacing).toBe(true);
    expect(error.suggestion).toBe('Try again later.');

    const json = error.toJSON();
    expect(json.code).toBe(ErrorCodes.UNKNOWN_ERROR);
    expect(json.message).toBe('Something broke');
    expect(json.suggestion).toBe('Try again later.');
  });
});

describe('ToolExecutionError', () => {
  test('should include tool context', () => {
    const error = new ToolExecutionError('Tool failed', {
      toolName: 'bash',
      toolInput: { command: 'ls' },
      code: ErrorCodes.TOOL_EXECUTION_FAILED,
    });

    expect(error.toolName).toBe('bash');
    expect(error.toolInput).toEqual({ command: 'ls' });
    expect(error.code).toBe(ErrorCodes.TOOL_EXECUTION_FAILED);
  });
});

describe('ErrorAggregator', () => {
  test('should count errors by code', () => {
    const aggregator = new ErrorAggregator();
    const error = new AssistantError('Oops', { code: ErrorCodes.UNKNOWN_ERROR });

    aggregator.record(error);
    aggregator.record(error);

    const stats = aggregator.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].code).toBe(ErrorCodes.UNKNOWN_ERROR);
    expect(stats[0].count).toBe(2);
    expect(stats[0].samples).toHaveLength(2);
  });
});
