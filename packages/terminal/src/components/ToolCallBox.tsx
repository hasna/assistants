import React, { useState } from 'react';
import { Box, Text } from 'ink';
import type { ToolCall, ToolResult } from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface ToolCallEntry {
  toolCall: ToolCall;
  result?: ToolResult;
}

interface ToolCallBoxProps {
  entries: ToolCallEntry[];
  maxVisible?: number;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export function ToolCallBox({
  entries,
  maxVisible = 3,
  isExpanded = false,
  onToggleExpand,
}: ToolCallBoxProps) {
  if (entries.length === 0) {
    return null;
  }

  const visibleEntries = isExpanded ? entries : entries.slice(-maxVisible);
  const hiddenCount = entries.length - visibleEntries.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#d4d4d8" borderLeft={false} borderRight={false}
      paddingX={1}
      marginY={1}
    >
      {/* Header with expand hint */}
      <Box justifyContent="space-between">
        <Text dimColor bold>
          Tools ({entries.length})
        </Text>
        {entries.length > maxVisible && (
          <Text dimColor>
            {isExpanded ? 'Ctrl+O to collapse' : 'Ctrl+O to expand'}
          </Text>
        )}
      </Box>

      {/* Hidden count indicator */}
      {hiddenCount > 0 && !isExpanded && (
        <Text dimColor>  +{hiddenCount} more above...</Text>
      )}

      {/* Visible tool calls */}
      {visibleEntries.map((entry, index) => (
        <ToolCallRow key={entry.toolCall.id} entry={entry} />
      ))}
    </Box>
  );
}

interface ToolCallRowProps {
  entry: ToolCallEntry;
}

function ToolCallRow({ entry }: ToolCallRowProps) {
  const { toolCall, result } = entry;
  const statusIcon = result ? (result.isError ? '✗' : '✓') : '○';
  const statusColor = result ? (result.isError ? 'red' : 'green') : 'gray';

  return (
    <Box>
      <Text color={statusColor}>{statusIcon} </Text>
      <Text dimColor>{formatToolCall(toolCall)}</Text>
    </Box>
  );
}

function formatToolCall(toolCall: ToolCall): string {
  const { name, input } = toolCall;

  switch (name) {
    case 'bash':
      return `Running: ${truncate(String(input.command || ''), 50)}`;
    case 'curl':
    case 'web_fetch':
      return `Fetching: ${truncate(String(input.url || ''), 50)}`;
    case 'web_search':
      return `Searching: ${truncate(String(input.query || ''), 50)}`;
    case 'read':
      return `Reading: ${truncate(String(input.path || input.file_path || ''), 50)}`;
    case 'write':
      return `Writing: ${truncate(String(input.filename || input.path || input.file_path || ''), 50)}`;
    case 'glob':
      return `Finding: ${truncate(String(input.pattern || ''), 50)}`;
    case 'grep':
      return `Searching: ${truncate(String(input.pattern || ''), 50)}`;
    case 'schedule':
      return formatScheduleAction(input);
    case 'submit_feedback':
      return `Submitting ${input.type || 'feedback'}`;
    case 'notion':
      return `Notion: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'gmail':
      return `Gmail: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'googledrive':
      return `Drive: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'googlecalendar':
      return `Calendar: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'linear':
      return `Linear: ${truncate(String(input.command || input.action || ''), 50)}`;
    case 'slack':
      return `Slack: ${truncate(String(input.command || input.action || ''), 50)}`;
    default:
      // For any tool, try to find a meaningful action
      const action = input.action || input.command || input.operation;
      if (action) {
        return `${formatName(name)}: ${truncate(String(action), 40)}`;
      }
      return `${formatName(name)}`;
  }
}

function formatName(name: string): string {
  return name
    .replace(/^connect_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatScheduleAction(input: Record<string, unknown>): string {
  const action = String(input.action || '');
  switch (action) {
    case 'list':
      return 'Listing scheduled tasks';
    case 'create':
      return `Creating schedule`;
    case 'update':
      return `Updating schedule`;
    case 'delete':
      return `Deleting schedule`;
    case 'pause':
      return `Pausing schedule`;
    case 'resume':
      return `Resuming schedule`;
    default:
      return `Schedule: ${action || 'unknown'}`;
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

// Hook for handling Ctrl+O expansion
export function useToolCallExpansion() {
  const [isExpanded, setIsExpanded] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'o') {
      setIsExpanded((prev) => !prev);
    }
  });

  return { isExpanded, setIsExpanded };
}
