import React, { useEffect, useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { HookEvent, HookMatcher, HookHandler, HookConfig, NativeHook } from '@hasna/assistants-shared';
import type { HookLocation } from '@hasna/assistants-core';
import { HookWizard } from './HookWizard';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface NativeHookInfo {
  hook: NativeHook;
  event: HookEvent;
  enabled: boolean;
}

interface HooksPanelProps {
  hooks: HookConfig;
  nativeHooks?: NativeHookInfo[];
  onToggle: (event: HookEvent, hookId: string, enabled: boolean) => void;
  onToggleNative?: (hookId: string, enabled: boolean) => void;
  onDelete: (event: HookEvent, hookId: string) => Promise<void>;
  onAdd: (event: HookEvent, handler: HookHandler, location: HookLocation, matcher?: string) => Promise<void>;
  onGenerateDraft?: (prompt: string) => Promise<HookDraft>;
  onCancel: () => void;
}

interface FlattenedHook {
  event: HookEvent;
  matcherIndex: number;
  hookIndex: number;
  matcher: string | undefined;
  hook: HookHandler;
}

const HOOK_EVENTS: HookEvent[] = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'SubassistantStart',
  'SubassistantStop',
  'PreCompact',
  'Stop',
];

type HookDraft = {
  event?: HookEvent;
  matcher?: string;
  type?: 'command' | 'prompt' | 'assistant';
  command?: string;
  timeout?: number;
  async?: boolean;
  name?: string;
  description?: string;
  location?: HookLocation;
};
type Mode = 'list' | 'delete-confirm' | 'wizard' | 'prompt';

export function HooksPanel({
  hooks,
  nativeHooks = [],
  onToggle,
  onToggleNative,
  onDelete,
  onAdd,
  onGenerateDraft,
  onCancel,
}: HooksPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [promptError, setPromptError] = useState<string | null>(null);
  const [wizardInitial, setWizardInitial] = useState<HookDraft | null>(null);
  const [wizardStartStep, setWizardStartStep] = useState<'confirm' | 'event' | 'command'>('event');
  const [isGenerating, setIsGenerating] = useState(false);

  // Flatten hooks into a navigable list grouped by event
  const flattenedHooks = useMemo(() => {
    const items: FlattenedHook[] = [];
    for (const event of HOOK_EVENTS) {
      const matchers = hooks[event] ?? [];
      for (let mi = 0; mi < matchers.length; mi++) {
        const matcher = matchers[mi];
        for (let hi = 0; hi < matcher.hooks.length; hi++) {
          items.push({
            event: event as HookEvent,
            matcherIndex: mi,
            hookIndex: hi,
            matcher: matcher.matcher,
            hook: matcher.hooks[hi],
          });
        }
      }
    }
    return items;
  }, [hooks]);

  // Group by event for display
  const groupedHooks = useMemo(() => {
    const groups: Map<HookEvent, FlattenedHook[]> = new Map();
    for (const item of flattenedHooks) {
      if (!groups.has(item.event)) {
        groups.set(item.event, []);
      }
      groups.get(item.event)!.push(item);
    }
    return groups;
  }, [flattenedHooks]);

  // Total items for navigation
  const totalItems = nativeHooks.length + flattenedHooks.length;

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  // Get selected item info
  const isNativeSelected = selectedIndex < nativeHooks.length;
  const selectedNativeHook = isNativeSelected ? nativeHooks[selectedIndex] : null;
  const selectedUserHook = !isNativeSelected ? flattenedHooks[selectedIndex - nativeHooks.length] : null;

  useInput((input, key) => {
    if (mode === 'prompt') {
      if (key.escape) {
        setMode('list');
        setPromptError(null);
      }
      return;
    }
    // In delete confirmation mode
    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        const item = flattenedHooks[selectedIndex - nativeHooks.length];
        if (item && item.hook.id) {
          setIsSubmitting(true);
          onDelete(item.event, item.hook.id).finally(() => {
            setIsSubmitting(false);
            setMode('list');
          });
        } else {
          setMode('list');
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    // List mode shortcuts
    if (input === 'e' || input === 'E') {
      // Enable hook
      if (isNativeSelected && selectedNativeHook) {
        onToggleNative?.(selectedNativeHook.hook.id, true);
      } else if (selectedUserHook && selectedUserHook.hook.id) {
        onToggle(selectedUserHook.event, selectedUserHook.hook.id, true);
      }
      return;
    }

    if (input === 'd' || input === 'D') {
      // Disable hook
      if (isNativeSelected && selectedNativeHook) {
        onToggleNative?.(selectedNativeHook.hook.id, false);
      } else if (selectedUserHook && selectedUserHook.hook.id) {
        onToggle(selectedUserHook.event, selectedUserHook.hook.id, false);
      }
      return;
    }

    if (input === 'x' || input === 'X') {
      // Delete hook (only user hooks can be deleted)
      if (!isNativeSelected && selectedUserHook) {
        setMode('delete-confirm');
      }
      return;
    }

    if (input === 'a' || input === 'A') {
      // Add new hook
      setWizardInitial(null);
      setWizardStartStep('event');
      setMode('wizard');
      return;
    }

    if (input === 'p' || input === 'P') {
      // Add new hook via prompt
      setPromptValue('');
      setPromptError(null);
      setMode('prompt');
      return;
    }

    // Escape or q: cancel
    if (key.escape || input === 'q' || input === 'Q') {
      onCancel();
      return;
    }

    // Arrow navigation with wraparound
    if (key.upArrow) {
      if (totalItems === 0) return;
      setSelectedIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
      return;
    }

    if (key.downArrow) {
      if (totalItems === 0) return;
      setSelectedIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
      return;
    }
  }, { isActive: true });

  // Get the selected hook for details (use the computed values from above)
  const selectedHook = selectedUserHook;

  // Format hook name
  const getHookName = (hook: HookHandler): string => {
    if (hook.name) return hook.name;
    if (hook.command) {
      const cmd = hook.command.slice(0, 25);
      return cmd + (hook.command.length > 25 ? '...' : '');
    }
    if (hook.prompt) {
      const p = hook.prompt.slice(0, 25);
      return p + (hook.prompt.length > 25 ? '...' : '');
    }
    return hook.type;
  };

  // Format hook type badge
  const getTypeBadge = (type: string): string => {
    switch (type) {
      case 'command': return 'cmd';
      case 'prompt': return 'llm';
      case 'assistant': return 'ast';
      default: return type.slice(0, 3);
    }
  };

  // Delete confirmation mode
  if (mode === 'delete-confirm') {
    const item = flattenedHooks[selectedIndex - nativeHooks.length];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Hook</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Are you sure you want to delete &quot;{getHookName(item?.hook ?? { type: 'command' })}&quot;?
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Wizard mode
  if (mode === 'wizard') {
    return (
      <HookWizard
        initial={wizardInitial ?? undefined}
        startStep={wizardStartStep}
        onSave={async (event, handler, location, matcher) => {
          await onAdd(event, handler, location, matcher);
          setMode('list');
        }}
        onCancel={() => setMode('list')}
      />
    );
  }

  if (mode === 'prompt') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Create Hook from Prompt</Text>
        </Box>
        <Text dimColor>Describe the behavior you want (event, matcher, action).</Text>
        <Box marginTop={1}>
          <Text>Prompt: </Text>
          <TextInput
            value={promptValue}
            onChange={(value) => {
              setPromptValue(value);
              setPromptError(null);
            }}
            onSubmit={async () => {
              const prompt = promptValue.trim();
              if (!prompt) {
                setPromptError('Prompt is required');
                return;
              }
              if (!onGenerateDraft) {
                setPromptError('Hook generation is not available.');
                return;
              }
              setIsGenerating(true);
              setPromptError(null);
              try {
                const draft = await onGenerateDraft(prompt);
                setWizardInitial(draft);
                setWizardStartStep(draft.command ? 'confirm' : 'command');
                setMode('wizard');
              } catch (err) {
                setPromptError(err instanceof Error ? err.message : String(err));
              } finally {
                setIsGenerating(false);
              }
            }}
            focus
            placeholder="e.g. Block dangerous bash commands like rm -rf"
          />
        </Box>
        {promptError && (
          <Box marginTop={1}>
            <Text color="red">{promptError}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Enter generate | Esc back</Text>
        </Box>
        {isGenerating && (
          <Box marginTop={1}>
            <Text color="yellow">Generating hook draft...</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Total hooks count
  const totalHooks = flattenedHooks.length + nativeHooks.length;

  // List mode UI
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Hooks</Text>
        <Text dimColor>{totalHooks} hook{totalHooks !== 1 ? 's' : ''}</Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="#d4d4d8" borderLeft={false} borderRight={false}
        paddingX={1}
        height={Math.min(18, totalHooks + 4)}
        overflowY="hidden"
      >
        {/* Native Hooks Section */}
        {nativeHooks.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold color="cyan">Native</Text>
              <Text dimColor> ({nativeHooks.length})</Text>
            </Box>
            {nativeHooks.map((item, index) => {
              const isSelected = index === selectedIndex && selectedIndex < nativeHooks.length;
              return (
                <Box key={item.hook.id} paddingLeft={2}>
                  <Text
                    inverse={isSelected}
                    color={item.enabled ? undefined : 'gray'}
                  >
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={item.enabled ? 'green' : 'red'}>[{item.enabled ? 'on ' : 'off'}]</Text>{' '}
                    <Text bold={isSelected}>{(item.hook.name || item.hook.id).padEnd(22)}</Text>{' '}
                    <Text dimColor>nat</Text>{' '}
                    <Text dimColor>@{item.event}</Text>
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}

        {/* User Hooks Section */}
        {flattenedHooks.length === 0 && nativeHooks.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No hooks configured.</Text>
          </Box>
        ) : flattenedHooks.length > 0 ? (
          <>
            <Box>
              <Text bold dimColor>User Hooks</Text>
              <Text dimColor> ({flattenedHooks.length})</Text>
            </Box>
            {/* Render grouped by event */}
            {Array.from(groupedHooks.entries()).map(([event, eventHooks]) => (
              <Box key={event} flexDirection="column">
                <Box paddingLeft={1}>
                  <Text bold dimColor>{event}</Text>
                  <Text dimColor> ({eventHooks.length})</Text>
                </Box>
                {eventHooks.map((item) => {
                  const globalIndex = flattenedHooks.indexOf(item) + nativeHooks.length;
                  const isSelected = globalIndex === selectedIndex;
                  const isEnabled = item.hook.enabled !== false;

                  return (
                    <Box key={item.hook.id ?? `${item.matcherIndex}-${item.hookIndex}`} paddingLeft={2}>
                      <Text
                        inverse={isSelected}
                        color={isEnabled ? undefined : 'gray'}
                      >
                        {isSelected ? '>' : ' '}{' '}
                        <Text color={isEnabled ? 'green' : 'red'}>[{isEnabled ? 'on ' : 'off'}]</Text>{' '}
                        <Text bold={isSelected}>{getHookName(item.hook).padEnd(22)}</Text>{' '}
                        <Text dimColor>{getTypeBadge(item.hook.type)}</Text>{' '}
                        {item.matcher && <Text dimColor>@{item.matcher}</Text>}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </>
        ) : null}
      </Box>

      {/* Selected native hook details */}
      {selectedNativeHook && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>Type: </Text>
            <Text color="cyan">native</Text>
          </Box>
          <Box>
            <Text dimColor>Event: </Text>
            <Text>{selectedNativeHook.event}</Text>
          </Box>
          <Box>
            <Text dimColor>ID: </Text>
            <Text>{selectedNativeHook.hook.id}</Text>
          </Box>
          {selectedNativeHook.hook.description && (
            <Box>
              <Text dimColor>Description: </Text>
              <Text>{selectedNativeHook.hook.description}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Selected user hook details */}
      {selectedHook && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>Type: </Text>
            <Text>{selectedHook.hook.type}</Text>
            {selectedHook.hook.async && <Text color="yellow"> (async)</Text>}
          </Box>
          {selectedHook.matcher && (
            <Box>
              <Text dimColor>Matcher: </Text>
              <Text>{selectedHook.matcher}</Text>
            </Box>
          )}
          {selectedHook.hook.description && (
            <Box>
              <Text dimColor>Description: </Text>
              <Text>{selectedHook.hook.description}</Text>
            </Box>
          )}
          {selectedHook.hook.command && (
            <Box>
              <Text dimColor>Command: </Text>
              <Text>{selectedHook.hook.command.slice(0, 50)}{selectedHook.hook.command.length > 50 ? '...' : ''}</Text>
            </Box>
          )}
          {selectedHook.hook.timeout && (
            <Box>
              <Text dimColor>Timeout: </Text>
              <Text>{selectedHook.hook.timeout}ms</Text>
            </Box>
          )}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          [a]dd [p]rompt [e]nable [d]isable {!isNativeSelected && '[x]delete '} [q]uit | ↑↓ navigate
        </Text>
      </Box>
    </Box>
  );
}
