import React, { useState, useMemo, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { Heartbeat } from '@hasna/assistants-core';
import type { HeartbeatState } from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface HeartbeatPanelProps {
  runs: Heartbeat[];
  heartbeatState?: HeartbeatState;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

type Mode = 'list' | 'detail';

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'n/a';
  const now = Date.now();
  const ts = new Date(iso).getTime();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export function HeartbeatPanel({
  runs,
  heartbeatState,
  onRefresh,
  onClose,
}: HeartbeatPanelProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime();
      const bTime = new Date(b.timestamp).getTime();
      return bTime - aTime;
    });
  }, [runs]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, sortedRuns.length - 1)));
  }, [sortedRuns.length]);

  const selectedRun = sortedRuns[selectedIndex];

  useEffect(() => {
    if (mode === 'detail' && !selectedRun) {
      setMode('list');
    }
  }, [mode, selectedRun]);

  useInput((input, key) => {
    if (mode === 'detail') {
      if (key.escape || input === 'q' || input === 'Q') {
        setMode('list');
      }
      return;
    }

    if (key.escape || input === 'q' || input === 'Q') {
      onClose();
      return;
    }

    if (key.return && sortedRuns.length > 0) {
      setMode('detail');
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? Math.max(0, sortedRuns.length - 1) : prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev >= sortedRuns.length - 1 ? 0 : prev + 1));
      return;
    }

    if (input === 'r' || input === 'R') {
      void onRefresh();
      return;
    }
  });

  if (mode === 'detail' && selectedRun) {
    return (
      <Box flexDirection="column">
        <Text bold>Heartbeat Run Details</Text>
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
          <Text>{JSON.stringify(selectedRun, null, 2)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Esc / q to go back</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>Heartbeat</Text>

      <Box marginTop={1}>
        {heartbeatState ? (
          <Text dimColor>
            State: {heartbeatState.state} | Stale: {heartbeatState.isStale ? 'yes' : 'no'} | Last Activity:{' '}
            {formatRelativeTime(heartbeatState.lastActivity)} | Uptime: {heartbeatState.uptimeSeconds}s
          </Text>
        ) : (
          <Text dimColor>Heartbeat status unavailable.</Text>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {sortedRuns.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No heartbeat runs recorded yet.</Text>
          </Box>
        ) : (
          sortedRuns.map((run, index) => {
            const isSelected = index === selectedIndex;
            const time = formatRelativeTime(run.timestamp).padEnd(8);
            const activity = formatRelativeTime(run.lastActivity).padEnd(8);
            const stats = run.stats || { messagesProcessed: 0, toolCallsExecuted: 0, errorsEncountered: 0 };
            const summary = `msgs:${stats.messagesProcessed} tools:${stats.toolCallsExecuted} err:${stats.errorsEncountered}`;
            return (
              <Box key={`${run.timestamp}-${index}`} paddingY={0}>
                <Text inverse={isSelected}>
                  {time} {run.state.padEnd(12)} {activity} {truncate(summary, 32)}
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate | Enter details | r refresh | q quit</Text>
      </Box>
    </Box>
  );
}
