/**
 * Generic deep merge utility for configuration objects.
 *
 * Merge semantics:
 * - Objects are recursively merged (override values take precedence over base)
 * - Arrays are replaced entirely (override array replaces base array, no concatenation)
 * - undefined in override means "use base value"
 * - null in override means "set to null"
 * - Primitives: override wins
 */

/**
 * Check if a value is a plain object (not an array, Date, RegExp, null, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  // Check for plain objects (not class instances like Date, RegExp, etc.)
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep merge two objects. Override values take precedence over base values.
 *
 * @param base - The base object with default values
 * @param override - The override object whose values take precedence
 * @returns A new merged object
 */
export function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T;
export function deepMerge<T extends Record<string, unknown>>(base: T, override?: Partial<T>): T;
export function deepMerge<T extends Record<string, unknown>>(base: T, override?: Partial<T>): T {
  if (!override) return base;

  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const overrideValue = (override as Record<string, unknown>)[key];
    const baseValue = result[key];

    // undefined in override means "use base value" (skip)
    if (overrideValue === undefined) {
      continue;
    }

    // null in override means "set to null"
    if (overrideValue === null) {
      result[key] = null;
      continue;
    }

    // Arrays are replaced entirely
    if (Array.isArray(overrideValue)) {
      result[key] = overrideValue;
      continue;
    }

    // Both values are plain objects: recurse
    if (isPlainObject(overrideValue) && isPlainObject(baseValue)) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      );
      continue;
    }

    // Override wins for everything else (primitives, non-plain objects, type mismatches)
    result[key] = overrideValue;
  }

  return result as T;
}
