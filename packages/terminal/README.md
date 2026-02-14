# @hasna/assistants

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A general-purpose AI assistant that runs in your terminal. Built with [Ink](https://github.com/vadimdemedes/ink).

**Not just for coding** - while it excels at development workflows, this assistant helps with research, writing, task management, automation, and any task you need assistance with.

## Features

- General-purpose assistant for any task
- Interactive chat with AI
- Execute bash commands with approval
- Read, write, and edit files
- Fetch and search web content
- Custom skills and hooks for domain-specific workflows
- Project and plan management
- Memory and context persistence across sessions
- Session history and resumption
- Identity management for different contexts
- Voice input/output (optional)
- Connectors for external services (Notion, Gmail, Linear, etc.)

## Installation

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.0 or later)
- [Anthropic API key](https://console.anthropic.com/)

### Install globally

```bash
bun add -g @hasna/assistants
```

### Or run directly

```bash
bunx @hasna/assistants
```

## Quick Start

1. Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

2. Start the assistant:

```bash
assistants
# or use the short alias
ast
```

3. Start chatting!

## CLI Reference

### Basic Usage

```bash
# Start interactive mode
assistants

# Run in headless mode (non-interactive)
assistants -p "What does this codebase do?"
```

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |
| `-p, --print <prompt>` | Run non-interactively with the given prompt |
| `--output-format <format>` | Output format: `text` (default), `json`, `stream-json` |
| `--allowed-tools <tools>` | Comma-separated tools to auto-approve |
| `--system-prompt <prompt>` | Custom system prompt |
| `--json-schema <schema>` | JSON Schema for structured output |
| `-c, --continue` | Continue the most recent conversation |
| `-r, --resume <session_id>` | Resume a specific session by ID |
| `--cwd <path>` | Set working directory |

### Headless Mode Examples

```bash
# Ask a question
assistants -p "What does the auth module do?"

# Run with JSON output
assistants -p "Summarize this project" --output-format json

# Stream JSON events
assistants -p "Explain this code" --output-format stream-json

# Auto-approve specific tools
assistants -p "Fix the bug in auth.py" --allowed-tools "Read,Edit,Bash"

# Get structured output with JSON Schema
assistants -p "List all functions" --output-format json \
  --json-schema '{"type":"array","items":{"type":"string"}}'

# Continue a previous conversation
assistants -p "What else can you tell me?" --continue

# Resume a specific session
assistants -p "Continue from where we left off" --resume abc123
```

## Interactive Mode

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+C` | Stop current operation or exit |
| `Ctrl+]` | Switch sessions |
| `Up/Down` | Navigate command history |
| `Tab` | Autocomplete commands |

### Shell Passthrough

Prefix a line with `!` to run a local shell command and send the output to the assistant:

```bash
!ls -la
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/exit` | Exit the assistant |
| `/new` | Start a new session |
| `/clear` | Clear the screen |
| `/session` | Show current session info |
| `/tokens` | Show token usage |
| `/context` | Show/manage context window |
| `/cost` | Show estimated cost |
| `/status` | Show system status |
| `/model` | Show/change model settings |
| `/config` | Show/edit configuration |
| `/init` | Initialize project settings |

### Project & Plan Commands

| Command | Description |
|---------|-------------|
| `/projects` | List and manage projects |
| `/plans` | View and manage plans |
| `/summarize` | Summarize the conversation |
| `/compact` | Compact context to save tokens |

### Scheduling Commands

| Command | Description |
|---------|-------------|
| `/schedule` | Create a scheduled task |
| `/schedules` | List scheduled tasks |
| `/unschedule` | Remove a scheduled task |
| `/pause` | Pause a schedule |
| `/resume` | Resume a paused schedule |

### Skills & Connectors

| Command | Description |
|---------|-------------|
| `/skills` | List available skills |
| `/skill <name>` | Execute a skill |
| `/connectors` | List available connectors |

### Hooks Commands

| Command | Description |
|---------|-------------|
| `/hooks` | Open interactive hooks panel |
| `/hooks list` | List all hooks (native + user) |
| `/hooks enable <id>` | Enable a hook |
| `/hooks disable <id>` | Disable a hook |
| `/hooks test <id>` | Test a hook with sample input |
| `/hooks help` | Show hooks help |

### Advanced Commands

| Command | Description |
|---------|-------------|
| `/voice` | Toggle voice mode |
| `/say <text>` | Speak text aloud |
| `/talk` | Live voice conversation (pause ~2s to send) |
| `/identity` | Manage assistant identity |
| `/whoami` | Show current identity |
| `/assistant` | Configure assistant settings |
| `/inbox` | Check email inbox |
| `/wallet` | Manage crypto wallet |
| `/secrets` | Manage secrets |
| `/jobs` | View background jobs |
| `/messages` | Assistant-to-assistant messages |
| `/verification` | Manage verification sessions |
| `/memory` | View memory usage |
| `/rest` | Enter rest mode |
| `/feedback` | Submit feedback |
| `/security-log` | View security events |

## Configuration

### Directory Structure

```
~/.assistants/
├── config.json        # Global configuration
├── sessions/          # Session history
├── skills/            # Custom skills
├── hooks.json         # Global hooks
└── schedules/         # Scheduled tasks

.assistants/           # Project-level (in any directory)
├── config.json        # Project configuration
├── skills/            # Project-specific skills
└── hooks.json         # Project-specific hooks
```

### Configuration File

Create `~/.assistants/config.json`:

```json
{
  "model": "claude-sonnet-4-20250514",
  "temperature": 0.7,
  "maxTokens": 8192,
  "connectors": ["notion", "googledrive"],
  "voice": {
    "tts": "elevenlabs",
    "stt": "whisper"
  }
}
```

### Project Configuration

Create `.assistants/config.json` in your project:

```json
{
  "name": "My Project",
  "description": "Project description",
  "systemPrompt": "You are helping with a Node.js backend project.",
  "context": [
    "src/README.md",
    "docs/architecture.md"
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `ELEVENLABS_API_KEY` | No | ElevenLabs TTS |
| `OPENAI_API_KEY` | No | Whisper STT |
| `EXA_API_KEY` | No | Enhanced web search |
| `AWS_ACCESS_KEY_ID` | No | AWS features |
| `AWS_SECRET_ACCESS_KEY` | No | AWS features |
| `AWS_REGION` | No | AWS region |
| `ASSISTANTS_NO_SYNC` | No | Disable synchronized output (set to `1`) |

## Skills

Skills are reusable prompts defined in `SKILL.md` files:

```markdown
---
name: code-review
description: Review code for issues and improvements
argument-hint: <file-path>
allowed-tools: Read, Grep
---

## Instructions

Review the code at $ARGUMENTS and provide feedback on:
1. Potential bugs
2. Performance issues
3. Code style
4. Security concerns
```

Place in `~/.assistants/skills/code-review/SKILL.md` or `.assistants/skills/code-review/SKILL.md`.

Use with `/skill code-review src/auth.ts` or `$code-review src/auth.ts`.

## Hooks

Hooks intercept assistant behavior at key lifecycle points. Use them to validate inputs, block dangerous actions, log activity, or inject context.

### Managing Hooks

Use the interactive panel:
```
/hooks
```

Or manage via commands:
```
/hooks list           # List all hooks
/hooks enable abc123  # Enable a hook by ID
/hooks disable abc123 # Disable a hook
/hooks test abc123    # Test a hook with sample input
```

### Hook Events

| Event | When Triggered |
|-------|----------------|
| **PreToolUse** | Before any tool executes |
| **PostToolUse** | After tool succeeds |
| **PostToolUseFailure** | After tool fails |
| **PermissionRequest** | When approval needed |
| **UserPromptSubmit** | User sends message |
| **SessionStart** | Session begins |
| **SessionEnd** | Session ends |
| **SubassistantStart** | Subassistant spawning |
| **SubassistantStop** | Subassistant completes |
| **PreCompact** | Before context compaction |
| **Notification** | Notification sent |
| **Stop** | Assistant stopping |

### Configuration

Create `.assistants/hooks.json` in your project:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash|Edit|Write",
      "hooks": [
        {
          "id": "validate-commands",
          "name": "Validate dangerous commands",
          "description": "Blocks rm -rf, sudo, etc.",
          "type": "command",
          "command": "./scripts/validate.sh",
          "timeout": 5000,
          "enabled": true
        }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "Edit",
      "hooks": [
        {
          "type": "command",
          "command": "prettier --write \"$INPUT_file_path\"",
          "async": true
        }
      ]
    }
  ]
}
```

### Creating Hooks via Wizard

Press `a` in the hooks panel to launch the interactive wizard:

1. Select event type (PreToolUse, PostToolUse, etc.)
2. Enter matcher pattern (regex or `*` for all)
3. Choose hook type (command, prompt, assistant)
4. Enter command or prompt
5. Set timeout and async options
6. Choose save location (user, project, local)

### Example: Block Dangerous Commands

```bash
#!/bin/bash
# .assistants/scripts/validate.sh
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE 'rm\s+-rf|sudo|shutdown'; then
  echo "Blocked: dangerous command" >&2
  exit 2  # Exit 2 = block
fi

exit 0  # Exit 0 = allow
```

### Native Hooks

Built-in hooks that can be enabled/disabled:

| Hook | Event | Description |
|------|-------|-------------|
| **scope-verification** | Stop | Verifies goals were met |

Manage native hooks via `/hooks` panel or commands.

## Programmatic Usage

### EmbeddedClient (Full Control)

```typescript
import { EmbeddedClient } from '@hasna/assistants';

// Create client with working directory
const client = new EmbeddedClient(process.cwd(), {
  systemPrompt: 'You are a helpful coding assistant.',
  allowedTools: ['Read', 'Write', 'Edit', 'Bash'],
});

// Handle streaming chunks
client.onChunk((chunk) => {
  if (chunk.type === 'text' && chunk.content) {
    process.stdout.write(chunk.content);
  }
});

// Initialize and send a message
await client.initialize();
await client.send('What files are in this directory?');

// Get session info
console.log('Session ID:', client.getSessionId());
console.log('Token usage:', client.getTokenUsage());

// Cleanup
client.disconnect();
```

### Headless Mode (Simple Queries)

```typescript
import { runHeadless } from '@hasna/assistants';

// Run a simple query with JSON output
await runHeadless({
  prompt: 'Summarize this project in 3 bullet points',
  cwd: process.cwd(),
  outputFormat: 'json',
});

// Stream JSON events
await runHeadless({
  prompt: 'Explain the authentication system',
  cwd: process.cwd(),
  outputFormat: 'stream-json',
});

// Auto-approve tools
await runHeadless({
  prompt: 'Fix the bug in auth.ts',
  cwd: process.cwd(),
  outputFormat: 'text',
  allowedTools: ['Read', 'Edit'],
});
```

### Feature Detection

```typescript
import { getFeatureAvailability, getFeatureStatusMessage } from '@hasna/assistants';

// Check what features are available
const features = getFeatureAvailability();
console.log('Core chat:', features.coreChat);     // true if ANTHROPIC_API_KEY set
console.log('AWS features:', features.awsFeatures); // true if AWS configured

// Get human-readable status
console.log(getFeatureStatusMessage());
```

## Connectors

Connectors integrate external services. Install separately:

```bash
# Example: Notion connector
bun add -g @hasna/connect-notion

# List available connectors
assistants
/connectors
```

## Troubleshooting

### "ANTHROPIC_API_KEY not set"

Set your API key:
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### Terminal rendering issues

Try disabling synchronized output:
```bash
ASSISTANTS_NO_SYNC=1 assistants
```

### Slow startup

The first run may take longer as dependencies are cached. Subsequent runs will be faster.

### Session not found

Sessions are stored in `~/.assistants/sessions/`. Use `/session` to see current session info.

## License

MIT

## See Also

- [FEATURES.md](./FEATURES.md) - Detailed feature documentation
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Bun Documentation](https://bun.sh/docs)
