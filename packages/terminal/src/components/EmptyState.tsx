import React from 'react';
import { Box, Text } from 'ink';

interface EmptyStateProps {
  message: string;
  hint?: string;
}

/**
 * Standardized empty state component for panels.
 */
export function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <Box paddingX={1} flexDirection="column">
      <Text color="gray">{message}</Text>
      {hint && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}
