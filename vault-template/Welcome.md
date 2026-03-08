# Welcome to Claude Shards

Claude Shards is a knowledge management tool for Claude Code, backed by an Obsidian-compatible vault. It acts as a single source of truth for knowledge that can be synced into CLAUDE.md, making relevant notes to your project readily available.

## How it works

1. **Capture knowledge** — Claude will proactively suggest note creation/updates during conversations to save decisions, patterns, gotchas, and references as vault notes.
2. **Sync to projects** — The `sync` tool copies selected notes into your project's `docs/knowledge/` folder and updates the Knowledge Index in CLAUDE.md. Notes are organized by type:
   ```
   docs/knowledge/
   ├── decisions/
   ├── patterns/
   ├── gotchas/
   └── references/
   ```
3. **Search and retrieve** — Use the `search` and `read` MCP tools to find and load specific notes on demand.

## Vault structure

- Notes are organized into folders by their `type` frontmatter field (e.g., `decisions/`, `patterns/`, `gotchas/`, `references/`)
- `_unsorted/` holds notes that don't have a type yet
- `.obsidian/` contains Obsidian app configuration

## Getting started

Open this vault in Obsidian to browse and edit notes with a full GUI, or let Claude manage everything through MCP tools. Both workflows are fully compatible.
