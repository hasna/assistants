# Feature Dependencies

This document describes the features available in the Assistants terminal package and their dependencies.

## Feature Matrix

| Feature | Required | Dependencies | Environment Variables | Notes |
|---------|----------|--------------|----------------------|-------|
| **Core Chat** | Yes | None | `ANTHROPIC_API_KEY` | Basic AI chat functionality |
| **Bash Tool** | Yes | None | None | Execute shell commands |
| **Filesystem Tools** | Yes | None | None | Read/write/edit files |
| **Web Fetch** | Yes | None | None | Fetch web content |
| **Skills** | Yes | None | None | Local SKILL.md files |
| **Hooks** | Yes | None | None | Local hooks.json |
| **Commands** | Yes | None | None | Slash commands (/help, /exit, etc.) |
| **Projects** | Yes | None | None | Local SQLite storage |
| **Plans** | Yes | None | None | Task planning within projects |
| **Scheduling** | Yes | None | None | Cron-like scheduled tasks |
| **Session Management** | Yes | None | None | Local session persistence |
| **Connectors** | Optional | connect-* CLIs | Varies per connector | Third-party integrations |
| **Voice TTS** | Optional | ElevenLabs API | `ELEVENLABS_API_KEY` | Text-to-speech output |
| **Voice STT** | Optional | OpenAI Whisper API | `OPENAI_API_KEY` | Speech-to-text input |
| **System TTS** | Optional | macOS `say` command | None | Built-in macOS TTS |
| **System STT** | Optional | macOS Dictation | None | Built-in macOS speech recognition |
| **Email Inbox** | Optional | AWS S3, SES | `AWS_*` credentials | Receive/send emails |
| **Secrets Storage** | Optional | AWS Secrets Manager | `AWS_*` credentials | Secure credential storage |
| **Wallet** | Optional | AWS Secrets Manager | `AWS_*` credentials | Crypto wallet management |
| **Identity** | Optional | None | None | Assistant identity management |

## Configuration Levels

### Minimum Configuration (Basic Chat)

The only required configuration to run the terminal:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

This enables:
- AI chat with Claude
- Bash command execution
- File reading/writing/editing
- Web content fetching
- Local skills and hooks
- Session history persistence

### Recommended Configuration

For most users, we recommend:

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Optional but useful
export EXA_API_KEY="..."  # Enhanced web search
```

This adds:
- Better web search capabilities via Exa

### Full-Featured Configuration

For all features:

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."

# Voice features
export ELEVENLABS_API_KEY="..."  # Premium TTS
export OPENAI_API_KEY="..."      # Whisper STT

# AWS features (inbox, secrets, wallet)
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_REGION="us-east-1"

# Optional enhancements
export EXA_API_KEY="..."  # Web search
```

## Environment Variables Reference

| Variable | Required | Feature | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Core | Claude API access |
| `ELEVENLABS_API_KEY` | No | Voice TTS | ElevenLabs text-to-speech |
| `OPENAI_API_KEY` | No | Voice STT | OpenAI Whisper speech-to-text |
| `EXA_API_KEY` | No | Web Search | Enhanced semantic search |
| `AWS_ACCESS_KEY_ID` | No | AWS Features | AWS authentication |
| `AWS_SECRET_ACCESS_KEY` | No | AWS Features | AWS authentication |
| `AWS_REGION` | No | AWS Features | AWS region (default: us-east-1) |

## Built-in Tools

These tools are always available and require no additional configuration:

### Bash Tool
Execute shell commands with configurable timeout and working directory tracking.

### Filesystem Tools
- **Read**: Read file contents
- **Write**: Create or overwrite files
- **Edit**: Make precise edits to existing files
- **Glob**: Find files by pattern
- **Grep**: Search file contents

### Web Tools
- **WebFetch**: Retrieve and process web page content
- **WebSearch**: Search the web (enhanced with Exa API if available)

### Feedback Tool
Request user input during task execution.

### Wait/Sleep Tools
Pause execution for specified durations.

## Optional Integrations

### Connectors
Connectors allow integration with external services like Notion, Google Drive, Gmail, etc.

Each connector is a separate CLI tool (`connect-notion`, `connect-googledrive`, etc.) that must be installed separately. The ConnectorBridge automatically discovers installed connectors.

**Installation:**
```bash
# Example: Install Notion connector
npm install -g @hasna/connect-notion
```

### Voice Features

**ElevenLabs TTS**: High-quality voice synthesis
```bash
export ELEVENLABS_API_KEY="your-key"
```

**OpenAI Whisper STT**: Accurate speech recognition
```bash
export OPENAI_API_KEY="your-key"
```

**System Voice** (macOS only): Uses built-in `say` command and Dictation - no API key needed.

### AWS Features

Email inbox, secrets storage, and wallet features require AWS credentials:

```bash
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
export AWS_REGION="us-east-1"
```

## Feature Detection

The terminal automatically detects available features at startup based on:

1. Environment variables present
2. CLI tools in PATH (for connectors)
3. Platform capabilities (macOS for system voice)

Missing optional features are silently skipped - the terminal will work with whatever is available.

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
Set your API key: `export ANTHROPIC_API_KEY="sk-ant-..."`

### Connector not found
Install the specific connector CLI, e.g., `npm install -g @hasna/connect-notion`

### Voice not working
- **ElevenLabs**: Check `ELEVENLABS_API_KEY` is set correctly
- **Whisper**: Check `OPENAI_API_KEY` is set correctly
- **System voice**: Only available on macOS

### AWS features not working
Ensure all three AWS variables are set:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
