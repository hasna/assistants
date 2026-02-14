import React from 'react';
import { Box, Text } from 'ink';
import { getModelDisplayName } from '@hasna/assistants-shared';

interface WelcomeBannerProps {
  version: string;
  model: string;
  directory: string;
}

export function WelcomeBanner({ version, model, directory }: WelcomeBannerProps) {
  const homeDir = process.env.HOME || '';
  const displayDir = homeDir && directory.startsWith(homeDir)
    ? '~' + directory.slice(homeDir.length)
    : directory;

  // Shorten long paths: ~/Workspace/hasna/opensource/opensourcedev/foo -> ~/…/opensourcedev/foo
  const parts = displayDir.split('/');
  const shortDir = parts.length > 4
    ? parts[0] + '/\u2026/' + parts.slice(-2).join('/')
    : displayDir;

  const displayModel = getModelDisplayName(model);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text dimColor>{'>'}</Text>
        <Text bold>_ Hasna Assistants</Text>
        <Text dimColor>  (v{version})</Text>
      </Box>
      <Text>{''}</Text>
      <Box>
        <Text dimColor>model:     </Text>
        <Text>{displayModel}</Text>
        <Text dimColor>    /model to change</Text>
      </Box>
      <Box>
        <Text dimColor>directory: </Text>
        <Text>{shortDir}</Text>
      </Box>
    </Box>
  );
}
