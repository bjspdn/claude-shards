---
type: architecture
description: "High-level architecture of the Claude Shards codebase"
tags:
  - typescript
  - mcp
created: 2026-03-08
updated: 2026-03-08
status: active
---

# Architecture

Claude Shards is an MCP server that gives Claude Code persistent knowledge through an Obsidian-compatible vault. It is built with Bun and TypeScript.

## Entry point

`src/index.ts` handles both CLI commands (`--init`, `--update`, `--uninstall`, `--logging`) and the MCP server (`--stdio` / non-TTY stdin). The server startup sequence:

1. Load all vault notes via `loadVault()`
2. Build link graph and IDF table
3. Start file watcher for live reload
4. Initialize embedding pipeline (async, non-blocking)
5. Register MCP tools and connect via stdio transport

## Module structure

```
src/
├── index.ts              # CLI dispatch + MCP server bootstrap
├── config.ts             # Global config with defaults (paths, search, lifecycle)
├── logger.ts             # Structured JSON logging to ~/.claude-shards/claude-shards.log
├── tool-logger.ts        # Monkey-patches McpServer.registerTool for per-call logging
├── update-checker.ts     # npm registry version check
├── utils.ts              # Shared utilities
│
├── vault/                # Vault data layer
│   ├── types.ts          # Zod schemas (NoteFrontmatter, NoteType, LinkGraph)
│   ├── parser.ts         # Parse .md → NoteEntry (gray-matter + tiktoken)
│   ├── loader.ts         # Discover + load all notes, build link graph
│   ├── watcher.ts        # fs.watch with debounced flush for live reload
│   ├── config.ts         # Per-project .context.toml loader
│   └── paths.ts          # Path helpers (draft folder resolution)
│
├── tools/                # MCP tool implementations
│   ├── types.ts          # ToolDefinition, ToolContext, ToolResponse interfaces
│   ├── registry.ts       # registerTools() — binds tools to McpServer
│   ├── read-tool.ts      # Fetch note content by path
│   ├── write-tool.ts     # Create/replace/append/patch notes
│   ├── search-tool.ts    # Hybrid BM25 + semantic search with link-graph boosting
│   ├── suggest-capture-tool.ts  # Proactive knowledge capture suggestions
│   ├── sync-tool.ts      # Copy notes into project docs/knowledge/ + update CLAUDE.md
│   ├── health-tool.ts    # Vault health check (stale notes, missing links)
│   └── bm25.ts           # BM25 scoring with IDF tables
│
├── embeddings/           # Semantic search layer
│   ├── embedder.ts       # HuggingFace transformers pipeline (all-MiniLM-L6-v2)
│   ├── cache.ts          # Disk-cached embedding index with content-hash invalidation
│   ├── types.ts          # EmbeddingEntry, EmbeddingIndex types
│   └── index.ts          # Re-exports
│
├── index-engine/         # Knowledge Index formatting
│   └── index.ts          # Build markdown table, inject/update in CLAUDE.md
│
└── cli/                  # CLI-only code (not loaded by MCP server)
    ├── init.ts           # Vault scaffolding + MCP registration
    ├── claude-code.ts    # Claude Code MCP server config management
    ├── obsidian.ts       # Obsidian vault registration
    ├── logging.ts        # Log viewer (--logging)
    ├── spinner.ts        # Terminal spinner
    └── vault-bundle.gen.ts  # Generated vault template bundle
```

## Key patterns

**Tool system** — Tools implement `ToolDefinition` (name, description, Zod input schema, handler). `registerTools()` wraps each handler to normalize responses into MCP content blocks. `ToolContext` provides shared state (entries, link graph, IDF table, embedding index).

**Vault as source of truth** — All notes live as markdown files with YAML frontmatter. The vault is loaded into an in-memory `NoteEntry[]` array at startup, kept in sync by a file watcher that debounces changes and flushes upserts/removes.

**Hybrid search** — Search combines BM25 keyword scoring with cosine similarity from sentence embeddings (all-MiniLM-L6-v2). Results are min-max normalized and blended with configurable weights. Link-graph PageRank-style boosting is applied as a final pass.

**Sync to projects** — The `sync` tool copies selected notes into a project's `docs/knowledge/` folder (organized by type) and injects a Knowledge Index table into the project's CLAUDE.md.

## Data flow

```
Vault (.md files)
  → parser.ts (gray-matter + Zod validation + tiktoken)
  → NoteEntry[] (in-memory)
  → link graph + IDF table + embedding index (derived)
  → MCP tools (read, search, write, sync, health, suggest-capture)
  → Claude Code (via stdio MCP transport)
```

The watcher keeps the in-memory state fresh: file changes trigger debounced re-parse, link graph rebuild, and incremental embedding updates.
