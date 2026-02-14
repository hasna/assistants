# @hasna/assistants-core

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The core runtime library for building AI assistants. Provides the assistant loop, tool system, skills, hooks, and context management.

## Features

- **Assistant Loop**: Full conversation orchestration with Claude
- **Tool System**: Bash, filesystem, web tools + custom tool support
- **Skills**: Reusable prompt templates (SKILL.md format)
- **Hooks**: Pre/post tool execution hooks for validation
- **Context Management**: Automatic summarization and token management
- **Session Storage**: Local persistence with SQLite

## Installation

```bash
bun add @hasna/assistants-core @hasna/runtime-bun
```

## Quick Start

```typescript
import { setRuntime } from '@hasna/assistants-core';
import { bunRuntime } from '@hasna/runtime-bun';

// Initialize runtime first
setRuntime(bunRuntime);

import { AssistantLoop } from '@hasna/assistants-core';

// Create assistant loop
const assistant = new AssistantLoop({
  cwd: process.cwd(),
});

// Initialize
await assistant.initialize();

// Send a message
const response = await assistant.processMessage('Hello!');
console.log(response);

// Cleanup
assistant.stop();
```

## Core Components

### AssistantLoop

The main orchestrator that manages conversation flow, tool execution, and context.

```typescript
import { AssistantLoop } from '@hasna/assistants-core';

const assistant = new AssistantLoop({
  cwd: '/path/to/working/directory',
  sessionId: 'optional-session-id',
  config: {
    llm: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 8192,
    },
  },
});
```

### EmbeddedClient

A simplified client for embedding in other applications.

```typescript
import { EmbeddedClient } from '@hasna/assistants-core';

const client = new EmbeddedClient(process.cwd(), {
  systemPrompt: 'You are a helpful assistant.',
  allowedTools: ['Read', 'Write', 'Bash'],
});

client.onChunk((chunk) => {
  if (chunk.type === 'text') {
    console.log(chunk.content);
  }
});

await client.initialize();
await client.send('What files are here?');
client.disconnect();
```

### Tool Registry

Register custom tools for the assistant to use.

```typescript
import { ToolRegistry, type Tool, type ToolExecutor } from '@hasna/assistants-core';

const registry = new ToolRegistry();

const myTool: Tool = {
  name: 'my_tool',
  description: 'Does something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' },
    },
    required: ['input'],
  },
};

const executor: ToolExecutor = async (params) => {
  return { success: true, result: `Processed: ${params.input}` };
};

registry.register(myTool, executor);
```

### Skills

Skills are reusable prompt templates stored in SKILL.md files.

```typescript
import { SkillLoader, SkillExecutor } from '@hasna/assistants-core';

const loader = new SkillLoader([
  '~/.assistants/skills',
  './.assistants/skills',
]);

await loader.initialize();

const skills = loader.getSkills();
const executor = new SkillExecutor(loader);

// Execute a skill
const expandedPrompt = await executor.execute('code-review', 'src/main.ts');
```

### Hooks

Hooks allow you to intercept and modify assistant behavior at key lifecycle points. They can validate inputs, block actions, inject context, or perform cleanup.

#### Hook Events

| Event | Trigger | Use Cases |
|-------|---------|-----------|
| **PreToolUse** | Before a tool executes | Validate inputs, block dangerous commands |
| **PostToolUse** | After tool completes successfully | Log results, modify output |
| **PostToolUseFailure** | After tool fails | Error handling, retry logic |
| **PermissionRequest** | When user approval needed | Auto-approve, auto-deny patterns |
| **UserPromptSubmit** | When user sends a message | Input sanitization, context injection |
| **SessionStart** | When a new session begins | Initialize state, log session |
| **SessionEnd** | When session ends | Cleanup, analytics, summary |
| **SubassistantStart** | When spawning a subassistant | Validate task, modify config |
| **SubassistantStop** | When subassistant completes | Process results, cleanup |
| **PreCompact** | Before context compaction | Skip/delay compaction |
| **Notification** | When notification sent | Custom delivery, filtering |
| **Stop** | When assistant is stopping | Goal verification, cleanup |

#### Hook Types

| Type | Description |
|------|-------------|
| **command** | Execute a shell command. Input passed as JSON via stdin. Exit 0 = allow, Exit 2 = block |
| **prompt** | Single-turn LLM query. Must respond with `{"allow": boolean, "reason": string}` |
| **assistant** | Multi-turn assistant with tools. Must respond with ALLOW or DENY |

#### Configuration

Hooks are stored in JSON files that are loaded from multiple locations:
- `~/.assistants/hooks.json` - Global user hooks
- `.assistants/hooks.json` - Project-level hooks
- `.assistants/hooks.local.json` - Local hooks (gitignored)

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash|Edit|Write",
      "hooks": [
        {
          "id": "validate-dangerous",
          "name": "Validate dangerous commands",
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

#### Hook Input

Hooks receive a JSON object on stdin with context:

```typescript
interface HookInput {
  session_id: string;
  hook_event_name: string;
  cwd: string;
  // Event-specific fields:
  tool_name?: string;        // PreToolUse, PostToolUse, PermissionRequest
  tool_input?: object;       // PreToolUse, PostToolUse
  tool_result?: object;      // PostToolUse, PostToolUseFailure
  error?: string;            // PostToolUseFailure
  user_prompt?: string;      // UserPromptSubmit
  notification_type?: string; // Notification
  subassistant_id?: string;  // SubassistantStart, SubassistantStop
  task?: string;             // SubassistantStart
  status?: string;           // SubassistantStop
  strategy?: string;         // PreCompact
  reason?: string;           // SessionEnd, Stop
}
```

#### Hook Output

Hooks can return JSON to control execution:

```typescript
interface HookOutput {
  continue?: boolean;           // false = block
  stopReason?: string;         // Message when blocked
  systemMessage?: string;      // Inject into conversation
  additionalContext?: string;  // Add to context
  permissionDecision?: 'allow' | 'deny' | 'ask';  // PermissionRequest
  updatedInput?: object;       // Modify tool input
  skip?: boolean;              // PreCompact - skip compaction
}
```

#### Example: Block Dangerous Commands

```bash
#!/bin/bash
# validate.sh - Block dangerous Bash commands

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block rm -rf, sudo, etc.
if echo "$COMMAND" | grep -qE 'rm\s+-rf|sudo|shutdown|reboot'; then
  echo "Destructive command blocked" >&2
  exit 2
fi

exit 0
```

#### Programmatic Usage

```typescript
import { HookLoader, HookExecutor, HookStore, HookTester } from '@hasna/assistants-core';

// Load hooks
const loader = new HookLoader(process.cwd());
await loader.initialize();

// Execute hooks
const executor = new HookExecutor();
const result = await executor.execute(
  loader.getHooks('PreToolUse'),
  { session_id: 'abc', hook_event_name: 'PreToolUse', cwd: '/app', tool_name: 'Bash', tool_input: { command: 'ls' } }
);

if (result?.continue === false) {
  console.log('Blocked:', result.stopReason);
}

// Manage hooks
const store = new HookStore(process.cwd());
store.addHook('PreToolUse', {
  type: 'command',
  command: './validate.sh',
  name: 'Validate commands',
}, 'project', 'Bash');

// Test hooks
const tester = new HookTester(process.cwd());
const testResult = await tester.test(hook, 'PreToolUse');
console.log(testResult.action); // 'ALLOW', 'BLOCK', 'MODIFY', or 'ERROR'
```

#### Native Hooks

Native hooks are built-in hooks that cannot be deleted but can be enabled/disabled:

| Hook | Event | Description |
|------|-------|-------------|
| **scope-verification** | Stop | Verifies user goals were met before stopping |

```typescript
import { nativeHookRegistry } from '@hasna/assistants-core';

// Disable native hook
nativeHookRegistry.setEnabled('scope-verification', false);

// List native hooks
const hooks = nativeHookRegistry.listFlat();
```

## Configuration

Create `~/.assistants/config.json` or `.assistants/config.json`:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 8192
  },
  "context": {
    "maxContextTokens": 180000,
    "summaryStrategy": "hybrid",
    "keepRecentMessages": 10
  },
  "scheduler": {
    "enabled": true
  }
}
```

## Built-in Tools

| Tool | Description |
|------|-------------|
| **Bash** | Execute shell commands |
| **Read** | Read file contents |
| **Write** | Create/overwrite files |
| **Edit** | Make precise edits |
| **Glob** | Find files by pattern |
| **Grep** | Search file contents |
| **WebFetch** | Fetch web content |
| **WebSearch** | Search the web |
| **Wait** | Pause execution |

## Memory System

The memory system provides persistent storage for assistant memories across sessions. Memories are scoped, categorized, and can be automatically injected into conversations.

### Scopes

| Scope | Description |
|-------|-------------|
| **global** | Accessible to all assistants and sessions |
| **shared** | Shared between assistants (visible to current assistant + assistants it delegates to) |
| **private** | Private to the current assistant only |

### Categories

| Category | Description |
|----------|-------------|
| **preference** | User settings and choices (e.g., timezone, language) |
| **fact** | Known truths about the user or environment |
| **knowledge** | Learned information (e.g., API patterns, project structure) |
| **history** | Session context and conversation topics |

### Using the Memory Manager

```typescript
import { GlobalMemoryManager } from '@hasna/assistants-core';

const manager = new GlobalMemoryManager({
  dbPath: '/path/to/memory.db',
  defaultScope: 'private',
  scopeId: 'my-assistant-123',
});

// Store a memory
await manager.set('user.timezone', 'America/Los_Angeles', {
  category: 'preference',
  importance: 8,
  summary: 'User is in Pacific time',
  tags: ['user', 'timezone'],
});

// Retrieve a memory
const memory = await manager.get('user.timezone');
console.log(memory?.value); // 'America/Los_Angeles'

// Query memories
const prefs = await manager.query({
  category: 'preference',
  minImportance: 5,
  limit: 10,
});

// Get relevant memories for a context
const relevant = await manager.getRelevant('What time is it?', {
  categories: ['preference', 'fact'],
  minImportance: 5,
});

// Export/Import
const exported = await manager.export();
await manager.import(memoriesArray, { overwrite: true });
```

### Memory Injection

The `MemoryInjector` automatically includes relevant memories in the system prompt:

```typescript
import { MemoryInjector } from '@hasna/assistants-core';

const injector = new MemoryInjector(manager, {
  enabled: true,
  maxTokens: 500,
  minImportance: 5,
  categories: ['preference', 'fact'],
  refreshInterval: 5, // Refresh deduped memories every 5 turns
});

// Prepare injection for a user message
const { content, memoryIds, tokenEstimate } = await injector.prepareInjection(
  'Help me with this task'
);

// content is formatted markdown ready to include in system prompt
```

### Memory Commands

Users can manage memories via slash commands:

| Command | Description |
|---------|-------------|
| `/memory` | Show help and statistics |
| `/memory list [category]` | List memories with optional filters |
| `/memory get <key>` | Get a specific memory |
| `/memory set <key> <value>` | Save a memory |
| `/memory update <key> [opts]` | Update memory metadata |
| `/memory search <query>` | Search memories |
| `/memory delete <key>` | Delete a memory |
| `/memory stats` | Show detailed statistics |
| `/memory export [file]` | Export to JSON |
| `/memory import <file>` | Import from JSON |

### Memory Tools

Assistants can use memory tools programmatically:

| Tool | Description |
|------|-------------|
| `memory_save` | Save information to memory |
| `memory_recall` | Recall by key or search |
| `memory_list` | List memories with filters |
| `memory_forget` | Delete a memory |
| `memory_update` | Update metadata |
| `memory_stats` | Get statistics |
| `memory_export` | Export memories |
| `memory_import` | Import memories |

### Privacy Boundaries

- **Global memories** are accessible to all assistants
- **Private memories** are isolated by `scopeId` (typically the assistant ID)
- **Shared memories** can be accessed by the assistant and its delegates
- Memory queries enforce scope isolation to prevent data leakage
- Access logs track all read/write operations

### Configuration

```json
{
  "memory": {
    "enabled": true,
    "injection": {
      "enabled": true,
      "maxTokens": 500,
      "minImportance": 5,
      "categories": ["preference", "fact"],
      "refreshInterval": 5
    },
    "storage": {
      "maxEntries": 1000,
      "defaultTTL": null
    },
    "scopes": {
      "globalEnabled": true,
      "sharedEnabled": true,
      "privateEnabled": true
    }
  }
}
```

## Optional Features

These features require additional configuration:

| Feature | Requirement |
|---------|-------------|
| **Voice TTS** | `ELEVENLABS_API_KEY` |
| **Voice STT** | `OPENAI_API_KEY` |
| **Inbox** | AWS S3 + SES credentials |
| **Wallet** | AWS Secrets Manager |
| **Secrets** | AWS Secrets Manager |

## Related Packages

- **@hasna/assistants** - Terminal UI built on this core
- **@hasna/assistants-shared** - Shared types and utilities
- **@hasna/runtime-bun** - Bun runtime implementation

## License

MIT
