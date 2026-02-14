import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  ALL_MODELS,
  LLM_PROVIDER_IDS,
  getModelDisplayName,
  getProviderLabel,
  type ModelDefinition,
} from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface ModelPanelProps {
  currentModelId: string | null;
  assistantName?: string;
  onSelectModel: (modelId: string) => Promise<void>;
  onCancel: () => void;
}

type DisplayRow =
  | { type: 'provider'; key: string; label: string }
  | { type: 'model'; key: string; model: ModelDefinition; index: number };

export function ModelPanel({
  currentModelId,
  assistantName,
  onSelectModel,
  onCancel,
}: ModelPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSwitching, setIsSwitching] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const models = useMemo(() => {
    const ordered: ModelDefinition[] = [];
    for (const provider of LLM_PROVIDER_IDS) {
      ordered.push(...ALL_MODELS.filter((model) => model.provider === provider));
    }
    return ordered;
  }, []);

  const rows = useMemo(() => {
    const nextRows: DisplayRow[] = [];
    let modelIndex = 0;
    for (const provider of LLM_PROVIDER_IDS) {
      const providerModels = models.filter((model) => model.provider === provider);
      if (providerModels.length === 0) continue;
      nextRows.push({
        type: 'provider',
        key: `provider-${provider}`,
        label: getProviderLabel(provider),
      });
      for (const model of providerModels) {
        nextRows.push({
          type: 'model',
          key: model.id,
          model,
          index: modelIndex,
        });
        modelIndex += 1;
      }
    }
    return nextRows;
  }, [models]);

  useEffect(() => {
    if (!currentModelId) return;
    const idx = models.findIndex((model) => model.id === currentModelId);
    if (idx >= 0) setSelectedIndex(idx);
  }, [currentModelId, models]);

  useInput((input, key) => {
    if (isSwitching) return;

    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }

    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => (prev <= 0 ? Math.max(0, models.length - 1) : prev - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => (prev >= models.length - 1 ? 0 : prev + 1));
      return;
    }

    if (key.return || input === 's' || input === 'S') {
      const selected = models[selectedIndex];
      if (!selected) return;
      if (selected.id === currentModelId) {
        setStatus({ type: 'info', text: `${selected.name} is already active.` });
        return;
      }

      setIsSwitching(true);
      void onSelectModel(selected.id)
        .then(() => {
          setStatus({ type: 'success', text: `Switched to ${selected.name}.` });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setStatus({ type: 'error', text: message });
        })
        .finally(() => {
          setIsSwitching(false);
        });
    }
  }, { isActive: true });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Model Selector</Text>
        {assistantName ? (
          <Text dimColor>{assistantName}</Text>
        ) : (
          <Text dimColor>Active assistant</Text>
        )}
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          Current: {getModelDisplayName(currentModelId || 'unknown')} ({currentModelId || 'unknown'})
        </Text>
      </Box>

      {status && (
        <Box marginBottom={1}>
          <Text color={status.type === 'error' ? 'red' : status.type === 'success' ? 'green' : 'yellow'}>
            {status.text}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {rows.map((row) => {
          if (row.type === 'provider') {
            return (
              <Box key={row.key} marginTop={1}>
                <Text bold color="cyan">{row.label}</Text>
              </Box>
            );
          }

          const isSelected = row.index === selectedIndex;
          const isCurrent = row.model.id === currentModelId;
          return (
            <Box key={row.key} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isSelected ? 'blue' : undefined}>
                  {isSelected ? '▸ ' : '  '}
                </Text>
                <Text bold={isSelected} color={isSelected ? 'blue' : undefined}>
                  {row.model.name}
                </Text>
                {isCurrent && <Text color="green"> (current)</Text>}
              </Box>
              <Box paddingLeft={2}>
                <Text dimColor>{row.model.id} · {row.model.description}</Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{isSwitching ? 'Switching model...' : 'Enter/s switch | ↑↓ navigate | q quit'}</Text>
      </Box>
    </Box>
  );
}
