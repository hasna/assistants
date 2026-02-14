import { useEffect } from 'react';
import { Buffer } from 'node:buffer';
import { useStdin, type Key } from 'ink';

let rawModeUsers = 0;
let rawModePatched = false;
let originalSetRawMode: ((mode: boolean) => void) | null = null;

function ensureRawModePatch(): void {
  if (rawModePatched) return;
  if (!process.stdin || typeof process.stdin.setRawMode !== 'function') return;
  originalSetRawMode = process.stdin.setRawMode.bind(process.stdin);
  process.stdin.setRawMode = ((mode: boolean) => {
    if (!mode && rawModeUsers > 0) {
      return process.stdin;
    }
    originalSetRawMode?.(mode);
    return process.stdin;
  }) as typeof process.stdin.setRawMode;
  rawModePatched = true;
}
// Inline minimal keypress parser to avoid depending on ink internals
function parseKeypress(rawInput: unknown): { name: string; ctrl: boolean; shift: boolean; meta: boolean; option: boolean; sequence: string } {
  let s = '';
  if (Buffer.isBuffer(rawInput)) {
    if (rawInput[0] > 127 && rawInput[1] === undefined) {
      rawInput[0] -= 128;
      s = `\x1b${String(rawInput)}`;
    } else {
      s = String(rawInput);
    }
  } else if (typeof rawInput === 'string') {
    s = rawInput;
  } else if (rawInput !== undefined && rawInput !== null) {
    s = String(rawInput);
  }
  const key = { name: '', ctrl: false, shift: false, meta: false, option: false, sequence: s };
  if (s === '\r' || s === '\n' || s === '\r\n' || s === '\n\r') { key.name = 'return'; }
  else if (s === '\x1b') { key.name = 'escape'; }
  else if (s === '\t') { key.name = 'tab'; }
  else if (s === '\x1b[Z') { key.name = 'tab'; key.shift = true; }
  else if (s === '\x7f' || s === '\b') { key.name = 'backspace'; }
  else if (s === '\x1b[A') { key.name = 'up'; }
  else if (s === '\x1b[B') { key.name = 'down'; }
  else if (s === '\x1b[C') { key.name = 'right'; }
  else if (s === '\x1b[D') { key.name = 'left'; }
  else if (s === '\x1b[5~') { key.name = 'pageup'; }
  else if (s === '\x1b[6~') { key.name = 'pagedown'; }
  else if (s === '\x1b[H' || s === '\x1bOH') { key.name = 'home'; }
  else if (s === '\x1b[F' || s === '\x1bOF') { key.name = 'end'; }
  else if (s === '\x1b[3~') { key.name = 'delete'; }
  else if (s.length === 1 && s.charCodeAt(0) <= 26) {
    key.ctrl = true;
    key.name = String.fromCharCode(s.charCodeAt(0) + 96);
  } else if (s.length === 1 && s.charCodeAt(0) >= 28 && s.charCodeAt(0) <= 31) {
    key.ctrl = true;
    const ctrlCodeMap: Record<number, string> = {
      28: '\\',
      29: ']',
      30: '^',
      31: '_',
    };
    key.name = ctrlCodeMap[s.charCodeAt(0)] || '';
  } else if (s.startsWith('\x1b') && s.length === 2) {
    key.meta = true;
    key.name = s[1];
  } else {
    key.name = s;
  }
  return key;
}
const NON_ALPHA_KEYS = ['up', 'down', 'left', 'right', 'pageup', 'pagedown', 'home', 'end', 'delete', 'backspace', 'return', 'escape', 'tab'];

type Handler = (input: string, key: Key) => void;
type Options = { isActive?: boolean };

// Input hook that avoids toggling raw mode off when handlers deactivate.
export function useSafeInput(handler: Handler, options: Options = {}): void {
  ensureRawModePatch();
  const { internal_eventEmitter, internal_exitOnCtrlC, setRawMode, isRawModeSupported, stdin } = useStdin() as {
    internal_eventEmitter?: NodeJS.EventEmitter;
    internal_exitOnCtrlC?: boolean;
    setRawMode?: (isEnabled: boolean) => void;
    isRawModeSupported?: boolean;
    stdin?: NodeJS.ReadStream;
  };

  useEffect(() => {
    const rawModeSupported = isRawModeSupported ?? Boolean(stdin?.isTTY ?? process.stdin?.isTTY);
    const rawModeSetter = setRawMode
      ?? (stdin && typeof stdin.setRawMode === 'function' ? stdin.setRawMode.bind(stdin) : undefined)
      ?? (process.stdin && typeof process.stdin.setRawMode === 'function' ? process.stdin.setRawMode.bind(process.stdin) : undefined);
    if (!rawModeSupported || !rawModeSetter) return;
    rawModeUsers += 1;
    rawModeSetter(true);
    return () => {
      rawModeUsers = Math.max(0, rawModeUsers - 1);
      rawModeSetter(false);
    };
  }, [isRawModeSupported, setRawMode, stdin]);

  useEffect(() => {
    if (options.isActive === false) return;
    const resolvedStdin = stdin ?? process.stdin;
    if (!internal_eventEmitter && !resolvedStdin) return;
    if (!internal_eventEmitter && resolvedStdin?.resume) {
      resolvedStdin.resume();
    }

    const handleData = (data: string | Buffer, inkKey?: Key) => {
      if (inkKey && typeof inkKey === 'object') {
        let input = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString() : '';
        // Preserve Alt+Enter newline handling (ESC + CR/LF) for consumers.
        if (inkKey.meta && inkKey.return && (input === '\r' || input === '\n')) {
          input = input === '\n' ? '\x1b\n' : '\x1b\r';
        }
        const key = { ...inkKey } as Key;
        // Some terminal stacks report Enter as Ctrl+M (not return). Normalize it.
        if ((input === 'm' || input === 'j') && key.ctrl && !key.return) {
          input = input === 'j' ? '\n' : '\r';
          key.return = true;
          key.ctrl = false;
        }
        const isReturnInput = input === '\r' || input === '\n' || input === '\r\n' || input === '\n\r';
        if (isReturnInput && !key.return) {
          key.return = true;
        }
        if (input === '\x1b' && !key.escape) {
          key.escape = true;
        }
        if (input === '\x1b[Z' && key.tab && !key.shift) {
          key.shift = true;
        }
        if (input.length === 1 && /[A-Z]/.test(input)) {
          key.shift = true;
        }
        if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
          handler(input, key);
        }
        return;
      }

      const keypress = parseKeypress(data);
      const isReturn = keypress.name === 'return' || keypress.sequence === '\x1b\r' || keypress.sequence === '\x1b\n';
      const key = {
        upArrow: keypress.name === 'up',
        downArrow: keypress.name === 'down',
        leftArrow: keypress.name === 'left',
        rightArrow: keypress.name === 'right',
        pageDown: keypress.name === 'pagedown',
        pageUp: keypress.name === 'pageup',
        home: keypress.name === 'home',
        end: keypress.name === 'end',
        return: isReturn,
        escape: keypress.name === 'escape',
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: keypress.name === 'tab',
        backspace: keypress.name === 'backspace',
        delete: keypress.name === 'delete',
        meta: keypress.meta || keypress.name === 'escape' || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (NON_ALPHA_KEYS.includes(keypress.name)) {
        input = '';
      }
      if (input.startsWith('\x1b') && input !== '\x1b\r' && input !== '\x1b\n') {
        input = input.slice(1);
      }
      if (input.length === 1 && /[A-Z]/.test(input[0])) {
        key.shift = true;
      }

      if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
        handler(input, key);
      }
    };

    if (internal_eventEmitter) {
      internal_eventEmitter.on('input', handleData);
    } else if (resolvedStdin) {
      resolvedStdin.on('data', handleData);
    }
    return () => {
      if (internal_eventEmitter) {
        internal_eventEmitter.removeListener('input', handleData);
      } else if (resolvedStdin) {
        resolvedStdin.removeListener('data', handleData);
      }
    };
  }, [handler, internal_eventEmitter, internal_exitOnCtrlC, options.isActive, stdin]);
}
