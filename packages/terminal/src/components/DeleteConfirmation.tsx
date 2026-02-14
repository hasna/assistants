import React from 'react';
import { Box, Text } from 'ink';

interface DeleteConfirmationProps {
  title?: string;
  itemName: string;
  itemId?: string;
  message?: string;
  color?: string;
}

/**
 * Standardized delete confirmation dialog.
 * Press 'y' to confirm, 'n' to cancel.
 */
export function DeleteConfirmation({
  title = 'Delete?',
  itemName,
  itemId,
  message,
  color = 'red',
}: DeleteConfirmationProps) {
  return (
    <Box paddingX={1} flexDirection="column">
      <Text color={color} bold>{title}</Text>
      <Text> </Text>
      <Text>This will delete "{itemName}"{itemId ? ` (${itemId})` : ''}.</Text>
      {message && <Text>{message}</Text>}
      <Text> </Text>
      <Text>Press <Text bold>'y'</Text> to confirm, <Text bold>'n'</Text> to cancel.</Text>
    </Box>
  );
}
