import React from 'react';
import { Box, Text } from 'ink';
import type { QueuedMessage } from './appTypes';

interface QueueIndicatorProps {
  messages: QueuedMessage[];
  maxPreview?: number;
}

const DEFAULT_MAX_PREVIEW = 3;

function truncateQueued(text: string, maxLen: number = 80): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

export function QueueIndicator({
  messages,
  maxPreview = DEFAULT_MAX_PREVIEW,
}: QueueIndicatorProps) {
  if (messages.length === 0) return null;

  const totalCount = messages.length;
  const sorted = [...messages].sort((a, b) => a.queuedAt - b.queuedAt);
  const previewItems = sorted.slice(0, maxPreview);
  const hasMore = totalCount > maxPreview;
  const inlineCount = messages.filter((msg) => msg.mode === 'inline').length;
  const queuedCount = messages.filter((msg) => msg.mode === 'queued').length;

  return (
    <Box flexDirection="column">
      <Text dimColor>
        ↳ {totalCount} pending{totalCount > 1 ? '' : ''}
        {inlineCount > 0 || queuedCount > 0
          ? ` · ${inlineCount} in-stream · ${queuedCount} queued`
          : ''}
      </Text>
      {previewItems.map((queued) => (
        <Box key={queued.id} marginLeft={2}>
          <Text dimColor>
            ↳ {truncateQueued(queued.content)}
          </Text>
        </Box>
      ))}
      {hasMore && (
        <Text dimColor>  +{totalCount - maxPreview} more</Text>
      )}
    </Box>
  );
}
