/**
 * Webhooks module exports
 * Provides webhook event reception and management functionality
 */

// Core manager
export { WebhooksManager, createWebhooksManager } from './manager';
export type { WebhooksManagerOptions } from './manager';

// Storage
export { LocalWebhookStorage, getWebhooksBasePath } from './storage/local-storage';
export type { LocalStorageOptions as WebhookStorageOptions } from './storage/local-storage';

// Watcher
export { WebhookEventWatcher, type NewEventCallback } from './watcher';

// Crypto
export {
  generateWebhookSecret,
  signPayload,
  verifySignature,
  isTimestampValid,
  generateWebhookId,
  generateEventId,
  generateDeliveryId,
} from './crypto';

// Tools
export {
  webhookTools,
  webhookCreateTool,
  webhookListTool,
  webhookGetTool,
  webhookUpdateTool,
  webhookDeleteTool,
  webhookEventsTool,
  webhookTestTool,
  createWebhookToolExecutors,
  registerWebhookTools,
} from './tools';

// Types
export type {
  // Status types
  WebhookStatus,
  WebhookEventStatus,
  WebhookDeliveryStatus,
  // Core types
  WebhookRegistration,
  WebhookEvent,
  WebhookDelivery,
  // List/summary types
  WebhookListItem,
  WebhookEventListItem,
  // Input/output types
  CreateWebhookInput,
  UpdateWebhookInput,
  ReceiveEventInput,
  WebhookOperationResult,
  // Index types
  WebhookIndex,
  WebhookEventIndex,
  // Config types
  WebhooksConfig,
  WebhooksInjectionConfig,
  WebhooksStorageConfig,
  WebhooksSecurityConfig,
} from './types';
