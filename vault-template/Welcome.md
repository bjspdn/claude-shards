# Welcome to Claude Shards

Claude Shards gives Claude Code persistent memory through an Obsidian-compatible knowledge vault. Notes you capture here survive across conversations and get injected into Claude's context automatically.

## How it works

1. **Capture knowledge** — Use the `capture` MCP tool during conversations to save decisions, patterns, gotchas, and references as vault notes.
2. **Automatic indexing** — Claude Shards builds a Knowledge Index from your notes and injects it into your project's CLAUDE.md so Claude always has context.
3. **Search and retrieve** — Use the `search` and `read` MCP tools to find and load specific notes on demand.

## Vault structure

- Notes are organized into folders by their `type` frontmatter field (e.g., `decisions/`, `patterns/`, `gotchas/`, `references/`)
- `_unsorted/` holds notes that don't have a type yet
- `skills/` is reserved for prompt templates (coming soon)
- `.obsidian/` contains Obsidian app configuration

## Getting started

Open this vault in Obsidian to browse and edit notes with a full GUI, or let Claude manage everything through MCP tools. Both workflows are fully compatible.
