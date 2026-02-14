import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { Message, ToolCall, ToolResult } from '@hasna/assistants-shared';
import { Markdown } from './Markdown';
import {
  groupConsecutiveToolMessages,
  type DisplayMessage,
} from './messageLines';
import { truncateToolResult, truncateToolResultWithInfo } from './toolDisplay';
import { TerminalImage } from './TerminalImage';
import { basename } from 'path';

interface ActivityEntry {
  id: string;
  type: 'text' | 'tool_call' | 'tool_result';
  content?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
}

interface MessagesProps {
  messages: DisplayMessage[];
  currentResponse?: string;
  streamingMessages?: DisplayMessage[];
  currentToolCall?: ToolCall;
  lastToolResult?: ToolResult;
  activityLog?: ActivityEntry[];
  queuedMessageIds?: Set<string>;
  verboseTools?: boolean;
}

export function Messages({
  messages,
  currentResponse,
  streamingMessages = [],
  currentToolCall,
  lastToolResult,
  activityLog = [],
  queuedMessageIds,
  verboseTools = false,
}: MessagesProps) {
  const [now, setNow] = useState(Date.now());

  type MessageItem =
    | { kind: 'message'; message: DisplayMessage }
    | { kind: 'grouped'; messages: DisplayMessage[] };

  type Item = MessageItem
    | { kind: 'activity'; entry: ActivityEntry }
    | { kind: 'streaming'; message: DisplayMessage };

  const messageGroups = useMemo(() => groupConsecutiveToolMessages(messages), [messages]);
  const messageItems = useMemo<MessageItem[]>(() => {
    return messageGroups.map((group) => (
      group.type === 'single'
        ? { kind: 'message', message: group.message }
        : { kind: 'grouped', messages: group.messages }
    ));
  }, [messageGroups]);

  const visibleMessageItems = messageItems;
  const visibleActivity = activityLog;
  const visibleStreaming = streamingMessages;
  const showCurrentResponse = Boolean(currentResponse) && streamingMessages.length === 0;

  // Separate historical messages (stable) from current activity (dynamic)
  const historicalItems = visibleMessageItems.map((item) => {
    if (item.kind === 'message') {
      return { id: item.message.id, item };
    }
    return { id: item.messages[0].id, item };
  });

  const toolResultMap = useMemo(() => {
    const map = new Map<string, ActivityEntry>();
    for (const entry of activityLog) {
      if (entry.type === 'tool_result' && entry.toolResult) {
        map.set(entry.toolResult.toolCallId, entry);
      }
    }
    return map;
  }, [activityLog]);

  const hasPendingTools = useMemo(() => {
    for (const entry of activityLog) {
      if (entry.type === 'tool_call' && entry.toolCall) {
        if (!toolResultMap.has(entry.toolCall.id)) {
          return true;
        }
      }
    }
    return false;
  }, [activityLog, toolResultMap]);

  useEffect(() => {
    if (!hasPendingTools) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasPendingTools]);

  return (
    <Box flexDirection="column" width="100%">
      {/* Historical messages */}
      {historicalItems.map((item) => {
        if (item.item.kind === 'message') {
          return (
            <MessageBubble
              key={item.id}
              message={item.item.message}
              queuedMessageIds={queuedMessageIds}
              verboseTools={verboseTools}
            />
          );
        }
        return <CombinedToolMessage key={item.id} messages={item.item.messages} verboseTools={verboseTools} />;
      })}

      {/* Show text entries from activity log */}
      {visibleActivity
        .filter((entry) => entry.type === 'text' && entry.content)
        .map((entry) => (
          <Box key={entry.id} marginY={1}>
            <Text dimColor>● </Text>
            <Box flexGrow={1}>
              <Markdown content={entry.content!} indent={3} />
            </Box>
          </Box>
        ))}

      {/* Unified active tools panel */}
      {visibleActivity.some((entry) => entry.type === 'tool_call') && (
        <ActiveToolsPanel
          activityLog={visibleActivity}
          now={now}
          verboseTools={verboseTools}
        />
      )}

      {visibleStreaming.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          queuedMessageIds={queuedMessageIds}
          verboseTools={verboseTools}
        />
      ))}

      {/* Show current streaming response (text being typed now) */}
      {showCurrentResponse && (
        <Box marginY={1}>
          <Text dimColor>● </Text>
          <Box flexGrow={1}>
            <Markdown content={currentResponse ?? ''} indent={3} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * Format duration in a human-friendly way
 * - Under 1 minute: "42s"
 * - Under 1 hour: "5m 32s"
 * - 1 hour or more: "1h 21m 32s"
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Render multiple tool-only messages as a single combined row
 */
function CombinedToolMessage({ messages, verboseTools }: { messages: DisplayMessage[]; verboseTools?: boolean }) {
  // Collect all tool calls from all messages
  const allToolCalls: ToolCall[] = [];
  const allToolResults: ToolResult[] = [];
  for (const msg of messages) {
    if (msg.toolCalls) {
      allToolCalls.push(...msg.toolCalls);
    }
    if (msg.toolResults) {
      allToolResults.push(...msg.toolResults);
    }
  }

  return (
    <Box marginY={1}>
      <ToolCallPanel toolCalls={allToolCalls} toolResults={allToolResults} verboseTools={verboseTools} />
    </Box>
  );
}


interface MessageBubbleProps {
  message: DisplayMessage;
  queuedMessageIds?: Set<string>;
  verboseTools?: boolean;
}

function MessageBubble({ message, queuedMessageIds, verboseTools }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isDraft = message.id.startsWith('listening-draft');
  const isQueued = isUser && queuedMessageIds?.has(message.id);
  const chunkMatch = message.id.match(/::chunk-(\d+)$/);
  const chunkIndex = chunkMatch ? Number(chunkMatch[1]) : -1;
  const isContinuation = chunkIndex > 0;
  const content = message.content ?? '';
  const displayContent = isUser ? normalizeUserDisplay(content) : content;
  const leadingBullet = !isContinuation && !startsWithListOrTable(content);

  if (isSystem) {
    return null;
  }

  if (isUser) {
    const toolResults = message.toolResults || [];
    const showToolResultsOnly = toolResults.length > 0 && !isContinuation;
    const hasContent = Boolean((message.content ?? '').trim());
    return (
      <Box marginY={isContinuation ? 0 : 1} flexDirection="column">
        {isDraft && !isContinuation && (
          <Box>
            <Text dimColor>  🎤 Live dictation</Text>
          </Box>
        )}
        {hasContent && (
          <Box>
            <Text dimColor={isDraft || isContinuation}>{isContinuation ? '  ' : '❯ '} </Text>
            {isQueued && !isContinuation ? (
              <Text dimColor>⏳ {message.content ?? ''}</Text>
            ) : (
              <Text dimColor={isDraft}>{displayContent}</Text>
            )}
          </Box>
        )}
        {showToolResultsOnly && (
          <Box marginTop={hasContent ? 1 : 0}>
            <ToolResultPanel toolResults={toolResults} verboseTools={verboseTools} />
          </Box>
        )}
      </Box>
    );
  }

  // Assistant message
  const toolCalls = message.toolCalls || [];
  const toolResults = message.toolResults || [];
  const hasContent = content && content.trim();
  const showToolResultsOnly = toolCalls.length === 0 && toolResults.length > 0;

  return (
    <Box marginY={isContinuation ? 0 : 1} flexDirection="column">
      {hasContent && (
        <Box>
          <Text dimColor>{isContinuation || !leadingBullet ? '  ' : '● '} </Text>
          <Box flexGrow={1}>
            <Markdown content={message.content} preRendered={Boolean(message.__rendered)} indent={3} />
          </Box>
        </Box>
      )}
      {toolCalls.length > 0 && (
        <Box marginTop={hasContent ? 1 : 0}>
          <ToolCallPanel toolCalls={toolCalls} toolResults={toolResults} verboseTools={verboseTools} />
        </Box>
      )}
      {showToolResultsOnly && (
        <Box marginTop={hasContent ? 1 : 0}>
          <ToolResultPanel toolResults={toolResults} verboseTools={verboseTools} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Unified panel showing all active tool calls with status and counts
 */
interface ActiveToolsStatus {
  running: number;
  succeeded: number;
  failed: number;
  total: number;
}

interface ActiveToolInfo {
  id: string;
  toolCall: ToolCall;
  status: 'running' | 'succeeded' | 'failed';
  startTime: number;
  endTime?: number;
  result?: ToolResult;
}

interface ActiveToolsPanelProps {
  activityLog: ActivityEntry[];
  now: number;
  verboseTools?: boolean;
}

function ActiveToolsPanel({ activityLog, now, verboseTools }: ActiveToolsPanelProps) {
  // Build tool call info from activity log
  const toolCalls = useMemo(() => {
    const calls: ActiveToolInfo[] = [];
    const resultMap = new Map<string, { result: ToolResult; timestamp: number }>();

    // First pass: collect results
    for (const entry of activityLog) {
      if (entry.type === 'tool_result' && entry.toolResult) {
        resultMap.set(entry.toolResult.toolCallId, {
          result: entry.toolResult,
          timestamp: entry.timestamp,
        });
      }
    }

    // Second pass: build tool info
    const now = Date.now();
    for (const entry of activityLog) {
      if (entry.type === 'tool_call' && entry.toolCall) {
        const resultInfo = resultMap.get(entry.toolCall.id);
        let status: 'running' | 'succeeded' | 'failed';
        if (resultInfo) {
          status = resultInfo.result.isError ? 'failed' : 'succeeded';
        } else {
          // Detect orphaned tool calls (no result after 60s)
          const elapsed = now - entry.timestamp;
          status = elapsed > 60_000 ? 'failed' : 'running';
        }
        calls.push({
          id: entry.toolCall.id,
          toolCall: entry.toolCall,
          status,
          startTime: entry.timestamp,
          endTime: resultInfo?.timestamp,
          result: resultInfo?.result,
        });
      }
    }

    return calls;
  }, [activityLog]);

  if (toolCalls.length === 0) return null;

  // Compact summary for 2+ tool calls when not verbose
  if (!verboseTools && toolCalls.length >= 2) {
    const anyRunning = toolCalls.some((c) => c.status === 'running');
    const anyError = toolCalls.some((c) => c.status === 'failed');
    const summary = buildToolCallSummary(toolCalls.map((c) => c.toolCall), anyRunning);
    const icon = anyRunning ? '○' : anyError ? '✗' : '●';
    const iconColor = anyRunning ? 'gray' : anyError ? 'red' : 'green';
    const suffix = anyRunning ? '…' : '';

    return (
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text> </Text>
        <Text>{summary}{suffix}</Text>
        <Text dimColor> (ctrl+o to expand)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {toolCalls.map((call) => {
        const icon = call.status === 'running' ? '○'
          : call.status === 'failed' ? '✗' : '●';
        const iconColor = call.status === 'running' ? 'gray'
          : call.status === 'failed' ? 'red' : 'green';
        const elapsedMs = (call.endTime ?? now) - call.startTime;
        const elapsedText = formatDuration(elapsedMs);
        const title = getToolCallTitle(call.toolCall);
        const prefix = call.status === 'running' ? 'Calling ' : '';

        // Show params when running, result when done
        const params = call.status === 'running' ? formatToolParams(call.toolCall) : [];

        // Handle display_image specially
        if (call.result && call.toolCall.name === 'display_image' && !call.result.isError) {
          try {
            const imgData = JSON.parse(call.result.content);
            if (imgData.path) {
              return (
                <Box key={call.id} flexDirection="column">
                  <Box>
                    <Text color={iconColor}>{icon} </Text>
                    <Text color={iconColor} bold>{title}</Text>
                    <Text dimColor> · {elapsedText}</Text>
                  </Box>
                  <TerminalImage src={imgData.path} width={imgData.width} height={imgData.height} alt={imgData.alt || 'image'} />
                </Box>
              );
            }
          } catch { /* fall through */ }
        }

        return (
          <Box key={call.id} flexDirection="column">
            <Box>
              <Text color={iconColor}>{icon} </Text>
              <Text> </Text>
              <Text color={iconColor} bold>{prefix}{title}</Text>
              <Text dimColor> · {elapsedText}</Text>
            </Box>
            {params.length > 0 && (
              <Box marginLeft={2} flexDirection="column">
                {params.map((param, i) => (
                  <Text key={i} dimColor>{i === 0 ? '└ ' : '  '}{param}</Text>
                ))}
              </Box>
            )}
            {call.result && (call.toolCall.name !== 'display_image' || call.result.isError) && (
              <Box marginLeft={2}>
                <Text dimColor>└ {truncateToolResult(call.result, 2, 200, { verbose: verboseTools })}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function startsWithListOrTable(content: string): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = stripAnsi(line).trimStart();
    if (!trimmed) continue;
    if (/^[-*•]\s+/.test(trimmed)) return true;
    if (/^\d+\.\s+/.test(trimmed)) return true;
    if (trimmed.startsWith('|')) return true;
    if (trimmed.startsWith('```')) return true;
    if (trimmed.startsWith(':::')) return true;
    if (/^[┌┐└┘├┤┬┴┼│]/.test(trimmed)) return true;
    if (/^[╭╮╰╯│]/.test(trimmed)) return true;
    return false;
  }
  return false;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function normalizeUserDisplay(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  if (normalized.includes('```')) {
    return normalized.replace(/\t/g, '  ');
  }
  const compact = normalized
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').replace(/ {2,}/g, ' '))
    .join('\n')
    .replace(/\n{2,}/g, '\n');
  return compact;
}

function ToolCallPanel({
  toolCalls,
  toolResults,
  verboseTools,
}: {
  toolCalls: ToolCall[];
  toolResults?: ToolResult[];
  verboseTools?: boolean;
}) {
  if (toolCalls.length === 0) return null;

  const resultMap = new Map<string, ToolResult>();
  for (const result of toolResults || []) {
    resultMap.set(result.toolCallId, result);
  }

  // Compact summary for 2+ tool calls when not verbose
  if (!verboseTools && toolCalls.length >= 2) {
    const allComplete = toolCalls.every((tc) => resultMap.has(tc.id));
    const anyError = toolCalls.some((tc) => resultMap.get(tc.id)?.isError);
    const isRunning = !allComplete;
    const summary = buildToolCallSummary(toolCalls, isRunning);
    const icon = isRunning ? '○' : anyError ? '✗' : '●';
    const iconColor = isRunning ? 'gray' : anyError ? 'red' : 'green';
    const suffix = isRunning ? '…' : '';

    return (
      <Box>
        <Text color={iconColor}>{icon} </Text>
        <Text> </Text>
        <Text>{summary}{suffix}</Text>
        <Text dimColor> (ctrl+o to expand)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {toolCalls.map((toolCall) => {
        const result = resultMap.get(toolCall.id);
        const isRunning = !result;
        const isError = result?.isError;

        const icon = isRunning ? '○' : isError ? '✗' : '●';
        const iconColor = isRunning ? 'gray' : isError ? 'red' : 'green';

        const title = getToolCallTitle(toolCall);
        const prefix = isRunning ? 'Calling ' : '';

        // Show params when running, result when done
        const params = isRunning ? formatToolParams(toolCall) : [];

        // Handle display_image specially
        if (result && toolCall.name === 'display_image' && !result.isError) {
          try {
            const imgData = JSON.parse(result.content);
            if (imgData.path) {
              return (
                <Box key={toolCall.id} flexDirection="column">
                  <Box>
                    <Text color={iconColor}>{icon} </Text>
                    <Text> </Text>
                    <Text color={iconColor} bold>{title}</Text>
                  </Box>
                  <TerminalImage src={imgData.path} width={imgData.width} height={imgData.height} alt={imgData.alt || 'image'} />
                </Box>
              );
            }
          } catch { /* fall through */ }
        }

        const truncatedResult = result
          ? truncateToolResultWithInfo(result, 4, 400, { verbose: verboseTools })
          : null;
        const resultText = truncatedResult?.content || '';
        const showExpandHint = !verboseTools && truncatedResult?.truncation.wasTruncated;

        return (
          <Box key={toolCall.id} flexDirection="column">
            <Box>
              <Text color={iconColor}>{icon} </Text>
              <Text> </Text>
              <Text color={iconColor} bold>{prefix}{title}</Text>
            </Box>
            {params.length > 0 && (
              <Box marginLeft={2} flexDirection="column">
                {params.map((param, i) => (
                  <Text key={i} dimColor>{i === 0 ? '└ ' : '  '}{param}</Text>
                ))}
              </Box>
            )}
            {result && resultText && (
              <Box marginLeft={2}>
                <Text dimColor>└ {indentMultiline(resultText, '  ')}</Text>
              </Box>
            )}
            {showExpandHint && (
              <Box marginLeft={2}>
                <Text dimColor>  (Ctrl+O for full output)</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ToolResultPanel({
  toolResults,
  verboseTools,
}: {
  toolResults: ToolResult[];
  verboseTools?: boolean;
}) {
  if (toolResults.length === 0) return null;

  return (
    <Box flexDirection="column">
      {toolResults.map((result, index) => {
        const isError = result.isError;
        const icon = isError ? '✗' : '●';
        const iconColor = isError ? 'red' : 'green';
        const title = result.toolName
          ? capitalizeToolName(result.toolName)
          : `Result ${index + 1}`;

        // Render inline image for display_image tool results
        if (result.toolName === 'display_image' && !result.isError) {
          try {
            const data = JSON.parse(result.content);
            if (data.path) {
              return (
                <Box key={`${result.toolCallId}-${index}`} flexDirection="column">
                  <Box>
                    <Text color={iconColor}>{icon} </Text>
                    <Text color={iconColor} bold>{title}</Text>
                  </Box>
                  <TerminalImage src={data.path} width={data.width} height={data.height} alt={data.alt || basename(data.path)} />
                </Box>
              );
            }
          } catch { /* fall through to text display */ }
        }

        const truncatedResult = truncateToolResultWithInfo(result, 4, 400, { verbose: verboseTools });
        const resultText = indentMultiline(truncatedResult.content, '   ');
        const showExpandHint = !verboseTools && truncatedResult.truncation.wasTruncated;
        return (
          <Box key={`${result.toolCallId}-${index}`} flexDirection="column">
            <Box>
              <Text color={iconColor}>{icon} </Text>
              <Text color={iconColor} bold>{title}</Text>
            </Box>
            <Box marginLeft={1}>
              <Text dimColor>└  {resultText}</Text>
            </Box>
            {showExpandHint && (
              <Box marginLeft={1}>
                <Text dimColor>   (Ctrl+O for full output)</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Get tool call title in format "ToolName(context)" like Claude Code
 * e.g., "Read(factory.ts)", "Bash(git status)", "Grep"
 */
function getToolCallTitle(toolCall: ToolCall): string {
  const name = capitalizeToolName(toolCall.name);
  const context = getToolContext(toolCall);
  return context ? `${name}(${context})` : name;
}

/**
 * Capitalize tool name for display
 * e.g., "bash" -> "Bash", "web_fetch" -> "WebFetch"
 */
function capitalizeToolName(name: string): string {
  const nameMap: Record<string, string> = {
    bash: 'Bash',
    read: 'Read',
    write: 'Write',
    glob: 'Glob',
    grep: 'Grep',
    web_fetch: 'WebFetch',
    web_search: 'WebSearch',
    curl: 'Curl',
    display_image: 'Image',
    schedule: 'Schedule',
    submit_feedback: 'Feedback',
    ask_user: 'Ask',
    notion: 'Notion',
    gmail: 'Gmail',
    googledrive: 'GoogleDrive',
    googlecalendar: 'GoogleCalendar',
    linear: 'Linear',
    slack: 'Slack',
  };
  if (nameMap[name]) return nameMap[name];
  return name
    .replace(/^connect[_-]/, '')
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Format key tool params for display under "Calling ToolName"
 * Returns array of "key: value" strings
 */
function formatToolParams(toolCall: ToolCall): string[] {
  const { name, input } = toolCall;
  const params: string[] = [];

  switch (name) {
    case 'bash':
      if (input.command) params.push(`command: ${truncate(String(input.command), 60)}`);
      break;
    case 'read':
      if (input.file_path || input.path) params.push(`file_path: ${truncate(String(input.file_path || input.path), 60)}`);
      break;
    case 'write':
      if (input.file_path || input.path || input.filename)
        params.push(`file_path: ${truncate(String(input.file_path || input.path || input.filename), 60)}`);
      break;
    case 'glob':
      if (input.pattern) params.push(`pattern: ${truncate(String(input.pattern), 60)}`);
      if (input.path) params.push(`path: ${truncate(String(input.path), 60)}`);
      break;
    case 'grep':
      if (input.pattern) params.push(`pattern: ${truncate(String(input.pattern), 60)}`);
      if (input.path) params.push(`path: ${truncate(String(input.path), 60)}`);
      break;
    case 'web_fetch':
    case 'curl':
      if (input.url) params.push(`url: ${truncate(String(input.url), 60)}`);
      break;
    case 'web_search':
      if (input.query) params.push(`query: ${truncate(String(input.query), 60)}`);
      break;
    case 'schedule':
      if (input.action) params.push(`action: ${String(input.action)}`);
      if (input.command) params.push(`command: ${truncate(String(input.command), 50)}`);
      break;
    default: {
      const entries = Object.entries(input)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .slice(0, 2);
      for (const [key, value] of entries) {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        params.push(`${key}: ${truncate(String(str), 50)}`);
      }
    }
  }

  return params;
}

/**
 * Get short context from tool call input
 */
function getToolContext(toolCall: ToolCall): string {
  const { name, input } = toolCall;
  switch (name) {
    case 'bash':
      return truncate(String(input.command || ''), 30);
    case 'read':
      const path = String(input.path || input.file_path || '');
      return basename(path) || path;
    case 'write':
      const writePath = String(input.filename || input.path || input.file_path || '');
      return basename(writePath) || writePath;
    case 'glob':
      return truncate(String(input.pattern || ''), 30);
    case 'grep':
      return truncate(String(input.pattern || ''), 30);
    case 'schedule':
      return String(input.action || '');
    case 'submit_feedback':
      return String(input.type || 'feedback');
    case 'web_search':
      return truncate(String(input.query || ''), 30);
    case 'web_fetch':
    case 'curl':
      const url = String(input.url || '');
      try {
        return new URL(url).hostname;
      } catch {
        return truncate(url, 30);
      }
    default:
      // Try common field names for context
      const action = input.action || input.command || input.operation;
      if (action) return truncate(String(action), 30);
      return '';
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

function indentMultiline(text: string, padding: string): string {
  const parts = text.split('\n');
  if (parts.length <= 1) return text;
  return [parts[0], ...parts.slice(1).map((line) => `${padding}${line}`)].join('\n');
}

// ============================================
// Compact Tool Call Summary
// ============================================

/**
 * Get the summary category for a tool name
 */
function getToolCategory(name: string): string {
  switch (name) {
    case 'grep':
    case 'glob':
    case 'web_search':
      return 'search';
    case 'read':
      return 'read';
    case 'write':
      return 'write';
    case 'bash':
      return 'bash';
    case 'web_fetch':
    case 'curl':
      return 'fetch';
    case 'memory_recall':
      return 'memory_recall';
    case 'memory_save':
      return 'memory_save';
    case 'memory_forget':
      return 'memory_forget';
    case 'memory_list':
    case 'memory_stats':
    case 'memory_export':
      return 'memory_query';
    case 'memory_update':
    case 'memory_import':
      return 'memory_update';
    default:
      return 'other';
  }
}

/**
 * Build a compact summary of tool calls grouped by type
 * e.g., "Searching for 2 patterns, reading 1 file…"
 * e.g., "Recalled 1 memory, wrote 1 memory"
 */
function buildToolCallSummary(toolCalls: ToolCall[], isRunning: boolean): string {
  // Group by category
  const groups = new Map<string, number>();
  for (const tc of toolCalls) {
    const cat = getToolCategory(tc.name);
    groups.set(cat, (groups.get(cat) || 0) + 1);
  }

  const parts: string[] = [];

  for (const [category, count] of groups) {
    switch (category) {
      case 'search':
        parts.push(isRunning
          ? `Searching for ${count} ${count === 1 ? 'pattern' : 'patterns'}`
          : `Searched ${count} ${count === 1 ? 'pattern' : 'patterns'}`);
        break;
      case 'read':
        parts.push(isRunning
          ? `reading ${count} ${count === 1 ? 'file' : 'files'}`
          : `read ${count} ${count === 1 ? 'file' : 'files'}`);
        break;
      case 'write':
        parts.push(isRunning
          ? `writing ${count} ${count === 1 ? 'file' : 'files'}`
          : `wrote ${count} ${count === 1 ? 'file' : 'files'}`);
        break;
      case 'bash':
        parts.push(isRunning
          ? `running ${count} ${count === 1 ? 'command' : 'commands'}`
          : `ran ${count} ${count === 1 ? 'command' : 'commands'}`);
        break;
      case 'fetch':
        parts.push(isRunning
          ? `fetching ${count} ${count === 1 ? 'URL' : 'URLs'}`
          : `fetched ${count} ${count === 1 ? 'URL' : 'URLs'}`);
        break;
      case 'memory_recall':
        parts.push(isRunning
          ? `recalling ${count} ${count === 1 ? 'memory' : 'memories'}`
          : `Recalled ${count} ${count === 1 ? 'memory' : 'memories'}`);
        break;
      case 'memory_save':
        parts.push(isRunning
          ? `saving ${count} ${count === 1 ? 'memory' : 'memories'}`
          : `wrote ${count} ${count === 1 ? 'memory' : 'memories'}`);
        break;
      case 'memory_forget':
        parts.push(isRunning
          ? `forgetting ${count} ${count === 1 ? 'memory' : 'memories'}`
          : `forgot ${count} ${count === 1 ? 'memory' : 'memories'}`);
        break;
      case 'memory_query':
        parts.push(isRunning
          ? `querying memories`
          : `queried memories`);
        break;
      case 'memory_update':
        parts.push(isRunning
          ? `updating ${count} ${count === 1 ? 'memory' : 'memories'}`
          : `updated ${count} ${count === 1 ? 'memory' : 'memories'}`);
        break;
      default:
        parts.push(isRunning
          ? `running ${count} ${count === 1 ? 'tool' : 'tools'}`
          : `ran ${count} ${count === 1 ? 'tool' : 'tools'}`);
        break;
    }
  }

  // Capitalize the first part
  if (parts.length > 0) {
    parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }

  return parts.join(', ');
}
