# @hasna/assistants - Development Guide

## Project Overview

A general-purpose AI assistant that runs in your terminal. Built with Ink (React for terminals), powered by Claude. Not just for coding — it helps with research, writing, task management, automation, and anything you need.

Published as `@hasna/assistants` on npm. Install with `bun add -g @hasna/assistants`.

## Tech Stack

- **Runtime**: Bun
- **Package Manager**: pnpm with workspaces
- **Monorepo**: Turborepo
- **Terminal UI**: Ink (React for terminals)
- **LLM**: Claude API (Anthropic SDK) + OpenAI API
- **Database**: SQLite (local, via `bun:sqlite`)
- **Language**: TypeScript (strict mode)

## Project Structure

```
packages/
├── core/           # Platform-agnostic assistant runtime
│   ├── agent/      # Assistant loop and context management
│   ├── tools/      # Tool registry and built-in tools
│   ├── skills/     # Skill loading and execution
│   ├── hooks/      # Hook loading and execution
│   ├── memory/     # SQLite persistence
│   ├── llm/        # LLM client abstraction
│   ├── connectors/ # External service integrations
│   ├── channels/   # Multi-channel messaging
│   ├── contacts/   # Address book
│   ├── sessions/   # Session management
│   ├── security/   # Input validation and safety
│   └── swarm/      # Multi-agent coordination
├── terminal/       # Ink-based terminal UI
│   ├── components/ # React components for terminal
│   ├── hooks/      # React hooks (useListNavigation, etc.)
│   └── cli/        # CLI entry point and commands
├── shared/         # Shared types and utilities
│   ├── types.ts    # Core type definitions
│   ├── models.ts   # LLM model catalog
│   └── utils.ts    # Shared utilities
└── runtime-bun/    # Bun runtime bindings (SQLite, filesystem)
```

## Key Files

- `build.ts` — Root build script that bundles everything into `dist/index.js`
- `package.json` — Root package.json (this is what gets published to npm)
- `config/settings.json` — Default settings (LLM model, voice, connectors)
- `config/hooks.json` — Default hooks configuration
- `.assistants/` — Built-in skills and commands

## Commands

```bash
# Development
pnpm dev              # Run terminal app locally
pnpm build            # Build distributable (dist/index.js)
pnpm typecheck        # Type check all packages
pnpm test             # Run all tests

# Run directly from source
bun run packages/terminal/src/index.tsx

# Publish to npm
pnpm build && npm publish
```

## Build System

The build (`build.ts`) uses Bun's bundler to compile `packages/terminal/src/index.tsx` into a single self-contained `dist/index.js`. All workspace packages (core, shared, runtime-bun) are **bundled inline** — the published package has zero npm dependencies at runtime.

The build also:
- Adds a `#!/usr/bin/env bun` shebang
- Polyfills the `__promiseAll` Bun bundler bug
- Copies `.assistants/skills`, `.assistants/commands`, and `config/` into `dist/`

## Architecture

### How the pieces fit together

```
User Input → Terminal (Ink UI) → Core (Agent Loop) → LLM (Claude API)
                                      ↓
                              Tool Registry → Built-in Tools (Bash, Read, Write, etc.)
                                      ↓
                              Skills, Hooks, Connectors
                                      ↓
                              SQLite (sessions, memory, schedules)
```

### Key Patterns

- **Runtime abstraction**: Core doesn't depend on Bun directly. It uses `packages/runtime-bun` for platform-specific APIs (SQLite, filesystem). This allows future runtimes (Node, Deno).
- **Workspace packages use `workspace:*`** in devDependencies — the build inlines them.
- **Skills** follow the `SKILL.md` format with YAML frontmatter.
- **Hooks** are JSON-configured lifecycle interceptors (PreToolUse, PostToolUse, etc.).
- **Connectors** are external CLIs (`connect-notion`, `connect-gmail`) discovered at runtime.

## Testing

```bash
# Run all tests
pnpm test

# Run specific package tests
cd packages/core && bun test
cd packages/terminal && bun test
cd packages/shared && bun test

# Run specific test file
bun test packages/core/tests/agent.test.ts
```

Tests use Bun's native test runner (`bun:test`). Test files live in `tests/` directories within each package.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API access |
| `OPENAI_API_KEY` | No | Whisper STT + OpenAI models |
| `ELEVENLABS_API_KEY` | No | Voice TTS |
| `EXA_API_KEY` | No | Enhanced web search |
| `AWS_ACCESS_KEY_ID` | No | AWS features (inbox, secrets) |
| `AWS_SECRET_ACCESS_KEY` | No | AWS features |
| `AWS_REGION` | No | AWS region |

## Publishing

The package is published as `@hasna/assistants` with public access:

```bash
pnpm build
npm publish --access public
```

The published artifact includes:
- `dist/index.js` — Single bundled CLI (self-contained, ~11MB)
- `dist/index.js.map` — Source map
- `dist/.assistants/` — Built-in skills and commands
- `dist/config/` — Default configuration
- `README.md`, `LICENSE`

Users install with:
```bash
bun add -g @hasna/assistants
# or
bunx @hasna/assistants
```

## Coding Conventions

- Use `bun` instead of `npm`, `yarn`, `pnpm` for running commands
- Prefer Bun APIs (`Bun.file`, `Bun.write`, `Bun.build`) over Node equivalents
- TypeScript strict mode — no `any` types without justification
- Imports use `@hasna/assistants-core`, `@hasna/assistants-shared`, `@hasna/runtime-bun`
- Commits follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`

## Adding a New Tool

1. Create the tool file in `packages/core/src/tools/`
2. Define the tool schema and executor
3. Register it in `packages/core/src/tools/registry.ts`
4. Add tests in `packages/core/tests/`

## Adding a New Skill

1. Create `skills/{name}/SKILL.md` with frontmatter and instructions
2. Place in `.assistants/skills/` (built-in) or `~/.assistants/skills/` (user)
3. The SkillLoader auto-discovers it on startup

## Adding a New Hook

1. Edit `config/hooks.json` or `.assistants/hooks.json`
2. Add hook configuration under the appropriate event
3. Hooks are loaded on startup and merged from multiple sources
