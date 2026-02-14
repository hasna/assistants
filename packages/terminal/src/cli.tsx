#!/usr/bin/env bun
/**
 * CLI entry point for @hasna/assistants
 *
 * This file is the executable entry point for the `assistants` and `ast` commands.
 * For programmatic usage, import from '@hasna/assistants' instead.
 */

// Initialize Bun runtime before any core imports
import { setRuntime } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';
setRuntime(bunRuntime);

import React from 'react';
import { render } from 'ink';
import { App } from './components/App';
import { runHeadless } from './headless';
import { sanitizeTerminalOutput } from './output/sanitize';
import { parseArgs } from './cli/main';

// Version is embedded at build time via define in build.ts
const VERSION = process.env.ASSISTANTS_VERSION || 'dev';

// DEC Mode 2026 - Synchronized Output
// This prevents scrollback destruction by batching all updates atomically
// Supported by: Ghostty, WezTerm, Windows Terminal, VS Code terminal
const SYNC_START = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

/**
 * Patch stdout.write to use synchronized output (DEC 2026)
 * This batches writes and flushes them atomically, preventing partial renders
 * that can destroy scrollback in terminals like Ghostty.
 */
function enableSynchronizedOutput(): () => void {
  const originalWrite = process.stdout.write.bind(process.stdout);

  // Wrap each write in DEC 2026 synchronized output markers.
  // Unlike the previous buffering approach, this writes through immediately
  // which preserves stdin/stdout escape sequence communication (needed by ink-picture).
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean {
    const raw = typeof chunk === 'string' ? chunk : chunk.toString();
    const safe = sanitizeTerminalOutput(raw);
    return originalWrite(SYNC_START + safe + SYNC_END, encodingOrCallback as any, callback as any);
  } as typeof process.stdout.write;

  // Return cleanup function
  return () => {
    process.stdout.write = originalWrite as typeof process.stdout.write;
  };
}

// Parse CLI arguments
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
    process.exit(0);
  });
}
