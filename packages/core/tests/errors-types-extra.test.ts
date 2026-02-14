import { describe, expect, test } from 'bun:test';
import { ErrorCodes } from '../src/errors/codes';
import {
  AssistantError,
  ConfigurationError,
  ConnectorError,
  HookError,
  LLMError,
  ValidationError,
  isAssistantError,
} from '../src/errors/types';

describe('Error subclasses', () => {
  test('LLMError includes status and flags', () => {
    const err = new LLMError('bad', { statusCode: 429, rateLimited: true });
    expect(err.code).toBe(ErrorCodes.LLM_API_ERROR);
    expect(err.statusCode).toBe(429);
    expect(err.rateLimited).toBe(true);
  });

  test('ConfigurationError includes config path', () => {
    const err = new ConfigurationError('bad', { configPath: '/tmp/config.json' });
    expect(err.code).toBe(ErrorCodes.CONFIG_INVALID);
    expect(err.configPath).toBe('/tmp/config.json');
  });

  test('ConnectorError includes connector details', () => {
    const err = new ConnectorError('bad', { connectorName: 'git', command: 'status' });
    expect(err.code).toBe(ErrorCodes.CONNECTOR_EXECUTION_FAILED);
    expect(err.connectorName).toBe('git');
    expect(err.command).toBe('status');
  });

  test('ValidationError includes field metadata', () => {
    const err = new ValidationError('bad', { field: 'count', expected: 'number', received: 'string' });
    expect(err.code).toBe(ErrorCodes.VALIDATION_INVALID_TYPE);
    expect(err.field).toBe('count');
    expect(err.expected).toBe('number');
    expect(err.received).toBe('string');
  });

  test('HookError includes hook metadata', () => {
    const err = new HookError('bad', { hookType: 'prompt', hookName: 'verify' });
    expect(err.code).toBe(ErrorCodes.HOOK_EXECUTION_FAILED);
    expect(err.hookType).toBe('prompt');
    expect(err.hookName).toBe('verify');
  });

  test('isAssistantError identifies subclasses', () => {
    const err = new AssistantError('bad', { code: ErrorCodes.UNKNOWN_ERROR });
    expect(isAssistantError(err)).toBe(true);
    expect(isAssistantError(new Error('x'))).toBe(false);
  });
});
