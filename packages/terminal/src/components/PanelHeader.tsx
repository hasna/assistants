import React from 'react';
import { Box, Text } from 'ink';

interface PanelHeaderProps {
  title: string;
  color?: string;
  count?: number;
  hints?: string;
}

/**
 * Standardized panel header component.
 * All panels should use this for consistent header formatting.
 */
export function PanelHeader({ title, color = 'cyan', count, hints }: PanelHeaderProps) {
  return (
    <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={0} marginBottom={1}>
      <Text bold>{title}</Text>
      {count !== undefined && (
        <Text dimColor> ({count})</Text>
      )}
      {hints && (
        <>
          <Text dimColor> | </Text>
          <Text dimColor>{hints}</Text>
        </>
      )}
    </Box>
  );
}
