const CLEAR_SCREEN_SEQUENCE = '\x1b[2J\x1b[3J\x1b[H';
export const CLEAR_SCREEN_TOKEN = '__ASSISTANTS_CLEAR_SCREEN__';

export function sanitizeTerminalOutput(chunk: string): string {
  // Strip clear scrollback (CSI 3 J) sequences that wipe terminal history.
  // Strip full clear-terminal sequences that would wipe scrollback.
  // Note: We preserve cursor-home (\x1b[H) as Ink needs it for proper rendering.
  const safe = chunk
    .replace(/\x1b\[2J\x1b\[3J\x1b\[H/g, '')
    .replace(/\x1b\[2J\x1b\[3J/g, '')
    .replace(/\x1b\[3J/g, '');

  // Allow explicit, controlled clears via token substitution.
  if (!safe.includes(CLEAR_SCREEN_TOKEN)) {
    return safe;
  }

  return safe.split(CLEAR_SCREEN_TOKEN).join(CLEAR_SCREEN_SEQUENCE);
}
