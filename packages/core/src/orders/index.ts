/**
 * Orders module exports
 * Provides full-lifecycle order management for stores and vendors
 */

// Core manager
export { OrdersManager, createOrdersManager } from './manager';
export type { OrdersManagerOptions } from './manager';

// Store
export { OrderStore } from './store';

// Tools
export {
  orderTools,
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
  createOrderToolExecutors,
  registerOrderTools,
} from './tools';

// Types
export type {
  Store,
  Order,
  OrderItem,
  OrderListItem,
  StoreListItem,
  OrderOperationResult,
  OrderStatus,
  OrderItemStatus,
  StoreCategory,
  OrdersConfig,
  OrdersInjectionConfig,
  OrdersStorageConfig,
} from './types';
