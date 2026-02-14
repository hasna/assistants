import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  return (
    <Box>
      <Text dimColor>
        <InkSpinner type="dots" />
      </Text>
      {label && <Text dimColor> {label}</Text>}
    </Box>
  );
}
