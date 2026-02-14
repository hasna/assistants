import type { Message } from '@hasna/assistants-shared';
import { renderMarkdown } from './Markdown';
import type { DisplayMessage } from './messageLines';

function wrapTextLines(text: string, wrapChars: number): string[] {
  const rawLines = text.split('\n');
  const lines: string[] = [];
  const maxIndent = Math.min(4, Math.max(0, wrapChars - 1));

  for (const rawLine of rawLines) {
    const expanded = rawLine.replace(/\t/g, '  ');
    if (wrapChars <= 0 || expanded.length <= wrapChars) {
      lines.push(expanded);
      continue;
    }

    const indentMatch = expanded.match(/^\s+/);
    const indentRaw = indentMatch ? indentMatch[0] : '';
    const indent = indentRaw.slice(0, maxIndent);
    const content = expanded.slice(indentRaw.length).trim();

    if (!content) {
      lines.push(indent);
      continue;
    }

    const words = content.split(/\s+/).filter(Boolean);
    let current = indent;

    const flush = () => {
      const trimmed = current.trimEnd();
      if (trimmed.length > 0 || indent.length > 0) {
        lines.push(trimmed);
      }
      current = indent;
    };

    const pushWord = (word: string) => {
      if (!current.trim()) {
        current = indent + word;
        return;
      }
      if (current.length + 1 + word.length <= wrapChars) {
        current += ` ${word}`;
      } else {
        flush();
        current = indent + word;
      }
    };

    for (const word of words) {
      if (word.length + indent.length <= wrapChars) {
        pushWord(word);
        continue;
      }

      if (current.trim()) {
        flush();
      }

      const chunkSize = Math.max(1, wrapChars - indent.length);
      for (let i = 0; i < word.length; i += chunkSize) {
        const chunk = word.slice(i, i + chunkSize);
        if (chunk.length === 0) continue;
        lines.push(indent + chunk);
      }
      current = indent;
    }

    if (current.trim() || indent) {
      lines.push(current.trimEnd());
    }
  }

  return lines;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function countWrappedLines(lines: string[], maxWidth?: number): number {
  if (!maxWidth || maxWidth <= 0) return lines.length;
  let total = 0;
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    total += Math.max(1, Math.ceil(visible / maxWidth));
  }
  return total;
}

function chunkRenderedLines(lines: string[], chunkLines: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let i = 0;

  const isBoxStart = (line: string) => stripAnsi(line).trimStart().startsWith('┌');
  const isBoxEnd = (line: string) => stripAnsi(line).trimStart().startsWith('└');

  while (i < lines.length) {
    const line = lines[i];
    if (isBoxStart(line)) {
      let end = i + 1;
      while (end < lines.length && !isBoxEnd(lines[end])) {
        end += 1;
      }
      if (end < lines.length) end += 1;
      const boxLines = lines.slice(i, end);
      if (current.length > 0 && current.length + boxLines.length > chunkLines) {
        chunks.push(current);
        current = [];
      }
      if (boxLines.length >= chunkLines) {
        chunks.push(boxLines);
      } else {
        current.push(...boxLines);
      }
      i = end;
      continue;
    }

    if (current.length >= chunkLines) {
      chunks.push(current);
      current = [];
    }
    current.push(line);
    i += 1;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export function buildDisplayMessages(
  messages: Message[],
  chunkLines: number,
  wrapChars: number,
  options?: { maxWidth?: number }
): DisplayMessage[] {
  const display: DisplayMessage[] = [];

  for (const msg of messages) {
    const content = msg.content ?? '';
    const shouldChunk = content.trim() !== '';
    if (!shouldChunk) {
      display.push(msg);
      continue;
    }

    if (msg.role === 'assistant') {
      const assistantWidth = options?.maxWidth ? Math.max(1, options.maxWidth - 2) : undefined;
      const rendered = renderMarkdown(content, { maxWidth: assistantWidth });
      const renderedLines = rendered.split('\n');
      if (renderedLines.length <= chunkLines) {
        const lineCount = countWrappedLines(renderedLines, assistantWidth);
        display.push({ ...msg, content: rendered, __rendered: true, __lineCount: lineCount });
        continue;
      }
      const chunks = chunkRenderedLines(renderedLines, chunkLines);
      for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i].join('\n');
        const lineCount = countWrappedLines(chunks[i], assistantWidth);
        display.push({
          ...msg,
          id: `${msg.id}::chunk-${i}`,
          content: chunkContent,
          __rendered: true,
          __lineCount: lineCount,
          toolCalls: i === chunks.length - 1 ? msg.toolCalls : undefined,
          toolResults: i === chunks.length - 1 ? msg.toolResults : undefined,
        });
      }
      continue;
    }

    const effectiveWrap = msg.role === 'user' ? Math.max(1, wrapChars - 2) : wrapChars;
    const lines = wrapTextLines(content, effectiveWrap);
    if (lines.length <= chunkLines) {
      display.push({ ...msg, __lineCount: lines.length });
      continue;
    }

    const chunks = chunkRenderedLines(lines, chunkLines);
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i].join('\n');
      display.push({
        ...msg,
        id: `${msg.id}::chunk-${i}`,
        content: chunkContent,
        __lineCount: chunks[i].length,
        toolCalls: i === chunks.length - 1 ? msg.toolCalls : undefined,
        toolResults: i === chunks.length - 1 ? msg.toolResults : undefined,
      });
    }
  }

  return display;
}
