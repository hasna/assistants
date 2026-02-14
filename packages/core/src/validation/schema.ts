import Ajv, { type ValidateFunction } from 'ajv';
import { ErrorCodes, ValidationError } from '../errors';

export type ValidationMode = 'strict' | 'lenient';

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
  coerced?: Record<string, unknown>;
}

const ajv = new Ajv({
  allErrors: true,
  coerceTypes: true,
  allowUnionTypes: true,
  strict: false,
});

const validatorCache = new Map<string, ValidateFunction>();

export function validateToolInput(
  toolName: string,
  schema: object | undefined,
  input: unknown
): ValidationResult {
  if (!schema || typeof schema !== 'object') {
    return { valid: true, coerced: normalizeInput(input) };
  }

  const validator = getValidator(toolName, schema);
  const inputCopy = normalizeInput(input);
  const valid = validator(inputCopy);

  if (!valid) {
    const errors = (validator.errors || []).map((err) =>
      new ValidationError(`${toolName}: ${formatAjvError(err)}`, {
        code: ErrorCodes.VALIDATION_SCHEMA_ERROR,
        field: err.instancePath || undefined,
        expected: typeof err.params?.type === 'string' ? err.params.type : undefined,
        received: typeof input,
        recoverable: false,
        retryable: false,
        suggestion: 'Check required fields and argument types for this tool.',
      })
    );
    return { valid: false, errors };
  }

  return { valid: true, coerced: inputCopy };
}

function getValidator(toolName: string, schema: object): ValidateFunction {
  const schemaKey = safeSchemaKey(schema);
  const cacheKey = schemaKey ? `${toolName}:${schemaKey}` : toolName;
  const cached = validatorCache.get(cacheKey);
  if (cached) return cached;

  const validator = ajv.compile(schema);
  validatorCache.set(cacheKey, validator);
  return validator;
}

function normalizeInput(input: unknown): Record<string, unknown> {
  if (input && typeof input === 'object') {
    return structuredClone(input as Record<string, unknown>);
  }
  return {};
}

function safeSchemaKey(schema: object): string | null {
  try {
    return JSON.stringify(schema);
  } catch {
    return null;
  }
}

function formatAjvError(error: { instancePath?: string; message?: string; params?: Record<string, unknown> }): string {
  const path = error.instancePath ? ` ${error.instancePath}` : '';
  const message = error.message || 'is invalid';
  return `${path} ${message}`.trim();
}
