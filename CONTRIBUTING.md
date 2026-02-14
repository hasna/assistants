# Contributing to @hasna/assistants

Thanks for your interest in contributing! Whether it's a bug fix, new feature, documentation improvement, or a new skill, all contributions are welcome.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.9
- [pnpm](https://pnpm.io) (the project uses pnpm workspaces)

### Getting Started

```bash
git clone https://github.com/hasna/assistants.git
cd assistants
pnpm install
pnpm dev
```

You'll need at least an `ANTHROPIC_API_KEY` environment variable set to interact with the assistant.

## Project Structure

The repository is a monorepo managed with Turborepo and pnpm workspaces:

```
packages/
  core/         # Platform-agnostic assistant runtime (agent loop, tools, skills, hooks, LLM client)
  terminal/     # Ink-based terminal UI and CLI entry point
  shared/       # Shared types, model catalog, and utilities
  runtime-bun/  # Bun-specific runtime bindings (SQLite, filesystem)
  mcp/          # MCP server for running assistants
  web/          # Web interface and landing page
```

All workspace packages are bundled inline at build time -- the published package has zero npm runtime dependencies.

## Running Tests

Tests use Bun's native test runner (`bun:test`). Test files live in `tests/` directories within each package.

```bash
# Run all tests across every package
pnpm test

# Run tests for a specific package
cd packages/core && bun test
cd packages/shared && bun test

# Run a specific test file
bun test packages/core/tests/agent.test.ts
```

## Code Style

- **TypeScript strict mode** -- avoid `any` types without justification.
- **Bun-first APIs** -- prefer `Bun.file`, `Bun.write`, `Bun.build` over Node equivalents.
- **Conventional Commits** -- all commit messages must follow the format:
  - `feat:` -- a new feature
  - `fix:` -- a bug fix
  - `docs:` -- documentation only
  - `refactor:` -- code restructuring without behavior change
  - `chore:` -- maintenance, deps, CI, etc.
- Imports use the workspace package names: `@hasna/assistants-core`, `@hasna/assistants-shared`, `@hasna/runtime-bun`.

## Submitting Changes

1. **Fork** the repository and create a branch from `main`.
2. **Make your changes.** Keep commits focused and use conventional commit messages.
3. **Add or update tests** if your change affects behavior.
4. **Run `pnpm test`** to verify nothing is broken.
5. **Open a pull request** against `main` with a clear description of what changed and why.

## Adding a New Tool

1. Create the tool file in `packages/core/src/tools/`.
2. Define the tool schema (name, description, input parameters) and its executor function.
3. Register the tool in `packages/core/src/tools/registry.ts`.
4. Add tests in `packages/core/tests/`.

## Adding a New Skill

Skills are reusable prompt templates defined as `SKILL.md` files with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
argument-hint: <required-input>
allowed-tools: Read, Grep
---

Your prompt instructions here. Use $ARGUMENTS for user input.
```

Place the file at:

- `.assistants/skills/my-skill/SKILL.md` -- built-in (ships with the package)
- `~/.assistants/skills/my-skill/SKILL.md` -- user-level (personal skills)

The SkillLoader auto-discovers skills on startup.

## Reporting Bugs

Found a bug? Please [open an issue](https://github.com/hasna/assistants/issues) with:

- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Bun version, package version)

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](LICENSE).
