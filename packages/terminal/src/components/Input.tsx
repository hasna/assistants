import React, { useEffect, useMemo, useState, useRef, useCallback, useImperativeHandle } from 'react';
import { Box, Text, useStdout } from 'ink';
import { buildLayout, moveCursorVertical, type InputLayout } from './inputLayout';
import { CommandHistory, getCommandHistory } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

// Deterministic color palette for assistant badges (white text on colored bg)
const ASSISTANT_COLORS = [
  '#6B4C9A', // purple
  '#2E86AB', // cerulean
  '#A23B72', // mulberry
  '#1B813E', // forest
  '#C1440E', // rust
  '#5B5EA6', // indigo
  '#9B2335', // crimson
  '#2D6A4F', // teal green
  '#7C4DFF', // violet
  '#D4621B', // tangerine
];

function getAssistantColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return ASSISTANT_COLORS[Math.abs(hash) % ASSISTANT_COLORS.length];
}

// Available commands with descriptions
const COMMANDS = [
  // Core commands
  { name: '/help', description: 'show available commands' },
  { name: '/clear', description: 'clear the conversation' },
  { name: '/new', description: 'start a new conversation' },
  { name: '/exit', description: 'exit assistants' },
  // Session management
  { name: '/sessions', description: 'list/switch sessions (Ctrl+])' },
  { name: '/status', description: 'show session status' },
  { name: '/tokens', description: 'show token usage' },
  { name: '/cost', description: 'show estimated API cost' },
  { name: '/model', description: 'select or switch model interactively' },
  { name: '/compact', description: 'summarize to save context' },
  // Skills and tools
  { name: '/skills', description: 'browse, create, and manage skills' },
  { name: '/connectors', description: 'list available connectors' },
  // Configuration
  { name: '/config', description: 'show configuration' },
  { name: '/init', description: 'initialize assistants in project' },
  { name: '/memory', description: 'show what AI remembers' },
  { name: '/context', description: 'manage injected project context' },
  { name: '/hooks', description: 'manage hooks (list, add, remove, test)' },
  { name: '/onboarding', description: 'rerun onboarding setup' },
  // Projects and plans
  { name: '/projects', description: 'manage projects in this folder' },
  { name: '/plans', description: 'manage project plans' },
  // Scheduling
  { name: '/schedules', description: 'manage scheduled commands' },
  // Budgets
  { name: '/budgets', description: 'manage budget profiles' },
  // Identity and assistant
  { name: '/assistants', description: 'switch or list assistants' },
  { name: '/identity', description: 'manage assistant identity' },
  { name: '/whoami', description: 'show current identity' },
  // Voice features
  { name: '/voice', description: 'toggle voice mode' },
  { name: '/say', description: 'speak text aloud' },
  { name: '/talk', description: 'live voice conversation (2s pause to send)' },
  // Assistant communication
  { name: '/messages', description: 'assistant messaging and email inbox' },
  { name: '/communication', description: 'manage calls, SMS, WhatsApp, routing' },
  // Resources
  { name: '/wallet', description: 'manage assistant wallet' },
  { name: '/secrets', description: 'manage assistant secrets' },
  { name: '/jobs', description: 'manage background jobs' },
  { name: '/contacts', description: 'manage contacts address book' },
  { name: '/docs', description: 'interactive app documentation' },
  // Git
  { name: '/diff', description: 'show git diff of changes' },
  { name: '/undo', description: 'revert uncommitted changes' },
  // System
  { name: '/rest', description: 'enter rest mode' },
  { name: '/logs', description: 'view security event logs' },
  { name: '/verification', description: 'scope verification status' },
  { name: '/feedback', description: 'submit feedback on GitHub' },
];

interface SkillInfo {
  name: string;
  description: string;
  argumentHint?: string;
}

// Default paste threshold configuration (can be overridden via props)
const DEFAULT_PASTE_THRESHOLDS = {
  chars: 500,
  words: 100,
  lines: 20,
};

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countLines(text: string): number {
  return text.split('\n').length;
}

function formatPastePlaceholder(text: string): string {
  const chars = text.length;
  const words = countWords(text);
  return `📋 Pasted ${words.toLocaleString()} words / ${chars.toLocaleString()} chars`;
}

interface PasteThresholds {
  chars?: number;
  words?: number;
  lines?: number;
}

function isLargePaste(text: string, thresholds: PasteThresholds = DEFAULT_PASTE_THRESHOLDS): boolean {
  const charThreshold = thresholds.chars ?? DEFAULT_PASTE_THRESHOLDS.chars;
  const wordThreshold = thresholds.words ?? DEFAULT_PASTE_THRESHOLDS.words;
  const lineThreshold = thresholds.lines ?? DEFAULT_PASTE_THRESHOLDS.lines;

  return (
    text.length > charThreshold ||
    countWords(text) > wordThreshold ||
    countLines(text) > lineThreshold
  );
}

interface PasteConfig {
  /** Whether large paste handling is enabled (default: true) */
  enabled?: boolean;
  /** Paste detection thresholds */
  thresholds?: PasteThresholds;
  /** Display mode: 'placeholder' (default), 'preview', 'confirm', 'inline' */
  mode?: 'placeholder' | 'preview' | 'confirm' | 'inline';
}

interface InputProps {
  onSubmit: (value: string, mode: 'normal' | 'interrupt' | 'queue' | 'inline') => void;
  onStopProcessing?: () => void;
  isProcessing?: boolean;
  queueLength?: number;
  commands?: { name: string; description: string }[];
  skills?: SkillInfo[];
  isAskingUser?: boolean;
  askPlaceholder?: string;
  allowBlankAnswer?: boolean;
  /** Active assistant name shown on the top-right of the input border */
  assistantName?: string;
  /** Optional command history instance (uses global singleton if not provided) */
  history?: CommandHistory;
  /** Optional paste handling configuration */
  pasteConfig?: PasteConfig;
  /** Whether push-to-talk recording is active */
  isRecording?: boolean;
  /** Recording status: 'recording', 'transcribing', or 'talking' */
  recordingStatus?: 'recording' | 'transcribing' | 'talking' | null;
  /** Callback to stop recording (e.g. when Enter is pressed during recording) */
  onStopRecording?: () => void;
  /** Callback to search files for @ autocomplete */
  onFileSearch?: (query: string) => string[];
  /** Live partial transcript from streaming STT (talk mode) */
  partialTranscript?: string;
}

export interface InputHandle {
  setValue: (value: string, cursor?: number, resetHistory?: boolean) => void;
  appendValue: (text: string) => void;
  clearValue: () => void;
  getValue: () => string;
}

export const Input = React.forwardRef<InputHandle, InputProps>(function Input({
  onSubmit,
  onStopProcessing,
  isProcessing,
  queueLength = 0,
  commands,
  skills = [],
  isAskingUser = false,
  askPlaceholder,
  allowBlankAnswer = false,
  assistantName,
  history: historyProp,
  pasteConfig,
  isRecording = false,
  recordingStatus,
  onStopRecording,
  onFileSearch,
  partialTranscript = '',
}: InputProps, ref) {
  // Paste handling configuration with defaults
  const pasteEnabled = pasteConfig?.enabled !== false;
  const pasteThresholds = pasteConfig?.thresholds ?? DEFAULT_PASTE_THRESHOLDS;
  const pasteMode = pasteConfig?.mode ?? 'placeholder';
  // Combined value+cursor state for atomic updates during rapid paste operations
  // When text is pasted, it may arrive in multiple chunks; using a single state
  // object ensures each chunk sees the correct previous state via functional updates
  const [inputState, setInputState] = useState({ value: '', cursor: 0 });
  const { value, cursor } = inputState;

  // Large paste handling - when a large paste is detected, we show a placeholder
  // but keep the actual content stored for submission
  const [largePaste, setLargePaste] = useState<{
    content: string;
    placeholder: string;
  } | null>(null);
  const [showPastePreview, setShowPastePreview] = useState(false);

  // Command history - use prop or global singleton
  const historyRef = useRef<CommandHistory>(historyProp || getCommandHistory());
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Track whether we've modified the input since starting history navigation
  const [savedInput, setSavedInput] = useState<string>('');

  // Load history on mount
  useEffect(() => {
    historyRef.current.load().then(() => {
      setHistoryLoaded(true);
    });
  }, []);

  // Helpers for setting value/cursor together (atomic) or separately
  const setValue = (newValue: string | ((prev: string) => string)) => {
    setInputState(prev => ({
      ...prev,
      value: typeof newValue === 'function' ? newValue(prev.value) : newValue,
    }));
  };
  const setCursor = (newCursor: number | ((prev: number) => number)) => {
    setInputState(prev => ({
      ...prev,
      cursor: typeof newCursor === 'function' ? newCursor(prev.cursor) : newCursor,
    }));
  };

  const [preferredColumn, setPreferredColumn] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { stdout } = useStdout();
  const screenWidth = stdout?.columns ?? 80;
  const textWidth = Math.max(10, screenWidth - 4);

  // Merge built-in commands with passed commands
  const allCommands = useMemo(() => {
    const merged = [...COMMANDS];
    if (commands) {
      for (const cmd of commands) {
        if (!merged.find(c => c.name === cmd.name)) {
          merged.push(cmd);
        }
      }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [commands]);

  // Determine autocomplete mode
  const autocompleteMode = useMemo(() => {
    if (isAskingUser) return null;
    if (value.startsWith('$') && !value.includes(' ')) {
      return 'skill';
    }
    if (value.startsWith('/') && !value.includes(' ')) {
      return 'command';
    }
    // Detect @ file picker: @ at start or after a space
    if (onFileSearch) {
      const atMatch = value.match(/(?:^|.*\s)@([^\s]*)$/);
      if (atMatch) {
        return 'file';
      }
    }
    return null;
  }, [value, isAskingUser, onFileSearch]);

  // Filter commands based on input
  const filteredCommands = useMemo(() => {
    if (autocompleteMode !== 'command') return [];
    const search = value.toLowerCase();
    return allCommands.filter(cmd => cmd.name.toLowerCase().startsWith(search));
  }, [value, autocompleteMode, allCommands]);

  // Filter skills based on input
  const filteredSkills = useMemo(() => {
    if (autocompleteMode !== 'skill') return [];
    const search = value.slice(1).toLowerCase(); // Remove $ prefix
    return skills.filter(skill => skill.name.toLowerCase().startsWith(search));
  }, [value, autocompleteMode, skills]);

  // Extract file search query and filter files
  const fileSearchQuery = useMemo(() => {
    if (autocompleteMode !== 'file') return '';
    const atMatch = value.match(/(?:^|.*\s)@([^\s]*)$/);
    return atMatch ? atMatch[1] : '';
  }, [value, autocompleteMode]);

  const filteredFiles = useMemo(() => {
    if (autocompleteMode !== 'file' || !onFileSearch) return [];
    return onFileSearch(fileSearchQuery);
  }, [autocompleteMode, fileSearchQuery, onFileSearch]);

  // Combined items for selection
  const autocompleteItems: Array<{ name: string }> = autocompleteMode === 'skill'
    ? filteredSkills
    : autocompleteMode === 'file'
      ? filteredFiles.map(f => ({ name: f }))
      : filteredCommands;

  // Keep selected index in range when list size changes
  useEffect(() => {
    if (autocompleteItems.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((prev) => Math.min(prev, autocompleteItems.length - 1));
  }, [autocompleteItems.length]);

  const setValueAndCursor = useCallback((nextValue: string, nextCursor: number = nextValue.length, resetHistory: boolean = true) => {
    const normalized = normalizeLineEndings(nextValue);
    const clamped = Math.max(0, Math.min(nextCursor, normalized.length));
    setInputState({ value: normalized, cursor: clamped });
    setPreferredColumn(null);
    setSelectedIndex(0);
    // Reset history navigation when input changes (unless navigating history)
    if (resetHistory) {
      historyRef.current.resetIndex(normalized);
    }
  }, []);

  const clearLargePaste = useCallback(() => {
    setLargePaste(null);
    setShowPastePreview(false);
  }, []);

  useImperativeHandle(ref, () => ({
    setValue: (nextValue: string, nextCursor = nextValue.length, resetHistory = true) => {
      clearLargePaste();
      setValueAndCursor(nextValue, nextCursor, resetHistory);
    },
    appendValue: (text: string) => {
      const cleaned = normalizeLineEndings(text);
      if (!cleaned) return;
      clearLargePaste();
      setInputState(prev => {
        const newValue = prev.value + cleaned;
        historyRef.current.resetIndex(newValue);
        return {
          value: newValue,
          cursor: newValue.length,
        };
      });
      setPreferredColumn(null);
      setSelectedIndex(0);
    },
    clearValue: () => {
      clearLargePaste();
      setValueAndCursor('');
    },
    getValue: () => inputState.value,
  }), [clearLargePaste, setValueAndCursor, inputState.value]);


  const handleSubmit = (submittedValue: string) => {
    // If there's a large paste pending, use that content instead
    const rawValue = largePaste ? largePaste.content : submittedValue;
    const actualValue = normalizeLineEndings(rawValue);

    // Allow blank submission only for optional ask-user questions
    if (!actualValue.trim() && !allowBlankAnswer) return;

    // Add to history before submitting (use truncated version for history)
    const valueToAdd = actualValue.trim();
    if (valueToAdd && !isAskingUser) {
      // For large pastes, add a truncated version to history
      const historyEntry = largePaste
        ? `[Pasted ${countWords(valueToAdd)} words]`
        : valueToAdd;
      historyRef.current.add(historyEntry);
    }

    // Clear large paste state before submitting
    if (largePaste) {
      setLargePaste(null);
      setShowPastePreview(false);
    }

    if (
      autocompleteMode === 'command' &&
      filteredCommands.length > 0 &&
      !actualValue.includes(' ')
    ) {
      const selected = filteredCommands[selectedIndex] || filteredCommands[0];
      if (selected) {
        // Add the selected command to history instead
        historyRef.current.add(selected.name);
        onSubmit(selected.name, isProcessing ? 'inline' : 'normal');
        setValueAndCursor('');
        return;
      }
    }

    if (isProcessing) {
      onSubmit(actualValue, 'inline');
    } else {
      onSubmit(actualValue, 'normal');
    }
    setValueAndCursor('');
  };

  const moveCursorTo = (next: number, resetPreferred: boolean = true) => {
    const clamped = Math.max(0, Math.min(next, value.length));
    setCursor(clamped);
    if (resetPreferred) {
      setPreferredColumn(null);
    }
  };

  const moveCursorBy = (delta: number) => {
    moveCursorTo(cursor + delta);
  };

  const applyVerticalMove = (currentLayout: InputLayout, direction: -1 | 1) => {
    const result = moveCursorVertical(currentLayout, preferredColumn, direction);
    if (!result) return;
    setCursor(result.cursor);
    setPreferredColumn(result.preferredColumn);
  };

  const insertText = (text: string) => {
    const cleaned = normalizeLineEndings(text);
    if (!cleaned) return;

    // Detect large paste (multiple characters at once that exceed threshold)
    // A paste is detected when multiple characters arrive at once (text.length > 1)
    // and the total content exceeds the threshold
    // Only apply special handling if paste handling is enabled and mode is not 'inline'
    if (pasteEnabled && pasteMode !== 'inline' && cleaned.length > 1 && isLargePaste(cleaned, pasteThresholds)) {
      // Store the large paste content and show placeholder
      setLargePaste({
        content: cleaned,
        placeholder: formatPastePlaceholder(cleaned),
      });
      setShowPastePreview(false);
      // Reset history navigation so stale state doesn't persist
      historyRef.current.resetIndex(cleaned);
      return;
    }

    // Clear any pending large paste if user types normally
    if (largePaste) {
      setLargePaste(null);
      setShowPastePreview(false);
    }

    // Use functional update for atomic value+cursor change during rapid pastes
    setInputState(prev => {
      const newValue = prev.value.slice(0, prev.cursor) + cleaned + prev.value.slice(prev.cursor);
      // Reset history navigation when user types
      historyRef.current.resetIndex(newValue);
      return {
        value: newValue,
        cursor: prev.cursor + cleaned.length,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteBackward = () => {
    setInputState(prev => {
      if (prev.cursor === 0) return prev;
      const newValue = prev.value.slice(0, prev.cursor - 1) + prev.value.slice(prev.cursor);
      // Reset history navigation when user edits
      historyRef.current.resetIndex(newValue);
      return {
        value: newValue,
        cursor: prev.cursor - 1,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  const deleteForward = () => {
    setInputState(prev => {
      if (prev.cursor >= prev.value.length) return prev;
      const newValue = prev.value.slice(0, prev.cursor) + prev.value.slice(prev.cursor + 1);
      // Reset history navigation when user edits
      historyRef.current.resetIndex(newValue);
      return {
        value: newValue,
        cursor: prev.cursor,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  // Delete word backward (Ctrl+W) - standard terminal/readline behavior
  const deleteWordBackward = () => {
    setInputState(prev => {
      if (prev.cursor === 0) return prev;

      let start = prev.cursor - 1;

      // Skip trailing spaces/whitespace
      while (start >= 0 && /\s/.test(prev.value[start])) {
        start--;
      }

      // Find start of word (stop at space or beginning)
      while (start >= 0 && !/\s/.test(prev.value[start])) {
        start--;
      }

      // start is now at the space before the word (or -1 if at beginning)
      const newValue = prev.value.slice(0, start + 1) + prev.value.slice(prev.cursor);
      // Reset history navigation when user edits
      historyRef.current.resetIndex(newValue);
      return {
        value: newValue,
        cursor: start + 1,
      };
    });
    setPreferredColumn(null);
    setSelectedIndex(0);
  };

  // Handle keyboard input for autocomplete and editing
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (value.length > 0) {
        setValueAndCursor('');
      }
      return;
    }

    // Escape: clear large paste, clear input, or exit history mode (if not asking user)
    if (key.escape && !isAskingUser) {
      // In processing mode Esc is a hard stop signal for the active run.
      if (isProcessing && onStopProcessing) {
        onStopProcessing();
        return;
      }
      // First priority: cancel pending large paste
      if (largePaste) {
        setLargePaste(null);
        setShowPastePreview(false);
        return;
      }
      if (historyRef.current.isNavigating()) {
        // If navigating history, restore saved input
        setValueAndCursor(savedInput);
        setSavedInput('');
      } else if (value.length > 0) {
        setValueAndCursor('');
      }
      return;
    }

    // Ctrl+W: delete word backward (standard readline behavior)
    if (key.ctrl && input === 'w') {
      deleteWordBackward();
      return;
    }

    // Ctrl+U: clear line (standard readline behavior)
    if (key.ctrl && input === 'u') {
      setValueAndCursor('');
      return;
    }

    if (!isAskingUser) {
      // Tab: queue message while processing, or autocomplete when idle
      if (key.tab) {
        // When agent is processing, Tab always queues (takes priority over autocomplete)
        if (isProcessing && value.trim()) {
          onSubmit(value, 'queue');
          setValueAndCursor('');
          return;
        }
        if (autocompleteItems.length > 0) {
          const selected = autocompleteItems[selectedIndex] || autocompleteItems[0];
          if (autocompleteMode === 'file') {
            // Replace @query with the file path
            const atMatch = value.match(/^(.*(?:^|\s))@[^\s]*$/);
            const prefix = atMatch ? atMatch[1] : '';
            const nextValue = prefix + selected.name + ' ';
            setValueAndCursor(nextValue);
          } else {
            const nextValue = autocompleteMode === 'skill'
              ? `$${selected.name} `
              : `${selected.name} `;
            setValueAndCursor(nextValue);
          }
          return;
        }
      }

      // Arrow keys for autocomplete navigation (circular)
      // Only capture arrows for autocomplete when input is single-line
      if (autocompleteItems.length > 0 && !value.includes('\n')) {
        if (key.downArrow) {
          setSelectedIndex((prev) => (prev + 1) % autocompleteItems.length);
          return;
        }
        if (key.upArrow) {
          setSelectedIndex((prev) => (prev - 1 + autocompleteItems.length) % autocompleteItems.length);
          return;
        }
      }
    }

    const activeLayout = buildLayout(value, cursor, textWidth);

    if (key.leftArrow) {
      moveCursorBy(-1);
      return;
    }
    if (key.rightArrow) {
      moveCursorBy(1);
      return;
    }

    // Handle arrow up for history navigation
    if (key.upArrow) {
      // Navigate history if:
      // 1. Input is empty, OR
      // 2. Already navigating history, OR
      // 3. Cursor is on the first line of multi-line input
      const isOnFirstLine = activeLayout.cursorRow === 0;
      const shouldNavigateHistory = value.length === 0 || historyRef.current.isNavigating() || isOnFirstLine;

      if (shouldNavigateHistory && !isAskingUser) {
        // Save current input before navigating
        if (!historyRef.current.isNavigating()) {
          setSavedInput(value);
          historyRef.current.resetIndex(value);
        }
        const prev = historyRef.current.previous();
        if (prev !== null) {
          // Set value and cursor at end, don't reset history
          setValueAndCursor(prev, prev.length, false);
        }
        return;
      }

      // Otherwise, do vertical cursor movement for multi-line
      applyVerticalMove(activeLayout, -1);
      return;
    }

    // Handle arrow down for history navigation
    if (key.downArrow) {
      // Navigate history if:
      // 1. Already navigating history, OR
      // 2. Cursor is on the last line of multi-line input
      const isOnLastLine = activeLayout.cursorRow === activeLayout.displayLines.length - 1;
      const isNavigatingHistory = historyRef.current.isNavigating();

      if (isNavigatingHistory && !isAskingUser) {
        const next = historyRef.current.next();
        if (next !== null) {
          // Set value and cursor at end, don't reset history
          setValueAndCursor(next, next.length, false);
        }
        return;
      }

      // If on last line and not navigating history, do nothing (or could beep)
      if (!isOnLastLine) {
        applyVerticalMove(activeLayout, 1);
      }
      return;
    }
    if (key.home) {
      const line = activeLayout.displayLines[activeLayout.cursorRow];
      moveCursorTo(line.start, false);
      return;
    }
    if (key.end) {
      const line = activeLayout.displayLines[activeLayout.cursorRow];
      moveCursorTo(line.start + line.text.length, false);
      return;
    }
    // Handle backspace - multiple terminal variations:
    // - \x7f (DEL, ASCII 127) - what most modern terminals send for Backspace
    // - \x08 (BS, ASCII 8) - traditional backspace, some terminals still use this
    // - Ink sets key.delete for \x7f on Mac/Linux, key.backspace varies by terminal
    // We check raw codes first for cross-terminal reliability
    if (input === '\x7f' || input === '\x08' || key.backspace || key.delete) {
      deleteBackward();
      return;
    }
    // Handle forward delete key (Fn+Backspace on Mac, Delete on full keyboards)
    // This key sends the \x1b[3~ escape sequence, not \x7f
    if (input === '\x1b[3~') {
      deleteForward();
      return;
    }

    if (key.return) {
      // During push-to-talk recording, Enter stops recording
      if (isRecording && onStopRecording) {
        onStopRecording();
        return;
      }
      // Shift+Enter or Ctrl+Enter: interrupt and send immediately
      if ((key.shift || key.ctrl) && value.trim()) {
        onSubmit(value, 'interrupt');
        setValueAndCursor('');
        return;
      }
      // Meta+Enter: queue message
      if (key.meta && value.trim() && input !== '\x1b\r' && input !== '\x1b\n') {
        onSubmit(value, 'queue');
        setValueAndCursor('');
        return;
      }
      handleSubmit(value);
      setValueAndCursor('');
      return;
    }

    // Insert printable characters only (filter out control characters and DEL)
    const charCode = input?.charCodeAt(0) ?? 0;
    if (input && charCode >= 32 && charCode !== 127) {
      insertText(input);
    }
  });

  // Show different prompts based on state
  let placeholder = 'Type a message...';

  if (isAskingUser) {
    placeholder = askPlaceholder || 'Answer the question...';
  } else if (isProcessing) {
    placeholder = queueLength > 0
      ? 'Enter=inline | Tab=queue | Shift+Enter=interrupt'
      : 'Enter=send inline | Shift+Enter=interrupt';
  }

  // Truncate description to fit in terminal
  const truncateDescription = (desc: string, maxLen: number = 60) => {
    if (desc.length <= maxLen) return desc;
    return desc.slice(0, maxLen - 3) + '...';
  };

  // Autocomplete dropdown settings
  const maxVisible = 8;

  // Calculate visible window for scrolling
  const getVisibleItems = <T extends { name: string }>(items: T[]): { items: T[]; startIndex: number } => {
    if (items.length <= maxVisible) {
      return { items, startIndex: 0 };
    }

    // Keep selected item in view with some context
    let startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
    startIndex = Math.min(startIndex, items.length - maxVisible);

    return {
      items: items.slice(startIndex, startIndex + maxVisible),
      startIndex,
    };
  };

  const visibleSkills = getVisibleItems(filteredSkills);
  const visibleCommands = getVisibleItems(filteredCommands);
  const fileItems = useMemo(() => filteredFiles.map(f => ({ name: f })), [filteredFiles]);
  const visibleFiles = getVisibleItems(fileItems);

  const layout = buildLayout(value, cursor, textWidth);
  const lines = layout.displayLines;
  const lineCount = value.split('\n').length;
  return (
    <Box flexDirection="column" marginTop={0}>
      {/* Assistant name badge above the input box */}
      {assistantName && (
        <Box justifyContent="flex-end" marginBottom={0}>
          <Text backgroundColor={getAssistantColor(assistantName)} color="whiteBright" bold> {assistantName} </Text>
        </Box>
      )}

      {/* Input box with top/bottom border only (Claude Code style) */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderLeft={false}
        borderRight={false}
        borderColor="#d4d4d8"
      >
        {/* Recording indicator */}
        {recordingStatus === 'recording' && (
          <Box paddingY={0}>
            <Text color="red" bold>🎤 Recording... </Text>
            <Text dimColor>[Ctrl+R or Enter to stop]</Text>
          </Box>
        )}
        {recordingStatus === 'transcribing' && (
          <Box paddingY={0}>
            <Text color="yellow" bold>⏳ Transcribing...</Text>
          </Box>
        )}
        {recordingStatus === 'talking' && (
          <Box paddingY={0} flexDirection="column">
            <Box>
              <Text color="green" bold>🎙 Talk mode </Text>
              <Text dimColor>[listening... Ctrl+C to stop]</Text>
            </Box>
            {partialTranscript ? (
              <Box>
                <Text color="cyan" dimColor>{'> '}</Text>
                <Text color="white" italic>{partialTranscript}</Text>
              </Box>
            ) : null}
          </Box>
        )}

        {/* Input area */}
        {largePaste ? (
          /* Large paste placeholder view */
          <Box>
            <Text color={isProcessing ? 'gray' : 'cyan'}>&gt; </Text>
            <Box flexGrow={1}>
              <Text color="yellow">{largePaste.placeholder}</Text>
              <Text dimColor> [Enter to send, Esc to cancel]</Text>
            </Box>
          </Box>
        ) : value.length === 0 ? (
          <Box>
            <Text color={isProcessing ? 'gray' : 'cyan'}>&gt; </Text>
            <Box flexGrow={1}>
              <Text inverse> </Text>
              <Text dimColor>{placeholder}</Text>
            </Box>
          </Box>
        ) : (
          lines.map((line, index) => {
            const isCursorLine = index === layout.cursorRow;
            if (!isCursorLine) {
              return (
                <Box key={`line-${index}`}>
                  <Text color={isProcessing ? 'gray' : 'cyan'}>{index === 0 ? '> ' : '  '}</Text>
                  <Box flexGrow={1}>
                    <Text>{line.text || ' '}</Text>
                  </Box>
                </Box>
              );
            }
            const column = Math.min(layout.cursorCol, line.text.length);
            const before = line.text.slice(0, column);
            const cursorChar = column < line.text.length ? line.text[column] : ' ';
            const after = column < line.text.length ? line.text.slice(column + 1) : '';
            return (
              <Box key={`line-${index}`}>
                <Text color={isProcessing ? 'gray' : 'cyan'}>{index === 0 ? '> ' : '  '}</Text>
                <Box flexGrow={1}>
                  <Text>{before}</Text>
                  <Text inverse>{cursorChar}</Text>
                  <Text>{after}</Text>
                </Box>
              </Box>
            );
          })
        )}

        {/* Show line count if multiline */}
        {lineCount > 1 && (
          <Box>
            <Text color="gray">({lineCount} lines)</Text>
          </Box>
        )}
      </Box>

      {/* Skills autocomplete dropdown - below input */}
      {autocompleteMode === 'skill' && filteredSkills.length > 0 && (
        <Box flexDirection="column">
          {/* Scroll indicator - top */}
          {visibleSkills.startIndex > 0 && (
            <Text dimColor>  ↑ {visibleSkills.startIndex} more above</Text>
          )}
          {visibleSkills.items.map((skill, i) => {
            const actualIndex = visibleSkills.startIndex + i;
            return (
              <Box key={skill.name}>
                <Text color={actualIndex === selectedIndex ? 'cyan' : '#5fb3a1'}>
                  {actualIndex === selectedIndex ? '▸ ' : '  '}
                  {skill.name.padEnd(18)}
                </Text>
                <Text dimColor={actualIndex !== selectedIndex}>
                  {truncateDescription(skill.description)}
                </Text>
              </Box>
            );
          })}
          {/* Scroll indicator - bottom */}
          {visibleSkills.startIndex + maxVisible < filteredSkills.length && (
            <Text dimColor>  ↓ {filteredSkills.length - visibleSkills.startIndex - maxVisible} more below</Text>
          )}
        </Box>
      )}

      {/* Commands autocomplete dropdown - below input */}
      {autocompleteMode === 'command' && filteredCommands.length > 0 && (
        <Box flexDirection="column">
          {/* Scroll indicator - top */}
          {visibleCommands.startIndex > 0 && (
            <Text dimColor>  ↑ {visibleCommands.startIndex} more above</Text>
          )}
          {visibleCommands.items.map((cmd, i) => {
            const actualIndex = visibleCommands.startIndex + i;
            return (
              <Box key={cmd.name}>
                <Text color={actualIndex === selectedIndex ? 'cyan' : undefined}>
                  {actualIndex === selectedIndex ? '▸ ' : '  '}
                  {cmd.name.padEnd(18)}
                </Text>
                <Text dimColor={actualIndex !== selectedIndex}>
                  {cmd.description}
                </Text>
              </Box>
            );
          })}
          {/* Scroll indicator - bottom */}
          {visibleCommands.startIndex + maxVisible < filteredCommands.length && (
            <Text dimColor>  ↓ {filteredCommands.length - visibleCommands.startIndex - maxVisible} more below</Text>
          )}
        </Box>
      )}

      {/* File autocomplete dropdown - below input */}
      {autocompleteMode === 'file' && filteredFiles.length > 0 && (
        <Box flexDirection="column">
          {/* Scroll indicator - top */}
          {visibleFiles.startIndex > 0 && (
            <Text dimColor>  ↑ {visibleFiles.startIndex} more above</Text>
          )}
          {visibleFiles.items.map((file, i) => {
            const actualIndex = visibleFiles.startIndex + i;
            return (
              <Box key={file.name}>
                <Text color={actualIndex === selectedIndex ? 'cyan' : '#5fb3a1'}>
                  {actualIndex === selectedIndex ? '▸ ' : '  '}
                  {file.name}
                </Text>
              </Box>
            );
          })}
          {/* Scroll indicator - bottom */}
          {visibleFiles.startIndex + maxVisible < filteredFiles.length && (
            <Text dimColor>  ↓ {filteredFiles.length - visibleFiles.startIndex - maxVisible} more below</Text>
          )}
        </Box>
      )}
    </Box>
  );
});

Input.displayName = 'Input';
