import { ErrorCodes, type ErrorCode } from './codes';

export interface AssistantErrorOptions {
  code: ErrorCode;
  recoverable?: boolean;
  retryable?: boolean;
  userFacing?: boolean;
  suggestion?: string;
  cause?: Error;
}

export class AssistantError extends Error {
  code: ErrorCode;
  recoverable: boolean;
  retryable: boolean;
  userFacing: boolean;
  suggestion?: string;
  cause?: Error;

  constructor(message: string, options: AssistantErrorOptions) {
    super(message);
    this.name = 'AssistantError';
    this.code = options.code;
    this.recoverable = options.recoverable ?? true;
    this.retryable = options.retryable ?? false;
    this.userFacing = options.userFacing ?? true;
    this.suggestion = options.suggestion;
    this.cause = options.cause;
  }

  toJSON(): {
    name: string;
    code: ErrorCode;
    message: string;
    suggestion?: string;
    recoverable: boolean;
    retryable: boolean;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      retryable: this.retryable,
    };
  }
}

export class ToolExecutionError extends AssistantError {
  toolName: string;
  toolInput: unknown;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    toolName: string;
    toolInput: unknown;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.TOOL_EXECUTION_FAILED,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'ToolExecutionError';
    this.toolName = options.toolName;
    this.toolInput = options.toolInput;
  }
}

export class LLMError extends AssistantError {
  statusCode?: number;
  rateLimited?: boolean;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    statusCode?: number;
    rateLimited?: boolean;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.LLM_API_ERROR,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'LLMError';
    this.statusCode = options.statusCode;
    this.rateLimited = options.rateLimited;
  }
}

export class ConfigurationError extends AssistantError {
  configPath?: string;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    configPath?: string;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.CONFIG_INVALID,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'ConfigurationError';
    this.configPath = options.configPath;
  }
}

export class ConnectorError extends AssistantError {
  connectorName: string;
  command?: string;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    connectorName: string;
    command?: string;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.CONNECTOR_EXECUTION_FAILED,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'ConnectorError';
    this.connectorName = options.connectorName;
    this.command = options.command;
  }
}

export class ValidationError extends AssistantError {
  field?: string;
  expected?: string;
  received?: string;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    field?: string;
    expected?: string;
    received?: string;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.VALIDATION_INVALID_TYPE,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'ValidationError';
    this.field = options.field;
    this.expected = options.expected;
    this.received = options.received;
  }
}

export class HookError extends AssistantError {
  hookType: string;
  hookName?: string;

  constructor(message: string, options: Omit<AssistantErrorOptions, 'code'> & {
    hookType: string;
    hookName?: string;
    code?: ErrorCode;
  }) {
    super(message, {
      code: options.code ?? ErrorCodes.HOOK_EXECUTION_FAILED,
      recoverable: options.recoverable,
      retryable: options.retryable,
      userFacing: options.userFacing,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.name = 'HookError';
    this.hookType = options.hookType;
    this.hookName = options.hookName;
  }
}

export function isAssistantError(error: unknown): error is AssistantError {
  return error instanceof AssistantError;
}
