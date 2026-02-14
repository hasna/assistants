import React from 'react';
import { Box, Text } from 'ink';
import type { AskUserQuestion, AskUserRequest } from '@hasna/assistants-shared';

interface AskUserPanelProps {
  sessionId: string;
  request: AskUserRequest;
  question: AskUserQuestion;
  index: number;
  total: number;
}

export function AskUserPanel({
  sessionId,
  request,
  question,
  index,
  total,
}: AskUserPanelProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} marginY={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>{request.title || 'Question'}</Text>
        <Text dimColor>{index + 1}/{total}</Text>
      </Box>
      {request.description && (
        <Box marginTop={1}>
          <Text dimColor>{request.description}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text>{question.question}</Text>
      </Box>
      {question.options && question.options.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {question.options.map((opt, idx) => (
            <Text key={`${opt}-${idx}`} dimColor>
              • {opt}
            </Text>
          ))}
        </Box>
      )}
      {question.multiline && (
        <Box marginTop={1}>
          <Text dimColor>Multi-line answer allowed. Use Alt+Enter to insert newlines.</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Session: {sessionId}</Text>
      </Box>
    </Box>
  );
}
