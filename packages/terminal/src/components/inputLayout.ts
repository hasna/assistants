export interface DisplayLine {
  text: string;
  start: number;
  end: number;
}

export interface InputLayout {
  displayLines: DisplayLine[];
  cursorRow: number;
  cursorCol: number;
}

export function buildLayout(text: string, position: number, width: number): InputLayout {
  const displayLines: DisplayLine[] = [];
  let cursorRow = 0;
  let cursorCol = 0;

  const lines = text.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineStart = offset;
    const segments: string[] = [];
    if (line.length === 0) {
      segments.push('');
    } else {
      for (let idx = 0; idx < line.length; idx += width) {
        segments.push(line.slice(idx, idx + width));
      }
    }

    for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
      const segment = segments[segIndex];
      const segStart = lineStart + segIndex * width;
      const segEnd = segStart + segment.length;
      displayLines.push({ text: segment, start: segStart, end: segEnd });
    }

    offset += line.length;
    if (i < lines.length - 1) {
      offset += 1;
    }
  }

  const clampedPos = Math.max(0, Math.min(position, text.length));
  let matched = false;
  for (let i = 0; i < displayLines.length; i += 1) {
    const line = displayLines[i];
    if (line.end === line.start && clampedPos === line.start) {
      cursorRow = i;
      cursorCol = 0;
      matched = true;
      break;
    }
    if (clampedPos >= line.start && clampedPos < line.end) {
      cursorRow = i;
      cursorCol = clampedPos - line.start;
      matched = true;
      break;
    }
    if (
      clampedPos === line.end &&
      (i === displayLines.length - 1 || displayLines[i + 1].start !== line.end)
    ) {
      cursorRow = i;
      cursorCol = clampedPos - line.start;
      matched = true;
      break;
    }
  }
  if (!matched && displayLines.length > 0) {
    const lastLine = displayLines[displayLines.length - 1];
    cursorRow = displayLines.length - 1;
    cursorCol = Math.max(0, Math.min(clampedPos - lastLine.start, lastLine.text.length));
  }

  return { displayLines, cursorRow, cursorCol };
}

export function moveCursorVertical(
  layout: InputLayout,
  preferredColumn: number | null,
  direction: -1 | 1
): { cursor: number; preferredColumn: number } | null {
  const targetRow = layout.cursorRow + direction;
  if (targetRow < 0 || targetRow >= layout.displayLines.length) return null;
  const desiredColumn = preferredColumn ?? layout.cursorCol;
  const targetLine = layout.displayLines[targetRow];
  const nextColumn = Math.min(desiredColumn, targetLine.text.length);
  const nextCursor = targetLine.start + nextColumn;
  return { cursor: nextCursor, preferredColumn: desiredColumn };
}
