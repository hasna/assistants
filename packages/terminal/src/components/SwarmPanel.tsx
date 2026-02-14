import React from 'react';
import { Box, Text } from 'ink';
import type { SerializableSwarmState, SwarmConfig } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface SwarmPanelProps {
  state: SerializableSwarmState | null;
  config: SwarmConfig | null;
  memoryStats?: { totalEntries: number; byCategory: Record<string, number> } | null;
  onStop: () => void;
  onCancel: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle: 'gray',
    planning: 'cyan',
    executing: 'blue',
    reviewing: 'yellow',
    aggregating: 'magenta',
    completed: 'green',
    failed: 'red',
    cancelled: 'red',
  };

  return <Text color={colorMap[status] || 'gray'} bold>{status.toUpperCase()}</Text>;
}

function TaskStatusIcon({ status }: { status: string }) {
  const icons: Record<string, string> = {
    pending: '○',
    assigned: '◐',
    running: '●',
    completed: '✓',
    failed: '✗',
    blocked: '⊘',
    cancelled: '—',
  };
  const colors: Record<string, string> = {
    pending: 'gray',
    assigned: 'cyan',
    running: 'blue',
    completed: 'green',
    failed: 'red',
    blocked: 'yellow',
    cancelled: 'gray',
  };

  return <Text color={colors[status] || 'gray'}>{icons[status] || '?'}</Text>;
}

export function SwarmPanel({
  state,
  config,
  memoryStats,
  onStop,
  onCancel,
}: SwarmPanelProps) {
  useInput((input, key) => {
    if (input === 's' || input === 'S') {
      onStop();
      return;
    }
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  if (!state) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Swarm</Text>
        <Box marginTop={1}>
          <Text dimColor>No swarm currently running. Use /swarm &lt;goal&gt; to start.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[q]uit</Text>
        </Box>
      </Box>
    );
  }

  const tasks = state.plan?.tasks || [];
  const isRunning = !['completed', 'failed', 'cancelled'].includes(state.status);

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>Swarm</Text>
        <StatusBadge status={state.status} />
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
        {/* Goal */}
        {state.plan?.goal && (
          <Box marginBottom={1}>
            <Text dimColor>Goal: </Text>
            <Text>{state.plan.goal}</Text>
          </Box>
        )}

        {/* Task Graph */}
        {tasks.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold dimColor>Tasks ({state.metrics.completedTasks}/{state.metrics.totalTasks}):</Text>
            <Box flexDirection="column" marginTop={1}>
              {tasks.slice(0, 15).map((task, i) => (
                <Box key={task.id || i} gap={1}>
                  <TaskStatusIcon status={task.status} />
                  <Text dimColor={task.status === 'completed'}>{task.description.slice(0, 60)}</Text>
                  {task.assignedAssistantId && (
                    <Text dimColor color="cyan"> [{task.assignedAssistantId.slice(0, 6)}]</Text>
                  )}
                </Box>
              ))}
              {tasks.length > 15 && (
                <Text dimColor>  ...and {tasks.length - 15} more</Text>
              )}
            </Box>
          </Box>
        )}

        {/* Metrics */}
        <Box flexDirection="column">
          <Text bold dimColor>Metrics:</Text>
          <Box paddingLeft={1} flexDirection="column">
            <Box>
              <Text dimColor>{'LLM Calls:'.padEnd(16)}</Text>
              <Text>{state.metrics.llmCalls}</Text>
            </Box>
            <Box>
              <Text dimColor>{'Tool Calls:'.padEnd(16)}</Text>
              <Text>{state.metrics.toolCalls}</Text>
            </Box>
            <Box>
              <Text dimColor>{'Tokens Used:'.padEnd(16)}</Text>
              <Text>{state.metrics.tokensUsed.toLocaleString()}</Text>
              {config?.tokenBudget && config.tokenBudget > 0 && (
                <Text dimColor> / {config.tokenBudget.toLocaleString()}</Text>
              )}
            </Box>
            {state.metrics.replans > 0 && (
              <Box>
                <Text dimColor>{'Replans:'.padEnd(16)}</Text>
                <Text>{state.metrics.replans}</Text>
              </Box>
            )}
          </Box>
        </Box>

        {/* Active Assistants */}
        {state.activeAssistants && state.activeAssistants.length > 0 && (
          <Box marginTop={1}>
            <Text dimColor>Active workers: </Text>
            <Text color="cyan">{state.activeAssistants.length}</Text>
          </Box>
        )}

        {/* Shared Memory */}
        {memoryStats && memoryStats.totalEntries > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold dimColor>Shared Memory: {memoryStats.totalEntries} entries</Text>
            <Box paddingLeft={1}>
              {Object.entries(memoryStats.byCategory)
                .filter(([_, count]) => count > 0)
                .map(([cat, count]) => (
                  <Text key={cat} dimColor>{cat}: {count}  </Text>
                ))}
            </Box>
          </Box>
        )}

        {/* Errors */}
        {state.errors && state.errors.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red" bold>Errors:</Text>
            {state.errors.slice(-3).map((err, i) => (
              <Text key={i} color="red">  - {err.slice(0, 80)}</Text>
            ))}
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {isRunning ? '[s]top ' : ''}[q]uit
        </Text>
      </Box>
    </Box>
  );
}
