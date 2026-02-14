/**
 * Assistant Capabilities Module
 *
 * Provides capability definitions, resolution, and enforcement for assistants.
 */

export * from './types';
export {
  resolveCapabilityChain,
  createCapabilityChain,
  extendCapabilityChain,
} from './resolver';
export {
  CapabilityStorage,
  getGlobalCapabilityStorage,
  resetGlobalCapabilityStorage,
  configToCapabilities,
  getDefaultCapabilities,
  getCapabilityPreset,
} from './storage';
export type { CapabilityStorageConfig } from './storage';
export {
  CapabilityEnforcer,
  getGlobalCapabilityEnforcer,
  resetGlobalCapabilityEnforcer,
} from './enforcer';
export type {
  CapabilityCheckContext,
  CapabilityEnforcementResult,
} from './enforcer';
