import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import {
  ALL_MODELS,
  LLM_PROVIDER_IDS,
  getModelDisplayName,
  getProviderLabel,
  type ModelDefinition,
} from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

const MAX_VISIBLE_ROWS = 12;
const NAME_WIDTH = 28;
const CTX_WIDTH = 6;
const OUT_WIDTH = 6;
const COST_WIDTH = 10;

interface ModelPanelProps {
  currentModelId: string | null;
  assistantName?: string;
  onSelectModel: (modelId: string) => Promise<void>;
  onCancel: () => void;
}

type DisplayRow =
  | { type: 'provider'; label: string }
  | { type: 'model'; model: ModelDefinition };

// --- Format helpers ---

function fmtTokens(n?: number): string {
  if (n == null) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtCost(model: ModelDefinition): string {
  if (model.inputCostPer1M == null || model.outputCostPer1M == null) return '—';
  const fmtNum = (n: number) => (n >= 1 ? `$${n % 1 === 0 ? n : n.toFixed(1)}` : `$${n}`);
  return `${fmtNum(model.inputCostPer1M)}/${fmtNum(model.outputCostPer1M)}`;
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : ' '.repeat(w - s.length) + s;
}

// --- Scrolling ---

function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_ROWS,
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return { start: 0, end: totalItems, hasMore: { above: 0, below: 0 } };
  }
  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);
  if (start < 0) {
    start = 0;
    end = maxVisible;
  }
  if (end > totalItems) {
    end = totalItems;
    start = Math.max(0, totalItems - maxVisible);
  }
  return { start, end, hasMore: { above: start, below: totalItems - end } };
}

// --- Build display rows ---

function buildRows(models: ModelDefinition[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  for (const provider of LLM_PROVIDER_IDS) {
    const providerModels = models.filter((m) => m.provider === provider);
    if (providerModels.length === 0) continue;
    rows.push({ type: 'provider', label: getProviderLabel(provider) });
    for (const model of providerModels) {
      rows.push({ type: 'model', model });
    }
  }
  return rows;
}

// --- Get selectable (model) indices from rows ---

function getSelectableIndices(rows: DisplayRow[]): number[] {
  return rows.reduce<number[]>((acc, row, i) => {
    if (row.type === 'model') acc.push(i);
    return acc;
  }, []);
}

export function ModelPanel({
  currentModelId,
  assistantName,
  onSelectModel,
  onCancel,
}: ModelPanelProps) {
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [isSwitching, setIsSwitching] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter models by search
  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return [...ALL_MODELS];
    const q = searchQuery.toLowerCase();
    return ALL_MODELS.filter(
      (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const rows = useMemo(() => buildRows(filteredModels), [filteredModels]);
  const selectableIndices = useMemo(() => getSelectableIndices(rows), [rows]);

  // Initialize selection to current model
  useEffect(() => {
    if (!currentModelId) return;
    const idx = rows.findIndex(
      (r) => r.type === 'model' && r.model.id === currentModelId,
    );
    if (idx >= 0) setSelectedRowIndex(idx);
  }, [currentModelId, rows]);

  // Clamp selection when rows change (e.g. after search)
  useEffect(() => {
    if (selectableIndices.length === 0) return;
    if (!selectableIndices.includes(selectedRowIndex)) {
      setSelectedRowIndex(selectableIndices[0]!);
    }
  }, [selectableIndices, selectedRowIndex]);

  // Navigation helpers
  const moveSelection = (direction: 1 | -1) => {
    if (selectableIndices.length === 0) return;
    const currentPos = selectableIndices.indexOf(selectedRowIndex);
    let nextPos: number;
    if (currentPos === -1) {
      nextPos = direction === 1 ? 0 : selectableIndices.length - 1;
    } else {
      nextPos = currentPos + direction;
      if (nextPos < 0) nextPos = selectableIndices.length - 1;
      if (nextPos >= selectableIndices.length) nextPos = 0;
    }
    setSelectedRowIndex(selectableIndices[nextPos]!);
  };

  const handleSelect = () => {
    const row = rows[selectedRowIndex];
    if (!row || row.type !== 'model') return;
    if (row.model.id === currentModelId) {
      setStatus({ type: 'info', text: `${row.model.name} is already active.` });
      return;
    }
    setIsSwitching(true);
    void onSelectModel(row.model.id)
      .then(() => {
        setStatus({ type: 'success', text: `Switched to ${row.model.name}.` });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ type: 'error', text: message });
      })
      .finally(() => {
        setIsSwitching(false);
      });
  };

  useInput(
    (input, key) => {
      if (isSwitching) return;

      // Search mode: Escape clears search
      if (isSearching) {
        if (key.escape) {
          setIsSearching(false);
          setSearchQuery('');
          return;
        }
        // Let TextInput handle all other keys
        return;
      }

      // Normal mode
      if (key.escape || input === 'q' || input === 'Q') {
        onCancel();
        return;
      }

      if (input === '/') {
        setIsSearching(true);
        setSearchQuery('');
        return;
      }

      if (key.upArrow || input === 'k') {
        moveSelection(-1);
        return;
      }

      if (key.downArrow || input === 'j') {
        moveSelection(1);
        return;
      }

      if (key.return || input === 's' || input === 'S') {
        handleSelect();
      }
    },
    { isActive: true },
  );

  // Scrolling
  const visibleRange = useMemo(
    () => getVisibleRange(selectedRowIndex, rows.length),
    [selectedRowIndex, rows.length],
  );
  const visibleRows = rows.slice(visibleRange.start, visibleRange.end);

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Header */}
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

      {/* Status message */}
      {status && (
        <Box marginBottom={1}>
          <Text color={status.type === 'error' ? 'red' : status.type === 'success' ? 'green' : 'yellow'}>
            {status.text}
          </Text>
        </Box>
      )}

      {/* Search bar */}
      {isSearching && (
        <Box marginBottom={1}>
          <Text bold color="blue">/ </Text>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search models..."
          />
        </Box>
      )}

      {/* Scroll indicator: above */}
      {visibleRange.hasMore.above > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>↑ {visibleRange.hasMore.above} more</Text>
        </Box>
      )}

      {/* Column header */}
      <Box paddingLeft={2}>
        <Text dimColor>
          {padRight('Model', NAME_WIDTH)}
          {padLeft('Ctx', CTX_WIDTH)}
          {padLeft('Out', OUT_WIDTH)}
          {padLeft('Cost/1M', COST_WIDTH)}
        </Text>
      </Box>

      {/* Model rows */}
      <Box flexDirection="column">
        {visibleRows.map((row, i) => {
          const globalIndex = visibleRange.start + i;

          if (row.type === 'provider') {
            return (
              <Box key={`p-${row.label}`} paddingLeft={1}>
                <Text bold color="cyan"> {row.label}</Text>
              </Box>
            );
          }

          const isSelected = globalIndex === selectedRowIndex;
          const isCurrent = row.model.id === currentModelId;
          const prefix = isSelected ? '▸ ' : '  ';
          const name = padRight(row.model.name, NAME_WIDTH);
          const ctx = padLeft(fmtTokens(row.model.contextWindow), CTX_WIDTH);
          const out = padLeft(fmtTokens(row.model.maxOutputTokens), OUT_WIDTH);
          const cost = padLeft(fmtCost(row.model), COST_WIDTH);

          return (
            <Box key={row.model.id}>
              <Text color={isSelected ? 'blue' : undefined}>{prefix}</Text>
              <Text bold={isSelected} color={isSelected ? 'blue' : undefined}>
                {name}
              </Text>
              <Text dimColor={!isSelected} color={isSelected ? 'blue' : undefined}>
                {ctx}{out}{cost}
              </Text>
              {isCurrent && <Text color="green"> ← current</Text>}
            </Box>
          );
        })}
      </Box>

      {/* Scroll indicator: below */}
      {visibleRange.hasMore.below > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>↓ {visibleRange.hasMore.below} more</Text>
        </Box>
      )}

      {/* No results */}
      {selectableIndices.length === 0 && isSearching && (
        <Box paddingLeft={2} marginY={1}>
          <Text dimColor>No models match "{searchQuery}"</Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>
          {isSwitching
            ? 'Switching model...'
            : isSearching
              ? 'Type to filter | Esc clear search'
              : 'Enter select | ↑↓ navigate | / search | q quit'}
        </Text>
      </Box>
    </Box>
  );
}
