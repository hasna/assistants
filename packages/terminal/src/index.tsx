#!/usr/bin/env bun
// Initialize Bun runtime before any core imports
import { setRuntime, closeDatabase } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';
setRuntime(bunRuntime);

import React from 'react';
import { render } from 'ink';
import { App } from './components/App';
import { runHeadless } from './headless';
import { sanitizeTerminalOutput } from './output/sanitize';
import { parseArgs, main } from './cli/main';

// --- Graceful shutdown handling ---

function cleanup(): void {
  closeDatabase();
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  process.stderr.write(`Uncaught exception: ${error}\n`);
  cleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  cleanup();
  process.exit(1);
});

// Version is embedded at build time via define in build.ts
const VERSION = process.env.ASSISTANTS_VERSION || 'dev';

// DEC Mode 2026 - Synchronized Output
// This prevents scrollback destruction by batching all updates atomically
// Supported by: Ghostty, WezTerm, Windows Terminal, VS Code terminal
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

/**
 * Patch stdout.write to use synchronized output (DEC 2026)
 *
 * Buffers all writes within a single synchronous frame (Ink render cycle) and
 * flushes them atomically in a single DEC 2026 sync block via queueMicrotask.
 * This prevents Ghostty (and similar terminals) from rendering partial frames
 * between individual write() calls, which caused the entire conversation
 * history to visually duplicate on every new message.
 *
 * Microtasks run after the current synchronous task completes but before any
 * I/O events, so terminal query/response sequences (used by ink-picture for
 * Sixel/iTerm2 inline images) still work correctly.
 */
function enableSynchronizedOutput(): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let buffer = '';
  let flushScheduled = false;

  function flush() {
    flushScheduled = false;
    if (!buffer) return;
    const output = buffer;
    buffer = '';
    originalWrite(SYNC_START + output + SYNC_END);
  }

  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    const raw = typeof chunk === 'string' ? chunk : chunk.toString();
    const safe = sanitizeTerminalOutput(raw);
    buffer += safe;

    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }

    // Invoke callbacks — the data is accepted (buffered), so report success.
    if (typeof encodingOrCallback === 'function') {
      encodingOrCallback();
    } else if (callback) {
      callback();
    }
    return true;
  } as typeof process.stdout.write;

  // Return cleanup function
  return () => {
    flush();
    process.stdout.write = originalWrite as typeof process.stdout.write;
  };
}

// Re-export parseArgs and main for testing
export { parseArgs, main };

const options = parseArgs(process.argv);

// Handle parsing errors
if (options.errors.length > 0) {
  for (const error of options.errors) {
    console.error(`Error: ${error}`);
  }
  process.exit(1);
}

// Handle version
if (options.version) {
  console.log(`assistants v${VERSION}`);
  process.exit(0);
}

// Handle help
if (options.help) {
  console.log(`
assistants - Your personal AI assistant

Usage:
  assistants [options]                    Start interactive mode
  assistants -p "<prompt>" [options]      Run in headless mode

Options:
  -h, --help                   Show this help message
  -v, --version                Show version number

Headless Mode:
  -p, --print <prompt>         Run non-interactively with the given prompt
  --output-format <format>     Output format: text (default), json, stream-json
  --allowed-tools <tools>      Comma-separated tools to auto-approve (e.g., "Read,Edit,Bash")
  --system-prompt <prompt>     Custom system prompt
  --json-schema <schema>       JSON Schema for structured output (use with --output-format json)
  --headless-timeout-ms <ms>   Abort headless run after the given timeout (ms)
  -c, --continue               Continue the most recent conversation
  -r, --resume <session_id>    Resume a specific session by ID
  --cwd <path>                 Set working directory

Examples:
  # Ask a question
  assistants -p "What does the auth module do?"

  # Run with JSON output
  assistants -p "Summarize this project" --output-format json

  # Stream JSON events
  assistants -p "Explain this code" --output-format stream-json

  # Auto-approve tools
  assistants -p "Fix the bug in auth.py" --allowed-tools "Read,Edit,Bash"

  # Get structured output
  assistants -p "List all functions" --output-format json --json-schema '{"type":"array","items":{"type":"string"}}'

  # Continue conversation
  assistants -p "What else can you tell me?" --continue

Interactive Mode:
  - Type your message and press Enter to send
  - Use $skill-name to invoke a skill
  - Use /command for built-in commands
  - Press Ctrl+] to switch sessions
  - Press Ctrl+C to exit
`);
  process.exit(0);
}

// Headless mode
if (options.print !== null) {
  if (!options.print.trim()) {
    console.error('Error: Prompt is required with -p/--print flag');
    process.exit(1);
  }

  runHeadless({
    prompt: options.print,
    cwd: options.cwd,
    outputFormat: options.outputFormat,
    allowedTools: options.allowedTools.length > 0 ? options.allowedTools : undefined,
    systemPrompt: options.systemPrompt || undefined,
    jsonSchema: options.jsonSchema || undefined,
    continue: options.continue,
    resume: options.resume,
    cwdProvided: options.cwdProvided,
    timeoutMs: options.headlessTimeoutMs,
  })
    .then((result) => {
      process.exit(result.success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Error:', error.message);
      process.exit(1);
    });
} else {
  // Interactive mode
  // Enable synchronized output for terminals that support DEC 2026 (Ghostty, WezTerm, etc.)
  // This batches all terminal writes and flushes them atomically, preserving scrollback
  // Can be disabled with ASSISTANTS_NO_SYNC=1 if causing rendering issues
  const useSyncOutput = process.env.ASSISTANTS_NO_SYNC !== '1';
  const disableSyncOutput = useSyncOutput ? enableSynchronizedOutput() : () => {};

  const appElement = <App cwd={options.cwd} version={VERSION} />;

  const { waitUntilExit } = render(
    appElement,
    {
      // Patch console to route through our synced output
      patchConsole: true,
      // Let the app decide how to handle Ctrl+C (clear input or stop processing).
      exitOnCtrlC: false,
    },
  );

  waitUntilExit().then(() => {
    // Restore original stdout.write before exiting
    disableSyncOutput();
    cleanup();
    process.exit(0);
  });
}
