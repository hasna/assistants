/**
 * WebhooksManager - Core class for webhook event handling
 * Handles registration, event reception, context injection, and cleanup.
 * Follows the same pattern as messages/messages-manager.ts
 */

import { LocalWebhookStorage } from './storage/local-storage';
import { WebhookEventWatcher, type NewEventCallback } from './watcher';
import type { DatabaseConnection } from '../runtime';
import {
  generateWebhookSecret,
  generateWebhookId,
  generateEventId,
  generateDeliveryId,
  verifySignature,
  isTimestampValid,
} from './crypto';
import type {
  WebhookRegistration,
  WebhookEvent,
  WebhookDelivery,
  WebhookListItem,
  WebhookEventListItem,
  CreateWebhookInput,
  UpdateWebhookInput,
  ReceiveEventInput,
  WebhookOperationResult,
  WebhooksConfig,
} from './types';

export interface WebhooksManagerOptions {
  /** Assistant ID */
  assistantId: string;
  /** Webhooks configuration */
  config: WebhooksConfig;
  /** Optional database connection (for testing) */
  db?: DatabaseConnection;
}

/**
 * Rate limit tracker - tracks event counts per webhook per minute
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/**
 * WebhooksManager handles all webhook operations
 */
export class WebhooksManager {
  private assistantId: string;
  private config: WebhooksConfig;
  private storage: LocalWebhookStorage;
  private watcher: WebhookEventWatcher | null = null;
  private eventCallbacks: Set<(event: WebhookEvent) => void> = new Set();
  private rateLimits: Map<string, RateLimitEntry> = new Map();

  constructor(options: WebhooksManagerOptions) {
    this.assistantId = options.assistantId;
    this.config = options.config;

    this.storage = new LocalWebhookStorage(options.db ? { db: options.db } : undefined);
  }

  /**
   * Initialize the manager
   */
  async initialize(): Promise<void> {
    await this.storage.ensureDirectories();
  }

  // ============================================
  // Registration Operations
  // ============================================

  /**
   * Create a new webhook registration
   */
  async create(input: CreateWebhookInput): Promise<WebhookOperationResult> {
    try {
      const webhookId = generateWebhookId();
      const secret = generateWebhookSecret();
      const now = new Date().toISOString();

      const registration: WebhookRegistration = {
        id: webhookId,
        name: input.name,
        source: input.source,
        description: input.description,
        secret,
        eventsFilter: input.eventsFilter || [],
        status: 'active',
        deliveryCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await this.storage.saveRegistration(registration);

      const url = `/api/v1/webhooks/receive/${webhookId}`;

      return {
        success: true,
        message: `Webhook "${input.name}" created for source "${input.source}"`,
        webhookId,
        secret,
        url,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create webhook: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * List all registered webhooks
   */
  async list(): Promise<WebhookListItem[]> {
    return this.storage.listRegistrations();
  }

  /**
   * Get a specific webhook registration (full details)
   */
  async get(webhookId: string): Promise<WebhookRegistration | null> {
    return this.storage.loadRegistration(webhookId);
  }

  /**
   * Update a webhook registration
   */
  async update(input: UpdateWebhookInput): Promise<WebhookOperationResult> {
    try {
      const registration = await this.storage.loadRegistration(input.id);
      if (!registration) {
        return { success: false, message: `Webhook "${input.id}" not found.` };
      }

      if (input.name !== undefined) registration.name = input.name;
      if (input.description !== undefined) registration.description = input.description;
      if (input.eventsFilter !== undefined) registration.eventsFilter = input.eventsFilter;
      if (input.status !== undefined) registration.status = input.status;
      registration.updatedAt = new Date().toISOString();

      await this.storage.saveRegistration(registration);

      return {
        success: true,
        message: `Webhook "${registration.name}" updated.`,
        webhookId: registration.id,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update webhook: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete a webhook registration
   */
  async delete(webhookId: string): Promise<WebhookOperationResult> {
    const deleted = await this.storage.deleteRegistration(webhookId);
    if (deleted) {
      return { success: true, message: `Webhook ${webhookId} deleted.` };
    }
    return { success: false, message: `Webhook ${webhookId} not found.` };
  }

  // ============================================
  // Event Reception
  // ============================================

  /**
   * Receive a webhook event (called by the web API receive endpoint)
   */
  async receiveEvent(input: ReceiveEventInput): Promise<WebhookOperationResult> {
    try {
      // Load registration
      const registration = await this.storage.loadRegistration(input.webhookId);
      if (!registration) {
        return { success: false, message: 'Webhook not found.' };
      }

      if (registration.status !== 'active') {
        return { success: false, message: 'Webhook is not active.' };
      }

      // Check rate limit
      if (!this.checkRateLimit(input.webhookId)) {
        return { success: false, message: 'Rate limit exceeded.' };
      }

      // Verify timestamp freshness
      const maxTimestampAge = this.config.security?.maxTimestampAgeMs || 300_000;
      if (!isTimestampValid(input.timestamp, maxTimestampAge)) {
        return { success: false, message: 'Timestamp too old or invalid.' };
      }

      // Verify signature
      const payloadStr = typeof input.rawBody === 'string' ? input.rawBody : JSON.stringify(input.payload);
      if (!verifySignature(payloadStr, input.signature, registration.secret)) {
        return { success: false, message: 'Invalid signature.' };
      }

      // Check events filter
      if (registration.eventsFilter.length > 0 && !registration.eventsFilter.includes(input.eventType)) {
        return { success: false, message: `Event type "${input.eventType}" not accepted by this webhook.` };
      }

      // Create event
      const eventId = generateEventId();
      const deliveryId = generateDeliveryId();
      const now = new Date().toISOString();

      const event: WebhookEvent = {
        id: eventId,
        webhookId: input.webhookId,
        source: registration.source,
        eventType: input.eventType,
        payload: input.payload,
        timestamp: input.timestamp,
        signature: input.signature,
        status: 'pending',
      };

      await this.storage.saveEvent(event);

      // Create delivery record
      const delivery: WebhookDelivery = {
        id: deliveryId,
        webhookId: input.webhookId,
        eventId,
        receivedAt: now,
        status: 'accepted',
        httpStatus: 200,
        remoteIp: input.remoteIp,
      };

      await this.storage.saveDelivery(delivery);

      // Update registration delivery count
      registration.deliveryCount++;
      registration.lastDeliveryAt = now;
      registration.updatedAt = now;
      await this.storage.saveRegistration(registration);

      return {
        success: true,
        message: 'Event received.',
        deliveryId,
        eventId,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to process event: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Send a test event to a webhook (self-generated)
   */
  async sendTestEvent(webhookId: string): Promise<WebhookOperationResult> {
    const registration = await this.storage.loadRegistration(webhookId);
    if (!registration) {
      return { success: false, message: `Webhook "${webhookId}" not found.` };
    }

    const { signPayload } = await import('./crypto');
    const payload = { test: true, message: 'Test event from assistant', timestamp: new Date().toISOString() };
    const payloadStr = JSON.stringify(payload);
    const signature = signPayload(payloadStr, registration.secret);

    return this.receiveEvent({
      webhookId,
      payload,
      signature,
      timestamp: new Date().toISOString(),
      eventType: 'test',
      rawBody: payloadStr,
    });
  }

  // ============================================
  // Event Listing
  // ============================================

  /**
   * List events for a webhook
   */
  async listEvents(
    webhookId: string,
    options?: { limit?: number; pendingOnly?: boolean }
  ): Promise<WebhookEventListItem[]> {
    return this.storage.listEvents(webhookId, options);
  }

  /**
   * List delivery records for a webhook
   */
  async listDeliveries(
    webhookId: string,
    options?: { limit?: number }
  ): Promise<WebhookDelivery[]> {
    return this.storage.listDeliveries(webhookId, options);
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Get pending events for context injection
   */
  async getPendingForInjection(): Promise<WebhookEvent[]> {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }

    const maxPerTurn = injectionConfig.maxPerTurn || 5;
    const webhooks = await this.storage.listRegistrations();
    const allPending: WebhookEvent[] = [];

    for (const webhook of webhooks) {
      if (webhook.status !== 'active') continue;

      const pendingItems = await this.storage.listEvents(webhook.id, { pendingOnly: true });
      for (const item of pendingItems) {
        const event = await this.storage.loadEvent(webhook.id, item.id);
        if (event && event.status === 'pending') {
          allPending.push(event);
        }
      }
    }

    // Sort by timestamp (oldest first)
    allPending.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return allPending.slice(0, maxPerTurn);
  }

  /**
   * Mark events as injected
   */
  async markInjected(events: Array<{ webhookId: string; eventId: string }>): Promise<void> {
    const now = new Date().toISOString();
    for (const { webhookId, eventId } of events) {
      await this.storage.updateEventStatus(webhookId, eventId, 'injected', now);
    }
  }

  /**
   * Build context string for injection
   */
  buildInjectionContext(events: WebhookEvent[]): string {
    if (events.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('## Pending Webhook Events');
    lines.push('');
    lines.push(`You have ${events.length} pending webhook event(s):`);

    for (const evt of events) {
      lines.push('');
      lines.push(`### ${evt.source}: ${evt.eventType}`);
      lines.push(`**Webhook:** ${evt.webhookId} | **Received:** ${formatDate(evt.timestamp)}`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(evt.payload, null, 2));
      lines.push('```');
      lines.push(`*Event ID: ${evt.id}*`);
      lines.push('---');
    }

    lines.push('');
    lines.push('Process these events as appropriate. Use webhook tools to manage webhooks.');

    return lines.join('\n');
  }

  // ============================================
  // Real-time Watching
  // ============================================

  /**
   * Start watching for new webhook events
   */
  startWatching(): void {
    if (this.watcher) return;
    this.watcher = new WebhookEventWatcher(this.config.storage?.basePath);

    this.watcher.onNewEvent(async (webhookId, eventId) => {
      try {
        const event = await this.storage.loadEvent(webhookId, eventId);
        if (event) {
          for (const cb of this.eventCallbacks) {
            try {
              cb(event);
            } catch {
              // Don't let callback errors crash watching
            }
          }
        }
      } catch {
        // Non-critical
      }
    });

    this.watcher.start();
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
    this.eventCallbacks.clear();
  }

  /**
   * Register a callback for incoming events
   * Returns unsubscribe function
   */
  onEvent(callback: (event: WebhookEvent) => void): () => void {
    this.eventCallbacks.add(callback);
    return () => {
      this.eventCallbacks.delete(callback);
    };
  }

  /**
   * Check if watching is active
   */
  isWatching(): boolean {
    return this.watcher?.isRunning() ?? false;
  }

  // ============================================
  // Rate Limiting
  // ============================================

  /**
   * Check rate limit for a webhook
   * Returns true if within limit, false if exceeded
   */
  private checkRateLimit(webhookId: string): boolean {
    const maxPerMinute = this.config.security?.rateLimitPerMinute || 60;
    const now = Date.now();
    const windowMs = 60_000;

    let entry = this.rateLimits.get(webhookId);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { count: 0, windowStart: now };
      this.rateLimits.set(webhookId, entry);
    }

    entry.count++;
    return entry.count <= maxPerMinute;
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clean up old events across all webhooks
   */
  async cleanup(): Promise<number> {
    const maxAgeDays = this.config.storage?.maxAgeDays || 30;
    const maxEvents = this.config.storage?.maxEvents || 1000;
    const webhooks = await this.storage.listRegistrations();

    let totalDeleted = 0;
    for (const webhook of webhooks) {
      totalDeleted += await this.storage.cleanupEvents(webhook.id, maxAgeDays);
      totalDeleted += await this.storage.enforceMaxEvents(webhook.id, maxEvents);
    }

    return totalDeleted;
  }
}

/**
 * Format a date for display
 */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString();
}

/**
 * Create a WebhooksManager from config
 */
export function createWebhooksManager(
  assistantId: string,
  config: WebhooksConfig
): WebhooksManager {
  return new WebhooksManager({
    assistantId,
    config,
  });
}
