# Agent Instructions

## Project: @hasna/assistants

Open-source terminal AI assistant published on npm as `@hasna/assistants`.

## What This Project Is

A general-purpose AI assistant that runs in your terminal. It's not just for coding — it handles research, writing, task management, automation, and more. Think of it as a personal assistant you talk to in your terminal.

Key capabilities:
- Interactive chat with Claude (and other LLMs)
- Execute bash commands, read/write files
- Custom skills (reusable prompt templates)
- Hooks (lifecycle interceptors for safety and automation)
- Connectors (integrations with external services)
- Memory persistence across sessions (SQLite)
- Voice input/output (optional)
- Multi-agent coordination (swarm)
- Scheduling and background tasks

## Repository Structure

This is a monorepo with 4 packages:

| Package | Purpose |
|---------|---------|
| `packages/core` | Agent loop, tools, skills, hooks, LLM client, connectors, memory — the brain |
| `packages/terminal` | Ink-based terminal UI — the face |
| `packages/shared` | Types, model catalog, utilities — shared between all packages |
| `packages/runtime-bun` | Bun-specific bindings (SQLite, filesystem) — the platform layer |

The root `build.ts` bundles everything into a single `dist/index.js` for npm publishing.

## Development Workflow

```bash
# Install dependencies
pnpm install

# Run in development
pnpm dev

# Build for distribution
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Key Decisions

- **Bun-first**: We use Bun as the runtime. All Bun APIs are preferred over Node equivalents.
- **SQLite for persistence**: Local-first. No external database servers needed. Everything stores in `~/.assistants/`.
- **Single-file distribution**: The build bundles all workspace packages into one `dist/index.js`. Zero runtime npm dependencies.
- **Skills over plugins**: Extensibility is through SKILL.md files (declarative prompts), not code plugins.
- **Hooks for safety**: Lifecycle hooks validate tool usage, block dangerous commands, inject context.

## What We're Building

This is the open-source version of the assistant. The goal is to make it:

1. **Easy to install**: `bun add -g @hasna/assistants` and you're running
2. **Works standalone**: No servers, no databases to set up. Just an API key and go.
3. **Extensible**: Skills, hooks, and connectors let users customize everything
4. **Multi-model**: Claude is the default, but OpenAI and other providers are supported
5. **Privacy-first**: Everything runs locally. Data stays on your machine in SQLite.

## Contributing Guidelines

- Write tests for new features
- Follow Conventional Commits
- Keep the single-file build working — if you add a dependency, make sure it bundles
- Don't break the standalone experience — the assistant must work with just `ANTHROPIC_API_KEY`
- UI components go in `packages/terminal/src/components/`
- Core logic goes in `packages/core/src/`
- Shared types go in `packages/shared/src/`
