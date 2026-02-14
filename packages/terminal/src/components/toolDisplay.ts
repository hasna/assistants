import type { ToolResult } from '@hasna/assistants-shared';

/**
 * Metadata about truncation that occurred
 */
export interface TruncationInfo {
  wasTruncated: boolean;
  originalLines: number;
  displayedLines: number;
  originalChars: number;
  displayedChars: number;
}

/**
 * Result of truncating tool output
 */
export interface TruncatedResult {
  content: string;
  truncation: TruncationInfo;
}

/**
 * Format truncation info for display (e.g., "truncated: 42→15 lines, 3000→400 chars")
 */
export function formatTruncationInfo(info: TruncationInfo): string {
  if (!info.wasTruncated) return '';

  const parts: string[] = [];
  if (info.originalLines > info.displayedLines) {
    parts.push(`${info.originalLines}→${info.displayedLines} lines`);
  }
  if (info.originalChars > info.displayedChars) {
    parts.push(`${info.originalChars}→${info.displayedChars} chars`);
  }

  return parts.length > 0 ? `truncated: ${parts.join(', ')}` : '';
}

/**
 * Truncate tool result for display - keeps it readable
 * Returns both the content and metadata about what was truncated
 */
export function truncateToolResultWithInfo(
  toolResult: ToolResult,
  maxLines = 15,
  maxChars = 3000,
  options?: { verbose?: boolean }
): TruncatedResult {
  const toolName = toolResult.toolName || 'tool';
  const rawContent = toolResult.rawContent ?? toolResult.content ?? '';
  let content = String(toolResult.content || rawContent);

  const originalContent = stripAnsi(content).replace(/\t/g, '  ');
  const originalLines = originalContent.split('\n').length;
  const originalChars = originalContent.length;

  if (options?.verbose) {
    return {
      content: originalContent.trimEnd(),
      truncation: {
        wasTruncated: false,
        originalLines,
        displayedLines: originalLines,
        originalChars,
        displayedChars: originalChars,
      },
    };
  }

  // Try to format the result more nicely based on the tool
  const formatted = formatToolResultNicely(toolName, content, toolResult.isError);
  if (formatted) {
    return {
      content: formatted,
      truncation: {
        wasTruncated: originalChars > formatted.length,
        originalLines,
        displayedLines: formatted.split('\n').length,
        originalChars,
        displayedChars: formatted.length,
      },
    };
  }

  const prefix = toolResult.isError ? `Error: ` : '';
  content = originalContent;

  let linesTruncated = false;
  let charsTruncated = false;
  let displayedLines = originalLines;
  let displayedChars = originalChars;

  // Truncate by lines first
  const lines = content.split('\n');
  if (lines.length > maxLines) {
    content = lines.slice(0, maxLines).join('\n');
    linesTruncated = true;
    displayedLines = maxLines;
  }

  // Then truncate by chars
  if (content.length > maxChars) {
    content = content.slice(0, maxChars);
    charsTruncated = true;
    displayedChars = maxChars;
  } else {
    displayedChars = content.length;
  }

  const wasTruncated = linesTruncated || charsTruncated;

  // Add truncation suffix to the content itself
  if (wasTruncated) {
    const truncInfo = formatTruncationInfo({
      wasTruncated: true,
      originalLines,
      displayedLines,
      originalChars,
      displayedChars,
    });
    content = content + `\n... (${truncInfo})`;
  }

  return {
    content: prefix + content.trimEnd(),
    truncation: {
      wasTruncated,
      originalLines,
      displayedLines,
      originalChars,
      displayedChars,
    },
  };
}

/**
 * Truncate tool result for display - keeps it readable
 * @deprecated Use truncateToolResultWithInfo for metadata about truncation
 */
export function truncateToolResult(
  toolResult: ToolResult,
  maxLines = 15,
  maxChars = 3000,
  options?: { verbose?: boolean }
): string {
  return truncateToolResultWithInfo(toolResult, maxLines, maxChars, options).content;
}

/**
 * Extract structured error information from tool errors
 */
export interface ErrorInfo {
  type: string;
  message: string;
  exitCode?: number;
  hint?: string;
}

/**
 * Parse error content to extract meaningful error info
 */
export function parseErrorInfo(content: string, toolName?: string): ErrorInfo {
  const lowerContent = content.toLowerCase();

  // Extract exit code if present
  const exitCodeMatch = content.match(/exit(?:ed with)?\s*(?:code|status)?\s*(\d+)/i)
    || content.match(/code\s*[:=]\s*(\d+)/i);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;

  // File system errors
  if (lowerContent.includes('enoent') || lowerContent.includes('no such file')) {
    return {
      type: 'not_found',
      message: 'File or directory not found',
      exitCode,
      hint: 'Check the path exists and is spelled correctly',
    };
  }
  if (lowerContent.includes('eacces') || lowerContent.includes('permission denied')) {
    return {
      type: 'permission',
      message: 'Permission denied',
      exitCode,
      hint: 'Check file permissions or run with elevated privileges',
    };
  }
  if (lowerContent.includes('eexist') || lowerContent.includes('already exists')) {
    return {
      type: 'exists',
      message: 'File already exists',
      exitCode,
      hint: 'Use a different name or remove the existing file',
    };
  }
  if (lowerContent.includes('enospc') || lowerContent.includes('no space left')) {
    return {
      type: 'disk_full',
      message: 'No space left on device',
      exitCode,
      hint: 'Free up disk space',
    };
  }
  if (lowerContent.includes('eisdir') || lowerContent.includes('is a directory')) {
    return {
      type: 'is_directory',
      message: 'Path is a directory',
      exitCode,
      hint: 'Use a file path instead of directory',
    };
  }
  if (lowerContent.includes('enotdir') || lowerContent.includes('not a directory')) {
    return {
      type: 'not_directory',
      message: 'Path is not a directory',
      exitCode,
      hint: 'Use a directory path',
    };
  }

  // Network errors
  if (lowerContent.includes('etimedout') || lowerContent.includes('timeout') || lowerContent.includes('timed out')) {
    return {
      type: 'timeout',
      message: 'Request timed out',
      exitCode,
      hint: 'Try again or check network connectivity',
    };
  }
  if (lowerContent.includes('econnrefused') || lowerContent.includes('connection refused')) {
    return {
      type: 'connection_refused',
      message: 'Connection refused',
      exitCode,
      hint: 'Check if the server is running and accessible',
    };
  }
  if (lowerContent.includes('econnreset') || lowerContent.includes('connection reset')) {
    return {
      type: 'connection_reset',
      message: 'Connection reset',
      exitCode,
      hint: 'Retry the request',
    };
  }
  if (lowerContent.includes('enetunreach') || lowerContent.includes('network unreachable')) {
    return {
      type: 'network',
      message: 'Network unreachable',
      exitCode,
      hint: 'Check network connectivity',
    };
  }
  if (lowerContent.includes('enotfound') || lowerContent.includes('getaddrinfo')) {
    return {
      type: 'dns',
      message: 'DNS lookup failed',
      exitCode,
      hint: 'Check the hostname is correct',
    };
  }

  // HTTP errors
  const httpMatch = content.match(/(\d{3})\s*(Unauthorized|Forbidden|Not Found|Bad Request|Internal Server Error|Service Unavailable)/i)
    || content.match(/HTTP\s*(?:error|status)?\s*[:=]?\s*(\d{3})/i);
  if (httpMatch) {
    const code = parseInt(httpMatch[1], 10);
    const httpMessages: Record<number, { message: string; hint: string }> = {
      400: { message: 'Bad request', hint: 'Check request parameters' },
      401: { message: 'Unauthorized', hint: 'Check authentication credentials' },
      403: { message: 'Forbidden', hint: 'Check permissions or API key' },
      404: { message: 'Not found', hint: 'Check the URL or resource exists' },
      429: { message: 'Rate limited', hint: 'Wait before retrying' },
      500: { message: 'Server error', hint: 'Try again later' },
      502: { message: 'Bad gateway', hint: 'Try again later' },
      503: { message: 'Service unavailable', hint: 'Service may be down, try again later' },
    };
    const info = httpMessages[code] || { message: `HTTP ${code}`, hint: 'Check the error message' };
    return {
      type: 'http',
      message: info.message,
      exitCode: code,
      hint: info.hint,
    };
  }

  // Syntax/Parse errors
  if (lowerContent.includes('syntaxerror') || lowerContent.includes('parse error') || lowerContent.includes('unexpected token')) {
    return {
      type: 'syntax',
      message: 'Syntax or parse error',
      exitCode,
      hint: 'Check code syntax',
    };
  }

  // Command not found
  if (lowerContent.includes('command not found') || lowerContent.includes('not recognized') || lowerContent.includes('not installed')) {
    return {
      type: 'command_not_found',
      message: 'Command not found',
      exitCode: exitCode ?? 127,
      hint: 'Install the required command or check PATH',
    };
  }

  // Tool denied/blocked
  if (lowerContent.includes('denied') || lowerContent.includes('blocked') || lowerContent.includes('not allowed')) {
    return {
      type: 'denied',
      message: 'Tool call denied',
      exitCode,
      hint: 'Check allowed tools configuration',
    };
  }

  // Generic error with exit code
  if (exitCode !== undefined) {
    return {
      type: 'exit_code',
      message: `Failed with exit code ${exitCode}`,
      exitCode,
      hint: exitCode === 1 ? 'Check command output for details' : undefined,
    };
  }

  // Fallback
  return {
    type: 'unknown',
    message: 'Error occurred',
    hint: 'Check the error details',
  };
}

/**
 * Format an error for concise display
 */
export function formatErrorConcise(content: string, toolName?: string): string {
  const info = parseErrorInfo(content, toolName);
  const exitPart = info.exitCode !== undefined ? ` [${info.exitCode}]` : '';
  const hintPart = info.hint ? ` → ${info.hint}` : '';
  return `✗ ${info.message}${exitPart}${hintPart}`;
}

/**
 * Format tool results in a more user-friendly way
 */
function formatToolResultNicely(toolName: string, content: string, isError?: boolean): string | null {
  if (isError) {
    return formatErrorConcise(content, toolName);
  }

  switch (toolName) {
    case 'schedule':
      return formatScheduleResult(content);
    case 'submit_feedback':
      return formatFeedbackResult(content);
    case 'read':
      return formatReadResult(content);
    case 'write':
      return formatWriteResult(content);
    case 'glob':
      return formatGlobResult(content);
    case 'grep':
      return formatGrepResult(content);
    case 'bash':
      return formatBashResult(content);
    case 'web_search':
      return formatSearchResult(content);
    default:
      return null; // Use default formatting
  }
}

function formatScheduleResult(content: string): string | null {
  const trimmed = content.trim().toLowerCase();
  if (trimmed === 'no schedules found.' || trimmed.includes('no schedules')) {
    return '📅 No scheduled tasks';
  }
  if (trimmed.includes('created') || trimmed.includes('scheduled')) {
    return '✓ Schedule created';
  }
  if (trimmed.includes('deleted') || trimmed.includes('removed')) {
    return '✓ Schedule deleted';
  }
  if (trimmed.includes('paused')) {
    return '⏸ Schedule paused';
  }
  if (trimmed.includes('resumed')) {
    return '▶ Schedule resumed';
  }
  // Check if it's a list of schedules
  if (content.includes('id:') || content.includes('command:')) {
    const lines = content.split('\n').filter((line) => line.trim());
    return `📅 ${lines.length} scheduled task${lines.length !== 1 ? 's' : ''}`;
  }
  return null;
}

function formatFeedbackResult(content: string): string | null {
  if (content.includes('submitted') || content.includes('created')) {
    return '✓ Feedback submitted';
  }
  return null;
}

function formatReadResult(content: string): string | null {
  const lines = content.split('\n').length;
  if (lines > 20) {
    return `📄 Read ${lines} lines`;
  }
  return null; // Show actual content for small files
}

function formatWriteResult(content: string): string | null {
  if (content.includes('written') || content.includes('saved') || content.includes('created')) {
    return '✓ File saved';
  }
  return null;
}

function formatGlobResult(content: string): string | null {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return '🔍 No files found';
  }
  if (lines.length > 10) {
    return `🔍 Found ${lines.length} files`;
  }
  return null; // Show actual files for small results
}

function formatGrepResult(content: string): string | null {
  const lines = content.split('\n').filter((line) => line.trim());
  if (lines.length === 0) {
    return '🔍 No matches found';
  }
  if (lines.length > 10) {
    return `🔍 Found ${lines.length} matches`;
  }
  return null; // Show actual matches for small results
}

function formatBashResult(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return '✓ Command completed';
  }
  // For very short output, let it show
  if (trimmed.length < 100 && !trimmed.includes('\n')) {
    return null;
  }
  const lines = trimmed.split('\n').length;
  if (lines > 20) {
    return `✓ Output: ${lines} lines`;
  }
  return null;
}

function formatSearchResult(content: string): string | null {
  // Try to count results
  const resultCount = (content.match(/https?:\/\//g) || []).length;
  if (resultCount > 0) {
    return `🔍 Found ${resultCount} result${resultCount !== 1 ? 's' : ''}`;
  }
  return null;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}
