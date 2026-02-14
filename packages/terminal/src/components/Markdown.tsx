import React from 'react';
import { Text, useStdout } from 'ink';
import chalk from 'chalk';

interface MarkdownProps {
  content: string;
  preRendered?: boolean;
  /** Number of characters consumed by the prefix (e.g., bullet + space) to calculate available width */
  indent?: number;
}

/**
 * Simple markdown parser for terminal output
 * - Uses dashes for lists (no bullets)
 * - Handles bold text
 * - Handles code blocks and inline code
 */
export function Markdown({ content, preRendered = false, indent = 0 }: MarkdownProps) {
  if (preRendered) {
    return <Text wrap="wrap">{content}</Text>;
  }

  return <MarkdownParsed content={content} indent={indent} />;
}

function MarkdownParsed({ content, indent = 0 }: { content: string; indent?: number }) {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const maxWidth = Math.max(20, columns - 2 - indent);
  const rendered = parseMarkdown(content, { maxWidth });
  const wrapped = wrapRenderedMarkdown(rendered, maxWidth);
  return <Text wrap="wrap">{wrapped}</Text>;
}

export function renderMarkdown(text: string, options?: { maxWidth?: number }): string {
  return parseMarkdown(text, { maxWidth: options?.maxWidth });
}

function parseMarkdown(text: string, options?: { skipBlocks?: boolean; maxWidth?: number }): string {
  let result = text;

  // Handle code blocks first (preserve them)
  const codeBlocks: string[] = [];
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `@@CODEBLOCK${codeBlocks.length - 1}@@`;
  });

  const inlineCodeBlocks: string[] = [];
  result = result.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodeBlocks.push(code);
    return `@@INLINECODE${inlineCodeBlocks.length - 1}@@`;
  });

  const blockSections: BlockSection[] = [];
  if (!options?.skipBlocks) {
    result = extractBlockSections(result, blockSections);
  }

  // Bold: **text** or __text__ (avoid matching inside words)
  result = result.replace(
    /(^|[\s([{>])\*\*([^*]+?)\*\*(?=[\s)\]}<.,!?;:]|$)/gm,
    (_, lead, text) => `${lead}${chalk.bold(text)}`
  );
  result = result.replace(
    /(^|[\s([{>])__([^_]+?)__(?=[\s)\]}<.,!?;:]|$)/gm,
    (_, lead, text) => `${lead}${chalk.bold(text)}`
  );

  // Italic: *text* or _text_ (avoid matching inside words)
  result = result.replace(
    /(^|[\s([{>])\*([^*\n]+?)\*(?=[\s)\]}<.,!?;:]|$)/gm,
    (_, lead, text) => `${lead}${chalk.italic(text)}`
  );
  result = result.replace(
    /(^|[\s([{>])_([^_\n]+?)_(?=[\s)\]}<.,!?;:]|$)/gm,
    (_, lead, text) => `${lead}${chalk.italic(text)}`
  );

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, (_, code) => chalk.dim(code));

  // Headers: # ## ###
  result = result.replace(/^### (.+)$/gm, (_, text) => chalk.bold(text));
  result = result.replace(/^## (.+)$/gm, (_, text) => chalk.bold(text));
  result = result.replace(/^# (.+)$/gm, (_, text) => chalk.bold(text));

  // Unordered lists: convert * and • to -
  result = result.replace(/^(\s*)[*•] /gm, '$1- ');

  // Ordered lists: keep as is but ensure proper spacing
  result = result.replace(/^(\s*)\d+\. /gm, '$1- ');

  // Links: [text](url) -> text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => `${text} (${chalk.dim(url)})`);

  // Status keyword highlighting
  result = result.replace(/\b(Building|Running|Working|Queued|Pending|Connecting)\b/gi, (match) => chalk.yellow(match));
  result = result.replace(/\b(Success|Succeeded|Done|Complete|Completed|Connected|Authenticated)\b/gi, (match) => chalk.green(match));
  result = result.replace(/\b(Error|Failed|Failure|Denied|Blocked)\b/gi, (match) => chalk.red(match));

  // Format markdown tables (before restoring code blocks)
  result = formatMarkdownTables(result, options?.maxWidth);

  // Restore block sections
  result = result.replace(/@@BLOCKSECTION(\d+)@@/g, (_, index) => {
    const section = blockSections[parseInt(index, 10)];
    if (!section) return '';
    return renderBlockSection(section, options?.maxWidth);
  });

  // Restore code blocks with dim styling
  result = result.replace(/@@CODEBLOCK(\d+)@@/g, (_, index) => {
    const block = codeBlocks[parseInt(index)];
    // Remove ``` markers and language identifier
    const code = block.replace(/```\w*\n?/g, '').replace(/```$/g, '').trim();
    return chalk.dim(code);
  });

  result = result.replace(/@@INLINECODE(\d+)@@/g, (_, index) => {
    const code = inlineCodeBlocks[parseInt(index, 10)] ?? '';
    return chalk.dim(code);
  });

  return result.trimEnd();
}

type BlockSection =
  | { kind: 'block'; type: string; title?: string; body: string; indent: string }
  | { kind: 'grid'; columns: number; cards: { type: string; title?: string; body: string }[]; body: string; indent: string }
  | { kind: 'report'; body: string; indent: string };

const ALLOWED_BLOCK_TYPES = new Set(['info', 'success', 'warning', 'error', 'note', 'command']);

function extractBlockSections(text: string, blocks: BlockSection[]): string {
  const lines = text.split('\n');
  const output: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const gridMatch = line.match(/^(\s*):::grid(.*)$/);
    const blockMatch = line.match(/^(\s*):::block(.*)$/);
    const reportMatch = line.match(/^(\s*):::report(.*)$/);

    if (gridMatch) {
      const indent = gridMatch[1] ?? '';
      const header = gridMatch[2] ?? '';
      const attrs = parseAttributes(header);
      const rawColumns = attrs.columns || attrs.cols;
      let columns = Number(rawColumns ?? 2);
      if (!Number.isFinite(columns) || columns <= 0) {
        output.push(createMalformedBlock(blocks, indent, 'grid', `Invalid columns value "${rawColumns ?? ''}". Using 2.`));
        columns = 2;
      }
      columns = Math.max(1, Math.min(4, Math.round(columns)));
      const parsed = parseDelimitedBlock(lines, i, indent);
      if (!parsed) {
        output.push(line);
        output.push(createMalformedBlock(blocks, indent, 'grid'));
        i += 1;
        continue;
      }
      if (parsed.warning) {
        output.push(createMalformedBlock(blocks, indent, 'grid', parsed.warning));
      }

      const bodyLines = stripIndent(parsed.bodyLines, indent);
      const body = bodyLines.join('\n');
      const cards = extractCards(body);
      blocks.push({ kind: 'grid', columns, cards, body, indent });
      output.push(`@@BLOCKSECTION${blocks.length - 1}@@`);
      i = parsed.nextIndex;
      continue;
    }

    if (blockMatch) {
      const indent = blockMatch[1] ?? '';
      const header = blockMatch[2] ?? '';
      const attrs = parseAttributes(header);
      let type = String(attrs.type || 'info');
      const title = attrs.title ? String(attrs.title) : undefined;
      const parsed = parseDelimitedBlock(lines, i, indent);
      if (!parsed) {
        output.push(line);
        output.push(createMalformedBlock(blocks, indent, 'block'));
        i += 1;
        continue;
      }
      const normalizedType = type.toLowerCase();
      if (!ALLOWED_BLOCK_TYPES.has(normalizedType)) {
        output.push(createMalformedBlock(blocks, indent, 'block', `Unknown block type "${type}". Using info.`));
        type = 'info';
      }
      if (parsed.warning) {
        output.push(createMalformedBlock(blocks, indent, 'block', parsed.warning));
      }
      const body = stripIndent(parsed.bodyLines, indent).join('\n');
      blocks.push({ kind: 'block', type, title, body, indent });
      output.push(`@@BLOCKSECTION${blocks.length - 1}@@`);
      i = parsed.nextIndex;
      continue;
    }

    if (reportMatch) {
      const indent = reportMatch[1] ?? '';
      const parsed = parseDelimitedBlock(lines, i, indent);
      if (!parsed) {
        output.push(line);
        output.push(createMalformedBlock(blocks, indent, 'report'));
        i += 1;
        continue;
      }
      if (parsed.warning) {
        output.push(createMalformedBlock(blocks, indent, 'report', parsed.warning));
      }
      const body = stripIndent(parsed.bodyLines, indent).join('\n');
      blocks.push({ kind: 'report', body, indent });
      output.push(`@@BLOCKSECTION${blocks.length - 1}@@`);
      i = parsed.nextIndex;
      continue;
    }

    const cardMatch = line.match(/^(\s*):::card(.*)$/);
    if (cardMatch) {
      const indent = cardMatch[1] ?? '';
      const parsed = parseDelimitedBlock(lines, i, indent);
      const warning = parsed?.warning || 'Card blocks must be inside :::grid.';
      output.push(createMalformedBlock(blocks, indent, 'block', warning));
      i = parsed ? parsed.nextIndex : i + 1;
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join('\n');
}

function extractCards(body: string): { type: string; title?: string; body: string }[] {
  const cards: { type: string; title?: string; body: string }[] = [];
  const lines = body.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const match = line.match(/^(\s*):::card(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }

    const indent = match[1] ?? '';
    const attrs = parseAttributes(match[2] ?? '');
    let type = String(attrs.type || 'note');
    const normalizedType = type.toLowerCase();
    if (!ALLOWED_BLOCK_TYPES.has(normalizedType)) {
      cards.push({
        type: 'warning',
        title: 'Malformed card',
        body: `Unknown card type "${type}". Using note.`,
      });
      type = 'note';
    } else {
      type = normalizedType;
    }
    const title = attrs.title ? String(attrs.title) : undefined;
    const bodyLines: string[] = [];
    let closed = false;
    let indentWarning: string | undefined;
    i += 1;
    while (i < lines.length) {
      const current = lines[i];
      if (current.trim() === ':::') {
        if (indent.length > 0 && !current.startsWith(indent)) {
          indentWarning = 'Card closing ::: indentation did not match opening.';
        }
        closed = true;
        i += 1;
        break;
      }
      bodyLines.push(current);
      i += 1;
    }
    if (!closed) {
      cards.push({
        type: 'warning',
        title: 'Malformed card',
        body: 'Missing closing ::: for card.',
      });
      break;
    }
    const stripped = stripIndent(bodyLines, indent);
    if (indentWarning) {
      cards.push({
        type: 'warning',
        title: 'Malformed card',
        body: indentWarning,
      });
    }
    cards.push({ type, title, body: stripped.join('\n') });
  }

  return cards;
}

function parseDelimitedBlock(
  lines: string[],
  startIndex: number,
  indent: string
): { bodyLines: string[]; nextIndex: number; warning?: string } | null {
  const bodyLines: string[] = [];
  let openCards = 0;
  let warning: string | undefined;
  let i = startIndex + 1;

  while (i < lines.length) {
    const current = lines[i];
    const trimmed = current.trim();

    if (trimmed.startsWith(':::card')) {
      openCards += 1;
      bodyLines.push(current);
      i += 1;
      continue;
    }

    if (trimmed === ':::') {
      const indentMismatch = indent.length > 0 && !current.startsWith(indent);
      if (openCards > 0) {
        openCards -= 1;
        bodyLines.push(current);
        i += 1;
        continue;
      }
      if (indentMismatch) {
        warning = 'Closing ::: indentation did not match opening. Adjust indentation for consistency.';
      }
      return { bodyLines, nextIndex: i + 1, warning };
    }

    bodyLines.push(current);
    i += 1;
  }

  return null;
}

function stripIndent(lines: string[], indent: string): string[] {
  if (!indent) return lines;
  return lines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line));
}

function createMalformedBlock(
  blocks: BlockSection[],
  indent: string,
  kind: 'block' | 'grid' | 'report',
  message?: string
): string {
  blocks.push({
    kind: 'block',
    type: 'warning',
    title: 'Malformed block',
    body: message || `Missing closing ::: for ${kind}.`,
    indent,
  });
  return `@@BLOCKSECTION${blocks.length - 1}@@`;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)=(".*?"|'.*?'|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw))) {
    const key = match[1];
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

function renderBlockSection(section: BlockSection, maxWidth?: number): string {
  if (section.kind === 'grid') {
    const adjustedWidth = maxWidth ? Math.max(20, maxWidth - section.indent.length) : undefined;
    if (section.cards.length === 0) {
      return renderCard(
        { type: 'note', title: 'Grid', body: section.body },
        adjustedWidth,
        section.indent,
        Boolean(adjustedWidth)
      ).join('\n');
    }
    return renderCardGrid(section.cards, section.columns, adjustedWidth, section.indent);
  }

  if (section.kind === 'report') {
    const adjustedWidth = maxWidth ? Math.max(20, maxWidth - section.indent.length) : undefined;
    return renderReport(section.body, adjustedWidth, section.indent);
  }

  const adjustedWidth = maxWidth ? Math.max(20, maxWidth - section.indent.length) : undefined;
  return renderBlock(section.type, section.title, section.body, adjustedWidth, section.indent);
}

function renderBlock(type: string, title: string | undefined, body: string, maxWidth?: number, indent = ''): string {
  const header = formatBlockHeader(type, title);
  const content = parseMarkdown(body, { skipBlocks: true, maxWidth });
  const lines = content ? content.split('\n') : [];
  return renderBox(header, lines, type, maxWidth, indent, Boolean(maxWidth));
}

function renderCard(
  card: { type: string; title?: string; body: string },
  maxWidth?: number,
  indent = '',
  forceWidth = false
): string[] {
  const header = formatBlockHeader(card.type, card.title);
  const content = parseMarkdown(card.body, { skipBlocks: true, maxWidth });
  const lines = content ? content.split('\n') : [];
  return renderBoxLines(header, lines, card.type, maxWidth, indent, forceWidth);
}

function renderCardGrid(
  cards: { type: string; title?: string; body: string }[],
  columns: number,
  maxWidth?: number,
  indent = ''
): string {
  const gap = 2;
  const totalWidth = maxWidth;
  let effectiveColumns = columns;
  if (totalWidth) {
    const minCardWidth = 18;
    const maxColumns = Math.max(1, Math.floor((totalWidth + gap) / (minCardWidth + gap)));
    effectiveColumns = Math.min(columns, maxColumns);
  }
  const cardTotalWidth = totalWidth
    ? Math.max(8, Math.floor((totalWidth - gap * (effectiveColumns - 1)) / effectiveColumns))
    : undefined;
  const cardLines = cards.map((card) => renderCard(card, cardTotalWidth, '', true));
  const rows: string[][][] = [];
  for (let i = 0; i < cardLines.length; i += effectiveColumns) {
    rows.push(cardLines.slice(i, i + effectiveColumns));
  }

  const output: string[] = [];
  for (const row of rows) {
    const maxHeight = Math.max(...row.map((c) => c.length));
    const padded = row.map((lines) => {
      const width = stripAnsi(lines[0] || '').length;
      const filled = [...lines];
      while (filled.length < maxHeight) {
        filled.push(' '.repeat(width));
      }
      return filled;
    });

    for (let lineIdx = 0; lineIdx < maxHeight; lineIdx += 1) {
      output.push(indent + padded.map((card) => card[lineIdx]).join('  '));
    }
  }

  return output.join('\n');
}

function formatBlockHeader(type: string, title?: string): string {
  const normalized = type.toLowerCase();
  const label = normalized.toUpperCase();
  const icon = getBlockIcon(normalized);
  const base = title ? `${icon} ${label} · ${title}` : `${icon} ${label}`;
  return base;
}

function getBlockIcon(type: string): string {
  switch (type) {
    case 'success':
      return '✓';
    case 'warning':
      return '⚠';
    case 'error':
      return '✗';
    case 'command':
      return '❯';
    case 'note':
      return '✶';
    default:
      return 'ℹ';
  }
}

function renderBox(
  header: string,
  lines: string[],
  type: string,
  maxWidth?: number,
  indent = '',
  forceWidth = false
): string {
  return renderBoxLines(header, lines, type, maxWidth, indent, forceWidth).join('\n');
}

function renderBoxLines(
  header: string,
  lines: string[],
  type: string,
  maxWidth?: number,
  indent = '',
  forceWidth = false
): string[] {
  const headerStyled = styleHeader(header, type);
  const maxInnerWidth = maxWidth ? Math.max(1, maxWidth - 4) : undefined;
  const headerLine = maxInnerWidth ? truncateAnsi(headerStyled, maxInnerWidth) : headerStyled;
  const wrappedLines = maxInnerWidth ? wrapAnsiLines(lines, maxInnerWidth) : lines;
  const contentWidth = Math.max(
    stripAnsi(headerLine).length,
    ...wrappedLines.map((line) => stripAnsi(line).length),
    0
  );
  const width = forceWidth && maxInnerWidth ? maxInnerWidth : contentWidth;
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const mid = `├${'─'.repeat(width + 2)}┤`;
  const bot = `└${'─'.repeat(width + 2)}┘`;

  const output: string[] = [];
  output.push(indent + chalk.dim(top));
  output.push(indent + formatBoxRow(headerLine, width));
  output.push(indent + chalk.dim(mid));
  for (const line of wrappedLines) {
    output.push(indent + formatBoxRow(line, width));
  }
  output.push(indent + chalk.dim(bot));
  return output;
}

function styleHeader(header: string, type: string): string {
  const color = type.toLowerCase();
  switch (color) {
    case 'success':
      return chalk.green.bold(header);
    case 'warning':
      return chalk.yellow.bold(header);
    case 'error':
      return chalk.red.bold(header);
    case 'command':
      return chalk.cyan.bold(header);
    case 'note':
      return chalk.magenta.bold(header);
    default:
      return chalk.blue.bold(header);
  }
}

function formatBoxRow(line: string, width: number): string {
  const len = stripAnsi(line).length;
  const padded = len < width ? line + ' '.repeat(width - len) : line;
  return `│ ${padded} │`;
}

function formatMarkdownTables(text: string, maxWidth?: number): string {
  const lines = text.split('\n');
  const output: string[] = [];

  const isSeparator = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const withoutPipes = trimmed.replace(/\|/g, '');
    if (!withoutPipes) return false;
    return /^[\s:-]+$/.test(withoutPipes);
  };
  const hasPipes = (line: string) => line.includes('|');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];

    if (line && next && hasPipes(line) && isSeparator(next)) {
      const header = parseTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && hasPipes(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }

      const table = renderTable(header, rows, maxWidth);
      output.push(...table);
      continue;
    }

    output.push(line);
    i += 1;
  }

  return output.join('\n');
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutEdges = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let escaping = false;
  for (let i = 0; i < withoutEdges.length; i += 1) {
    const ch = withoutEdges[i];
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (ch === '|') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (escaping) current += '\\';
  cells.push(current);
  return cells.map((cell) => cell.replace(/[\r\n]+/g, ' ').trim());
}

function renderTable(header: string[], rows: string[][], maxWidth?: number): string[] {
  const colCount = Math.max(header.length, ...rows.map((r) => r.length));
  const widths = new Array(colCount).fill(0);

  const allRows = [header, ...rows];
  for (const row of allRows) {
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? '';
      const len = stripAnsi(cell).length;
      if (len > widths[i]) widths[i] = len;
    }
  }

  const availableCellWidth = maxWidth
    ? Math.max(colCount, maxWidth - (colCount - 1) * 3 - 4)
    : undefined;
  if (availableCellWidth) {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total > availableCellWidth) {
      const minWidth = Math.max(1, Math.floor(availableCellWidth / colCount));
      while (widths.reduce((sum, width) => sum + width, 0) > availableCellWidth) {
        const maxWidthValue = Math.max(...widths);
        const idx = widths.findIndex((width) => width === maxWidthValue);
        if (idx === -1) break;
        if (widths[idx] <= minWidth) break;
        widths[idx] -= 1;
      }
    }
  }

  const pad = (value: string, width: number) => {
    const rendered = width > 0 ? truncateAnsi(value, width) : value;
    const len = stripAnsi(rendered).length;
    if (len >= width) return rendered;
    return rendered + ' '.repeat(width - len);
  };

  const top = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (row: string[], isHeader = false) => {
    const cells = [];
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? '';
      const rendered = isHeader ? chalk.bold.cyan(cell) : cell;
      cells.push(pad(rendered, widths[i]));
    }
    return `│ ${cells.join(' │ ')} │`;
  };

  const output: string[] = [];
  output.push(chalk.dim(top));
  output.push(formatRow(header, true));
  output.push(chalk.dim(mid));
  for (const row of rows) {
    output.push(formatRow(row, false));
  }
  output.push(chalk.dim(bot));

  return output;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function renderReport(body: string, maxWidth?: number, indent = ''): string {
  const lines = body.split('\n');
  let legendLine = '';
  const progressLines: string[] = [];
  const tableLines: string[] = [];
  let mode: 'progress' | 'table' | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const legendMatch = trimmed.match(/^legend\s*:\s*(.+)$/i);
    if (legendMatch) {
      legendLine = legendMatch[1];
      mode = null;
      continue;
    }

    if (/^progress\s*:/i.test(trimmed)) {
      mode = 'progress';
      continue;
    }

    if (/^table\s*:/i.test(trimmed)) {
      mode = 'table';
      continue;
    }

    if (mode === 'progress') {
      progressLines.push(rawLine);
    } else if (mode === 'table') {
      tableLines.push(rawLine);
    }
  }

  const output: string[] = [];
  if (legendLine) {
    output.push(indent + chalk.bold('Legend'));
    output.push(indent + renderLegend(legendLine));
    output.push('');
  }

  if (progressLines.length > 0) {
    output.push(indent + chalk.bold('Progress Overview'));
    const parsed = progressLines
      .map((line) => line.trim().replace(/^-/, '').trim())
      .map((line) => line.match(/^(.+?):\s*(\d{1,3})%?$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => ({ label: match[1].trim(), value: Math.max(0, Math.min(100, Number(match[2]))) }));
    if (parsed.length > 0) {
      const maxLabelWidth = maxWidth ? Math.max(4, maxWidth - 14) : 24;
      const labelWidth = Math.min(maxLabelWidth, Math.max(...parsed.map((p) => p.label.length), 10));
      const barWidth = maxWidth ? Math.max(4, Math.min(30, maxWidth - labelWidth - 8)) : 24;
      for (const entry of parsed) {
        output.push(indent + renderProgressLine(entry.label, entry.value, labelWidth, barWidth));
      }
      output.push('');
    }
  }

  if (tableLines.length > 0) {
    output.push(indent + chalk.bold('Detailed Status Table'));
    const adjustedWidth = maxWidth ? Math.max(20, maxWidth - indent.length) : undefined;
    const rendered = renderReportTable(tableLines, indent, adjustedWidth);
    output.push(...rendered);
  }

  return output.join('\n').trimEnd();
}

function renderLegend(raw: string): string {
  const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
  const rendered = parts.map((label) => {
    const key = label.toLowerCase();
    if (key.includes('not started')) return `${chalk.gray('■')} ${label}`;
    if (key.includes('in progress')) return `${chalk.yellow('■')} ${label}`;
    if (key.includes('complete')) return `${chalk.green('■')} ${label}`;
    if (key.includes('blocked')) return `${chalk.red('■')} ${label}`;
    return `${chalk.blue('■')} ${label}`;
  });
  return rendered.join(' | ');
}

function renderProgressLine(label: string, value: number, labelWidth: number, barWidth: number): string {
  const filled = Math.round((value / 100) * barWidth);
  const empty = barWidth - filled;
  const fill = chalk.white('█'.repeat(filled));
  const bar = chalk.gray('░'.repeat(empty));
  return `${label.padEnd(labelWidth)} [${fill}${bar}] ${value}%`;
}

function renderReportTable(lines: string[], indent: string, maxWidth?: number): string[] {
  const tableLines = lines.map((line) => line.trim()).filter(Boolean);
  if (tableLines.length < 2) return [];

  const header = parseTableRow(tableLines[0]);
  const separatorIndex = tableLines.findIndex((line) => /^\s*\|?[\s:-]+\|?[\s:-]*$/.test(line));
  const bodyLines = separatorIndex >= 0 ? tableLines.slice(separatorIndex + 1) : tableLines.slice(1);
  const rows = bodyLines.filter((line) => line.includes('|')).map((line) => parseTableRow(line));

  const priorityIndex = header.findIndex((cell) => cell.toLowerCase() === 'priority');
  const progressIndex = header.findIndex((cell) => cell.toLowerCase() === 'progress');
  const statusIndex = header.findIndex((cell) => cell.toLowerCase() === 'status');

  const styledRows = rows.map((row) => {
    const next = [...row];
    if (priorityIndex >= 0 && next[priorityIndex]) {
      next[priorityIndex] = decoratePriority(next[priorityIndex]);
    }
    if (progressIndex >= 0 && next[progressIndex]) {
      next[progressIndex] = decorateProgress(next[progressIndex]);
    }
    if (statusIndex >= 0 && next[statusIndex]) {
      next[statusIndex] = decorateStatus(next[statusIndex]);
    }
    return next;
  });

  return renderTable(header, styledRows, maxWidth).map((line) => indent + line);
}

function decoratePriority(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('high')) return `${chalk.red('●')} High`;
  if (normalized.includes('medium')) return `${chalk.yellow('●')} Medium`;
  if (normalized.includes('low')) return `${chalk.green('●')} Low`;
  return value;
}

function decorateProgress(value: string): string {
  const match = value.match(/(\d{1,3})/);
  if (!match) return value;
  const num = Math.max(0, Math.min(100, Number(match[1])));
  if (num === 100) return `${chalk.green('■')} ${num}%`;
  if (num === 0) return `${chalk.gray('■')} ${num}%`;
  return `${chalk.yellow('■')} ${num}%`;
}

function decorateStatus(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('blocked')) return chalk.red(value);
  if (normalized.includes('complete') || normalized.includes('done')) return chalk.green(value);
  if (normalized.includes('progress')) return chalk.yellow(value);
  return value;
}

function wrapAnsiLines(lines: string[], width: number): string[] {
  const output: string[] = [];
  for (const line of lines) {
    output.push(...wrapAnsiLine(line, width));
  }
  return output;
}

function isBoxLine(line: string): boolean {
  const visible = stripAnsi(line).trimStart();
  return (
    visible.startsWith('┌') ||
    visible.startsWith('├') ||
    visible.startsWith('└') ||
    visible.startsWith('│')
  );
}

function wrapRenderedMarkdown(text: string, width: number): string {
  if (!text) return '';
  if (width <= 0) return text;
  const lines = text.split('\n');
  const wrapped: string[] = [];
  for (const line of lines) {
    // Keep pre-built table/block box borders intact.
    if (isBoxLine(line)) {
      wrapped.push(line);
      continue;
    }
    wrapped.push(...wrapAnsiLine(line, width));
  }
  return wrapped.join('\n');
}

function wrapAnsiLine(line: string, width: number): string[] {
  if (width <= 0) return [line];

  // Parse line into tokens: ANSI codes and visible characters/words
  interface Token {
    type: 'ansi' | 'word' | 'space';
    text: string;
    visibleLength: number;
  }

  const tokens: Token[] = [];
  let i = 0;
  let currentWord = '';

  while (i < line.length) {
    // Check for ANSI escape sequence
    const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (match) {
      // Flush current word before ANSI
      if (currentWord) {
        tokens.push({ type: 'word', text: currentWord, visibleLength: currentWord.length });
        currentWord = '';
      }
      tokens.push({ type: 'ansi', text: match[0], visibleLength: 0 });
      i += match[0].length;
      continue;
    }

    const char = line[i];
    if (char === ' ') {
      // Flush current word before space
      if (currentWord) {
        tokens.push({ type: 'word', text: currentWord, visibleLength: currentWord.length });
        currentWord = '';
      }
      tokens.push({ type: 'space', text: ' ', visibleLength: 1 });
    } else {
      currentWord += char;
    }
    i += 1;
  }

  // Flush remaining word
  if (currentWord) {
    tokens.push({ type: 'word', text: currentWord, visibleLength: currentWord.length });
  }

  // Build wrapped lines
  const result: string[] = [];
  let currentLine = '';
  let visible = 0;
  let activeAnsi = '';

  for (const token of tokens) {
    if (token.type === 'ansi') {
      currentLine += token.text;
      if (token.text === '\x1b[0m') {
        activeAnsi = '';
      } else {
        activeAnsi += token.text;
      }
      continue;
    }

    if (token.type === 'space') {
      // Add space if it fits
      if (visible + 1 <= width) {
        currentLine += ' ';
        visible += 1;
      }
      // Otherwise skip leading space on new line
      continue;
    }

    // token.type === 'word'
    const wordLen = token.visibleLength;

    // If word fits on current line, add it
    if (visible + wordLen <= width) {
      currentLine += token.text;
      visible += wordLen;
      continue;
    }

    // Word doesn't fit - wrap
    if (visible > 0) {
      // Push current line and start new one
      result.push(currentLine);
      currentLine = activeAnsi;
      visible = 0;
    }

    // If word fits on a fresh line, add it
    if (wordLen <= width) {
      currentLine += token.text;
      visible = wordLen;
      continue;
    }

    // Word is longer than width - must break it character by character
    for (const char of token.text) {
      if (visible >= width) {
        result.push(currentLine);
        currentLine = activeAnsi;
        visible = 0;
      }
      currentLine += char;
      visible += 1;
    }
  }

  if (currentLine !== '' && currentLine !== activeAnsi) {
    result.push(currentLine);
  } else if (result.length === 0) {
    result.push('');
  }

  return result;
}

function truncateAnsi(line: string, width: number): string {
  if (stripAnsi(line).length <= width) return line;
  const hasAnsi = /\x1b\[[0-9;]*m/.test(line);
  if (width <= 3) {
    let result = '';
    let visible = 0;
    let i = 0;
    while (i < line.length && visible < width) {
      const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (match) {
        result += match[0];
        i += match[0].length;
        continue;
      }
      result += line[i];
      visible += 1;
      i += 1;
    }
    return hasAnsi && !result.endsWith('\x1b[0m') ? result + '\x1b[0m' : result;
  }
  const suffix = '...';
  const target = Math.max(0, width - suffix.length);
  let current = '';
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < target) {
    const match = line.slice(i).match(/^\x1b\[[0-9;]*m/);
    if (match) {
      current += match[0];
      i += match[0].length;
      continue;
    }
    current += line[i];
    visible += 1;
    i += 1;
  }
  const truncated = current + suffix;
  return hasAnsi && !truncated.endsWith('\x1b[0m') ? truncated + '\x1b[0m' : truncated;
}

export const __test__ = {
  parseMarkdown,
  extractBlockSections,
  extractCards,
  parseDelimitedBlock,
  stripIndent,
  createMalformedBlock,
  parseAttributes,
  formatBlockHeader,
  getBlockIcon,
  renderBox,
  renderBoxLines,
  formatBoxRow,
  renderCardGrid,
  formatMarkdownTables,
  parseTableRow,
  renderTable,
  renderReport,
  renderReportTable,
  renderProgressLine,
  decoratePriority,
  decorateProgress,
  decorateStatus,
  wrapRenderedMarkdown,
  wrapAnsiLines,
  wrapAnsiLine,
  stripAnsi,
  truncateAnsi,
};
