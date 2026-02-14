# @hasna/assistants-mcp

MCP (Model Context Protocol) server for running AI assistants. Connect your assistants to Claude Desktop, Cursor, or any MCP-compatible client.

## Tools

| Tool | Description |
|------|-------------|
| `chat` | Send a message to the assistant with full tool access |
| `run_prompt` | Run a one-shot prompt and get the result |
| `list_sessions` | List previous sessions that can be resumed |
| `get_session` | Get messages and details of a specific session |
| `list_skills` | List available skills (SKILL.md files) |
| `execute_skill` | Run a specific skill with arguments |

## Setup

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "assistants": {
      "command": "bun",
      "args": ["run", "/path/to/assistants/packages/mcp/src/index.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

### Cursor

Add to your MCP settings:

```json
{
  "assistants": {
    "command": "bun",
    "args": ["run", "/path/to/assistants/packages/mcp/src/index.ts"]
  }
}
```

## Development

```bash
# Run the MCP server directly
bun run packages/mcp/src/index.ts

# Build for distribution
cd packages/mcp && bun run build
```

## License

MIT
