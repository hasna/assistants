/**
 * Webhooks Types
 * Types for the webhook system that receives push events from external sources
 */

// ============================================
// Webhook Status & Event Status
// ============================================

export type WebhookStatus = 'active' | 'paused' | 'deleted';
export type WebhookEventStatus = 'pending' | 'injected' | 'processed' | 'failed';
export type WebhookDeliveryStatus = 'accepted' | 'rejected' | 'error';

// ============================================
// Core Types
// ============================================

/**
 * A registered webhook endpoint
 */
export interface WebhookRegistration {
  /** Unique webhook ID (whk_xxx) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Source identifier (e.g., 'gmail', 'notion', 'github', 'custom') */
  source: string;
  /** Description of what this webhook handles */
  description?: string;
  /** HMAC-SHA256 secret for signature verification (whsec_xxx) */
  secret: string;
  /** Event type filter (empty = accept all) */
  eventsFilter: string[];
  /** Current status */
  status: WebhookStatus;
  /** Number of events received */
  deliveryCount: number;
  /** When webhook was created (ISO 8601) */
  createdAt: string;
  /** When webhook was last updated (ISO 8601) */
  updatedAt: string;
  /** When last event was received (ISO 8601) */
  lastDeliveryAt?: string;
}

/**
 * A received webhook event
 */
export interface WebhookEvent {
  /** Unique event ID (evt_xxx) */
  id: string;
  /** Webhook registration ID this event belongs to */
  webhookId: string;
  /** Source identifier (copied from registration) */
  source: string;
  /** Event type (from X-Webhook-Event header) */
  eventType: string;
  /** Event payload (JSON) */
  payload: Record<string, unknown>;
  /** Received timestamp (ISO 8601) */
  timestamp: string;
  /** HMAC signature provided by sender */
  signature: string;
  /** Current status */
  status: WebhookEventStatus;
  /** When event was injected into context (ISO 8601) */
  injectedAt?: string;
}

/**
 * A webhook delivery record
 */
export interface WebhookDelivery {
  /** Unique delivery ID (dlv_xxx) */
  id: string;
  /** Webhook registration ID */
  webhookId: string;
  /** Event ID */
  eventId: string;
  /** When event was received (ISO 8601) */
  receivedAt: string;
  /** Delivery status */
  status: WebhookDeliveryStatus;
  /** Error message if delivery failed */
  error?: string;
  /** HTTP status code returned to sender */
  httpStatus: number;
  /** IP address of sender (if available) */
  remoteIp?: string;
}

// ============================================
// List/Summary Types
// ============================================

/**
 * Summary view of a webhook for listing
 */
export interface WebhookListItem {
  /** Webhook ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Source identifier */
  source: string;
  /** Current status */
  status: WebhookStatus;
  /** Number of events received */
  deliveryCount: number;
  /** When created (ISO 8601) */
  createdAt: string;
  /** When last event was received (ISO 8601) */
  lastDeliveryAt?: string;
}

/**
 * Summary view of a webhook event for listing
 */
export interface WebhookEventListItem {
  /** Event ID */
  id: string;
  /** Source identifier */
  source: string;
  /** Event type */
  eventType: string;
  /** Preview of payload (first ~100 chars of JSON) */
  preview: string;
  /** Event timestamp (ISO 8601) */
  timestamp: string;
  /** Current status */
  status: WebhookEventStatus;
}

// ============================================
// Input/Output Types
// ============================================

/**
 * Input for creating a webhook registration
 */
export interface CreateWebhookInput {
  /** Human-readable name */
  name: string;
  /** Source identifier (e.g., 'gmail', 'notion', 'custom') */
  source: string;
  /** Description (optional) */
  description?: string;
  /** Event type filter (optional, empty = accept all) */
  eventsFilter?: string[];
}

/**
 * Input for updating a webhook registration
 */
export interface UpdateWebhookInput {
  /** Webhook ID to update */
  id: string;
  /** New name */
  name?: string;
  /** New description */
  description?: string;
  /** New event type filter */
  eventsFilter?: string[];
  /** New status */
  status?: WebhookStatus;
}

/**
 * Input for receiving a webhook event
 */
export interface ReceiveEventInput {
  /** Webhook ID from URL */
  webhookId: string;
  /** Raw request body (used for signature verification when available) */
  rawBody?: string;
  /** Event payload */
  payload: Record<string, unknown>;
  /** HMAC-SHA256 signature from X-Webhook-Signature header */
  signature: string;
  /** Timestamp from X-Webhook-Timestamp header */
  timestamp: string;
  /** Event type from X-Webhook-Event header */
  eventType: string;
  /** Remote IP (optional) */
  remoteIp?: string;
}

/**
 * Result from a webhook operation
 */
export interface WebhookOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Webhook ID (for create operations) */
  webhookId?: string;
  /** Delivery ID (for receive operations) */
  deliveryId?: string;
  /** Event ID (for receive operations) */
  eventId?: string;
  /** Webhook secret (for create operations) */
  secret?: string;
  /** Webhook URL (for create operations) */
  url?: string;
}

// ============================================
// Index Types
// ============================================

/**
 * Webhook registry index for fast lookups
 */
export interface WebhookIndex {
  /** List of webhook summaries */
  webhooks: WebhookListItem[];
  /** Last time index was updated */
  lastUpdated: string;
}

/**
 * Event index for a specific webhook
 */
export interface WebhookEventIndex {
  /** List of event summaries */
  events: WebhookEventListItem[];
  /** Last time index was updated */
  lastUpdated: string;
  /** Total events received */
  totalEvents: number;
  /** Pending events count */
  pendingCount: number;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Webhooks injection configuration
 */
export interface WebhooksInjectionConfig {
  /** Whether to auto-inject events at turn start (default: true) */
  enabled?: boolean;
  /** Max events to inject per turn (default: 5) */
  maxPerTurn?: number;
}

/**
 * Webhooks storage configuration
 */
export interface WebhooksStorageConfig {
  /** Base path for storage (default: ~/.assistants/webhooks) */
  basePath?: string;
  /** Max events per webhook (default: 1000) */
  maxEvents?: number;
  /** Max event age in days (default: 30) */
  maxAgeDays?: number;
}

/**
 * Webhooks security configuration
 */
export interface WebhooksSecurityConfig {
  /** Max timestamp age in ms for replay protection (default: 300000 = 5 min) */
  maxTimestampAgeMs?: number;
  /** Rate limit: max events per webhook per minute (default: 60) */
  rateLimitPerMinute?: number;
}

/**
 * Webhooks system configuration (internal, detailed version)
 */
export interface WebhooksConfig {
  /** Whether webhooks are enabled (default: false) */
  enabled?: boolean;
  /** Auto-injection settings */
  injection?: WebhooksInjectionConfig;
  /** Storage settings */
  storage?: WebhooksStorageConfig;
  /** Security settings */
  security?: WebhooksSecurityConfig;
}
