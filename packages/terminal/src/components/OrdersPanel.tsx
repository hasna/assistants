import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type {
  OrdersManager,
  OrderListItem,
  StoreListItem,
  Store,
  Order,
  OrderItem,
  OrderStatus,
} from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface OrdersPanelProps {
  manager: OrdersManager;
  onClose: () => void;
}

type ViewMode = 'list' | 'order-detail' | 'store-detail' | 'order-create' | 'store-add';
type MainTab = 'orders' | 'stores' | 'overview';
type StatusFilter = 'all' | OrderStatus;

const MAIN_TABS: MainTab[] = ['orders', 'stores', 'overview'];
const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
];
const MAX_VISIBLE_ROWS = 12;

function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'never';
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const abs = Math.abs(diffMs);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return 'now';
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '-';
  return `${currency || 'USD'} ${amount.toFixed(2)}`;
}

function fit(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const raw = value || '';
  if (raw.length > width) {
    return width > 3 ? `${raw.slice(0, width - 3)}...` : raw.slice(0, width);
  }
  return align === 'right' ? raw.padStart(width, ' ') : raw.padEnd(width, ' ');
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'pending': return 'yellow';
    case 'processing': return 'cyan';
    case 'shipped': return 'blue';
    case 'delivered': return 'green';
    case 'cancelled': return 'red';
    case 'returned': return 'magenta';
    default: return 'gray';
  }
}

function visibleWindow(selectedIndex: number, total: number): { start: number; end: number; above: number; below: number } {
  if (total <= MAX_VISIBLE_ROWS) {
    return { start: 0, end: total, above: 0, below: 0 };
  }

  const half = Math.floor(MAX_VISIBLE_ROWS / 2);
  let start = selectedIndex - half;
  let end = start + MAX_VISIBLE_ROWS;

  if (start < 0) {
    start = 0;
    end = MAX_VISIBLE_ROWS;
  }
  if (end > total) {
    end = total;
    start = Math.max(0, end - MAX_VISIBLE_ROWS);
  }

  return {
    start,
    end,
    above: start,
    below: total - end,
  };
}

export function OrdersPanel({ manager, onClose }: OrdersPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [tab, setTab] = useState<MainTab>('orders');
  const [statusFilterIndex, setStatusFilterIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [stores, setStores] = useState<StoreListItem[]>([]);

  const [detailOrder, setDetailOrder] = useState<{ order: Order; items: OrderItem[] } | null>(null);
  const [detailStore, setDetailStore] = useState<{ store: Store; orders: OrderListItem[] } | null>(null);

  const [createOrderStore, setCreateOrderStore] = useState('');
  const [createOrderDescription, setCreateOrderDescription] = useState('');
  const [createOrderStep, setCreateOrderStep] = useState<'store' | 'description'>('store');

  const [newStoreName, setNewStoreName] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadData = useCallback(() => {
    try {
      setOrders(manager.listOrders({ limit: 200 }));
      setStores(manager.listStores());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [manager]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(null), 2400);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  const activeStatusFilter = STATUS_FILTERS[statusFilterIndex] || 'all';

  const filteredOrders = useMemo(() => {
    if (activeStatusFilter === 'all') return orders;
    return orders.filter((order) => order.status === activeStatusFilter);
  }, [orders, activeStatusFilter]);

  const listCount = useMemo(() => {
    if (tab === 'orders') return filteredOrders.length;
    if (tab === 'stores') return stores.length;
    return 0;
  }, [tab, filteredOrders.length, stores.length]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, listCount - 1)));
  }, [listCount]);

  const switchTab = useCallback((next: MainTab) => {
    setTab(next);
    setSelectedIndex(0);
    setViewMode('list');
  }, []);

  const openSelectedOrder = useCallback(() => {
    const order = filteredOrders[selectedIndex];
    if (!order) return;
    const detail = manager.getOrder(order.id);
    if (!detail) {
      setStatusMessage('Order not found.');
      return;
    }
    setDetailOrder(detail);
    setViewMode('order-detail');
  }, [filteredOrders, manager, selectedIndex]);

  const openSelectedStore = useCallback(() => {
    const store = stores[selectedIndex];
    if (!store) return;
    const detail = manager.getStoreDetails(store.id);
    if (!detail) {
      setStatusMessage('Store not found.');
      return;
    }
    setDetailStore(detail);
    setViewMode('store-detail');
  }, [manager, selectedIndex, stores]);

  const cancelSelectedOrder = useCallback(() => {
    const order = filteredOrders[selectedIndex];
    if (!order) return;
    const result = manager.cancelOrder(order.id);
    setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
    loadData();
  }, [filteredOrders, selectedIndex, manager, loadData]);

  useInput((input, key) => {
    if (viewMode === 'order-create') {
      if (key.escape) {
        setViewMode('list');
      }
      return;
    }

    if (viewMode === 'store-add') {
      if (key.escape) {
        setViewMode('list');
      }
      return;
    }

    if (viewMode === 'order-detail') {
      if (key.escape || key.backspace) {
        setViewMode('list');
        setDetailOrder(null);
        return;
      }
      if (input === 'q') {
        onClose();
        return;
      }
      if (input === 'c') {
        const id = detailOrder?.order.id;
        if (!id) return;
        const result = manager.cancelOrder(id);
        setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
        const refreshed = manager.getOrder(id);
        if (refreshed) {
          setDetailOrder(refreshed);
        }
        loadData();
      }
      return;
    }

    if (viewMode === 'store-detail') {
      if (key.escape || key.backspace) {
        setViewMode('list');
        setDetailStore(null);
        return;
      }
      if (input === 'q') {
        onClose();
      }
      return;
    }

    if (input === 'q' || key.escape) {
      onClose();
      return;
    }

    if (input === '1') {
      switchTab('orders');
      return;
    }
    if (input === '2') {
      switchTab('stores');
      return;
    }
    if (input === '3') {
      switchTab('overview');
      return;
    }

    if (key.leftArrow) {
      const index = MAIN_TABS.indexOf(tab);
      const next = index > 0 ? MAIN_TABS[index - 1] : MAIN_TABS[MAIN_TABS.length - 1];
      switchTab(next);
      return;
    }

    if (key.rightArrow) {
      const index = MAIN_TABS.indexOf(tab);
      const next = index < MAIN_TABS.length - 1 ? MAIN_TABS[index + 1] : MAIN_TABS[0];
      switchTab(next);
      return;
    }

    if (tab === 'orders' && (input === '[' || input === ']')) {
      setStatusFilterIndex((prev) => {
        if (input === '[') {
          return prev === 0 ? STATUS_FILTERS.length - 1 : prev - 1;
        }
        return prev === STATUS_FILTERS.length - 1 ? 0 : prev + 1;
      });
      setSelectedIndex(0);
      return;
    }

    if (input === 'k' || key.upArrow) {
      if (listCount === 0) return;
      setSelectedIndex((prev) => (prev === 0 ? listCount - 1 : prev - 1));
      return;
    }

    if (input === 'j' || key.downArrow) {
      if (listCount === 0) return;
      setSelectedIndex((prev) => (prev >= listCount - 1 ? 0 : prev + 1));
      return;
    }

    if (key.return) {
      if (tab === 'orders') {
        openSelectedOrder();
      } else if (tab === 'stores') {
        openSelectedStore();
      }
      return;
    }

    if (input === 'r') {
      loadData();
      setStatusMessage('Refreshed.');
      return;
    }

    if (input === 'n' && (tab === 'orders' || tab === 'overview')) {
      setCreateOrderStore('');
      setCreateOrderDescription('');
      setCreateOrderStep('store');
      setViewMode('order-create');
      return;
    }

    if (input === 'a' && tab === 'stores') {
      setNewStoreName('');
      setViewMode('store-add');
      return;
    }

    if (input === 'c' && tab === 'orders') {
      cancelSelectedOrder();
    }
  });

  const tabBar = (
    <Box marginBottom={1}>
      {MAIN_TABS.map((entry, index) => (
        <Box key={entry} marginRight={1}>
          <Text inverse={tab === entry}>
            {`${index + 1}:${entry}`}
          </Text>
        </Box>
      ))}
    </Box>
  );

  const controls = useMemo(() => {
    if (viewMode === 'order-create' || viewMode === 'store-add') {
      return 'Esc cancel';
    }
    if (viewMode === 'order-detail') {
      return 'Backspace/Esc back | c cancel-order | q close';
    }
    if (viewMode === 'store-detail') {
      return 'Backspace/Esc back | q close';
    }
    if (tab === 'orders') {
      return 'q close | 1/2/3 tabs | [ ] filter | up/down | Enter view | n new | c cancel | r refresh';
    }
    if (tab === 'stores') {
      return 'q close | 1/2/3 tabs | up/down | Enter view | a add-store | r refresh';
    }
    return 'q close | 1/2/3 tabs | n new-order | r refresh';
  }, [tab, viewMode]);

  const header = (
    <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}>
      <Text bold color="blue">Orders</Text>
      <Text color="gray"> | {controls}</Text>
    </Box>
  );

  if (viewMode === 'order-create') {
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>Create Order</Text>
          <Text color="gray">Store can be existing or new. New stores are auto-registered.</Text>
          <Text> </Text>
          {createOrderStep === 'store' ? (
            <Box>
              <Text>Store: </Text>
              <TextInput
                value={createOrderStore}
                onChange={setCreateOrderStore}
                onSubmit={() => {
                  if (!createOrderStore.trim()) {
                    setStatusMessage('Store is required.');
                    return;
                  }
                  setCreateOrderStep('description');
                }}
                placeholder="Store name"
                focus
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>Store: {createOrderStore}</Text>
              <Box>
                <Text>Description: </Text>
                <TextInput
                  value={createOrderDescription}
                  onChange={setCreateOrderDescription}
                  onSubmit={() => {
                    const result = manager.createOrder(
                      createOrderStore.trim(),
                      createOrderDescription.trim()
                        ? { description: createOrderDescription.trim() }
                        : undefined
                    );
                    setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                    loadData();
                    setViewMode('list');
                    switchTab('orders');
                  }}
                  placeholder="Optional description"
                  focus
                />
              </Box>
              <Text color="gray">Submit empty description to create without one.</Text>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  if (viewMode === 'store-add') {
    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>Add Store</Text>
          <Text> </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={newStoreName}
              onChange={setNewStoreName}
              onSubmit={() => {
                if (!newStoreName.trim()) {
                  setStatusMessage('Store name is required.');
                  return;
                }
                const result = manager.addStore(newStoreName.trim());
                setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                loadData();
                setViewMode('list');
                switchTab('stores');
              }}
              placeholder="Store name"
              focus
            />
          </Box>
        </Box>
      </Box>
    );
  }

  if (viewMode === 'order-detail' && detailOrder) {
    const { order, items } = detailOrder;
    const tracking = manager.getTracking(order.id);

    return (
      <Box flexDirection="column">
        {header}
        {statusMessage ? <Box marginBottom={1}><Text color="yellow">{statusMessage}</Text></Box> : null}
        {error ? <Box marginBottom={1}><Text color="red">Error: {error}</Text></Box> : null}

        <Box flexDirection="column" paddingX={1}>
          <Text bold>Order Detail</Text>
          <Text>ID: {order.id}</Text>
          <Text>Store: {order.storeName}</Text>
          <Box>
            <Text>Status: </Text>
            <Text color={statusColor(order.status)}>{order.status}</Text>
          </Box>
          {order.orderNumber ? <Text>Order #: {order.orderNumber}</Text> : null}
          {order.description ? <Text>Description: {order.description}</Text> : null}
          <Text>Total: {formatCurrency(order.totalAmount, order.currency)}</Text>
          {order.shippingAddress ? <Text>Shipping: {order.shippingAddress}</Text> : null}
          {order.paymentMethod ? <Text>Payment: {order.paymentMethod}</Text> : null}
          {order.notes ? <Text>Notes: {order.notes}</Text> : null}
          <Text>Created: {formatRelativeTime(order.createdAt)}</Text>
          <Text>Updated: {formatRelativeTime(order.updatedAt)}</Text>

          {tracking?.trackingNumber ? (
            <Box flexDirection="column" marginTop={1}>
              <Text bold>Tracking</Text>
              <Text>Number: {tracking.trackingNumber}</Text>
              {tracking.trackingUrl ? <Text>URL: {tracking.trackingUrl}</Text> : null}
            </Box>
          ) : null}

          <Box flexDirection="column" marginTop={1}>
            <Text bold>{`Items (${items.length})`}</Text>
            {items.length === 0 ? (
              <Text color="gray">No items.</Text>
            ) : (
              <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
                <Text bold>{`${fit('NAME', 24)} ${fit('QTY', 4, 'right')} ${fit('UNIT', 12, 'right')} ${fit('TOTAL', 12, 'right')} ${fit('STATUS', 10)}`}</Text>
                {items.map((item) => {
                  const row = `${fit(item.name, 24)} ${fit(String(item.quantity), 4, 'right')} ${fit(formatCurrency(item.unitPrice, order.currency), 12, 'right')} ${fit(formatCurrency(item.totalPrice, order.currency), 12, 'right')} ${fit(item.status, 10)}`;
                  return (
                    <Text key={item.id}>{row}</Text>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (viewMode === 'store-detail' && detailStore) {
    const recent = detailStore.orders;

    return (
      <Box flexDirection="column">
        {header}
        {statusMessage ? <Box marginBottom={1}><Text color="yellow">{statusMessage}</Text></Box> : null}
        {error ? <Box marginBottom={1}><Text color="red">Error: {error}</Text></Box> : null}

        <Box flexDirection="column" paddingX={1}>
          <Text bold>Store Detail</Text>
          <Text>ID: {detailStore.store.id}</Text>
          <Text>Name: {detailStore.store.name}</Text>
          <Text>Category: {detailStore.store.category}</Text>
          {detailStore.store.url ? <Text>URL: {detailStore.store.url}</Text> : null}
          <Text>Updated: {formatRelativeTime(detailStore.store.updatedAt)}</Text>

          <Box flexDirection="column" marginTop={1}>
            <Text bold>{`Recent Orders (${recent.length})`}</Text>
            {recent.length === 0 ? (
              <Text color="gray">No orders for this store yet.</Text>
            ) : (
              <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
                <Text bold>{`${fit('ID', 14)} ${fit('STATUS', 10)} ${fit('TOTAL', 12)} ${fit('UPDATED', 10)}`}</Text>
                {recent.slice(0, 20).map((order) => {
                  const row = `${fit(order.id, 14)} ${fit(order.status, 10)} ${fit(formatCurrency(order.totalAmount, order.currency), 12)} ${fit(formatRelativeTime(order.updatedAt), 10)}`;
                  return <Text key={order.id}>{row}</Text>;
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  const tableWindow = visibleWindow(selectedIndex, listCount);
  const visibleOrders = filteredOrders.slice(tableWindow.start, tableWindow.end);
  const visibleStores = stores.slice(tableWindow.start, tableWindow.end);

  const overviewCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const order of orders) {
      counts[order.status] = (counts[order.status] || 0) + 1;
    }
    return counts;
  }, [orders]);

  return (
    <Box flexDirection="column">
      {header}
      {tabBar}

      {tab === 'orders' ? (
        <Box marginBottom={1}>
          <Text color="gray">Status filter: </Text>
          {STATUS_FILTERS.map((status, idx) => (
            <Text key={status} inverse={idx === statusFilterIndex}>{` ${status} `}</Text>
          ))}
        </Box>
      ) : null}

      {statusMessage ? <Box marginBottom={1}><Text color="yellow">{statusMessage}</Text></Box> : null}
      {error ? <Box marginBottom={1}><Text color="red">Error: {error}</Text></Box> : null}

      {tab === 'orders' ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
          {filteredOrders.length === 0 ? (
            <Text color="gray">No orders for this filter. Press n to create an order.</Text>
          ) : (
            <>
              <Text bold>{`${fit('ID', 14)} ${fit('STORE', 18)} ${fit('STATUS', 10)} ${fit('TOTAL', 12)} ${fit('ITEMS', 5, 'right')} ${fit('UPDATED', 10)}`}</Text>

              {tableWindow.above > 0 ? (
                <Text color="gray">{`... ${tableWindow.above} more above`}</Text>
              ) : null}

              {visibleOrders.map((order, idx) => {
                const actualIndex = tableWindow.start + idx;
                const isSelected = actualIndex === selectedIndex;
                const marker = isSelected ? '> ' : '  ';
                const row = `${marker}${fit(order.id, 14)} ${fit(order.storeName, 18)} ${fit(order.status, 10)} ${fit(formatCurrency(order.totalAmount, order.currency), 12)} ${fit(String(order.itemCount), 5, 'right')} ${fit(formatRelativeTime(order.updatedAt), 10)}`;
                return (
                  <Text key={order.id} inverse={isSelected}>{row}</Text>
                );
              })}

              {tableWindow.below > 0 ? (
                <Text color="gray">{`... ${tableWindow.below} more below`}</Text>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      {tab === 'stores' ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
          {stores.length === 0 ? (
            <Text color="gray">No stores yet. Press a to add one.</Text>
          ) : (
            <>
              <Text bold>{`${fit('ID', 14)} ${fit('NAME', 22)} ${fit('CATEGORY', 12)} ${fit('ORD', 4, 'right')} ${fit('LAST', 10)}`}</Text>

              {tableWindow.above > 0 ? (
                <Text color="gray">{`... ${tableWindow.above} more above`}</Text>
              ) : null}

              {visibleStores.map((store, idx) => {
                const actualIndex = tableWindow.start + idx;
                const isSelected = actualIndex === selectedIndex;
                const marker = isSelected ? '> ' : '  ';
                const row = `${marker}${fit(store.id, 14)} ${fit(store.name, 22)} ${fit(store.category, 12)} ${fit(String(store.orderCount), 4, 'right')} ${fit(formatRelativeTime(store.lastOrderAt), 10)}`;
                return (
                  <Text key={store.id} inverse={isSelected}>{row}</Text>
                );
              })}

              {tableWindow.below > 0 ? (
                <Text color="gray">{`... ${tableWindow.below} more below`}</Text>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

      {tab === 'overview' ? (
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
          <Text bold>Summary</Text>
          <Text>{`Orders: ${orders.length}`}</Text>
          <Text>{`Stores: ${stores.length}`}</Text>
          <Text> </Text>
          <Text bold>Status counts</Text>
          {Object.keys(overviewCounts).length === 0 ? (
            <Text color="gray">No orders yet.</Text>
          ) : (
            STATUS_FILTERS.filter((status) => status !== 'all').map((status) => (
              <Box key={status}>
                <Text color={statusColor(status)}>{fit(status, 10)}</Text>
                <Text>{overviewCounts[status] || 0}</Text>
              </Box>
            ))
          )}

          <Text> </Text>
          <Text bold>Recent orders</Text>
          {orders.length === 0 ? (
            <Text color="gray">No recent orders.</Text>
          ) : (
            <>
              <Text bold>{`${fit('STORE', 18)} ${fit('STATUS', 10)} ${fit('TOTAL', 12)} ${fit('UPDATED', 10)}`}</Text>
              {orders.slice(0, 6).map((order) => {
                const row = `${fit(order.storeName, 18)} ${fit(order.status, 10)} ${fit(formatCurrency(order.totalAmount, order.currency), 12)} ${fit(formatRelativeTime(order.updatedAt), 10)}`;
                return <Text key={order.id}>{row}</Text>;
              })}
            </>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
