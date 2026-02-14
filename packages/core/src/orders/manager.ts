/**
 * OrdersManager - Core class for order lifecycle management
 *
 * Handles store registry, order CRUD, line items, and context injection.
 * Follows the pattern from channels/manager.ts.
 */

import type { OrdersConfig } from '@hasna/assistants-shared';
import { OrderStore } from './store';
import type {
  Store,
  Order,
  OrderItem,
  OrderListItem,
  StoreListItem,
  OrderOperationResult,
  OrderStatus,
  StoreCategory,
} from './types';

export interface OrdersManagerOptions {
  assistantId: string;
  assistantName: string;
  config: OrdersConfig;
}

export class OrdersManager {
  private config: OrdersConfig;
  private store: OrderStore;
  private lastInjectionTime: string;

  constructor(options: OrdersManagerOptions) {
    this.config = options.config;
    this.store = new OrderStore();
    this.lastInjectionTime = new Date().toISOString();
  }

  getStore(): OrderStore {
    return this.store;
  }

  // ============================================
  // Store Operations
  // ============================================

  addStore(
    name: string,
    options?: { url?: string; connectorName?: string; category?: StoreCategory; notes?: string }
  ): OrderOperationResult {
    return this.store.createStore(name, options);
  }

  getStoreDetails(nameOrId: string): { store: Store; orders: OrderListItem[] } | null {
    const store = this.store.resolveStore(nameOrId);
    if (!store) return null;
    const orders = this.store.listOrders({ storeId: store.id, limit: 20 });
    return { store, orders };
  }

  listStores(): StoreListItem[] {
    return this.store.listStores();
  }

  updateStore(
    nameOrId: string,
    updates: Partial<Pick<Store, 'name' | 'url' | 'connectorName' | 'category' | 'notes'>>
  ): OrderOperationResult {
    const store = this.store.resolveStore(nameOrId);
    if (!store) {
      return { success: false, message: `Store "${nameOrId}" not found.` };
    }
    const ok = this.store.updateStore(store.id, updates);
    return ok
      ? { success: true, message: `Store "${store.name}" updated.`, storeId: store.id }
      : { success: false, message: `Failed to update store "${store.name}".` };
  }

  // ============================================
  // Order Operations
  // ============================================

  createOrder(
    storeNameOrId: string,
    options?: {
      description?: string;
      orderNumber?: string;
      totalAmount?: number;
      currency?: string;
      shippingAddress?: string;
      paymentMethod?: string;
      notes?: string;
      connectorOrderId?: string;
    }
  ): OrderOperationResult {
    // Resolve store - auto-create if not found
    let store = this.store.resolveStore(storeNameOrId);
    if (!store) {
      const result = this.store.createStore(storeNameOrId);
      if (!result.success || !result.storeId) {
        return { success: false, message: `Could not find or create store "${storeNameOrId}".` };
      }
      store = this.store.getStore(result.storeId);
      if (!store) {
        return { success: false, message: `Could not find or create store "${storeNameOrId}".` };
      }
    }

    return this.store.createOrder(store.id, store.name, options);
  }

  getOrder(orderId: string): { order: Order; items: OrderItem[] } | null {
    const order = this.store.getOrder(orderId);
    if (!order) return null;
    const items = this.store.getItems(orderId);
    return { order, items };
  }

  listOrders(options?: {
    status?: OrderStatus;
    store?: string;
    limit?: number;
  }): OrderListItem[] {
    let storeId: string | undefined;
    if (options?.store) {
      const store = this.store.resolveStore(options.store);
      storeId = store?.id;
    }
    return this.store.listOrders({
      status: options?.status,
      storeId,
      limit: options?.limit,
    });
  }

  updateOrder(
    orderId: string,
    updates: Partial<Pick<Order, 'status' | 'orderNumber' | 'description' | 'totalAmount' | 'currency' | 'shippingAddress' | 'paymentMethod' | 'trackingNumber' | 'trackingUrl' | 'notes' | 'connectorOrderId'>>
  ): OrderOperationResult {
    const order = this.store.getOrder(orderId);
    if (!order) {
      return { success: false, message: `Order "${orderId}" not found.` };
    }
    const ok = this.store.updateOrder(orderId, updates);
    return ok
      ? { success: true, message: `Order updated.`, orderId }
      : { success: false, message: `Failed to update order.` };
  }

  cancelOrder(orderId: string): OrderOperationResult {
    const order = this.store.getOrder(orderId);
    if (!order) {
      return { success: false, message: `Order "${orderId}" not found.` };
    }
    if (order.status === 'cancelled') {
      return { success: false, message: `Order is already cancelled.` };
    }
    if (order.status === 'delivered' || order.status === 'returned') {
      return { success: false, message: `Cannot cancel a ${order.status} order.` };
    }
    const ok = this.store.cancelOrder(orderId);
    return ok
      ? { success: true, message: `Order at ${order.storeName} cancelled.`, orderId }
      : { success: false, message: `Failed to cancel order.` };
  }

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
    return this.store.addItem(orderId, name, options);
  }

  getTracking(orderId: string): {
    orderId: string;
    storeName: string;
    status: OrderStatus;
    trackingNumber: string | null;
    trackingUrl: string | null;
  } | null {
    const order = this.store.getOrder(orderId);
    if (!order) return null;
    return {
      orderId: order.id,
      storeName: order.storeName,
      status: order.status,
      trackingNumber: order.trackingNumber,
      trackingUrl: order.trackingUrl,
    };
  }

  // ============================================
  // Context Injection
  // ============================================

  getUnreadForInjection(): Order[] {
    const injectionConfig = this.config.injection || {};
    if (injectionConfig.enabled === false) {
      return [];
    }
    const maxPerTurn = injectionConfig.maxPerTurn || 5;
    return this.store.getRecentlyUpdatedOrders(this.lastInjectionTime, maxPerTurn);
  }

  buildInjectionContext(orders: Order[]): string {
    if (orders.length === 0) return '';

    const lines: string[] = [];
    lines.push('## Recent Order Updates');
    lines.push('');

    for (const order of orders) {
      const amount = order.totalAmount != null ? ` | ${order.currency} ${order.totalAmount.toFixed(2)}` : '';
      const tracking = order.trackingNumber ? ` | tracking: ${order.trackingNumber}` : '';
      lines.push(`- **${order.storeName}** (${order.id}): ${order.status}${amount}${tracking}`);
      if (order.description) {
        lines.push(`  ${order.description}`);
      }
    }

    lines.push('');
    lines.push('Use orders_get for details, orders_update to change status.');

    return lines.join('\n');
  }

  markInjected(orders: Order[]): void {
    if (orders.length === 0) return;
    // Track the latest updatedAt so next injection only shows newer updates
    let latest = this.lastInjectionTime;
    for (const order of orders) {
      if (order.updatedAt > latest) {
        latest = order.updatedAt;
      }
    }
    this.lastInjectionTime = latest;
  }

  // ============================================
  // Cleanup
  // ============================================

  cleanup(): number {
    const maxAgeDays = this.config.storage?.maxAgeDays || 365;
    const maxOrders = this.config.storage?.maxOrders || 5000;
    return this.store.cleanup(maxAgeDays, maxOrders);
  }

  close(): void {
    this.store.close();
  }
}

/**
 * Create an OrdersManager from config
 */
export function createOrdersManager(
  assistantId: string,
  assistantName: string,
  config: OrdersConfig
): OrdersManager {
  return new OrdersManager({
    assistantId,
    assistantName,
    config,
  });
}
