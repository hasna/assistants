import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface DocsPanelProps {
  onClose: () => void;
}

type Mode = 'index' | 'section';

type DocsSection = {
  id: string;
  title: string;
  summary: string;
  content: string[];
};

const MAX_INDEX_ROWS = 10;

const DOCS_SECTIONS: DocsSection[] = [
  {
    id: 'quick-start',
    title: 'Quick Start',
    summary: 'Install, initialize, and run your first assistant session.',
    content: [
      'Install the CLI globally: bun install -g @hasna/assistants',
      'Initialize in a project folder: /init',
      'Run onboarding any time with /onboarding. This configures provider, model, API key flow, and optional connector defaults.',
      'Create a fresh conversation with /new. Check current state with /status, /tokens, and /cost.',
      'Exit safely with /exit. If the terminal closes unexpectedly, use /resume to recover previous sessions.',
    ],
  },
  {
    id: 'core-workflow',
    title: 'Core Workflow',
    summary: 'How day-to-day coding sessions, queues, and interruptions work.',
    content: [
      'Everything in assistants starts from a session. A session keeps message history, tool calls, context state, and model settings.',
      'Submit a prompt normally with Enter. Queue work while processing with Shift+Enter (or your configured queue mode).',
      'Use /compact when context grows large. It summarizes conversation state and keeps key working memory.',
      'Use /sessions to switch sessions and /status for current execution state.',
      'If a run stalls or you need to redirect quickly, send an interrupt-mode prompt and continue from the same session.',
    ],
  },
  {
    id: 'assistants-identity',
    title: 'Assistants and Identity',
    summary: 'Switch assistants, tune persona, and manage identity behavior.',
    content: [
      'Use /assistants to list and switch assistant profiles.',
      'Use /identity to set role/behavior details and /whoami to inspect the active identity.',
      'Assistant settings are workspace-aware. Switching workspace changes which assistant registry and sessions are active.',
      'For multi-assistant collaboration, use /messages and channel tools for asynchronous coordination.',
    ],
  },
  {
    id: 'workspace-projects',
    title: 'Workspace and Projects',
    summary: 'Scope everything by workspace and project for clean separation.',
    content: [
      'Use /workspace use <name-or-id> to switch context. /workspace clear returns to default scope.',
      'Each workspace has isolated sessions, assistants, settings, budgets, and local state under its own .assistants tree.',
      'Use /projects to create/select projects and /plans to manage plan steps for the active project.',
      'When moving into a new workspace with no setup, onboarding should run so provider/model/config can be selected.',
    ],
  },
  {
    id: 'models-config',
    title: 'Models and Config',
    summary: 'Manage providers, model routing, and config scopes.',
    content: [
      'Use /model for interactive model selection and provider-specific model lists.',
      'Use /config to inspect and edit user/project/local config layers.',
      'Config precedence is usually: local > project > user > defaults.',
      'Use /memory and /context to inspect what the assistant remembers and what project context is injected.',
      'Use /guardrails and /hooks for safety policies and lifecycle automation.',
    ],
  },
  {
    id: 'resources-finance',
    title: 'Wallet, Secrets, Budgets',
    summary: 'Store credentials and payment info, and enforce spending/resource limits.',
    content: [
      'Use /wallet to add/edit cards interactively. Stored wallet records live in your .assistants data.',
      'Use /secrets to add/manage secret values from terminal UI.',
      'Use /budgets for full interactive budget management. /budget is an alias to /budgets.',
      'Budgets can include token, cost, duration, and tool-call limits at session and swarm scope.',
      'Use /cost and /tokens for real-time visibility while running heavy workflows.',
    ],
  },
  {
    id: 'operations-panels',
    title: 'Operations Panels',
    summary: 'Operational panels for tasks, schedules, jobs, orders, logs, and heartbeat.',
    content: [
      'Use /tasks for queued local tasks with priority and pause/resume controls.',
      'Use /schedules for recurring command execution with next-run visibility.',
      'Use /jobs for background connector/tool jobs. Kill jobs directly in the panel.',
      'Use /orders for interactive order/store workflows (tabs, table navigation, detail views).',
      'Use /logs for security events and /heartbeat for recurring assistant runs.',
    ],
  },
  {
    id: 'communication',
    title: 'Messaging and Channels',
    summary: 'How assistants and people communicate through unified interfaces.',
    content: [
      'Use /messages for assistant mailbox + email inbox in one panel.',
      'Use /channels to monitor channel streams and cross-assistant conversations.',
      'Use /people and /communication when those systems are enabled in config.',
      'Use @mentions in channel messages to target specific assistants and avoid duplicate responses.',
    ],
  },
  {
    id: 'voice',
    title: 'Voice Mode',
    summary: 'Dictation and live conversation controls.',
    content: [
      'Use /voice to toggle voice stack status.',
      'Use /talk for live conversational mode and /voice to control the stack.',
      'Use /say to synthesize output text aloud.',
      'Push-to-talk is available where configured. During recording, Enter can stop and submit.',
    ],
  },
  {
    id: 'storage-layout',
    title: 'Storage and Files',
    summary: 'Where data is persisted and what gets isolated by scope.',
    content: [
      'Project-local data uses .assistants in your repository.',
      'User/global data defaults to ~/.assistants.',
      'Workspace-scoped data is resolved from the active workspace base directory and includes sessions, assistant registry, wallet, secrets, budgets, and local runtime state.',
      'Switching workspace should not leak state between workspaces.',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Fast path for common failures and recovery.',
    content: [
      'If onboarding appears stuck, reopen with /onboarding and confirm provider and API key flow.',
      'If panel data looks stale, reopen the panel or use refresh controls shown in each panel footer.',
      'If sessions are missing after a workspace switch, verify active workspace with /workspace and check /sessions.',
      'Use /logs to inspect blocked commands and validation failures.',
      'Use /resume to recover interrupted sessions and continue work safely.',
    ],
  },
  {
    id: 'command-cheatsheet',
    title: 'Command Cheatsheet',
    summary: 'High-frequency commands grouped by workflow.',
    content: [
      'Session: /new, /sessions, /status, /compact, /resume, /exit',
      'Config: /onboarding, /model, /config, /memory, /context, /hooks, /guardrails',
      'Planning: /projects, /plans, /tasks, /schedules',
      'Ops: /jobs, /orders, /logs, /heartbeat',
      'Resources: /wallet, /secrets, /budgets, /cost, /tokens',
      'Collaboration: /assistants, /identity, /messages, /channels, /people, /communication',
    ],
  },
];

function getVisibleWindow(selectedIndex: number, total: number, maxVisible: number) {
  if (total <= maxVisible) {
    return { start: 0, end: total, above: 0, below: 0 };
  }

  const half = Math.floor(maxVisible / 2);
  let start = selectedIndex - half;
  let end = start + maxVisible;

  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

  if (end > total) {
    end = total;
    start = Math.max(0, total - maxVisible);
  }

  return {
    start,
    end,
    above: start,
    below: total - end,
  };
}

function splitWord(word: string, width: number): string[] {
  if (word.length <= width || width <= 1) return [word];
  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += width) {
    chunks.push(word.slice(i, i + width));
  }
  return chunks;
}

function wrapParagraph(paragraph: string, width: number): string[] {
  if (!paragraph) return [''];
  const safeWidth = Math.max(20, width);

  const prefixMatch = paragraph.match(/^(\s*(?:[-*]|\d+\.)\s+)/);
  const prefix = prefixMatch?.[1] ?? '';
  const baseIndent = ' '.repeat(prefix.length);
  const text = prefixMatch ? paragraph.slice(prefix.length).trim() : paragraph.trim();
  if (!text) return [prefix || ''];

  const tokens = text.split(/\s+/).flatMap((token) => splitWord(token, safeWidth));
  const lines: string[] = [];
  let current = prefix;
  let currentLen = current.length;
  const firstWidth = Math.max(8, safeWidth - prefix.length);
  const nextWidth = Math.max(8, safeWidth - baseIndent.length);
  let limit = firstWidth;

  for (const token of tokens) {
    if (!token) continue;
    if (currentLen <= (prefix ? prefix.length : 0)) {
      current += token;
      currentLen += token.length;
      continue;
    }
    if (currentLen + 1 + token.length <= (prefix ? prefix.length : 0) + limit) {
      current += ` ${token}`;
      currentLen += 1 + token.length;
    } else {
      lines.push(current);
      current = `${baseIndent}${token}`;
      currentLen = current.length;
      limit = nextWidth;
    }
  }

  if (current.trim().length > 0) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [paragraph];
}

function buildSectionLines(section: DocsSection, width: number): string[] {
  const lines: string[] = [];
  lines.push(...wrapParagraph(section.summary, width));
  lines.push('');
  for (const paragraph of section.content) {
    lines.push(...wrapParagraph(paragraph, width));
    lines.push('');
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function DocsPanel({ onClose }: DocsPanelProps) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 30;
  const contentWidth = Math.max(40, columns - 8);
  const contentHeight = Math.max(8, rows - 10);

  const [mode, setMode] = useState<Mode>('index');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, DOCS_SECTIONS.length - 1)));
  }, []);

  useEffect(() => {
    setScrollOffset(0);
  }, [selectedIndex, mode, contentWidth]);

  const selectedSection = DOCS_SECTIONS[selectedIndex];
  const sectionLines = useMemo(
    () => buildSectionLines(selectedSection, contentWidth),
    [selectedSection, contentWidth]
  );

  const maxScroll = Math.max(0, sectionLines.length - contentHeight);
  const clampedScroll = Math.min(scrollOffset, maxScroll);

  useEffect(() => {
    if (clampedScroll !== scrollOffset) {
      setScrollOffset(clampedScroll);
    }
  }, [clampedScroll, scrollOffset]);

  const sectionWindow = useMemo(
    () => getVisibleWindow(selectedIndex, DOCS_SECTIONS.length, MAX_INDEX_ROWS),
    [selectedIndex]
  );

  const visibleContent = sectionLines.slice(clampedScroll, clampedScroll + contentHeight);

  const moveSection = (delta: number) => {
    setSelectedIndex((prev) => {
      const total = DOCS_SECTIONS.length;
      if (total <= 0) return 0;
      const next = (prev + delta + total) % total;
      return next;
    });
  };

  useInput((input, key) => {
    if (mode === 'index') {
      if (input === 'q' || key.escape) {
        onClose();
        return;
      }

      if (key.upArrow || input === 'k') {
        moveSection(-1);
        return;
      }

      if (key.downArrow || input === 'j') {
        moveSection(1);
        return;
      }

      if (key.leftArrow || input === '[') {
        moveSection(-1);
        return;
      }

      if (key.rightArrow || input === ']') {
        moveSection(1);
        return;
      }

      const asNumber = Number.parseInt(input, 10);
      if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= DOCS_SECTIONS.length) {
        setSelectedIndex(asNumber - 1);
        return;
      }

      if (key.return || input === 'l') {
        setMode('section');
      }
      return;
    }

    if (input === 'q') {
      onClose();
      return;
    }

    if (key.escape || key.backspace || input === 'b' || input === 'h') {
      setMode('index');
      return;
    }

    if (key.upArrow || input === 'k') {
      setScrollOffset((prev) => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setScrollOffset((prev) => Math.min(maxScroll, prev + 1));
      return;
    }

    if (key.leftArrow || input === '[') {
      moveSection(-1);
      return;
    }

    if (key.rightArrow || input === ']') {
      moveSection(1);
      return;
    }

    if (input === 'u') {
      setScrollOffset((prev) => Math.max(0, prev - Math.max(1, Math.floor(contentHeight / 2))));
      return;
    }

    if (input === 'd') {
      setScrollOffset((prev) => Math.min(maxScroll, prev + Math.max(1, Math.floor(contentHeight / 2))));
      return;
    }

    if (input === 'g') {
      setScrollOffset(0);
      return;
    }

    if (input === 'G') {
      setScrollOffset(maxScroll);
    }
  });

  if (mode === 'index') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color="cyan">Documentation</Text>
          <Text dimColor>{DOCS_SECTIONS.length} sections</Text>
        </Box>

        <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} flexDirection="column" paddingX={1} paddingY={0}>
          <Text dimColor>Use up/down (or j/k) to choose, Enter to open, number keys for quick jump.</Text>
          <Text dimColor>Close with q or Esc.</Text>
          <Box marginTop={1} />

          {sectionWindow.above > 0 && (
            <Text dimColor>... {sectionWindow.above} more above</Text>
          )}

          {DOCS_SECTIONS.slice(sectionWindow.start, sectionWindow.end).map((section, offset) => {
            const absoluteIndex = sectionWindow.start + offset;
            const selected = absoluteIndex === selectedIndex;
            return (
              <Box key={section.id} marginBottom={0}>
                <Text color={selected ? 'cyan' : undefined}>
                  {selected ? '>' : ' '} {absoluteIndex + 1}. {section.title}
                </Text>
              </Box>
            );
          })}

          {sectionWindow.below > 0 && (
            <Text dimColor>... {sectionWindow.below} more below</Text>
          )}

          <Box marginTop={1} />
          <Text bold>Selected</Text>
          {wrapParagraph(selectedSection.summary, contentWidth).map((line, index) => (
            <Text key={`${selectedSection.id}-summary-${index}`} wrap="wrap">{line}</Text>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>Keys: [Enter] open  [j/k] move  [[/]] switch  [q] close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">{selectedSection.title}</Text>
        <Text dimColor>{selectedIndex + 1}/{DOCS_SECTIONS.length}</Text>
      </Box>

      <Box borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} flexDirection="column" paddingX={1} paddingY={0}>
        {visibleContent.length === 0 ? (
          <Text dimColor>No content.</Text>
        ) : (
          visibleContent.map((line, index) => (
            <Text key={`${selectedSection.id}-line-${clampedScroll + index}`} wrap="wrap">
              {line || ' '}
            </Text>
          ))
        )}
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Text dimColor>
          Keys: [j/k] scroll  [u/d] half-page  [g/G] top/bottom
        </Text>
        <Text dimColor>
          [b/Esc] index  [[/]] section  [q] close
        </Text>
      </Box>

      <Box marginTop={0}>
        <Text dimColor>
          Lines {Math.min(sectionLines.length, clampedScroll + 1)}-{Math.min(sectionLines.length, clampedScroll + visibleContent.length)} of {sectionLines.length}
        </Text>
      </Box>
    </Box>
  );
}
