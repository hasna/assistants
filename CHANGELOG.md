# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-02-14

### Added

- Ink-based terminal UI with markdown rendering, syntax highlighting, and session management
- Claude API (Anthropic SDK) and OpenAI API support with configurable model selection
- Built-in tool system: Bash, Read, Write, Search, Web, Image, Voice, Memory, Scheduler, and more
- Skill system with auto-discovery of SKILL.md files (built-in and user-defined)
- Hook system with JSON-configured lifecycle interceptors (PreToolUse, PostToolUse, etc.)
- Connector framework for external service integrations (Notion, Gmail, etc.)
- SQLite-backed persistence for sessions, memory, and schedules
- Multi-agent swarm coordination with task graphs, agent selection, and decision policies
- Voice support with ElevenLabs TTS and OpenAI Whisper STT
- Multi-channel messaging (terminal, telephony, webhooks)
- Contact address book and people management
- Project and workspace context awareness
- Energy and budget tracking for LLM usage
- Headless mode for non-interactive execution
- MCP server exposing assistant capabilities to Claude Desktop, Cursor, and MCP-compatible clients
- Landing page and newsletter subscription with SQLite backend
- Self-contained single-file build via Bun bundler (zero runtime npm dependencies)

### Security

- SSRF protection with network request validation
- Filesystem path validation to prevent directory traversal
- Bash command allowlisting with configurable restrictions
