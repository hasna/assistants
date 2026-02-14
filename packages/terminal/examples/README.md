# Examples

These examples demonstrate how to use `@hasna/assistants` programmatically.

## Prerequisites

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Running Examples

```bash
# Run from the terminal package directory
cd packages/terminal

# Basic chat
bun run examples/basic-chat.ts

# Headless mode (scripting)
bun run examples/headless-mode.ts

# Embedded client (full control)
bun run examples/embedded-client.ts

# Feature detection (no API key needed)
bun run examples/feature-detection.ts
```

## Example Descriptions

### basic-chat.ts

The simplest example - sends a message and prints the response.

```typescript
const client = new EmbeddedClient(process.cwd());
await client.initialize();
await client.send('Hello!');
```

### headless-mode.ts

Shows how to run without a UI - useful for scripting and automation:
- Text output (streaming)
- JSON output (structured)
- Stream JSON (real-time events)
- Auto-approved tools

### embedded-client.ts

Full control over the assistant:
- Custom system prompt
- Event handling (text, tools, errors)
- Token usage tracking
- Tool call logging

### feature-detection.ts

Check which features are available without making any API calls:
- Core chat availability
- AWS features
- Voice features
- Search features

## Common Patterns

### Stream text to stdout

```typescript
client.onChunk((chunk) => {
  if (chunk.type === 'text' && chunk.content) {
    process.stdout.write(chunk.content);
  }
});
```

### Handle tool calls

```typescript
client.onChunk((chunk) => {
  if (chunk.type === 'tool_use' && chunk.toolCall) {
    console.log(`Using tool: ${chunk.toolCall.name}`);
  }
});
```

### Auto-approve tools

```typescript
const client = new EmbeddedClient(process.cwd(), {
  allowedTools: ['Read', 'Write', 'Bash'],
});
```

### Custom system prompt

```typescript
const client = new EmbeddedClient(process.cwd(), {
  systemPrompt: 'You are a helpful coding assistant.',
});
```
