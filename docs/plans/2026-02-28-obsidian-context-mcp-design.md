# Design: obsidian-context-mcp

An MCP server that exposes an Obsidian vault as structured context for Claude Code. Claude gets a compressed knowledge index at session start and can pull full notes on demand via tools.

## Motivation

- Stop re-explaining the same gotchas, patterns, and decisions across Claude Code sessions
- Durable knowledge base that persists across projects and sessions
- Structured retrieval so Claude pulls knowledge on demand rather than loading everything

## Stack

TypeScript, Bun, @modelcontextprotocol/sdk, gray-matter, globby, tiktoken, zod, smol-toml

## Scope

**In scope:** MCP server with 4 tools (index, read, search, sync), vault parsing with frontmatter validation, per-project filtering via `.context.toml`, CLAUDE.md section injection, token counting, vault scaffolding CLI.

**Out of scope:** Semantic/embedding search, web UI, multi-vault support, auto-generating notes from code.

---

## Data Model

### Note Types

| Type | Icon | Purpose |
|------|------|---------|
| gotcha | 🔴 | Common pitfalls to avoid |
| decision | 🟤 | Architectural choices and rationale |
| pattern | 🔵 | Reusable code patterns |
| reference | 🟢 | Reference material and guides |

### Frontmatter Schema

```yaml
---
type: gotcha | decision | pattern | reference
projects:
  - my-bevy-game
  - shared
tags:
  - rust
  - ecs
created: 2026-02-28
updated: 2026-02-28
---
```

All fields validated with Zod at parse time. Notes with invalid frontmatter are logged as warnings and skipped.

### Core Types

- **NoteEntry**: frontmatter + filePath + title + body (raw markdown) + tokenCount
- **IndexEntry**: type icon + title + relative path + ~tokenCount (compressed row for CLAUDE.md)
- **ProjectConfig**: vault path, project name, include tags, include types, exclude patterns

Title resolution order: frontmatter `title` field → first `# heading` → filename without extension.

---

## Vault Structure

```
vault/
├── gotchas/
│   └── bevy-system-ordering.md
├── decisions/
│   └── chose-ecs-over-oop.md
├── patterns/
│   └── rust-error-handling.md
├── references/
│   └── bun-serve-api.md
└── .context/          # metadata, not synced to Obsidian
```

Folders are organizational — the `type` frontmatter field is authoritative.

Ignored during parsing: `.obsidian/`, `.trash/`, `.context/`, `node_modules/`, hidden directories.

---

## Configuration

### Server Config

Vault path via `--vault` CLI arg, falling back to `OBSIDIAN_VAULT_PATH` env var.

### Per-Project Config (.context.toml)

```toml
[project]
name = "my-bevy-game"

[filter]
tags = ["rust", "bevy", "ecs"]     # include notes matching ANY tag
types = ["gotcha", "decision", "pattern"]  # include these note types
exclude = ["drafts/*"]              # glob patterns to skip
```

All filter fields optional. If `.context.toml` is absent, the full vault is exposed.

Parsed with `smol-toml` (lightweight, Bun-compatible TOML parser).

---

## Architecture

### Data Loading

Load-on-startup, in-memory. The vault is parsed once when the MCP server starts and held as `NoteEntry[]` in memory. Claude Code starts a new MCP server per session, so stale data isn't a practical concern.

### Module Structure

```
src/
├── index.ts              # CLI arg parsing, MCP server bootstrap
├── vault/
│   ├── types.ts          # NoteType, NoteFrontmatter, NoteEntry, IndexEntry, ProjectConfig
│   ├── parser.ts         # Frontmatter parsing, title extraction, token counting
│   └── loader.ts         # File discovery + filtering → NoteEntry[]
├── index-engine/
│   └── index.ts          # NoteEntry[] → markdown index table, CLAUDE.md formatting
└── tools/
    ├── index-tool.ts     # index tool handler
    ├── read-tool.ts      # read tool handler
    ├── search-tool.ts    # search tool handler
    └── sync-tool.ts      # sync tool handler
```

---

## MCP Tools

### `index`

Returns the compressed knowledge index table for the current project.

- Input: `{ project?: string }`
- Filters by project tag if specified, otherwise uses `.context.toml` from CWD
- Returns markdown table: `| T | Title | Path | ~Tok |`
- If no matches: "No knowledge entries match this project's filters"

### `read`

Fetches full content of a vault note.

- Input: `{ path: string }` (relative to vault root)
- Validates path is within vault (rejects path traversal)
- Returns full markdown including frontmatter
- If note missing: error with suggestion to run `index`

### `search`

Keyword search across notes.

- Input: `{ query: string, types?: NoteType[], tags?: string[], limit?: number }`
- Splits query into keywords, matches against title + tags + body
- Scoring: title match > tag match > body match (simple weighted)
- Returns IndexEntry rows, not full content (use `read` for details)
- Default limit: 10
- Applies project filters if `.context.toml` present

### `sync`

Generates/updates CLAUDE.md in a project directory.

- Input: `{ targetDir?: string }` (defaults to CWD)
- Loads `.context.toml` from target dir if present
- Injects/replaces only `## Knowledge Index` section — preserves everything else
- If no CLAUDE.md exists, creates one with only the knowledge section
- Returns: "Synced N entries to CLAUDE.md (~X total index tokens)"

---

## CLAUDE.md Integration

The `sync` tool produces:

```markdown
## Knowledge Index
Use MCP tool `read` with the note path to fetch full details on demand.
🔴 = gotcha  🟤 = decision  🔵 = pattern  🟢 = reference

| T | Title | Path | ~Tok |
|---|-------|------|------|
| 🔴 | Bevy system ordering | gotchas/bevy-system-ordering.md | ~120 |
| 🟤 | Chose ECS over OOP | decisions/chose-ecs-over-oop.md | ~200 |
```

Claude Code sees this index at session start, then uses `read` to pull specific notes when relevant.

---

## Error Handling

- Invalid/missing frontmatter: warn to stderr, skip the note
- Path traversal in `read`: reject with error message
- Missing vault path: clear error with setup instructions
- Missing `.context.toml`: not an error, expose full vault
- Empty vault / all notes filtered: return clear "no results" message

---

## Testing Strategy

- Unit tests for parser (frontmatter extraction, title resolution, token counting)
- Unit tests for loader (file discovery, filtering)
- Unit tests for index engine (table generation, CLAUDE.md section injection)
- Integration tests with a fixture vault (~10-20 notes across all types)
- Security tests (path traversal rejection)
- Edge case tests (empty vault, all notes filtered, missing frontmatter, malformed TOML)

---

## Open-Source Considerations

- TOML config for human-friendly editing
- Vault scaffolding CLI (`--init-vault`) for easy onboarding
- Clear documentation: setup, frontmatter schema, `.context.toml` schema, writing good note titles
