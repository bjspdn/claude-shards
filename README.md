# claude-code-memory (ccm)

MCP server that gives Claude Code access to your Obsidian knowledge vault. Notes you write in Obsidian — gotchas, decisions, patterns, references — become queryable context without manual copy-pasting.

## How It Works

1. Maintain an Obsidian vault of categorized markdown notes with YAML frontmatter
2. MCP server loads the vault on startup and exposes 7 tools
3. Claude Code calls these tools during conversation to pull in relevant knowledge
4. Optional `.context.toml` per project filters the vault to only relevant notes

## Installation

Requires [Bun](https://bun.sh/).

```bash
git clone <repo-url>
cd claude-code-memory
bun install
```

### Register as MCP server

```bash
claude mcp add --transport stdio --scope user ccm -- \
  bun run /path/to/claude-code-memory/src/index.ts \
  --vault "/path/to/your/vault"
```

Vault path can also be set via `OBSIDIAN_VAULT_PATH` env var.

## MCP Tools

### `research`

Batched search+read in one call. Finds matching notes by keyword and returns the results table plus full note content. Preferred over `search` → `read` chains.

| Param       | Type     | Required | Description                                         |
|-------------|----------|----------|-----------------------------------------------------|
| `query`     | string   | Yes      | Space-separated keywords                            |
| `types`     | string[] | No       | Filter by note type                                 |
| `tags`      | string[] | No       | Filter by tag                                       |
| `limit`     | number   | No       | Max results (default 10)                            |
| `maxTokens` | number   | No       | Token budget — stops including bodies once exceeded |

```
> Search my vault for notes about Bevy system ordering

Calls: research({ query: "bevy system ordering" })
Returns: results table + full note bodies in one response
```

### `index`

Compressed markdown table of all vault notes (or filtered by project). Primary way Claude discovers available knowledge.

| Param     | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `project` | string | No       | Filter to notes tagged with this project |

### `write`

Creates a new note with structured frontmatter. Create-only — rejects existing paths.

| Param      | Type     | Required | Description                                     |
|------------|----------|----------|-------------------------------------------------|
| `path`     | string   | Yes      | Relative path for new note                      |
| `type`     | string   | Yes      | `gotcha`, `decision`, `pattern`, or `reference` |
| `title`    | string   | Yes      | Note title (becomes H1)                         |
| `body`     | string   | Yes      | Markdown body                                   |
| `tags`     | string[] | No       | Searchable tags                                 |
| `projects` | string[] | No       | Project names                                   |

Dates set automatically. Parent dirs created if needed. Note immediately available to other tools.

### `sync`

Generates/updates `## Knowledge Index` section in a project's `CLAUDE.md`. Injects the index table so Claude sees it at conversation start without a tool call.

| Param       | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `targetDir` | string | No       | Project directory (defaults to CWD) |

Preserves existing `CLAUDE.md` content outside the Knowledge Index section. Filters by project scope via `.context.toml`.

### `fetch-page`

Fetches a web page, extracts main content via Readability, converts to markdown. Returns a temp file path — read it, clean it up, then `write` to vault.

| Param | Type   | Required | Description  |
|-------|--------|----------|--------------|
| `url` | string | Yes      | URL to fetch |

### `search` *(deprecated)*

Keyword search returning only the results table, not note content. Replaced by `research` which returns table + bodies in one call. Still functional but will be removed in a future version.


### `read` *(deprecated)*

Full markdown content of a single note by relative path. Replaced by `research` which returns table + bodies in one call. Still functional but will be removed in a future version.

| Param  | Type   | Required | Description                                     |
|--------|--------|----------|-------------------------------------------------|
| `path` | string | Yes      | Relative path (e.g. `gotchas/bevy-ordering.md`) |

Path traversal and absolute paths rejected.

## Note Format

```markdown
---
type: gotcha
projects:
  - bevy-game
tags:
  - bevy
  - rust
created: 2026-02-01
updated: 2026-02-15
---

# Bevy system ordering matters

Systems in Bevy run in parallel by default...
```

### Note Types

| Type        | Icon | Purpose                            |
|-------------|------|------------------------------------|
| `gotcha`    | 🔴   | Pitfalls and common mistakes       |
| `decision`  | 🟤   | Architecture and tooling decisions |
| `pattern`   | 🔵   | Reusable code patterns             |
| `reference` | 🟢   | Cheatsheets and quick-reference    |

### Frontmatter Fields

| Field      | Required | Description                                             |
|------------|----------|---------------------------------------------------------|
| `type`     | Yes      | One of the 4 note types                                 |
| `projects` | No       | Project names (defaults to `[]`)                        |
| `tags`     | No       | Searchable tags (defaults to `[]`)                      |
| `created`  | Yes      | Creation date                                           |
| `updated`  | Yes      | Last updated date                                       |
| `title`    | No       | Overrides default title (first `#` heading or filename) |

### Vault Structure

Organize however you like. The server finds all `.md` files recursively, ignoring hidden dirs and `node_modules`.

```
vault/
  gotchas/
    bevy-system-ordering.md
  decisions/
    use-bun-over-node.md
  patterns/
    rust-error-handling.md
  references/
    bevy-query-cheatsheet.md
```

Invalid frontmatter notes are silently skipped.

## Project Filtering

Drop a `.context.toml` in any project root:

```toml
[project]
name = "bevy-game"

[filter]
tags = ["rust", "bevy"]
types = ["gotcha", "pattern"]
exclude = ["drafts/*"]
```

Applies to `index`, `research`, and `sync` automatically.

## Use Cases

### Capture mistakes as you hit them

```
Write a gotcha note about Rust lifetime elision not applying with
multiple references in the return type. Tag it with rust.
```

Next session, the gotcha surfaces via Knowledge Index — no re-explaining.

### Preserve architecture decisions

```
Write a decision note about why we chose ECS over OOP for bevy-game.
Tag it with architecture and bevy.
```

### Build a personal reference library

```
Write a reference note with the Bun.serve() API signature and common options.
```

Claude pulls it up instantly instead of searching docs.

### Research vault knowledge

```
Search my vault for notes about error handling
```

One `research` call returns ranked results with full note content.

### Onboard Claude to a project

```
Sync the knowledge index to CLAUDE.md
```

Injects a compact index table — Claude sees all relevant notes at conversation start.

### Import web pages into vault

```
Fetch https://docs.rs/some-crate and save the key parts as a reference note
```

### Scope notes to projects

Notes with no `projects` field are global — they only sync to `~/.claude/CLAUDE.md`. Project-tagged notes sync to matching project CLAUDE.md files. Notes with tech tags (e.g. `rust`, `react`) are excluded from global sync to avoid bloat.

```
# Global — syncs to ~/.claude/CLAUDE.md only
Write a gotcha note about keeping CLAUDE.md under 200 lines.

# Project-scoped — syncs to bevy-game's CLAUDE.md
Write a pattern note about Bevy system ordering, tag it with the bevy-game project.
```

## Running Tests

```bash
bun test
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) via `@modelcontextprotocol/sdk`
- **Frontmatter:** gray-matter
- **Tokens:** tiktoken (cl100k_base)
- **Validation:** Zod
- **Config:** smol-toml
- **Web extraction:** linkedom + Readability + Turndown
