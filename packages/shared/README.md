# @hasna/assistants-shared

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Shared types and utilities for the Hasna Assistants ecosystem. This package provides TypeScript type definitions used across `@hasna/assistants-core` and `@hasna/assistants`.

## Installation

```bash
bun add @hasna/assistants-shared
```

## Usage

```typescript
import type {
  Message,
  Tool,
  ToolCall,
  ToolResult,
  StreamChunk,
  TokenUsage,
} from '@hasna/assistants-shared';
```

## Type Categories

### Message Types

```typescript
import type { Message, MessageRole, StreamChunk, TokenUsage } from '@hasna/assistants-shared';

const message: Message = {
  id: 'msg-123',
  role: 'assistant',
  content: 'Hello!',
  timestamp: Date.now(),
};
```

### Tool Types

```typescript
import type { Tool, ToolCall, ToolResult, ToolParameters } from '@hasna/assistants-shared';

const myTool: Tool = {
  name: 'my_tool',
  description: 'A custom tool',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' },
    },
    required: ['input'],
  },
};
```

### Configuration Types

```typescript
import type { AssistantsConfig, LLMConfig, VoiceConfig } from '@hasna/assistants-shared';

const config: AssistantsConfig = {
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    maxTokens: 8192,
  },
};
```

### Hook Types

```typescript
import type { HookConfig, HookEvent, HookInput, HookOutput } from '@hasna/assistants-shared';
```

### Skill Types

```typescript
import type { Skill, SkillMetadata } from '@hasna/assistants-shared';
```

## Utilities

### ID Generation

```typescript
import { generateId } from '@hasna/assistants-shared';

const id = generateId(); // e.g., "a1b2c3d4e5f6"
```

## Complete Type List

### Core Types
- `Message`, `MessageRole`
- `StreamChunk`
- `TokenUsage`

### Tool Types
- `Tool`, `ToolParameters`, `ToolProperty`
- `ToolCall`, `ToolResult`
- `AskUserQuestion`, `AskUserResponse`

### Configuration Types
- `AssistantsConfig`
- `LLMConfig`
- `VoiceConfig`, `STTConfig`, `TTSConfig`
- `ContextConfig`
- `EnergyConfig`
- `SchedulerConfig`
- `HeartbeatConfig`
- `InboxConfig`, `WalletConfig`, `SecretsConfig`
- `MessagesConfig`, `JobsConfig`
- `ValidationConfig`

### Hook Types
- `HookConfig`, `HookMatcher`
- `HookEvent`, `HookInput`, `HookOutput`
- `NativeHook`, `NativeHookHandler`, `NativeHookConfig`
- `ScopeContext`, `VerificationSession`, `VerificationResult`

### Skill Types
- `Skill`, `SkillMetadata`

### Energy Types
- `EnergyState`

### Document Types
- `DocumentAttachment`, `DocumentSource`

## License

MIT
