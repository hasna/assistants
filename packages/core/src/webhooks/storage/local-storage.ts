import { getDatabase } from '../../database';
import type { DatabaseConnection } from '../../database';
import type {
  WebhookRegistration,
  WebhookEvent,
  WebhookDelivery,
  WebhookIndex,
  WebhookEventIndex,
  WebhookListItem,
  WebhookEventListItem,
} from '../types';

export interface LocalStorageOptions {
  db?: DatabaseConnection;
}

export function getWebhooksBasePath(): string {
  return ''; // No longer needed - storage is in SQLite
}

function getDb(injected?: DatabaseConnection): DatabaseConnection {
  if (injected) return injected;
  return getDatabase();
}

interface RegistrationRow {
  id: string;
  name: string;
  source: string;
  url: string | null;
  secret: string | null;
  events: string | null;
  status: string;
  delivery_count: number;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  webhook_id: string;
  source: string;
  event_type: string;
  payload: string;
  headers: string | null;
  status: string;
  timestamp: string;
  injected_at: string | null;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string;
  received_at: string;
  processed_at: string | null;
  status: string;
  response: string | null;
}

function rowToRegistration(row: RegistrationRow): WebhookRegistration {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    secret: row.secret ?? '',
    eventsFilter: row.events ? JSON.parse(row.events) as string[] : [],
    status: row.status as WebhookRegistration['status'],
    deliveryCount: row.delivery_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDeliveryAt: row.last_delivery_at ?? undefined,
  };
}

function rowToEvent(row: EventRow): WebhookEvent {
  const event: WebhookEvent = {
    id: row.id,
    webhookId: row.webhook_id,
    source: row.source,
    eventType: row.event_type,
    payload: JSON.parse(row.payload),
    timestamp: row.timestamp,
    signature: '', // Not stored separately in DB
    status: row.status as WebhookEvent['status'],
  };
  if (row.injected_at) event.injectedAt = row.injected_at;
  return event;
}

function rowToDelivery(row: DeliveryRow): WebhookDelivery {
  const delivery: WebhookDelivery = {
    id: row.id,
    webhookId: row.webhook_id,
    eventId: row.event_id,
    receivedAt: row.received_at,
    status: row.status as WebhookDelivery['status'],
    httpStatus: 200,
  };
  if (row.processed_at) (delivery as unknown as Record<string, unknown>).processedAt = row.processed_at;
  if (row.response) {
    try {
      const parsed = JSON.parse(row.response) as Record<string, unknown>;
      if (parsed.error) delivery.error = parsed.error as string;
      if (parsed.httpStatus) delivery.httpStatus = parsed.httpStatus as number;
    } catch {
      // Ignore parse errors
    }
  }
  return delivery;
}

export class LocalWebhookStorage {
  private injectedDb?: DatabaseConnection;

  constructor(options: LocalStorageOptions = {}) {
    this.injectedDb = options.db;
  }

  private db(): DatabaseConnection {
    return getDb(this.injectedDb);
  }

  async ensureDirectories(_webhookId?: string): Promise<void> {
    // No-op: tables are created by schema initialization
  }

  // ============================================
  // Webhook Index Operations
  // ============================================

  async loadIndex(): Promise<WebhookIndex> {
    const items = await this.listRegistrations();
    return { webhooks: items, lastUpdated: new Date().toISOString() };
  }

  async saveIndex(_index: WebhookIndex): Promise<void> {
    // No-op: index is computed from the registrations table
  }

  // ============================================
  // Registration Operations
  // ============================================

  async saveRegistration(registration: WebhookRegistration): Promise<void> {
    this.db().prepare(
      `INSERT OR REPLACE INTO webhook_registrations (id, name, source, url, secret, events, status, delivery_count, last_delivery_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      registration.id,
      registration.name,
      registration.source,
      null,
      registration.secret,
      registration.eventsFilter?.length ? JSON.stringify(registration.eventsFilter) : null,
      registration.status,
      registration.deliveryCount,
      registration.lastDeliveryAt ?? null,
      registration.createdAt,
      registration.updatedAt
    );
  }

  async loadRegistration(webhookId: string): Promise<WebhookRegistration | null> {
    const row = this.db().query<RegistrationRow>(
      'SELECT * FROM webhook_registrations WHERE id = ?'
    ).get(webhookId);
    if (!row) return null;
    return rowToRegistration(row);
  }

  async deleteRegistration(webhookId: string): Promise<boolean> {
    const d = this.db();
    return d.transaction(() => {
      const result = d.prepare(
        'DELETE FROM webhook_registrations WHERE id = ?'
      ).run(webhookId);
      if (result.changes === 0) return false;

      d.prepare('DELETE FROM webhook_events WHERE webhook_id = ?').run(webhookId);
      d.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(webhookId);

      return true;
    });
  }

  async listRegistrations(): Promise<WebhookListItem[]> {
    const rows = this.db().query<RegistrationRow>(
      'SELECT * FROM webhook_registrations ORDER BY created_at DESC'
    ).all();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.source,
      status: row.status as WebhookListItem['status'],
      deliveryCount: row.delivery_count,
      createdAt: row.created_at,
      lastDeliveryAt: row.last_delivery_at ?? undefined,
    }));
  }

  // ============================================
  // Event Operations
  // ============================================

  async loadEventIndex(webhookId: string): Promise<WebhookEventIndex> {
    const events = await this.listEvents(webhookId);
    const pendingCount = events.filter((e) => e.status === 'pending').length;
    return {
      events,
      lastUpdated: new Date().toISOString(),
      totalEvents: events.length,
      pendingCount,
    };
  }

  async saveEventIndex(_webhookId: string, _index: WebhookEventIndex): Promise<void> {
    // No-op: index is computed from the events table
  }

  async saveEvent(event: WebhookEvent): Promise<void> {
    this.db().prepare(
      `INSERT OR REPLACE INTO webhook_events (id, webhook_id, source, event_type, payload, headers, status, timestamp, injected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.id,
      event.webhookId,
      event.source,
      event.eventType,
      JSON.stringify(event.payload),
      null,
      event.status,
      event.timestamp,
      event.injectedAt ?? null
    );
  }

  async loadEvent(webhookId: string, eventId: string): Promise<WebhookEvent | null> {
    const row = this.db().query<EventRow>(
      'SELECT * FROM webhook_events WHERE webhook_id = ? AND id = ?'
    ).get(webhookId, eventId);
    if (!row) return null;
    return rowToEvent(row);
  }

  async updateEventStatus(
    webhookId: string,
    eventId: string,
    status: WebhookEvent['status'],
    timestamp?: string
  ): Promise<void> {
    const setClauses = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'injected' && timestamp) {
      setClauses.push('injected_at = ?');
      params.push(timestamp);
    }

    params.push(webhookId, eventId);
    this.db().prepare(
      `UPDATE webhook_events SET ${setClauses.join(', ')} WHERE webhook_id = ? AND id = ?`
    ).run(...params);
  }

  async listEvents(
    webhookId: string,
    options?: {
      limit?: number;
      pendingOnly?: boolean;
    }
  ): Promise<WebhookEventListItem[]> {
    let sql = 'SELECT * FROM webhook_events WHERE webhook_id = ?';
    const params: unknown[] = [webhookId];

    if (options?.pendingOnly) {
      sql += " AND status = 'pending'";
    }

    sql += ' ORDER BY timestamp DESC';

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db().query<EventRow>(sql).all(...params);
    return rows.map((row) => {
      const payloadStr = row.payload;
      return {
        id: row.id,
        source: row.source,
        eventType: row.event_type,
        preview: payloadStr.slice(0, 100) + (payloadStr.length > 100 ? '...' : ''),
        timestamp: row.timestamp,
        status: row.status as WebhookEventListItem['status'],
      };
    });
  }

  // ============================================
  // Delivery Operations
  // ============================================

  async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    this.db().prepare(
      `INSERT OR REPLACE INTO webhook_deliveries (id, webhook_id, event_id, received_at, processed_at, status, response)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      delivery.id,
      delivery.webhookId,
      delivery.eventId,
      delivery.receivedAt,
      null,
      delivery.status,
      JSON.stringify({ httpStatus: delivery.httpStatus, error: delivery.error })
    );
  }

  async listDeliveries(
    webhookId: string,
    options?: { limit?: number }
  ): Promise<WebhookDelivery[]> {
    let sql = 'SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY received_at DESC';
    const params: unknown[] = [webhookId];

    if (options?.limit && options.limit > 0) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db().query<DeliveryRow>(sql).all(...params);
    return rows.map(rowToDelivery);
  }

  // ============================================
  // Cleanup Operations
  // ============================================

  async cleanupEvents(webhookId: string, maxAgeDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffISO = cutoffDate.toISOString();

    const result = this.db().prepare(
      'DELETE FROM webhook_events WHERE webhook_id = ? AND timestamp < ?'
    ).run(webhookId, cutoffISO);

    return result.changes;
  }

  async enforceMaxEvents(webhookId: string, maxEvents: number): Promise<number> {
    const countRow = this.db().query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM webhook_events WHERE webhook_id = ?'
    ).get(webhookId);

    const total = countRow?.cnt ?? 0;
    if (total <= maxEvents) return 0;

    const toDelete = total - maxEvents;

    this.db().prepare(
      `DELETE FROM webhook_events WHERE id IN (
        SELECT id FROM webhook_events WHERE webhook_id = ? ORDER BY timestamp ASC LIMIT ?
      )`
    ).run(webhookId, toDelete);

    return toDelete;
  }
}
