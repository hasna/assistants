export function splitCommandLine(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += '\\';
  }

  if (current) {
    result.push(current);
  }

  return result;
}

export function buildCommandArgs(cli: string, args: string[]): string[] {
  const isWindows = process.platform === 'win32';
  const normalized = cli.trim();

  if (isWindows && normalized.toLowerCase().endsWith('.ps1')) {
    return [
      'powershell',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      normalized,
      ...args,
    ];
  }

  return [...splitCommandLine(normalized), ...args];
}
