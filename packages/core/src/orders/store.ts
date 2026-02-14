/**
 * OrderStore - SQLite storage for orders and stores
 *
 * Manages stores, orders, and order items in a shared SQLite database.
 * Follows the pattern from channels/store.ts.
 */

import { generateId } from '@hasna/assistants-shared';
import { getDatabase } from '../database';
import type { DatabaseConnection } from '../runtime';
import type {
  Store,
  Order,
  OrderItem,
  OrderListItem,
  StoreListItem,
  OrderOperationResult,
  OrderStatus,
  OrderItemStatus,
  StoreCategory,
} from './types';

function generateStoreId(): string {
  return `str_${generateId().slice(0, 12)}`;
}

function generateOrderId(): string {
  return `ord_${generateId().slice(0, 12)}`;
}

function generateItemId(): string {
  return `itm_${generateId().slice(0, 12)}`;
}

/**
 * OrderStore manages all order and store data in SQLite
 */
export class OrderStore {
  private db: DatabaseConnection;

  constructor(db?: DatabaseConnection) {
    this.db = db || getDatabase();
  }

  // ============================================
  // Store CRUD
  // ============================================

  createStore(
    name: string,
    options?: {
      url?: string;
      connectorName?: string;
      category?: StoreCategory;
      notes?: string;
    }
  ): OrderOperationResult {
    const existing = this.getStoreByName(name);
    if (existing) {
      return { success: false, message: `Store "${name}" already exists.`, storeId: existing.id };
    }

    const id = generateStoreId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO stores (id, name, url, connector_name, category, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      options?.url || null,
      options?.connectorName || null,
      options?.category || 'other',
      options?.notes || null,
      now,
      now
    );

    return { success: true, message: `Store "${name}" registered.`, storeId: id };
  }

  getStore(id: string): Store | null {
    const row = this.db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToStore(row) : null;
  }

  getStoreByName(name: string): Store | null {
    const row = this.db.prepare('SELECT * FROM stores WHERE LOWER(name) = LOWER(?)').get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToStore(row) : null;
  }

  resolveStore(nameOrId: string): Store | null {
    return this.getStore(nameOrId) || this.getStoreByName(nameOrId);
  }

  listStores(): StoreListItem[] {
    const rows = this.db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM orders WHERE store_id = s.id) as order_count,
        (SELECT MAX(created_at) FROM orders WHERE store_id = s.id) as last_order_at
      FROM stores s
      ORDER BY last_order_at DESC NULLS LAST, s.name ASC
    `).all() as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      category: String(row.category) as StoreCategory,
      url: row.url ? String(row.url) : null,
      orderCount: Number(row.order_count),
      lastOrderAt: row.last_order_at ? String(row.last_order_at) : null,
    }));
  }

  updateStore(
    id: string,
    updates: Partial<Pick<Store, 'name' | 'url' | 'connectorName' | 'category' | 'notes'>>
  ): boolean {
    const store = this.getStore(id);
    if (!store) return false;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.url !== undefined) { sets.push('url = ?'); params.push(updates.url); }
    if (updates.connectorName !== undefined) { sets.push('connector_name = ?'); params.push(updates.connectorName); }
    if (updates.category !== undefined) { sets.push('category = ?'); params.push(updates.category); }
    if (updates.notes !== undefined) { sets.push('notes = ?'); params.push(updates.notes); }

    params.push(id);
    const result = this.db.prepare(`UPDATE stores SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return (result as { changes: number }).changes > 0;
  }

  // ============================================
  // Order CRUD
  // ============================================

  createOrder(
    storeId: string,
    storeName: string,
    options?: {
      orderNumber?: string;
      description?: string;
      totalAmount?: number;
      currency?: string;
      shippingAddress?: string;
      paymentMethod?: string;
      notes?: string;
      connectorOrderId?: string;
    }
  ): OrderOperationResult {
    const id = generateOrderId();
    const now = new Date().toISOString();

    this.db.prepare(
      `INSERT INTO orders (id, store_id, store_name, order_number, description, status, total_amount, currency, shipping_address, payment_method, notes, connector_order_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      storeId,
      storeName,
      options?.orderNumber || null,
      options?.description || null,
      options?.totalAmount ?? null,
      options?.currency || 'USD',
      options?.shippingAddress || null,
      options?.paymentMethod || null,
      options?.notes || null,
      options?.connectorOrderId || null,
      now,
      now
    );

    return { success: true, message: `Order created at ${storeName}.`, orderId: id };
  }

  getOrder(id: string): Order | null {
    const row = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToOrder(row) : null;
  }

  listOrders(options?: {
    status?: OrderStatus;
    storeId?: string;
    limit?: number;
  }): OrderListItem[] {
    let query = `
      SELECT o.*,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
      FROM orders o
    `;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.status) {
      conditions.push('o.status = ?');
      params.push(options.status);
    }
    if (options?.storeId) {
      conditions.push('o.store_id = ?');
      params.push(options.storeId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY o.updated_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: String(row.id),
      storeName: String(row.store_name),
      orderNumber: row.order_number ? String(row.order_number) : null,
      description: row.description ? String(row.description) : null,
      status: String(row.status) as OrderStatus,
      totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
      currency: String(row.currency),
      itemCount: Number(row.item_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  }

  updateOrder(
    id: string,
    updates: Partial<Pick<Order, 'status' | 'orderNumber' | 'description' | 'totalAmount' | 'currency' | 'shippingAddress' | 'paymentMethod' | 'trackingNumber' | 'trackingUrl' | 'notes' | 'connectorOrderId'>>
  ): boolean {
    const order = this.getOrder(id);
    if (!order) return false;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
    if (updates.orderNumber !== undefined) { sets.push('order_number = ?'); params.push(updates.orderNumber); }
    if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
    if (updates.totalAmount !== undefined) { sets.push('total_amount = ?'); params.push(updates.totalAmount); }
    if (updates.currency !== undefined) { sets.push('currency = ?'); params.push(updates.currency); }
    if (updates.shippingAddress !== undefined) { sets.push('shipping_address = ?'); params.push(updates.shippingAddress); }
    if (updates.paymentMethod !== undefined) { sets.push('payment_method = ?'); params.push(updates.paymentMethod); }
    if (updates.trackingNumber !== undefined) { sets.push('tracking_number = ?'); params.push(updates.trackingNumber); }
    if (updates.trackingUrl !== undefined) { sets.push('tracking_url = ?'); params.push(updates.trackingUrl); }
    if (updates.notes !== undefined) { sets.push('notes = ?'); params.push(updates.notes); }
    if (updates.connectorOrderId !== undefined) { sets.push('connector_order_id = ?'); params.push(updates.connectorOrderId); }

    params.push(id);
    const result = this.db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return (result as { changes: number }).changes > 0;
  }

  cancelOrder(id: string): boolean {
    const order = this.getOrder(id);
    if (!order) return false;
    if (order.status === 'cancelled' || order.status === 'delivered' || order.status === 'returned') {
      return false;
    }
    return this.updateOrder(id, { status: 'cancelled' });
  }

  // ============================================
  // Order Items
  // ============================================

  addItem(
    orderId: string,
    name: string,
    options?: {
      description?: string;
      quantity?: number;
      unitPrice?: number;
      totalPrice?: number;
      sku?: string;
      url?: string;
    }
  ): OrderOperationResult {
    const order = this.getOrder(orderId);
    if (!order) {
      return { success: false, message: `Order "${orderId}" not found.` };
    }

    const id = generateItemId();
    const now = new Date().toISOString();
    const quantity = options?.quantity || 1;
    const unitPrice = options?.unitPrice ?? null;
    const totalPrice = options?.totalPrice ?? (unitPrice != null ? unitPrice * quantity : null);

    this.db.prepare(
      `INSERT INTO order_items (id, order_id, name, description, quantity, unit_price, total_price, sku, url, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).run(
      id,
      orderId,
      name,
      options?.description || null,
      quantity,
      unitPrice,
      totalPrice,
      options?.sku || null,
      options?.url || null,
      now
    );

    // Update order updated_at
    this.db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(now, orderId);

    return { success: true, message: `Item "${name}" added to order.`, itemId: id };
  }

  getItems(orderId: string): OrderItem[] {
    const rows = this.db.prepare(
      'SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC'
    ).all(orderId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToItem(row));
  }

  // ============================================
  // Recent Updates (for injection)
  // ============================================

  getRecentlyUpdatedOrders(sinceIso: string, limit: number): Order[] {
    const rows = this.db.prepare(
      'SELECT * FROM orders WHERE updated_at > ? ORDER BY updated_at DESC LIMIT ?'
    ).all(sinceIso, limit) as Record<string, unknown>[];
    return rows.map((row) => this.rowToOrder(row));
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(maxAgeDays: number, maxOrders: number): number {
    let deleted = 0;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxAgeDays);
    const cutoffStr = cutoff.toISOString();

    // Delete old order items first (for orders that are old)
    const itemResult = this.db.prepare(
      `DELETE FROM order_items WHERE order_id IN (
        SELECT id FROM orders WHERE created_at < ?
      )`
    ).run(cutoffStr);
    deleted += (itemResult as { changes: number }).changes;

    // Delete old orders
    const orderResult = this.db.prepare(
      'DELETE FROM orders WHERE created_at < ?'
    ).run(cutoffStr);
    deleted += (orderResult as { changes: number }).changes;

    // Enforce max orders limit
    const countResult = this.db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as Record<string, unknown>;
    const count = Number(countResult.cnt);

    if (count > maxOrders) {
      const excess = count - maxOrders;
      // Delete items for excess orders
      this.db.prepare(`
        DELETE FROM order_items WHERE order_id IN (
          SELECT id FROM orders ORDER BY updated_at ASC LIMIT ?
        )
      `).run(excess);
      const trimResult = this.db.prepare(`
        DELETE FROM orders WHERE id IN (
          SELECT id FROM orders ORDER BY updated_at ASC LIMIT ?
        )
      `).run(excess);
      deleted += (trimResult as { changes: number }).changes;
    }

    return deleted;
  }

  close(): void { }

  // ============================================
  // Row Mappers
  // ============================================

  private rowToStore(row: Record<string, unknown>): Store {
    return {
      id: String(row.id),
      name: String(row.name),
      url: row.url ? String(row.url) : null,
      connectorName: row.connector_name ? String(row.connector_name) : null,
      category: String(row.category) as StoreCategory,
      notes: row.notes ? String(row.notes) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToOrder(row: Record<string, unknown>): Order {
    return {
      id: String(row.id),
      storeId: String(row.store_id),
      storeName: String(row.store_name),
      orderNumber: row.order_number ? String(row.order_number) : null,
      description: row.description ? String(row.description) : null,
      status: String(row.status) as OrderStatus,
      totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
      currency: String(row.currency),
      shippingAddress: row.shipping_address ? String(row.shipping_address) : null,
      paymentMethod: row.payment_method ? String(row.payment_method) : null,
      trackingNumber: row.tracking_number ? String(row.tracking_number) : null,
      trackingUrl: row.tracking_url ? String(row.tracking_url) : null,
      notes: row.notes ? String(row.notes) : null,
      connectorOrderId: row.connector_order_id ? String(row.connector_order_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToItem(row: Record<string, unknown>): OrderItem {
    return {
      id: String(row.id),
      orderId: String(row.order_id),
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      quantity: Number(row.quantity),
      unitPrice: row.unit_price != null ? Number(row.unit_price) : null,
      totalPrice: row.total_price != null ? Number(row.total_price) : null,
      sku: row.sku ? String(row.sku) : null,
      url: row.url ? String(row.url) : null,
      status: String(row.status) as OrderItemStatus,
      createdAt: String(row.created_at),
    };
  }
}
