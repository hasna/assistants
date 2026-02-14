import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { SessionInfo } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface SessionSelectorProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Format date/time for session display
 */
function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).toLowerCase();
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toLowerCase();
}

/**
 * Format path for display (abbreviate home directory)
 */
function formatPath(cwd: string): string {
  const home = process.env.HOME || '';
  if (home && cwd.startsWith(home)) {
    return '~' + cwd.slice(home.length);
  }
  return cwd;
}

export function SessionSelector({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onCancel,
}: SessionSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, sessions.length));
  }, [sessions.length]);

  useInput((input, key) => {
    // 'n' or 'N' for new session - check first to prioritize
    if (input === 'n' || input === 'N') {
      onNew();
      return;
    }

    // Escape: cancel
    if (key.escape) {
      onCancel();
      return;
    }

    // Enter: select current option
    if (key.return) {
      if (selectedIndex >= sessions.length) {
        // "New session" option or out of bounds
        onNew();
      } else {
        onSelect(sessions[selectedIndex].id);
      }
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(sessions.length, prev + 1)); // +1 for "new" option
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sessions.length) {
      onSelect(sessions[num - 1].id);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1}>
        <Text bold>Sessions</Text>
      </Box>

      {sessions.map((session, index) => {
        const isActive = session.id === activeSessionId;
        const isSelected = index === selectedIndex;
        const prefix = isActive ? '[*]' : '   ';
        const time = formatSessionTime(session.updatedAt);
        const path = formatPath(session.cwd);
        const processing = session.isProcessing ? ' (processing)' : '';

        return (
          <Box key={session.id}>
            <Text
              inverse={isSelected}
              color={isActive ? 'green' : undefined}
              dimColor={!isSelected && !isActive}
            >
              {prefix} {index + 1}. {time}  {path}{processing}
            </Text>
          </Box>
        );
      })}

      {/* New session option */}
      <Box marginTop={1}>
        <Text
          inverse={selectedIndex === sessions.length}
          dimColor={selectedIndex !== sessions.length}
        >
            + New session (n)
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter to select | Esc to cancel | 1-{sessions.length} to switch | n for new
        </Text>
      </Box>
    </Box>
  );
}
