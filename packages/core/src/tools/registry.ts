import type { Tool, ToolCall, ToolResult, ValidationConfig } from '@hasna/assistants-shared';
import { sleep } from '@hasna/assistants-shared';
import { AssistantError, ErrorAggregator, ErrorCodes, ToolExecutionError } from '../errors';
import { enforceToolOutputLimit, getLimits } from '../validation/limits';
import { validateToolInput, type ValidationMode } from '../validation/schema';
import { getSecurityLogger } from '../security/logger';
import { PolicyEvaluator, type EvaluationContext } from '../guardrails/evaluator';
import type { PolicyAction, PolicyEvaluationResult } from '../guardrails/types';

/**
 * Tool with guardrails annotation
 */
export interface AnnotatedTool extends Tool {
  /** Guardrails policy status for this tool */
  guardrailsStatus?: {
    /** Policy action for this tool */
    action: PolicyAction;
    /** Whether the tool is allowed */
    allowed: boolean;
    /** Whether approval is required */
    requiresApproval: boolean;
    /** Reasons for the policy decision */
    reasons: string[];
    /** Warnings */
    warnings: string[];
  };
}

/**
 * Tool executor function type
 */
export type ToolExecutor = (input: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;

/**
 * Registered tool with executor
 */
interface RegisteredTool {
  tool: Tool;
  executor: ToolExecutor;
}

/**
 * Tool registry - manages available tools and their execution
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();
  private errorAggregator?: ErrorAggregator;
  private validationConfig?: ValidationConfig;
  private policyEvaluator?: PolicyEvaluator;

  /**
   * Register a tool
   */
  register(tool: Tool, executor: ToolExecutor): void {
    this.tools.set(tool.name, { tool, executor });
  }

  /**
   * Attach an error aggregator for tool execution errors
   */
  setErrorAggregator(aggregator?: ErrorAggregator): void {
    this.errorAggregator = aggregator;
  }

  /**
   * Configure validation behavior for tool inputs and outputs
   */
  setValidationConfig(config?: ValidationConfig): void {
    this.validationConfig = config;
  }

  /**
   * Set a policy evaluator for guardrails enforcement
   */
  setPolicyEvaluator(evaluator?: PolicyEvaluator): void {
    this.policyEvaluator = evaluator;
  }

  /**
   * Get the policy evaluator
   */
  getPolicyEvaluator(): PolicyEvaluator | undefined {
    return this.policyEvaluator;
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get all registered tools
   */
  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const entry of this.tools.values()) {
      tools.push(entry.tool);
    }
    return tools;
  }

  /**
   * Get tools annotated with guardrails policy status
   */
  getAnnotatedTools(depth?: number): AnnotatedTool[] {
    const tools: AnnotatedTool[] = [];
    for (const entry of this.tools.values()) {
      const annotated: AnnotatedTool = { ...entry.tool };

      if (this.policyEvaluator?.isEnabled()) {
        const result = this.policyEvaluator.evaluateToolUse({
          toolName: entry.tool.name,
          depth,
        });
        annotated.guardrailsStatus = {
          action: result.action,
          allowed: result.allowed,
          requiresApproval: result.requiresApproval,
          reasons: result.reasons,
          warnings: result.warnings,
        };
      }

      tools.push(annotated);
    }
    return tools;
  }

  /**
   * Get tools filtered by guardrails policy (only allowed tools)
   */
  getAllowedTools(depth?: number): Tool[] {
    if (!this.policyEvaluator?.isEnabled()) {
      return this.getTools();
    }

    const tools: Tool[] = [];
    for (const entry of this.tools.values()) {
      const result = this.policyEvaluator.evaluateToolUse({
        toolName: entry.tool.name,
        depth,
      });

      // Include if allowed or requires approval (let approval flow handle it)
      if (result.allowed || result.requiresApproval) {
        tools.push(entry.tool);
      }
    }
    return tools;
  }

  /**
   * Get denied tools based on guardrails policy
   */
  getDeniedTools(depth?: number): Tool[] {
    if (!this.policyEvaluator?.isEnabled()) {
      return [];
    }

    const tools: Tool[] = [];
    for (const entry of this.tools.values()) {
      const result = this.policyEvaluator.evaluateToolUse({
        toolName: entry.tool.name,
        depth,
      });

      if (!result.allowed && !result.requiresApproval) {
        tools.push(entry.tool);
      }
    }
    return tools;
  }

  /**
   * Check if a specific tool is allowed by guardrails
   */
  isToolAllowedByPolicy(toolName: string, input?: Record<string, unknown>, depth?: number): PolicyEvaluationResult | null {
    if (!this.policyEvaluator?.isEnabled()) {
      return null;
    }

    return this.policyEvaluator.evaluateToolUse({
      toolName,
      toolInput: input,
      depth,
    });
  }

  /**
   * Get a specific tool
   */
  getTool(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * Check if a tool is registered
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool call
   * @param toolCall - The tool call to execute
   * @param signal - Optional AbortSignal for cancellation
   */
  async execute(toolCall: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    const registered = this.tools.get(toolCall.name);

    if (!registered) {
      const error = new ToolExecutionError(`Tool "${toolCall.name}" not found`, {
        toolName: toolCall.name,
        toolInput: toolCall.input,
        code: ErrorCodes.TOOL_NOT_FOUND,
        recoverable: false,
        retryable: false,
        suggestion: 'Check the tool name or list available tools with /tools.',
      });
      this.errorAggregator?.record(error);
      return {
        toolCallId: toolCall.id,
        content: formatToolError(error),
        isError: true,
        toolName: toolCall.name,
      };
    }

    try {
      const validationMode = this.getValidationMode(toolCall.name);
      const validation = validateToolInput(toolCall.name, registered.tool.parameters, toolCall.input);
      const input = validation.coerced ?? (toolCall.input as Record<string, unknown>);

      if (!validation.valid) {
        const message = validation.errors?.map((err) => err.message).join('; ') || 'Invalid tool input';
        const error = new ToolExecutionError(message, {
          toolName: toolCall.name,
          toolInput: toolCall.input,
          code: ErrorCodes.VALIDATION_SCHEMA_ERROR,
          recoverable: false,
          retryable: false,
          suggestion: 'Review tool arguments and try again.',
        });
        if (validationMode === 'strict') {
          getSecurityLogger().log({
            eventType: 'validation_failure',
            severity: 'medium',
            details: {
              tool: toolCall.name,
              reason: message,
            },
            sessionId: (toolCall.input as Record<string, unknown>)?.sessionId as string || 'unknown',
          });
          this.errorAggregator?.record(error);
          return {
            toolCallId: toolCall.id,
            content: formatToolError(error),
            isError: true,
            toolName: toolCall.name,
          };
        }
      }

      const timeoutMsRaw = input?.timeoutMs ?? input?.timeout;
      const timeoutMsParsed = typeof timeoutMsRaw === 'string' ? Number(timeoutMsRaw) : timeoutMsRaw;
      let timeoutMs = typeof timeoutMsParsed === 'number' && timeoutMsParsed > 0 ? timeoutMsParsed : 60000;
      const derivedWaitTimeout = deriveWaitTimeoutMs(toolCall.name, input);
      if (derivedWaitTimeout !== null && derivedWaitTimeout > timeoutMs) {
        timeoutMs = derivedWaitTimeout;
      }

      // Check for abort before starting
      if (signal?.aborted) {
        throw new ToolExecutionError('Tool execution aborted', {
          toolName: toolCall.name,
          toolInput: toolCall.input,
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          recoverable: false,
          retryable: false,
          suggestion: 'The operation was cancelled.',
        });
      }

      // Create abort promise if signal provided
      const abortPromise = signal
        ? new Promise<never>((_, reject) => {
            const onAbort = () => {
              reject(
                new ToolExecutionError('Tool execution aborted', {
                  toolName: toolCall.name,
                  toolInput: toolCall.input,
                  code: ErrorCodes.TOOL_EXECUTION_FAILED,
                  recoverable: false,
                  retryable: false,
                  suggestion: 'The operation was cancelled.',
                })
              );
            };
            signal.addEventListener('abort', onAbort, { once: true });
          })
        : null;

      const racePromises: Promise<string>[] = [
        registered.executor(input, signal),
        sleep(timeoutMs).then(() => {
          throw new ToolExecutionError(`Tool timeout after ${Math.round(timeoutMs / 1000)}s`, {
            toolName: toolCall.name,
            toolInput: toolCall.input,
            code: ErrorCodes.TOOL_TIMEOUT,
            recoverable: true,
            retryable: true,
            suggestion: 'Try again or increase the timeout.',
          });
        }),
      ];

      if (abortPromise) {
        racePromises.push(abortPromise);
      }

      const result = await Promise.race(racePromises);
      const isError = isErrorResult(result);
      const outputLimit = this.getToolOutputLimit(toolCall.name);
      const rawContent = typeof result === 'string' ? result : safeStringify(result);
      const content = enforceToolOutputLimit(rawContent, outputLimit);
      return {
        toolCallId: toolCall.id,
        content,
        rawContent,
        truncated: content !== rawContent,
        isError,
        toolName: toolCall.name,
      };
    } catch (error) {
      const toolError = normalizeToolError(error, toolCall);
      const outputLimit = this.getToolOutputLimit(toolCall.name);
      const rawContent = formatToolError(toolError);
      const content = enforceToolOutputLimit(rawContent, outputLimit);
      if (toolError instanceof AssistantError) {
        this.errorAggregator?.record(toolError);
      }
      return {
        toolCallId: toolCall.id,
        content,
        rawContent,
        truncated: content !== rawContent,
        isError: true,
        toolName: toolCall.name,
      };
    }
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const tasks: Promise<ToolResult>[] = [];
    for (const call of toolCalls) {
      tasks.push(this.execute(call));
    }
    return Promise.all(tasks);
  }

  private getValidationMode(toolName: string): ValidationMode {
    const config = this.validationConfig;
    return resolveMode(config?.mode as ValidationMode, config?.perTool?.[toolName]?.mode as ValidationMode | undefined);
  }

  private getToolOutputLimit(toolName: string): number {
    const config = this.validationConfig;
    const limits = getLimits();
    return config?.perTool?.[toolName]?.maxOutputLength ?? config?.maxToolOutputLength ?? limits.maxToolOutputLength;
  }
}

// Helpers
function resolveMode(defaultMode: ValidationMode | undefined, override?: ValidationMode): ValidationMode {
  return override ?? defaultMode ?? 'strict';
}

function toNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isFinite(num)) return null;
  return num;
}

function deriveWaitTimeoutMs(toolName: string, input?: Record<string, unknown>): number | null {
  if (!input) return null;
  if (toolName !== 'wait' && toolName !== 'sleep') return null;

  const durationMs = toNumber(input.durationMs);
  if (durationMs !== null) {
    return clampWaitTimeout(durationMs);
  }

  const seconds = toNumber(input.seconds);
  if (seconds !== null) {
    return clampWaitTimeout(seconds * 1000);
  }

  const minutes = toNumber(input.minutes);
  if (minutes !== null) {
    return clampWaitTimeout(minutes * 60 * 1000);
  }

  const minSeconds = toNumber(input.minSeconds);
  const maxSeconds = toNumber(input.maxSeconds);
  if (minSeconds !== null && maxSeconds !== null) {
    return clampWaitTimeout(Math.max(minSeconds, maxSeconds) * 1000);
  }

  const minMinutes = toNumber(input.minMinutes);
  const maxMinutes = toNumber(input.maxMinutes);
  if (minMinutes !== null && maxMinutes !== null) {
    return clampWaitTimeout(Math.max(minMinutes, maxMinutes) * 60 * 1000);
  }

  return null;
}

function clampWaitTimeout(durationMs: number): number {
  const bufferMs = 5000;
  const maxMs = 7 * 24 * 60 * 60 * 1000;
  const safeDuration = Math.max(0, durationMs);
  const timeoutMs = safeDuration + bufferMs;
  return Math.min(timeoutMs, maxMs);
}

export const __test__ = {
  deriveWaitTimeoutMs,
  clampWaitTimeout,
};

function normalizeToolError(error: unknown, toolCall: ToolCall): AssistantError {
  if (error instanceof AssistantError) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new ToolExecutionError(`Error executing ${toolCall.name}: ${message}`, {
    toolName: toolCall.name,
    toolInput: toolCall.input,
    code: ErrorCodes.TOOL_EXECUTION_FAILED,
    recoverable: true,
    retryable: false,
  });
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? '');
  }
}

function formatToolError(error: AssistantError): string {
  if (error.suggestion) {
    return `${error.code}: ${error.message}\nSuggestion: ${error.suggestion}`;
  }
  return `${error.code}: ${error.message}`;
}

function isErrorResult(result: string): boolean {
  const trimmed = result.trim().toLowerCase();
  return (
    trimmed.startsWith('error') ||
    trimmed.startsWith('exit code') ||
    trimmed.startsWith('tool timeout') ||
    trimmed.startsWith('timed out')
  );
}
