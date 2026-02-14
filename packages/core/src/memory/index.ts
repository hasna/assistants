/**
 * Memory Module
 *
 * Provides persistent memory storage for the terminal/core package.
 * Supports global, shared, and private memory scopes with SQLite backend.
 *
 * NOTE: This is for terminal only. Web uses PostgreSQL with AWS vector storage.
 */

// Types
export * from './types';

// Memory Store (legacy key-value)
export { MemoryStore } from './store';

// Global Memory Manager
export { GlobalMemoryManager } from './global-memory';

// Memory Injector
export { MemoryInjector, buildContextInjection } from './injector';
