/**
 * Assistant Registry Module
 *
 * Provides assistant registration, discovery, and lifecycle management.
 */

export * from './types';
export { RegistryStore } from './store';
export { AssistantRegistryService, getGlobalRegistry, resetGlobalRegistry } from './service';
