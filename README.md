# @hasna/assistants

A general-purpose AI assistant that runs in your terminal. Built with [Ink](https://github.com/vadimdemedes/ink), powered by [Claude](https://anthropic.com).

**Not just for coding** — this assistant helps with research, writing, task management, automation, and anything you need.

## Install

```bash
bun add -g @hasna/assistants
```

Or run directly:

```bash
bunx @hasna/assistants
```

## Quick Start

1. Set your API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

2. Start the assistant:

```bash
assistants
```

That's it. Start chatting.

## Features

- Interactive terminal chat with Claude
- Execute bash commands with approval
- Read, write, and edit files
- Web search and content fetching
- Custom skills (reusable prompt templates)
- Hooks (lifecycle interceptors for safety and automation)
- Memory persistence across sessions
- Session history and resumption
- Voice input/output (optional)
- Connectors for external services (Notion, Gmail, Linear, etc.)
- Multi-agent coordination
- Scheduling and background tasks
- Project and plan management

## CLI

```bash
# Interactive mode
assistants

# Short alias
ast

# Run a one-off prompt
assistants -p "What does this codebase do?"

# JSON output
assistants -p "Summarize this project" --output-format json

# Stream JSON events
assistants -p "Explain this code" --output-format stream-json

# Auto-approve specific tools
assistants -p "Fix the bug" --allowed-tools "Read,Edit,Bash"

# Continue last conversation
assistants --continue

# Resume a specific session
assistants --resume <session_id>
```

## Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/exit` | Exit the assistant |
| `/new` | Start a new session |
| `/skills` | List available skills |
| `/hooks` | Manage hooks |
| `/connectors` | List connectors |
| `/memory` | View/manage memory |
| `/model` | Show/change model |
| `/config` | Show/edit configuration |
| `/schedule` | Create a scheduled task |
| `/voice` | Toggle voice mode |

Prefix with `!` to run a shell command: `!ls -la`

## Skills

Skills are reusable prompts in SKILL.md files:

```markdown
---
name: code-review
description: Review code for issues
argument-hint: <file-path>
allowed-tools: Read, Grep
---

Review the code at $ARGUMENTS and provide feedback on:
1. Potential bugs
2. Performance issues
3. Security concerns
```

Place in `~/.assistants/skills/code-review/SKILL.md` or `.assistants/skills/code-review/SKILL.md`.

## Hooks

Hooks intercept assistant behavior at lifecycle points:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "./validate.sh",
          "timeout": 5000
        }
      ]
    }
  ]
}
```

Events: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`, `Stop`, and more.

## Configuration

```
~/.assistants/           # Global
├── config.json
├── sessions/
├── skills/
└── hooks.json

.assistants/             # Project-level
├── config.json
├── skills/
└── hooks.json
```

## Programmatic Usage

```typescript
import { EmbeddedClient } from '@hasna/assistants';

const client = new EmbeddedClient(process.cwd(), {
  systemPrompt: 'You are a helpful assistant.',
  allowedTools: ['Read', 'Write', 'Bash'],
});

client.onChunk((chunk) => {
  if (chunk.type === 'text') process.stdout.write(chunk.content);
});

await client.initialize();
await client.send('What files are in this directory?');
client.disconnect();
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `OPENAI_API_KEY` | No | Whisper STT + OpenAI models |
| `ELEVENLABS_API_KEY` | No | Voice TTS |
| `EXA_API_KEY` | No | Enhanced web search |

## Requirements

- [Bun](https://bun.sh) v1.0+
- An [Anthropic API key](https://console.anthropic.com/)

## Development

```bash
git clone https://github.com/hasna/assistants.git
cd assistants
pnpm install
pnpm dev
```

## License

Apache-2.0
