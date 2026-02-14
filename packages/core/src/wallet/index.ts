/**
 * Wallet module exports
 * Provides payment card storage for assistants using:
 * - Local .assistants storage
 * - AWS Secrets Manager
 *
 * Access remains rate-limited regardless of backend.
 */

// Core manager
export { WalletManager, createWalletManager } from './wallet-manager';
export type { WalletManagerOptions } from './wallet-manager';

// Storage (AWS Secrets Manager)
export { SecretsClient } from './storage/secrets-client';
export type { SecretsClientOptions } from './storage/secrets-client';
export { LocalWalletClient } from './storage/local-client';
export type { LocalWalletClientOptions } from './storage/local-client';

// Tools
export {
  walletTools,
  walletListTool,
  walletAddTool,
  walletGetTool,
  walletRemoveTool,
  createWalletToolExecutors,
  registerWalletTools,
} from './tools';

// Types
export type {
  Card,
  CardListItem,
  CardForAutomation,
  CardForPayment,
  AddCardInput,
  BillingAddress,
  RateLimitState,
  WalletOperationResult,
} from './types';
