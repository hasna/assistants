# @hasna/assistants

## Overview

Open-source terminal AI assistant. Published as `@hasna/assistants` on npm.

Install: `bun add -g @hasna/assistants`
Run: `assistants` or `ast`

## Stack

- Runtime: Bun
- Package manager: pnpm (workspaces)
- Monorepo: Turborepo
- UI: Ink (React for terminals)
- LLM: Claude API (default), OpenAI (optional)
- Database: SQLite (local, via bun:sqlite)
- Language: TypeScript (strict)

## Packages

- `packages/core` — Agent loop, tools, skills, hooks, LLM, memory, connectors
- `packages/terminal` — Terminal UI (Ink/React components)
- `packages/shared` — Types, model catalog, utils
- `packages/runtime-bun` — Bun runtime bindings

## Build

`build.ts` bundles everything into a single `dist/index.js` using Bun's bundler. All workspace packages are inlined. Zero runtime npm dependencies.

## Commands

- `pnpm dev` — Run locally
- `pnpm build` — Build dist
- `pnpm test` — Run all tests
- `pnpm typecheck` — Type check

## Key Patterns

- Imports: `@hasna/assistants-core`, `@hasna/assistants-shared`, `@hasna/runtime-bun`
- Skills: SKILL.md files with YAML frontmatter in `.assistants/skills/`
- Hooks: JSON config in `config/hooks.json` or `.assistants/hooks.json`
- Tests: `bun:test` in `tests/` directories
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, etc.)

## Env Vars

Required: `ANTHROPIC_API_KEY`
Optional: `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `EXA_API_KEY`, `AWS_*`
