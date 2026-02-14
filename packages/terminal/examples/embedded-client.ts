#!/usr/bin/env bun
/**
 * Embedded Client Example
 *
 * This example shows how to embed the assistant in another application.
 * The EmbeddedClient gives you full control over the interaction.
 *
 * Usage:
 *   bun run examples/embedded-client.ts
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY environment variable
 */

import { EmbeddedClient } from '../src/lib';
import type { StreamChunk } from '@hasna/assistants-shared';

async function main() {
  console.log('Creating embedded client...\n');

  // Create client with options
  const client = new EmbeddedClient(process.cwd(), {
    // Custom session ID (optional - auto-generated if not provided)
    sessionId: `example-${Date.now()}`,

    // Custom system prompt
    systemPrompt: `You are a helpful coding assistant.
When asked about code, provide clear explanations.
Keep responses concise.`,

    // Auto-approve these tools (use with caution!)
    allowedTools: ['Read', 'Glob'],
  });

  // Track all tool calls
  const toolCalls: Array<{ name: string; input: unknown }> = [];

  // Handle streaming chunks
  client.onChunk((chunk: StreamChunk) => {
    switch (chunk.type) {
      case 'text':
        // Stream text to stdout
        if (chunk.content) {
          process.stdout.write(chunk.content);
        }
        break;

      case 'tool_use':
        // Log tool usage
        if (chunk.toolCall) {
          toolCalls.push({
            name: chunk.toolCall.name,
            input: chunk.toolCall.input,
          });
          console.log(`\n[Tool: ${chunk.toolCall.name}]`);
        }
        break;

      case 'tool_result':
        // Tool results are handled internally
        break;

      case 'error':
        console.error('\n[Error]:', chunk.error);
        break;

      case 'done':
        console.log('\n[Done]');
        break;
    }
  });

  // Handle client errors
  client.onError((error: Error) => {
    console.error('Client error:', error.message);
  });

  // Initialize the client
  console.log('Initializing...\n');
  await client.initialize();

  // Send a message
  console.log('Assistant: ');
  await client.send('What TypeScript files are in the src folder? List just the filenames.');

  // Print summary
  console.log('\n\n=== Summary ===');
  console.log('Session ID:', client.getSessionId());

  const usage = client.getTokenUsage();
  console.log('Tokens:', {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  });

  console.log('Tool calls:', toolCalls.length);
  for (const call of toolCalls) {
    console.log(`  - ${call.name}`);
  }

  // Cleanup
  client.disconnect();
}

main().catch(console.error);
