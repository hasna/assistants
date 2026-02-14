import { ErrorCodes, type ErrorCode } from './codes';
import { ToolExecutionError } from './types';

/**
 * Factory helpers for creating ToolExecutionError instances with less boilerplate.
 *
 * Instead of:
 *   throw new ToolExecutionError('Something failed', {
 *     toolName: 'bash',
 *     toolInput: input,
 *     code: ErrorCodes.TOOL_EXECUTION_FAILED,
 *     recoverable: true,
 *     retryable: false,
 *     suggestion: 'Try something else.',
 *   });
 *
 * You can write:
 *   throw toolError('bash', 'Something failed', {
 *     input,
 *     recoverable: true,
 *     suggestion: 'Try something else.',
 *   });
 */

/**
 * General-purpose tool error factory.
 * Defaults: code=TOOL_EXECUTION_FAILED, recoverable=true, retryable=false.
 */
export function toolError(
  toolName: string,
  message: string,
  opts?: {
    code?: ErrorCode;
    input?: Record<string, unknown>;
    recoverable?: boolean;
    retryable?: boolean;
    suggestion?: string;
  },
): ToolExecutionError {
  return new ToolExecutionError(message, {
    toolName,
    toolInput: opts?.input ?? {},
    code: opts?.code ?? ErrorCodes.TOOL_EXECUTION_FAILED,
    recoverable: opts?.recoverable ?? true,
    retryable: opts?.retryable ?? false,
    suggestion: opts?.suggestion,
  });
}

/**
 * Tool timeout error factory.
 * Always uses TOOL_TIMEOUT code, recoverable=true, retryable=true.
 */
export function toolTimeout(
  toolName: string,
  timeoutMs: number,
  input?: Record<string, unknown>,
): ToolExecutionError {
  return new ToolExecutionError(
    `Tool '${toolName}' timed out after ${timeoutMs}ms`,
    {
      toolName,
      toolInput: input ?? {},
      code: ErrorCodes.TOOL_TIMEOUT,
      recoverable: true,
      retryable: true,
      suggestion: 'Try again with a longer timeout or a simpler input.',
    },
  );
}

/**
 * Tool permission denied error factory.
 * Always uses TOOL_PERMISSION_DENIED code, recoverable=false, retryable=false.
 */
export function toolPermissionDenied(
  toolName: string,
  reason: string,
  input?: Record<string, unknown>,
): ToolExecutionError {
  return new ToolExecutionError(reason, {
    toolName,
    toolInput: input ?? {},
    code: ErrorCodes.TOOL_PERMISSION_DENIED,
    recoverable: false,
    retryable: false,
  });
}

/**
 * Tool validation error factory (invalid or missing input).
 * Always uses VALIDATION_OUT_OF_RANGE code, recoverable=false, retryable=false.
 */
export function toolValidationError(
  toolName: string,
  message: string,
  input?: Record<string, unknown>,
): ToolExecutionError {
  return new ToolExecutionError(message, {
    toolName,
    toolInput: input ?? {},
    code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
    recoverable: false,
    retryable: false,
  });
}

/**
 * Tool not found error factory.
 * Always uses TOOL_NOT_FOUND code, recoverable=false, retryable=false.
 */
export function toolNotFound(toolName: string): ToolExecutionError {
  return new ToolExecutionError(`Tool '${toolName}' not found`, {
    toolName,
    toolInput: {},
    code: ErrorCodes.TOOL_NOT_FOUND,
    recoverable: false,
    retryable: false,
    suggestion: `Check that tool '${toolName}' is registered and spelled correctly.`,
  });
}
