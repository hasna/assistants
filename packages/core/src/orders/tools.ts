/**
 * Order tools for assistant use
 * Tools that allow assistants to manage orders and stores
 */

import type { Tool } from '@hasna/assistants-shared';
import type { ToolExecutor, ToolRegistry } from '../tools/registry';
import type { OrdersManager } from './manager';
import type { OrderStatus, StoreCategory } from './types';

// ============================================
// Tool Definitions
// ============================================

export const ordersListTool: Tool = {
  name: 'orders_list',
  description: 'List orders. Optionally filter by status or store.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by order status',
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      },
      store: {
        type: 'string',
        description: 'Filter by store name or ID',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of orders to return (default: 20)',
      },
    },
    required: [],
  },
};

export const ordersCreateTool: Tool = {
  name: 'orders_create',
  description: 'Create a new order for a registered store. If the store does not exist, it will be auto-registered.',
  parameters: {
    type: 'object',
    properties: {
      store: {
        type: 'string',
        description: 'Store name or ID (will auto-create if not found)',
      },
      description: {
        type: 'string',
        description: 'Order description',
      },
      order_number: {
        type: 'string',
        description: 'External order number (e.g., from vendor)',
      },
      total_amount: {
        type: 'number',
        description: 'Total order amount',
      },
      currency: {
        type: 'string',
        description: 'ISO 4217 currency code (default: USD)',
      },
      shipping_address: {
        type: 'string',
        description: 'Shipping address',
      },
      payment_method: {
        type: 'string',
        description: 'Payment method used',
      },
      notes: {
        type: 'string',
        description: 'Additional notes',
      },
    },
    required: ['store'],
  },
};

export const ordersGetTool: Tool = {
  name: 'orders_get',
  description: 'Get full details of an order including line items.',
  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'Order ID (e.g., ord_xxxx)',
      },
    },
    required: ['order_id'],
  },
};

export const ordersUpdateTool: Tool = {
  name: 'orders_update',
  description: 'Update an order (status, tracking, notes, etc.).',
  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'Order ID to update',
      },
      status: {
        type: 'string',
        description: 'New status',
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      },
      tracking_number: {
        type: 'string',
        description: 'Tracking number',
      },
      tracking_url: {
        type: 'string',
        description: 'Tracking URL',
      },
      notes: {
        type: 'string',
        description: 'Updated notes',
      },
      total_amount: {
        type: 'number',
        description: 'Updated total amount',
      },
      shipping_address: {
        type: 'string',
        description: 'Updated shipping address',
      },
      payment_method: {
        type: 'string',
        description: 'Updated payment method',
      },
      order_number: {
        type: 'string',
        description: 'Updated order number',
      },
    },
    required: ['order_id'],
  },
};

export const ordersCancelTool: Tool = {
  name: 'orders_cancel',
  description: 'Cancel an order. Cannot cancel delivered or returned orders.',
  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'Order ID to cancel',
      },
    },
    required: ['order_id'],
  },
};

export const ordersAddItemTool: Tool = {
  name: 'orders_add_item',
  description: 'Add a line item to an order.',
  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'Order ID to add item to',
      },
      name: {
        type: 'string',
        description: 'Item name',
      },
      description: {
        type: 'string',
        description: 'Item description',
      },
      quantity: {
        type: 'number',
        description: 'Quantity (default: 1)',
      },
      unit_price: {
        type: 'number',
        description: 'Price per unit',
      },
      sku: {
        type: 'string',
        description: 'Product SKU',
      },
      url: {
        type: 'string',
        description: 'Product URL',
      },
    },
    required: ['order_id', 'name'],
  },
};

export const ordersTrackTool: Tool = {
  name: 'orders_track',
  description: 'Get tracking information for an order.',
  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'Order ID to track',
      },
    },
    required: ['order_id'],
  },
};

export const storesListTool: Tool = {
  name: 'stores_list',
  description: 'List all registered stores/vendors with order counts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const storesAddTool: Tool = {
  name: 'stores_add',
  description: 'Register a new store/vendor.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Store name',
      },
      url: {
        type: 'string',
        description: 'Store website URL',
      },
      category: {
        type: 'string',
        description: 'Store category',
        enum: ['retail', 'grocery', 'restaurant', 'service', 'subscription', 'travel', 'digital', 'other'],
      },
      notes: {
        type: 'string',
        description: 'Notes about this store',
      },
    },
    required: ['name'],
  },
};

export const storesGetTool: Tool = {
  name: 'stores_get',
  description: 'Get store details with recent order history.',
  parameters: {
    type: 'object',
    properties: {
      store: {
        type: 'string',
        description: 'Store name or ID',
      },
    },
    required: ['store'],
  },
};

// ============================================
// Tool Executors
// ============================================

export function createOrderToolExecutors(
  getOrdersManager: () => OrdersManager | null
): Record<string, ToolExecutor> {
  return {
    orders_list: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      try {
        const orders = manager.listOrders({
          status: input.status as OrderStatus | undefined,
          store: input.store as string | undefined,
          limit: typeof input.limit === 'number' ? input.limit : 20,
        });

        if (orders.length === 0) {
          return 'No orders found.';
        }

        const lines: string[] = [];
        lines.push(`## Orders (${orders.length})`);
        lines.push('');

        for (const order of orders) {
          const amount = order.totalAmount != null ? ` | ${order.currency} ${order.totalAmount.toFixed(2)}` : '';
          const desc = order.description ? ` — ${order.description}` : '';
          const num = order.orderNumber ? ` #${order.orderNumber}` : '';
          lines.push(`**${order.storeName}**${num} (${order.id})`);
          lines.push(`  Status: ${order.status}${amount} | Items: ${order.itemCount}${desc}`);
          lines.push('');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing orders: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    orders_create: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const store = String(input.store || '').trim();
      if (!store) return 'Error: Store name is required.';

      const result = manager.createOrder(store, {
        description: input.description as string | undefined,
        orderNumber: input.order_number as string | undefined,
        totalAmount: input.total_amount as number | undefined,
        currency: input.currency as string | undefined,
        shippingAddress: input.shipping_address as string | undefined,
        paymentMethod: input.payment_method as string | undefined,
        notes: input.notes as string | undefined,
      });

      return result.success
        ? `Order created: ${result.orderId}\n${result.message}`
        : `Error: ${result.message}`;
    },

    orders_get: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const orderId = String(input.order_id || '').trim();
      if (!orderId) return 'Error: Order ID is required.';

      try {
        const result = manager.getOrder(orderId);
        if (!result) return `Order "${orderId}" not found.`;

        const { order, items } = result;
        const lines: string[] = [];
        lines.push(`## Order ${order.id}`);
        lines.push('');
        lines.push(`**Store:** ${order.storeName}`);
        lines.push(`**Status:** ${order.status}`);
        if (order.orderNumber) lines.push(`**Order #:** ${order.orderNumber}`);
        if (order.description) lines.push(`**Description:** ${order.description}`);
        if (order.totalAmount != null) lines.push(`**Total:** ${order.currency} ${order.totalAmount.toFixed(2)}`);
        if (order.shippingAddress) lines.push(`**Ship to:** ${order.shippingAddress}`);
        if (order.paymentMethod) lines.push(`**Payment:** ${order.paymentMethod}`);
        if (order.trackingNumber) lines.push(`**Tracking:** ${order.trackingNumber}`);
        if (order.trackingUrl) lines.push(`**Tracking URL:** ${order.trackingUrl}`);
        if (order.notes) lines.push(`**Notes:** ${order.notes}`);
        lines.push(`**Created:** ${order.createdAt}`);
        lines.push(`**Updated:** ${order.updatedAt}`);

        if (items.length > 0) {
          lines.push('');
          lines.push(`### Items (${items.length})`);
          for (const item of items) {
            const price = item.totalPrice != null ? ` — $${item.totalPrice.toFixed(2)}` : '';
            const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
            lines.push(`- ${item.name}${qty}${price} [${item.status}]`);
            if (item.description) lines.push(`  ${item.description}`);
          }
        }

        return lines.join('\n');
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    orders_update: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const orderId = String(input.order_id || '').trim();
      if (!orderId) return 'Error: Order ID is required.';

      const updates: Record<string, unknown> = {};
      if (input.status) updates.status = input.status;
      if (input.tracking_number) updates.trackingNumber = input.tracking_number;
      if (input.tracking_url) updates.trackingUrl = input.tracking_url;
      if (input.notes) updates.notes = input.notes;
      if (input.total_amount != null) updates.totalAmount = input.total_amount;
      if (input.shipping_address) updates.shippingAddress = input.shipping_address;
      if (input.payment_method) updates.paymentMethod = input.payment_method;
      if (input.order_number) updates.orderNumber = input.order_number;

      if (Object.keys(updates).length === 0) {
        return 'Error: No updates specified. Provide at least one field to update.';
      }

      const result = manager.updateOrder(orderId, updates);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    orders_cancel: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const orderId = String(input.order_id || '').trim();
      if (!orderId) return 'Error: Order ID is required.';

      const result = manager.cancelOrder(orderId);
      return result.success ? result.message : `Error: ${result.message}`;
    },

    orders_add_item: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const orderId = String(input.order_id || '').trim();
      const name = String(input.name || '').trim();
      if (!orderId) return 'Error: Order ID is required.';
      if (!name) return 'Error: Item name is required.';

      const result = manager.addItem(orderId, name, {
        description: input.description as string | undefined,
        quantity: input.quantity as number | undefined,
        unitPrice: input.unit_price as number | undefined,
        sku: input.sku as string | undefined,
        url: input.url as string | undefined,
      });

      return result.success ? result.message : `Error: ${result.message}`;
    },

    orders_track: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const orderId = String(input.order_id || '').trim();
      if (!orderId) return 'Error: Order ID is required.';

      const tracking = manager.getTracking(orderId);
      if (!tracking) return `Order "${orderId}" not found.`;

      const lines: string[] = [];
      lines.push(`## Tracking: ${tracking.orderId}`);
      lines.push(`**Store:** ${tracking.storeName}`);
      lines.push(`**Status:** ${tracking.status}`);
      if (tracking.trackingNumber) {
        lines.push(`**Tracking #:** ${tracking.trackingNumber}`);
      } else {
        lines.push('**Tracking #:** Not available');
      }
      if (tracking.trackingUrl) {
        lines.push(`**Tracking URL:** ${tracking.trackingUrl}`);
      }

      return lines.join('\n');
    },

    stores_list: async () => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      try {
        const stores = manager.listStores();
        if (stores.length === 0) {
          return 'No stores registered. Use stores_add to register a store.';
        }

        const lines: string[] = [];
        lines.push(`## Stores (${stores.length})`);
        lines.push('');

        for (const store of stores) {
          const orders = store.orderCount > 0 ? ` | ${store.orderCount} orders` : '';
          const url = store.url ? ` | ${store.url}` : '';
          lines.push(`**${store.name}** [${store.category}]${orders}${url}`);
        }

        return lines.join('\n');
      } catch (error) {
        return `Error listing stores: ${error instanceof Error ? error.message : String(error)}`;
      }
    },

    stores_add: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const name = String(input.name || '').trim();
      if (!name) return 'Error: Store name is required.';

      const result = manager.addStore(name, {
        url: input.url as string | undefined,
        category: input.category as StoreCategory | undefined,
        notes: input.notes as string | undefined,
      });

      return result.success
        ? `Store registered: ${result.storeId}\n${result.message}`
        : `Error: ${result.message}`;
    },

    stores_get: async (input) => {
      const manager = getOrdersManager();
      if (!manager) {
        return 'Error: Orders are not enabled. Set orders.enabled: true in config.';
      }

      const store = String(input.store || '').trim();
      if (!store) return 'Error: Store name or ID is required.';

      try {
        const result = manager.getStoreDetails(store);
        if (!result) return `Store "${store}" not found.`;

        const { store: s, orders } = result;
        const lines: string[] = [];
        lines.push(`## ${s.name}`);
        lines.push('');
        lines.push(`**ID:** ${s.id}`);
        lines.push(`**Category:** ${s.category}`);
        if (s.url) lines.push(`**URL:** ${s.url}`);
        if (s.connectorName) lines.push(`**Connector:** ${s.connectorName}`);
        if (s.notes) lines.push(`**Notes:** ${s.notes}`);
        lines.push(`**Registered:** ${s.createdAt}`);

        if (orders.length > 0) {
          lines.push('');
          lines.push(`### Recent Orders (${orders.length})`);
          for (const order of orders) {
            const amount = order.totalAmount != null ? ` | ${order.currency} ${order.totalAmount.toFixed(2)}` : '';
            lines.push(`- ${order.id}: ${order.status}${amount}`);
          }
        } else {
          lines.push('');
          lines.push('No orders yet.');
        }

        return lines.join('\n');
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
}

/**
 * All order tools
 */
export const orderTools: Tool[] = [
  ordersListTool,
  ordersCreateTool,
  ordersGetTool,
  ordersUpdateTool,
  ordersCancelTool,
  ordersAddItemTool,
  ordersTrackTool,
  storesListTool,
  storesAddTool,
  storesGetTool,
];

/**
 * Register order tools with a tool registry
 */
export function registerOrderTools(
  registry: ToolRegistry,
  getOrdersManager: () => OrdersManager | null
): void {
  const executors = createOrderToolExecutors(getOrdersManager);

  for (const tool of orderTools) {
    registry.register(tool, executors[tool.name]);
  }
}
