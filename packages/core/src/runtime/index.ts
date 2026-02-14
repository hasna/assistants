/**
 * Runtime abstraction layer for cross-platform support.
 * Allows core to work with both Bun and Node.js runtimes.
 */

export * from './types';

import type { Runtime } from './types';

let currentRuntime: Runtime | null = null;

if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
  try {
    const { bunRuntime } = await import('@hasna/runtime-bun');
    currentRuntime = bunRuntime as Runtime;
  } catch {
    // Ignore and fall through to explicit error below.
  }
}

/**
 * Set the runtime implementation to use.
 * Must be called before any code that uses getRuntime().
 */
export function setRuntime(runtime: Runtime): void {
  currentRuntime = runtime;
}

/**
 * Get the current runtime implementation.
 * Throws if setRuntime() has not been called.
 */
export function getRuntime(): Runtime {
  if (!currentRuntime) {
    throw new Error(
      'Runtime not initialized. Call setRuntime() with a runtime implementation ' +
        '(e.g., bunRuntime from @hasna/runtime-bun or nodeRuntime from @hasna/runtime-node) ' +
        'before using any core functionality.'
    );
  }
  return currentRuntime;
}

/**
 * Check if a runtime has been initialized.
 */
export function hasRuntime(): boolean {
  return currentRuntime !== null;
}
