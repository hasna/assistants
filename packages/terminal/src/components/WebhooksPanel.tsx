import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { WebhookListItem, WebhookRegistration, WebhookEventListItem, WebhooksManager } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface WebhooksPanelProps {
  manager: WebhooksManager;
  onClose: () => void;
}

type Mode = 'list' | 'detail' | 'events' | 'create-name' | 'create-source' | 'create-confirm' | 'delete-confirm';

const STATUS_ICONS: Record<string, string> = {
  active: '●',
  paused: '◐',
  deleted: '✗',
};

const STATUS_COLORS: Record<string, string | undefined> = {
  active: 'green',
  paused: 'yellow',
  deleted: 'gray',
};

const EVENT_STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  injected: '📨',
  processed: '✓',
  failed: '✗',
};

function formatRelativeTime(isoDate: string | undefined): string {
  if (!isoDate) return 'never';
  const diff = Date.now() - new Date(isoDate).getTime();
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

export function WebhooksPanel({ manager, onClose }: WebhooksPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [webhooks, setWebhooks] = useState<WebhookListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookRegistration | null>(null);
  const [events, setEvents] = useState<WebhookEventListItem[]>([]);

  useEffect(() => {
    if ((mode === 'detail' || mode === 'events' || mode === 'delete-confirm') && !selectedWebhook) {
      setMode('list');
    }
  }, [mode, selectedWebhook]);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Create wizard state
  const [createName, setCreateName] = useState('');
  const [createSource, setCreateSource] = useState('');

  const loadWebhooks = async () => {
    try {
      const list = await manager.list();
      setWebhooks(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadWebhooks();
  }, []);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, webhooks.length - 1)));
  }, [webhooks.length]);

  const loadDetail = async (webhookId: string) => {
    try {
      const webhook = await manager.get(webhookId);
      if (webhook) {
        setSelectedWebhook(webhook);
        setMode('detail');
        setShowSecret(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadEvents = async (webhookId: string) => {
    try {
      const evts = await manager.listEvents(webhookId, { limit: 20 });
      setEvents(evts);
      setMode('events');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useInput((input, key) => {
    if (mode === 'create-name' || mode === 'create-source') return;

    if (key.escape || input === 'q') {
      if (mode === 'list') {
        onClose();
      } else {
        setMode('list');
        setSelectedWebhook(null);
        setShowSecret(false);
        setStatusMessage(null);
      }
      return;
    }

    if (mode === 'list') {
      if (key.upArrow || input === 'k') {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow || input === 'j') {
        if (webhooks.length === 0) {
          setSelectedIndex(0);
        } else {
          setSelectedIndex((prev) => Math.min(webhooks.length - 1, prev + 1));
        }
      } else if (key.return) {
        if (webhooks.length > 0) {
          loadDetail(webhooks[selectedIndex].id);
        }
      } else if (input === 'c') {
        setCreateName('');
        setCreateSource('');
        setMode('create-name');
      } else if (input === 'd' && webhooks.length > 0) {
        loadDetail(webhooks[selectedIndex].id).then(() => setMode('delete-confirm'));
      } else if (input === 'e' && webhooks.length > 0) {
        loadEvents(webhooks[selectedIndex].id);
      } else if (input === 't' && webhooks.length > 0) {
        const wh = webhooks[selectedIndex];
        manager.sendTestEvent(wh.id).then((result) => {
          setStatusMessage(result.success ? `Test event sent to ${wh.name}` : `Error: ${result.message}`);
          loadWebhooks();
        });
      } else if (input === 'p' && webhooks.length > 0) {
        const wh = webhooks[selectedIndex];
        const newStatus = wh.status === 'active' ? 'paused' : 'active';
        manager.update({ id: wh.id, status: newStatus as 'active' | 'paused' }).then((result) => {
          setStatusMessage(result.message);
          loadWebhooks();
        });
      } else if (input === 'r') {
        loadWebhooks();
        setStatusMessage('Refreshed');
      }
    } else if (mode === 'detail') {
      if (input === 'r') {
        setShowSecret(!showSecret);
      } else if (input === 'e' && selectedWebhook) {
        loadEvents(selectedWebhook.id);
      }
    } else if (mode === 'delete-confirm') {
      if (input === 'y' && selectedWebhook) {
        manager.delete(selectedWebhook.id).then((result) => {
          setStatusMessage(result.message);
          setMode('list');
          setSelectedWebhook(null);
          loadWebhooks();
        });
      } else if (input === 'n') {
        setMode('detail');
      }
    } else if (mode === 'create-confirm') {
      if (input === 'y') {
        manager.create({ name: createName, source: createSource || 'custom' }).then((result) => {
          if (result.success) {
            setStatusMessage(`Created webhook: ${result.webhookId}`);
            // Load the new webhook detail to show URL+secret
            if (!result.webhookId) {
              setMode('list');
              loadWebhooks();
              return;
            }
            manager.get(result.webhookId).then((wh) => {
              if (wh) {
                setSelectedWebhook(wh);
                setMode('detail');
                setShowSecret(true);
              } else {
                setMode('list');
              }
              loadWebhooks();
            });
          } else {
            setStatusMessage(`Error: ${result.message}`);
            setMode('list');
          }
        });
      } else if (input === 'n') {
        setMode('list');
      }
    }
  });

  // Header
  const header = (
    <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} marginBottom={1}>
      <Text bold color="cyan">Webhooks</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'list' ? 'q:close c:create d:delete p:pause/resume t:test e:events r:refresh' :
         mode === 'detail' ? 'esc:back r:reveal/hide secret e:events' :
         mode === 'events' ? 'esc:back' :
         mode === 'delete-confirm' ? 'y:confirm n:cancel' :
         mode === 'create-confirm' ? 'y:confirm n:cancel' :
         'Enter to continue'}
      </Text>
    </Box>
  );

  // Status message
  const statusBar = statusMessage ? (
    <Box marginBottom={1}>
      <Text color="yellow">{statusMessage}</Text>
    </Box>
  ) : null;

  // Error bar
  const errorBar = error ? (
    <Box marginBottom={1}>
      <Text color="red">Error: {error}</Text>
    </Box>
  ) : null;

  // List view
  if (mode === 'list') {
    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        {errorBar}
        {webhooks.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No webhooks registered. Press 'c' to create one.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {webhooks.map((wh, i) => (
              <Box key={wh.id}>
                <Text color={i === selectedIndex ? 'cyan' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text color={STATUS_COLORS[wh.status]}>
                  {STATUS_ICONS[wh.status] || '?'}{' '}
                </Text>
                <Text bold={i === selectedIndex}>
                  {wh.name}
                </Text>
                <Text color="gray">
                  {' '}({wh.source}) | {wh.deliveryCount} events | Last: {formatRelativeTime(wh.lastDeliveryAt)}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Detail view
  if (mode === 'detail' && selectedWebhook) {
    const maskedSecret = showSecret
      ? selectedWebhook.secret
      : selectedWebhook.secret.slice(0, 10) + '•'.repeat(20);

    return (
      <Box flexDirection="column">
        {header}
        {statusBar}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>{selectedWebhook.name}</Text>
          <Text> </Text>
          <Text>ID:          <Text color="cyan">{selectedWebhook.id}</Text></Text>
          <Text>Source:      {selectedWebhook.source}</Text>
          <Text>Status:      <Text color={STATUS_COLORS[selectedWebhook.status]}>{selectedWebhook.status}</Text></Text>
          {selectedWebhook.description && (
            <Text>Description: {selectedWebhook.description}</Text>
          )}
          <Text>URL:         <Text color="green">/api/v1/webhooks/receive/{selectedWebhook.id}</Text></Text>
          <Text>Secret:      <Text color={showSecret ? 'yellow' : 'gray'}>{maskedSecret}</Text> <Text color="gray">(r to {showSecret ? 'hide' : 'reveal'})</Text></Text>
          <Text>Filter:      {selectedWebhook.eventsFilter.length > 0 ? selectedWebhook.eventsFilter.join(', ') : 'all events'}</Text>
          <Text>Deliveries:  {selectedWebhook.deliveryCount}</Text>
          <Text>Created:     {new Date(selectedWebhook.createdAt).toLocaleString()}</Text>
          {selectedWebhook.lastDeliveryAt && (
            <Text>Last Event:  {new Date(selectedWebhook.lastDeliveryAt).toLocaleString()}</Text>
          )}
        </Box>
      </Box>
    );
  }

  // Events view
  if (mode === 'events') {
    return (
      <Box flexDirection="column">
        {header}
        {events.length === 0 ? (
          <Box paddingX={1}>
            <Text color="gray">No events received yet.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {events.map((evt) => (
              <Box key={evt.id} flexDirection="column" marginBottom={1}>
                <Box>
                  <Text>{EVENT_STATUS_ICONS[evt.status] || '?'} </Text>
                  <Text bold>{evt.eventType}</Text>
                  <Text color="gray"> ({evt.id})</Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text color="gray">
                    {evt.source} | {evt.status} | {new Date(evt.timestamp).toLocaleString()}
                  </Text>
                </Box>
                <Box paddingLeft={2}>
                  <Text color="gray" wrap="truncate">
                    {evt.preview}
                  </Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  }

  // Delete confirm
  if (mode === 'delete-confirm' && selectedWebhook) {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text color="red" bold>Delete webhook?</Text>
          <Text> </Text>
          <Text>This will permanently delete "{selectedWebhook.name}" ({selectedWebhook.id})</Text>
          <Text>and all its event history.</Text>
          <Text> </Text>
          <Text>Press 'y' to confirm, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  // Create wizard: name
  if (mode === 'create-name') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Webhook</Text>
          <Text> </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={createName}
              onChange={setCreateName}
              onSubmit={() => {
                if (createName.trim()) {
                  setMode('create-source');
                }
              }}
              focus
              placeholder="e.g., gmail-notifications"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: source
  if (mode === 'create-source') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Webhook</Text>
          <Text>Name: {createName}</Text>
          <Text> </Text>
          <Box>
            <Text>Source: </Text>
            <TextInput
              value={createSource}
              onChange={setCreateSource}
              onSubmit={() => {
                setMode('create-confirm');
              }}
              focus
              placeholder="e.g., gmail, notion, github, custom"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Create wizard: confirm
  if (mode === 'create-confirm') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Confirm Webhook Creation</Text>
          <Text> </Text>
          <Text>Name:   {createName}</Text>
          <Text>Source: {createSource || 'custom'}</Text>
          <Text> </Text>
          <Text>Press 'y' to create, 'n' to cancel.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text color="gray">Loading...</Text>
    </Box>
  );
}
