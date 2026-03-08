# Claude Shards Vault

This is a Claude Shards knowledge vault. Notes here are managed by the claude-shards MCP server and organized by type.

## Note format

All knowledge notes use YAML frontmatter with these fields:

```yaml
---
type: architecture | decisions | patterns | gotchas | references
tags:
  - relevant-tag
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

## Tools available

- `read` — Load the full content of a note by path
- `search` — Find notes by keyword or semantic similarity
- `write` — Create or update a knowledge note
- `sync` — Sync the Knowledge Index in CLAUDE.md
- `health` — Check vault health and surface stale notes
- `suggest-capture` — Get suggestions for knowledge worth capturing
