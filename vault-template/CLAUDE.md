# Claude Shards Vault

This is a Claude Shards knowledge vault. Notes here are managed by the claude-shards MCP server and organized by type.

## Note format

All knowledge notes use YAML frontmatter with these fields:

```yaml
---
type: architecture | decisions | patterns | gotchas | references
status: active | stale
tags:
  - relevant-tag
decisions: []
patterns: []
gotchas: []
references: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Folder organization

Notes are organized by project, then by type:

- `{project}/{type}/{SLUG}.md` — Project-specific notes (e.g. `claude-code-memory/gotchas/SYNC_BEFORE_INIT.md`)
- `GLOBAL/{type}/{SLUG}.md` — Project-agnostic notes (e.g. `GLOBAL/references/TYPESCRIPT_GENERICS.md`)

Type folders:

- `architecture/` — System design and structural documentation
- `decisions/` — Design choices and their rationale
- `patterns/` — Reusable solutions and conventions
- `gotchas/` — Known pitfalls and workarounds
- `references/` — External knowledge and reference material

## Tools available

- `read` — Load the full content of a note by path
- `search` — Find notes by keyword or semantic similarity
- `write` — Create or update a knowledge note
- `sync` — Gather vault notes with resolved dependencies for synthesis, or write synthesized notes into project context. Use `mode: "gather"` to get note content with linked dependencies, then pass back synthesized content to write to `docs/knowledge/`.
- `health` — Check vault health and surface stale notes
- `suggest-capture` — Get suggestions for knowledge worth capturing
