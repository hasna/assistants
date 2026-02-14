import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { BudgetConfig, BudgetLimits } from '@hasna/assistants-shared';
import type { BudgetStatus, BudgetScope } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface BudgetPanelProps {
  config: BudgetConfig;
  sessionStatus: BudgetStatus;
  swarmStatus: BudgetStatus;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: (scope: BudgetScope) => void;
  onSetLimits: (scope: BudgetScope, limits: Partial<BudgetLimits>) => void;
  onSetOnExceeded?: (action: 'warn' | 'pause' | 'stop') => void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  primaryActionKey?: string;
  onCancel: () => void;
}

type Mode = 'overview' | 'limits' | 'edit-limits' | 'preset-select';

interface EditField {
  key: keyof BudgetLimits;
  label: string;
  unit: string;
  /** Multiplier to convert display value to stored value (e.g., minutes -> ms) */
  toStored: (display: number) => number;
  /** Multiplier to convert stored value to display value */
  toDisplay: (stored: number) => number;
}

const EDIT_FIELDS: EditField[] = [
  { key: 'maxTotalTokens', label: 'Max Total Tokens', unit: 'tokens', toStored: (v) => v, toDisplay: (v) => v },
  { key: 'maxInputTokens', label: 'Max Input Tokens', unit: 'tokens', toStored: (v) => v, toDisplay: (v) => v },
  { key: 'maxOutputTokens', label: 'Max Output Tokens', unit: 'tokens', toStored: (v) => v, toDisplay: (v) => v },
  { key: 'maxLlmCalls', label: 'Max LLM Calls', unit: 'calls', toStored: (v) => v, toDisplay: (v) => v },
  { key: 'maxToolCalls', label: 'Max Tool Calls', unit: 'calls', toStored: (v) => v, toDisplay: (v) => v },
  { key: 'maxDurationMs', label: 'Max Duration', unit: 'min', toStored: (v) => v * 60 * 1000, toDisplay: (v) => Math.round(v / 60000) },
];

const ON_EXCEEDED_OPTIONS: Array<'warn' | 'pause' | 'stop'> = ['warn', 'pause', 'stop'];

const PRESET_LIMITS = {
  light: {
    name: 'Light',
    description: 'Low limits for quick tasks',
    session: { maxTotalTokens: 50000, maxLlmCalls: 20, maxToolCalls: 50, maxDurationMs: 10 * 60 * 1000 },
  },
  moderate: {
    name: 'Moderate',
    description: 'Balanced limits for typical work',
    session: { maxTotalTokens: 200000, maxLlmCalls: 50, maxToolCalls: 200, maxDurationMs: 30 * 60 * 1000 },
  },
  heavy: {
    name: 'Heavy',
    description: 'High limits for complex tasks',
    session: { maxTotalTokens: 500000, maxLlmCalls: 100, maxToolCalls: 500, maxDurationMs: 60 * 60 * 1000 },
  },
  unlimited: {
    name: 'Unlimited',
    description: 'No limits (monitoring only)',
    session: {},
  },
};

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function UsageBar({ used, limit }: { used: number; limit?: number }) {
  if (!limit) {
    return <Text dimColor>no limit</Text>;
  }

  const percent = Math.min(100, Math.round((used / limit) * 100));
  const barWidth = 20;
  const filledWidth = Math.round((percent / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  let barColor = 'green';
  if (percent >= 90) barColor = 'red';
  else if (percent >= 75) barColor = 'yellow';

  return (
    <Box>
      <Text color={barColor}>{'█'.repeat(filledWidth)}</Text>
      <Text dimColor>{'░'.repeat(emptyWidth)}</Text>
      <Text> {percent}%</Text>
    </Box>
  );
}

export function BudgetPanel({
  config,
  sessionStatus,
  swarmStatus,
  onToggleEnabled,
  onReset,
  onSetLimits,
  onSetOnExceeded,
  onPrimaryAction,
  primaryActionLabel = 'apply',
  primaryActionKey = 'a',
  onCancel,
}: BudgetPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedPreset, setSelectedPreset] = useState(0);

  // Edit-limits state
  const [editFieldIndex, setEditFieldIndex] = useState(0);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [editOnExceeded, setEditOnExceeded] = useState<'warn' | 'pause' | 'stop'>('warn');
  const [editingField, setEditingField] = useState(false);
  // Total fields = EDIT_FIELDS.length + 1 (onExceeded row)
  const totalEditRows = EDIT_FIELDS.length + 1;
  const primaryKey = (primaryActionKey || 'a').trim().toLowerCase() || 'a';

  const presetKeys = Object.keys(PRESET_LIMITS) as (keyof typeof PRESET_LIMITS)[];

  // Reset edit state when config or status changes externally
  useEffect(() => {
    if (mode !== 'overview') {
      setMode('overview');
    }
  }, [config, sessionStatus]);

  function initEditValues() {
    const limits = config.session || {};
    const values: Record<string, string> = {};
    for (const field of EDIT_FIELDS) {
      const stored = limits[field.key] as number | undefined;
      values[field.key] = stored ? String(field.toDisplay(stored)) : '';
    }
    setEditValues(values);
    setEditOnExceeded((config.onExceeded as 'warn' | 'pause' | 'stop') || 'warn');
    setEditFieldIndex(0);
    setEditingField(false);
  }

  function saveEditValues() {
    const newLimits: Partial<BudgetLimits> = {};
    for (const field of EDIT_FIELDS) {
      const raw = editValues[field.key];
      if (!raw || raw.trim() === '') {
        (newLimits as Record<string, number | undefined>)[field.key] = undefined;
        continue;
      }

      const num = parseInt(raw, 10);
      if (!isNaN(num) && num > 0) {
        (newLimits as Record<string, number>)[field.key] = field.toStored(num);
      } else {
        (newLimits as Record<string, number | undefined>)[field.key] = undefined;
      }
    }
    onSetLimits('session', newLimits);
    // Persist onExceeded action
    if (onSetOnExceeded) {
      onSetOnExceeded(editOnExceeded);
    }
    setMode('overview');
  }

  useInput((input, key) => {
    // Edit-limits mode
    if (mode === 'edit-limits') {
      if (editingField) {
        // Currently editing a field value
        if (key.return) {
          setEditingField(false);
          return;
        }
        if (key.escape) {
          setEditingField(false);
          return;
        }
        if (key.backspace || key.delete) {
          const fieldKey = editFieldIndex < EDIT_FIELDS.length ? EDIT_FIELDS[editFieldIndex].key : null;
          if (fieldKey) {
            setEditValues((prev) => ({
              ...prev,
              [fieldKey]: (prev[fieldKey] || '').slice(0, -1),
            }));
          }
          return;
        }
        // Only accept digits for numeric fields
        if (editFieldIndex < EDIT_FIELDS.length && /^\d$/.test(input)) {
          const fieldKey = EDIT_FIELDS[editFieldIndex].key;
          setEditValues((prev) => ({
            ...prev,
            [fieldKey]: (prev[fieldKey] || '') + input,
          }));
          return;
        }
        return;
      }

      // Not currently editing - navigation mode
      if (onPrimaryAction && input.toLowerCase() === primaryKey) {
        onPrimaryAction();
        return;
      }
      if (key.upArrow) {
        setEditFieldIndex((prev) => (prev === 0 ? totalEditRows - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setEditFieldIndex((prev) => (prev >= totalEditRows - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return || input === ' ') {
        if (editFieldIndex < EDIT_FIELDS.length) {
          // Start editing a numeric field
          setEditingField(true);
        } else {
          // Cycle onExceeded option
          const currentIdx = ON_EXCEEDED_OPTIONS.indexOf(editOnExceeded);
          setEditOnExceeded(ON_EXCEEDED_OPTIONS[(currentIdx + 1) % ON_EXCEEDED_OPTIONS.length]);
        }
        return;
      }
      // Clear field value
      if (input === 'c' || input === 'C') {
        if (editFieldIndex < EDIT_FIELDS.length) {
          const fieldKey = EDIT_FIELDS[editFieldIndex].key;
          setEditValues((prev) => ({ ...prev, [fieldKey]: '' }));
        }
        return;
      }
      // Save
      if (input === 's' || input === 'S') {
        saveEditValues();
        return;
      }
      // Cancel / back
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        return;
      }
      if (input === 'q' || input === 'Q') {
        onCancel();
        return;
      }
      return;
    }

    // Preset selection mode
    if (mode === 'preset-select') {
      if (onPrimaryAction && input.toLowerCase() === primaryKey) {
        onPrimaryAction();
        return;
      }
      if (key.upArrow) {
        setSelectedPreset((prev) => (prev === 0 ? presetKeys.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedPreset((prev) => (prev >= presetKeys.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return || input === ' ') {
        const preset = PRESET_LIMITS[presetKeys[selectedPreset]];
        onSetLimits('session', preset.session);
        onToggleEnabled(true);
        setMode('overview');
        return;
      }
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        return;
      }
      if (input === 'q' || input === 'Q') {
        onCancel();
        return;
      }
      return;
    }

    // Overview mode shortcuts
    if (mode === 'overview') {
      if (onPrimaryAction && input.toLowerCase() === primaryKey) {
        onPrimaryAction();
        return;
      }
      // Toggle enabled
      if (input === 'e' || input === 'E') {
        onToggleEnabled(true);
        return;
      }
      if (input === 'd' || input === 'D') {
        onToggleEnabled(false);
        return;
      }

      // Reset usage
      if (input === 'r' || input === 'R') {
        onReset('session');
        return;
      }

      // View limits
      if (input === 'l' || input === 'L') {
        setMode('limits');
        return;
      }

      // Set preset
      if (input === 'p' || input === 'P') {
        setMode('preset-select');
        return;
      }

      // Edit limits
      if (key.return || input === 'i' || input === 'I') {
        initEditValues();
        setMode('edit-limits');
        return;
      }
    }

    // Limits mode
    if (mode === 'limits') {
      if (onPrimaryAction && input.toLowerCase() === primaryKey) {
        onPrimaryAction();
        return;
      }
      if (input === 'i' || input === 'I' || key.return) {
        initEditValues();
        setMode('edit-limits');
        return;
      }
      if (key.escape || input === 'b' || input === 'B') {
        setMode('overview');
        return;
      }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }
  }, { isActive: true });

  // Edit-limits mode
  if (mode === 'edit-limits') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Edit Budget Limits</Text>
          <Text dimColor> (session scope)</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          {EDIT_FIELDS.map((field, index) => {
            const isSelected = index === editFieldIndex;
            const value = editValues[field.key] || '';
            const isEditing = isSelected && editingField;

            return (
              <Box key={field.key} gap={1}>
                <Text inverse={isSelected}>
                  {isSelected ? '>' : ' '}
                </Text>
                <Text bold={isSelected} dimColor={!isSelected}>
                  {field.label.padEnd(20)}
                </Text>
                <Box minWidth={15}>
                  {isEditing ? (
                    <Text>
                      <Text color="cyan">{value}</Text>
                      <Text color="cyan" bold>_</Text>
                      <Text dimColor> {field.unit}</Text>
                    </Text>
                  ) : (
                    <Text color={value ? undefined : 'gray'}>
                      {value || 'unlimited'}
                      {value ? <Text dimColor> {field.unit}</Text> : null}
                    </Text>
                  )}
                </Box>
              </Box>
            );
          })}

          {/* On Exceeded row */}
          <Box gap={1} marginTop={1}>
            <Text inverse={editFieldIndex === EDIT_FIELDS.length}>
              {editFieldIndex === EDIT_FIELDS.length ? '>' : ' '}
            </Text>
            <Text bold={editFieldIndex === EDIT_FIELDS.length} dimColor={editFieldIndex !== EDIT_FIELDS.length}>
              {'On Exceeded'.padEnd(20)}
            </Text>
            <Text color={editOnExceeded === 'stop' ? 'red' : editOnExceeded === 'pause' ? 'yellow' : 'cyan'}>
              {editOnExceeded}
            </Text>
            {editFieldIndex === EDIT_FIELDS.length && (
              <Text dimColor> (Enter to cycle)</Text>
            )}
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            {editingField
              ? 'Type digits | Enter/Esc to confirm'
              : `↑↓ navigate | Enter to edit | [c]lear | [s]ave | [b]ack | [q]uit${onPrimaryAction ? ` | [${primaryKey}] ${primaryActionLabel}` : ''}`}
          </Text>
        </Box>
      </Box>
    );
  }

  // Preset selection mode
  if (mode === 'preset-select') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Select Budget Preset</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          {presetKeys.map((key, index) => {
            const preset = PRESET_LIMITS[key];
            const isSelected = index === selectedPreset;
            return (
              <Box key={key} marginBottom={index < presetKeys.length - 1 ? 1 : 0}>
                <Text inverse={isSelected}>
                  {isSelected ? '>' : ' '} <Text bold={isSelected}>{preset.name.padEnd(12)}</Text>
                  <Text dimColor={!isSelected}>{preset.description}</Text>
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ navigate | Enter to select | [b]ack | [q]uit
            {onPrimaryAction ? ` | [${primaryKey}] ${primaryActionLabel}` : ''}
          </Text>
        </Box>
      </Box>
    );
  }

  // Limits mode
  if (mode === 'limits') {
    const limits = config.session || {};

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Budget Limits</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box marginBottom={1}>
            <Text bold>Session Limits:</Text>
          </Box>

          <Box paddingLeft={1} flexDirection="column">
            <Box>
              <Text dimColor>Max Total Tokens: </Text>
              <Text>{limits.maxTotalTokens ? formatNumber(limits.maxTotalTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Input Tokens: </Text>
              <Text>{limits.maxInputTokens ? formatNumber(limits.maxInputTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Output Tokens: </Text>
              <Text>{limits.maxOutputTokens ? formatNumber(limits.maxOutputTokens) : 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max LLM Calls: </Text>
              <Text>{limits.maxLlmCalls ?? 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Tool Calls: </Text>
              <Text>{limits.maxToolCalls ?? 'unlimited'}</Text>
            </Box>
            <Box>
              <Text dimColor>Max Duration: </Text>
              <Text>{limits.maxDurationMs ? formatDuration(limits.maxDurationMs) : 'unlimited'}</Text>
            </Box>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>On Exceeded: </Text>
            <Text color={config.onExceeded === 'stop' ? 'red' : config.onExceeded === 'pause' ? 'yellow' : 'cyan'}>
              {config.onExceeded || 'warn'}
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            [i] edit | [b]ack | [q]uit
            {onPrimaryAction ? ` | [${primaryKey}] ${primaryActionLabel}` : ''}
          </Text>
        </Box>
      </Box>
    );
  }

  // Overview mode (default)
  const { usage, limits, overallExceeded } = sessionStatus;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Budget</Text>
        <Text color={config.enabled ? 'green' : 'red'}>
          {config.enabled ? 'Enforcing' : 'Disabled'}
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
        {/* Status */}
        <Box marginBottom={1}>
          <Text bold>Status: </Text>
          <Text color={overallExceeded ? 'red' : config.enabled ? 'green' : 'gray'}>
            {overallExceeded ? 'EXCEEDED' : config.enabled ? 'Within limits' : 'Not enforcing'}
          </Text>
        </Box>

        {/* Usage */}
        <Box flexDirection="column">
          <Text bold dimColor>Session Usage:</Text>

          <Box marginTop={1} flexDirection="column">
            {/* Tokens */}
            <Box>
              <Text>{'Tokens:'.padEnd(15)}</Text>
              <Text>{formatNumber(usage.totalTokens).padStart(8)}</Text>
              {limits.maxTotalTokens && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{formatNumber(limits.maxTotalTokens)}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.totalTokens} limit={limits.maxTotalTokens} />
            </Box>

            {/* LLM Calls */}
            <Box>
              <Text>{'LLM Calls:'.padEnd(15)}</Text>
              <Text>{String(usage.llmCalls).padStart(8)}</Text>
              {limits.maxLlmCalls && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{limits.maxLlmCalls}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.llmCalls} limit={limits.maxLlmCalls} />
            </Box>

            {/* Tool Calls */}
            <Box>
              <Text>{'Tool Calls:'.padEnd(15)}</Text>
              <Text>{String(usage.toolCalls).padStart(8)}</Text>
              {limits.maxToolCalls && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{limits.maxToolCalls}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.toolCalls} limit={limits.maxToolCalls} />
            </Box>

            {/* Duration */}
            <Box>
              <Text>{'Duration:'.padEnd(15)}</Text>
              <Text>{formatDuration(usage.durationMs).padStart(8)}</Text>
              {limits.maxDurationMs && (
                <>
                  <Text dimColor> / </Text>
                  <Text>{formatDuration(limits.maxDurationMs)}</Text>
                </>
              )}
              <Text>  </Text>
              <UsageBar used={usage.durationMs} limit={limits.maxDurationMs} />
            </Box>
          </Box>
        </Box>

        {/* Warnings */}
        {sessionStatus.warningsCount > 0 && (
          <Box marginTop={1}>
            <Text color="yellow">! {sessionStatus.warningsCount} warning{sessionStatus.warningsCount !== 1 ? 's' : ''}</Text>
          </Box>
        )}

        {/* Exceeded */}
        {overallExceeded && (
          <Box marginTop={1}>
            <Text color="red" bold>Budget exceeded! Action: {config.onExceeded || 'warn'}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          [e]nable [d]isable [r]eset [l]imits [p]reset [i] edit | [q]uit
          {onPrimaryAction ? ` | [${primaryKey}] ${primaryActionLabel}` : ''}
        </Text>
      </Box>
    </Box>
  );
}
