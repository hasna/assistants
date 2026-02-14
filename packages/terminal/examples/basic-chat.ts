#!/usr/bin/env bun
/**
 * Basic Chat Example
 *
 * This example shows the simplest way to interact with the assistant.
 * It sends a single message and prints the response.
 *
 * Usage:
 *   bun run examples/basic-chat.ts
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY environment variable
 */

import { EmbeddedClient } from '../src/lib';

async function main() {
  // Create a client with the current working directory
  const client = new EmbeddedClient(process.cwd(), {
    // Optional: customize the system prompt
    systemPrompt: 'You are a helpful assistant. Be concise.',
  });

  // Handle streaming text output
  client.onChunk((chunk) => {
    if (chunk.type === 'text' && chunk.content) {
      process.stdout.write(chunk.content);
    }
  });

  // Handle errors
  client.onError((error) => {
    console.error('Error:', error.message);
  });

  console.log('Initializing assistant...\n');

  // Initialize the client (loads config, skills, hooks)
  await client.initialize();

  console.log('Assistant: ');

  // Send a message and wait for the response
  await client.send('What is the capital of France? Answer in one sentence.');

  // Print newline after response
  console.log('\n');

  // Get token usage
  const usage = client.getTokenUsage();
  console.log('Token usage:', {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.totalTokens,
  });

  // Cleanup
  client.disconnect();
}

main().catch(console.error);
