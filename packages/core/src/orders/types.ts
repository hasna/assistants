/**
 * Orders types
 * Types for full-lifecycle order management across stores and vendors
 */

import type { OrdersConfig } from '@hasna/assistants-shared';

// Re-export shared config type
export type { OrdersConfig };

// ============================================
// Status Types
// ============================================

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'returned';
export type OrderItemStatus = 'pending' | 'shipped' | 'delivered' | 'returned';
export type StoreCategory = 'retail' | 'grocery' | 'restaurant' | 'service' | 'subscription' | 'travel' | 'digital' | 'other';

// ============================================
// Core Types
// ============================================

/**
 * A registered store/vendor
 */
export interface Store {
  id: string;
  name: string;
  url: string | null;
  connectorName: string | null;
  category: StoreCategory;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An order placed at a store
 */
export interface Order {
  id: string;
  storeId: string;
  storeName: string;
  orderNumber: string | null;
  description: string | null;
  status: OrderStatus;
  totalAmount: number | null;
  currency: string;
  shippingAddress: string | null;
  paymentMethod: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  connectorOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A line item within an order
 */
export interface OrderItem {
  id: string;
  orderId: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  sku: string | null;
  url: string | null;
  status: OrderItemStatus;
  createdAt: string;
}

// ============================================
// List/Summary Types
// ============================================

/**
 * Summary item for order listing
 */
export interface OrderListItem {
  id: string;
  storeName: string;
  orderNumber: string | null;
  description: string | null;
  status: OrderStatus;
  totalAmount: number | null;
  currency: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary item for store listing
 */
export interface StoreListItem {
  id: string;
  name: string;
  category: StoreCategory;
  url: string | null;
  orderCount: number;
  lastOrderAt: string | null;
}

// ============================================
// Input/Output Types
// ============================================

/**
 * Result of an order/store operation
 */
export interface OrderOperationResult {
  success: boolean;
  message: string;
  orderId?: string;
  storeId?: string;
  itemId?: string;
}

// ============================================
// Config Sub-types
// ============================================

export interface OrdersInjectionConfig {
  enabled?: boolean;
  maxPerTurn?: number;
}

export interface OrdersStorageConfig {
  maxOrders?: number;
  maxAgeDays?: number;
}
