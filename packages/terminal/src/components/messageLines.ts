import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { renderMarkdown } from './Markdown';
import { truncateToolResult } from './toolDisplay';

export type DisplayMessage = Message & { __rendered?: boolean; __lineCount?: number };

export type MessageGroup =
  | { type: 'single'; message: DisplayMessage }
  | { type: 'grouped'; messages: DisplayMessage[] };

export interface ActivityEntryLike {
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolResult?: ToolResult;
}

function estimateToolPanelLines(
  toolCalls: ToolCall[],
  toolResults?: ToolResult[],
  hasContent?: boolean,
  maxWidth?: number
): number {
  if (!toolCalls || toolCalls.length === 0) {
    return 0;
  }

  const innerWidth = maxWidth ? Math.max(1, maxWidth - 4) : undefined;
  const resultWidth = innerWidth ? Math.max(1, innerWidth - 4) : undefined; // margin + prefix

  const resultLines = new Map<string, number>();
  for (const result of toolResults || []) {
    resultLines.set(result.toolCallId, estimateToolResultLines(result, resultWidth));
  }

  // No borders, just tool call lines
  let lines = 0;
  if (hasContent) {
    // Margin between text and panel.
    lines += 1;
  }

  for (const call of toolCalls) {
    // name line + param/result line
    lines += 2;
    const toolResultLines = resultLines.get(call.id);
    if (toolResultLines && toolResultLines > 0) {
      lines += toolResultLines;
    }
  }

  return lines;
}

function estimateToolResultPanelLines(
  toolResults: ToolResult[],
  hasContent?: boolean,
  maxWidth?: number
): number {
  if (!toolResults || toolResults.length === 0) return 0;
  const innerWidth = maxWidth ? Math.max(1, maxWidth - 4) : undefined;
  const resultWidth = innerWidth ? Math.max(1, innerWidth - 4) : undefined;

  // No borders, just result lines
  let lines = 0;
  if (hasContent) {
    lines += 1;
  }
  for (const result of toolResults) {
    // title line + result line(s)
    lines += 2;
    lines += estimateToolResultLines(result, resultWidth);
  }
  return lines;
}

function estimateToolResultLines(result: ToolResult, maxWidth?: number, maxLines = 4): number {
  const content = truncateToolResult(result, maxLines, 400);
  if (!content) return 1;
  const lines = stripAnsi(content).split('\n');
  const wrapped = countWrappedLines(lines, maxWidth);
  return Math.max(1, wrapped);
}

export function estimateMessageLines(message: DisplayMessage, maxWidth?: number): number {
  if (message.role === 'system') {
    return 0;
  }

  const content = message.content ?? '';
  const contentLines = content.length > 0 ? content.split('\n') : [];
  const hasContent = contentLines.length > 0;
  const prefixWidth = message.role === 'user' || message.role === 'assistant' ? 2 : 0;
  const effectiveWidth = maxWidth ? Math.max(1, maxWidth - prefixWidth) : maxWidth;
  const wrappedLines =
    typeof message.__lineCount === 'number'
      ? message.__lineCount
      : contentLines.length > 0
        ? countWrappedLines(contentLines, effectiveWidth)
        : 0;
  let lines = hasContent ? Math.max(1, wrappedLines) : 0;

  const toolCalls = message.toolCalls ?? [];
  const toolResults = message.toolResults ?? [];

  if (toolCalls.length > 0) {
    lines += estimateToolPanelLines(toolCalls, toolResults, hasContent, maxWidth);
  } else if (toolResults.length > 0) {
    lines += estimateToolResultPanelLines(toolResults, hasContent, maxWidth);
  }

  if (message.role === 'user' || message.role === 'assistant') {
    if (!isContinuationChunk(message.id)) {
      // marginY=1 adds two empty lines
      lines += 2;
    }
  }

  return lines;
}

export function estimateGroupedToolMessagesLines(messages: DisplayMessage[], maxWidth?: number): number {
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  for (const msg of messages) {
    if (msg.toolCalls) toolCalls.push(...msg.toolCalls);
    if (msg.toolResults) toolResults.push(...msg.toolResults);
  }
  if (toolCalls.length === 0) return 0;
  const synthetic: DisplayMessage = {
    id: 'grouped-tool-call',
    role: 'assistant',
    content: '',
    timestamp: 0,
    toolCalls,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
  };
  return estimateMessageLines(synthetic, maxWidth);
}

function countWrappedLines(lines: string[], maxWidth?: number): number {
  if (!maxWidth || maxWidth <= 0) {
    return lines.length;
  }
  let total = 0;
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    const wrapped = Math.max(1, Math.ceil(visible / maxWidth));
    total += wrapped;
  }
  return total;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

export function estimateActivityEntryLines(
  entry: ActivityEntryLike,
  wrapWidth: number,
  renderWidth?: number
): number {
  const effectiveWidth = Math.max(1, wrapWidth - 2);
  switch (entry.type) {
    case 'text': {
      const content = entry.content ?? '';
      if (!content.trim()) return 0;
      const rendered = renderMarkdown(content, { maxWidth: renderWidth });
      const lines = stripAnsi(rendered).split('\n');
      const wrapped = countWrappedLines(lines, effectiveWidth);
      return Math.max(1, wrapped) + 2; // marginY=1
    }
    case 'tool_call':
      // Two lines (call + elapsed) + marginY=1
      return 4;
    case 'tool_result':
      return estimateToolResultEntryLines(entry, effectiveWidth);
    default:
      return 0;
  }
}

function estimateToolResultEntryLines(entry: ActivityEntryLike, effectiveWidth: number): number {
  const content = entry.toolResult ? truncateToolResult(entry.toolResult) : '';
  const lines = content.split('\n');
  const wrapped = countWrappedLines(lines, effectiveWidth);
  return Math.max(1, wrapped) + 2; // marginY=1
}

export function estimateActivityLogLines(
  entries: ActivityEntryLike[],
  wrapWidth: number,
  renderWidth?: number
): number {
  return entries.reduce((sum, entry) => sum + estimateActivityEntryLines(entry, wrapWidth, renderWidth), 0);
}

export function estimateDisplayMessagesLines(messages: DisplayMessage[], maxWidth?: number): number {
  return messages.reduce((sum, message) => sum + estimateMessageLines(message, maxWidth), 0);
}

export function trimDisplayMessagesByLines(
  messages: DisplayMessage[],
  maxLines: number,
  maxWidth?: number
): { messages: DisplayMessage[]; trimmed: boolean } {
  if (maxLines <= 0) {
    return { messages: [], trimmed: messages.length > 0 };
  }

  const kept: DisplayMessage[] = [];
  let remaining = maxLines;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const lineCount = estimateMessageLines(message, maxWidth);
    if (lineCount <= remaining || kept.length === 0) {
      kept.unshift(message);
      remaining -= Math.max(0, lineCount);
    } else {
      break;
    }
  }

  return { messages: kept, trimmed: kept.length < messages.length };
}

export function trimActivityLogByLines<T extends ActivityEntryLike>(
  entries: T[],
  wrapWidth: number,
  renderWidth: number | undefined,
  maxLines: number
): { entries: T[]; trimmed: boolean } {
  if (maxLines <= 0) {
    return { entries: [], trimmed: entries.length > 0 };
  }

  const kept: T[] = [];
  let remaining = maxLines;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    const lineCount = estimateActivityEntryLines(entry, wrapWidth, renderWidth);
    if (lineCount <= remaining || kept.length === 0) {
      kept.unshift(entry);
      remaining -= Math.max(0, lineCount);
    } else {
      break;
    }
  }

  return { entries: kept, trimmed: kept.length < entries.length };
}

function isContinuationChunk(id: string): boolean {
  const match = id.match(/::chunk-(\d+)$/);
  if (!match) return false;
  const idx = Number(match[1]);
  return Number.isFinite(idx) && idx > 0;
}

export function groupConsecutiveToolMessages(messages: DisplayMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let currentToolGroup: DisplayMessage[] = [];

  for (const msg of messages) {
    const isToolOnlyAssistant =
      msg.role === 'assistant' &&
      (!msg.content || !msg.content.trim()) &&
      msg.toolCalls &&
      msg.toolCalls.length > 0;

    if (isToolOnlyAssistant) {
      currentToolGroup.push(msg);
    } else {
      if (currentToolGroup.length > 0) {
        if (currentToolGroup.length === 1) {
          groups.push({ type: 'single', message: currentToolGroup[0] });
        } else {
          groups.push({ type: 'grouped', messages: currentToolGroup });
        }
        currentToolGroup = [];
      }
      groups.push({ type: 'single', message: msg });
    }
  }

  if (currentToolGroup.length > 0) {
    if (currentToolGroup.length === 1) {
      groups.push({ type: 'single', message: currentToolGroup[0] });
    } else {
      groups.push({ type: 'grouped', messages: currentToolGroup });
    }
  }

  return groups;
}

export const __test__ = {
  estimateMessageLines,
  estimateActivityEntryLines,
  estimateActivityLogLines,
  estimateDisplayMessagesLines,
  estimateToolPanelLines,
  estimateToolResultLines,
  trimDisplayMessagesByLines,
  trimActivityLogByLines,
};
