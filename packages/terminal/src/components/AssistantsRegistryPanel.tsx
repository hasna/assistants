import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { RegisteredAssistant, RegistryStats, RegistryAssistantState, AssistantType } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface AssistantsPanelProps {
  assistants: RegisteredAssistant[];
  stats: RegistryStats;
  onRefresh: () => void;
  onCancel: () => void;
}

type Mode = 'overview' | 'list' | 'details';

const STATE_COLORS: Record<RegistryAssistantState, string> = {
  idle: 'green',
  processing: 'yellow',
  waiting_input: 'cyan',
  error: 'red',
  offline: 'gray',
  stopped: 'gray',
};

const TYPE_COLORS: Record<AssistantType, string> = {
  assistant: 'cyan',
  subassistant: 'magenta',
  coordinator: 'yellow',
  worker: 'green',
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

export function AssistantsRegistryPanel({
  assistants,
  stats,
  onRefresh,
  onCancel,
}: AssistantsPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Sort assistants by registration time (most recent first)
  const sortedAssistants = useMemo(() => {
    return [...assistants].sort((a, b) =>
      new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime()
    );
  }, [assistants]);

  const totalItems = sortedAssistants.length;

  useEffect(() => {
    if (sortedAssistants.length === 0) {
      setSelectedIndex(0);
      if (mode !== 'overview') {
        setMode('overview');
      }
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, sortedAssistants.length - 1));
  }, [sortedAssistants.length, mode]);

  useInput((input, key) => {
    // Navigation in list/details mode
    if (mode === 'list' || mode === 'details') {
      if (key.upArrow) {
        setSelectedIndex((prev) => (prev === 0 ? Math.max(0, totalItems - 1) : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
        return;
      }

      // Show details
      if (mode === 'list' && (key.return || input === 'd' || input === 'D')) {
        if (sortedAssistants.length > 0) {
          setMode('details');
        }
        return;
      }

      // Back to list/overview
      if (key.escape || input === 'b' || input === 'B') {
        if (mode === 'details') {
          setMode('list');
        } else {
          setMode('overview');
          setSelectedIndex(0);
        }
        return;
      }
    }

    // Overview mode shortcuts
    if (mode === 'overview') {
      // View assistants list
      if (input === 'a' || input === 'A') {
        setMode('list');
        setSelectedIndex(0);
        return;
      }

      // Refresh
      if (input === 'r' || input === 'R') {
        onRefresh();
        return;
      }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  // Details mode - show full assistant info
  if (mode === 'details' && sortedAssistants.length > 0) {
    const assistant = sortedAssistants[selectedIndex];

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Assistant Details</Text>
          <Text dimColor>{selectedIndex + 1} of {sortedAssistants.length}</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          {/* Identity */}
          <Box marginBottom={1} flexDirection="column">
            <Box>
              <Text bold>{assistant.name}</Text>
              <Text dimColor> ({assistant.id.slice(0, 12)}...)</Text>
            </Box>
            {assistant.description && (
              <Box paddingLeft={1}>
                <Text dimColor>{assistant.description}</Text>
              </Box>
            )}
          </Box>

          {/* Type & State */}
          <Box marginBottom={1} flexDirection="column">
            <Box>
              <Text dimColor>Type: </Text>
              <Text color={TYPE_COLORS[assistant.type]}>{assistant.type}</Text>
            </Box>
            <Box>
              <Text dimColor>State: </Text>
              <Text color={STATE_COLORS[assistant.status.state]}>{assistant.status.state}</Text>
              {assistant.status.currentTask && (
                <Text dimColor> ({assistant.status.currentTask})</Text>
              )}
            </Box>
          </Box>

          {/* Relationships */}
          {(assistant.parentId || assistant.childIds.length > 0) && (
            <Box marginBottom={1} flexDirection="column">
              {assistant.parentId && (
                <Box>
                  <Text dimColor>Parent: </Text>
                  <Text>{assistant.parentId.slice(0, 16)}...</Text>
                </Box>
              )}
              {assistant.childIds.length > 0 && (
                <Box>
                  <Text dimColor>Children: </Text>
                  <Text>{assistant.childIds.length}</Text>
                </Box>
              )}
            </Box>
          )}

          {/* Capabilities */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Capabilities:</Text>
            {assistant.capabilities.tools.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Tools: </Text>
                <Text>{assistant.capabilities.tools.slice(0, 5).join(', ')}</Text>
                {assistant.capabilities.tools.length > 5 && (
                  <Text dimColor> +{assistant.capabilities.tools.length - 5} more</Text>
                )}
              </Box>
            )}
            {assistant.capabilities.skills.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Skills: </Text>
                <Text>{assistant.capabilities.skills.join(', ')}</Text>
              </Box>
            )}
            {assistant.capabilities.tags.length > 0 && (
              <Box paddingLeft={1}>
                <Text dimColor>Tags: </Text>
                <Text>{assistant.capabilities.tags.join(', ')}</Text>
              </Box>
            )}
          </Box>

          {/* Load */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Load:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Active Tasks: </Text>
              <Text>{assistant.load.activeTasks}</Text>
              <Text dimColor> | Queued: </Text>
              <Text>{assistant.load.queuedTasks}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Tokens: </Text>
              <Text>{assistant.load.tokensUsed.toLocaleString()}</Text>
              <Text dimColor> | LLM Calls: </Text>
              <Text>{assistant.load.llmCalls}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Depth: </Text>
              <Text>{assistant.load.currentDepth}</Text>
              {assistant.capabilities.maxDepth && (
                <Text dimColor>/{assistant.capabilities.maxDepth}</Text>
              )}
            </Box>
          </Box>

          {/* Status Metrics */}
          <Box marginBottom={1} flexDirection="column">
            <Text bold dimColor>Metrics:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Uptime: </Text>
              <Text>{formatUptime(assistant.status.uptime)}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Messages: </Text>
              <Text>{assistant.status.messagesProcessed}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Tool Calls: </Text>
              <Text>{assistant.status.toolCallsExecuted}</Text>
            </Box>
            <Box paddingLeft={1}>
              <Text dimColor>Errors: </Text>
              <Text color={assistant.status.errorsCount > 0 ? 'red' : 'white'}>{assistant.status.errorsCount}</Text>
            </Box>
          </Box>

          {/* Heartbeat */}
          <Box flexDirection="column">
            <Text bold dimColor>Heartbeat:</Text>
            <Box paddingLeft={1}>
              <Text dimColor>Last: </Text>
              <Text>{formatTimestamp(assistant.heartbeat.lastHeartbeat)}</Text>
              {assistant.heartbeat.isStale && (
                <Text color="red"> (stale)</Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate [b]ack [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // List mode - show all assistants
  if (mode === 'list') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Registered Assistants</Text>
          <Text dimColor>{sortedAssistants.length} assistant{sortedAssistants.length !== 1 ? 's' : ''}</Text>
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="#d4d4d8" borderLeft={false} borderRight={false}
          paddingX={1}
          height={Math.min(14, sortedAssistants.length + 2)}
          overflowY="hidden"
        >
          {sortedAssistants.length === 0 ? (
            <Box paddingY={1}>
              <Text dimColor>No assistants registered.</Text>
            </Box>
          ) : (
            sortedAssistants.map((item, index) => {
              const isSelected = index === selectedIndex;
              const stateColor = STATE_COLORS[item.status.state];
              const typeColor = TYPE_COLORS[item.type];

              return (
                <Box key={item.id}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={stateColor}>[{item.status.state.slice(0, 4).padEnd(4)}]</Text>{' '}
                    <Text bold={isSelected}>{item.name.slice(0, 18).padEnd(18)}</Text>{' '}
                    <Text color={typeColor}>{item.type.slice(0, 8).padEnd(8)}</Text>{' '}
                    <Text dimColor>{formatTimestamp(item.registeredAt)}</Text>
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate [d]etails [b]ack [q]uit</Text>
        </Box>
      </Box>
    );
  }

  // Overview mode (default)
  const activeAssistants = sortedAssistants.filter(a => a.status.state !== 'offline' && !a.heartbeat.isStale);
  const processingAssistants = sortedAssistants.filter(a => a.status.state === 'processing');

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Assistant Registry</Text>
        <Text dimColor>
          {activeAssistants.length}/{sortedAssistants.length} active
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
        {/* Summary Stats */}
        <Box marginBottom={1} flexDirection="column">
          <Box>
            <Text dimColor>Total Assistants: </Text>
            <Text bold>{stats.totalAssistants}</Text>
          </Box>
          <Box>
            <Text dimColor>Active: </Text>
            <Text color="green">{activeAssistants.length}</Text>
            {processingAssistants.length > 0 && (
              <>
                <Text dimColor> | Processing: </Text>
                <Text color="yellow">{processingAssistants.length}</Text>
              </>
            )}
            {stats.staleCount > 0 && (
              <>
                <Text dimColor> | Stale: </Text>
                <Text color="red">{stats.staleCount}</Text>
              </>
            )}
          </Box>
        </Box>

        {/* By Type */}
        <Box marginBottom={1} flexDirection="column">
          <Text bold dimColor>By Type:</Text>
          <Box paddingLeft={1}>
            <Text color="cyan">Assistants: {stats.byType.assistant}</Text>
            <Text dimColor> | </Text>
            <Text color="magenta">Subassistants: {stats.byType.subassistant}</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text color="yellow">Coordinators: {stats.byType.coordinator}</Text>
            <Text dimColor> | </Text>
            <Text color="green">Workers: {stats.byType.worker}</Text>
          </Box>
        </Box>

        {/* By State */}
        <Box marginBottom={1} flexDirection="column">
          <Text bold dimColor>By State:</Text>
          <Box paddingLeft={1}>
            <Text color="green">Idle: {stats.byState.idle}</Text>
            <Text dimColor> | </Text>
            <Text color="yellow">Processing: {stats.byState.processing}</Text>
            <Text dimColor> | </Text>
            <Text color="cyan">Waiting: {stats.byState.waiting_input}</Text>
          </Box>
          <Box paddingLeft={1}>
            <Text color="red">Error: {stats.byState.error}</Text>
            <Text dimColor> | </Text>
            <Text color="gray">Offline: {stats.byState.offline}</Text>
            <Text dimColor> | </Text>
            <Text color="gray">Stopped: {stats.byState.stopped}</Text>
          </Box>
        </Box>

        {/* Average Load */}
        <Box flexDirection="column">
          <Box>
            <Text dimColor>Average Load: </Text>
            <Text color={stats.averageLoad > 0.8 ? 'red' : stats.averageLoad > 0.5 ? 'yellow' : 'green'}>
              {(stats.averageLoad * 100).toFixed(0)}%
            </Text>
          </Box>
          <Box>
            <Text dimColor>Registry Uptime: </Text>
            <Text>{formatUptime(stats.uptime)}</Text>
          </Box>
        </Box>

        {/* Quick assistant list preview */}
        {sortedAssistants.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Recent Assistants:</Text>
            {sortedAssistants.slice(0, 3).map((item) => (
              <Box key={item.id} paddingLeft={1}>
                <Text color={STATE_COLORS[item.status.state]}>●</Text>
                <Text> {item.name}</Text>
                <Text dimColor> ({item.type})</Text>
              </Box>
            ))}
            {sortedAssistants.length > 3 && (
              <Box paddingLeft={1}>
                <Text dimColor>+ {sortedAssistants.length - 3} more</Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[a]ssistants list [r]efresh [q]uit</Text>
      </Box>
    </Box>
  );
}
