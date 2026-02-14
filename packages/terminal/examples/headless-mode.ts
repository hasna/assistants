#!/usr/bin/env bun
/**
 * Headless Mode Example
 *
 * This example shows how to use the assistant in headless mode,
 * which is useful for scripting and automation.
 *
 * Usage:
 *   bun run examples/headless-mode.ts
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY environment variable
 */

import { runHeadless } from '../src/lib';

async function textOutput() {
  console.log('=== Text Output ===\n');

  // Simple text output - streams directly to stdout
  await runHeadless({
    prompt: 'List 3 benefits of TypeScript in one line each.',
    cwd: process.cwd(),
    outputFormat: 'text',
  });

  console.log('\n');
}

async function jsonOutput() {
  console.log('=== JSON Output ===\n');

  // Capture this separately to avoid mixing with the output
  // JSON mode returns a structured response at the end
  await runHeadless({
    prompt: 'What is 2 + 2? Reply with just the number.',
    cwd: process.cwd(),
    outputFormat: 'json',
  });

  console.log('\n');
}

async function streamJsonOutput() {
  console.log('=== Stream JSON Output ===\n');

  // Stream JSON mode outputs each event as a JSON line
  // Useful for real-time processing
  await runHeadless({
    prompt: 'Say "Hello World" and nothing else.',
    cwd: process.cwd(),
    outputFormat: 'stream-json',
  });

  console.log('\n');
}

async function withAllowedTools() {
  console.log('=== With Allowed Tools ===\n');

  // Auto-approve specific tools for automation
  // Be careful - this allows the assistant to run commands!
  await runHeadless({
    prompt: 'What files are in the current directory? Just list the names.',
    cwd: process.cwd(),
    outputFormat: 'text',
    allowedTools: ['Bash'], // Auto-approve Bash tool
  });

  console.log('\n');
}

async function main() {
  await textOutput();
  await jsonOutput();
  await streamJsonOutput();
  await withAllowedTools();

  console.log('Done!');
}

main().catch(console.error);
