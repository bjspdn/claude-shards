# claude-code-memory (ccm)

An MCP server that gives Claude Code access to your Obsidian knowledge vault. Write notes in Obsidian, query them from Claude Code — gotchas you keep hitting, architecture decisions, useful patterns, and quick-reference cheatsheets all stay in context without manual copy-pasting.

## How It Works

1. You maintain an Obsidian vault of categorized markdown notes with YAML frontmatter
2. The MCP server loads the vault on startup and exposes four tools: `index`, `search`, `read`, and `sync`
3. Claude Code calls these tools during conversation to pull in relevant knowledge on demand
4. An optional `.context.toml` per project filters the vault down to only the notes relevant to that project

## Note Format

Each note is a markdown file with required YAML frontmatter:

```markdown
---
type: gotcha
projects:
  - bevy-game
tags:
  - bevy
  - rust
  - ecs
created: 2026-02-01
updated: 2026-02-15
---

# Bevy system ordering matters

Systems in Bevy run in parallel by default. If System A writes to a
component and System B reads it, you need explicit ordering...
```

### Note Types

| Type        | Icon         | Purpose                                  |
|-------------|--------------|------------------------------------------|
| `gotcha`    | Red circle   | Pitfalls and common mistakes             |
| `decision`  | Brown circle | Architecture and tooling decisions       |
| `pattern`   | Blue circle  | Reusable code patterns and idioms        |
| `reference` | Green circle | Cheatsheets and quick-reference material |

### Frontmatter Fields

| Field      | Required | Description                                                 |
|------------|----------|-------------------------------------------------------------|
| `type`     | Yes      | One of `gotcha`, `decision`, `pattern`, `reference`         |
| `projects` | No       | Project names this note relates to (defaults to `[]`)       |
| `tags`     | No       | Searchable tags (defaults to `[]`)                          |
| `created`  | Yes      | Creation date                                               |
| `updated`  | Yes      | Last updated date                                           |
| `title`    | No       | Overrides the default title (first `# heading` or filename) |

### Vault Structure

Organize notes however you like. The server discovers all `.md` files recursively, ignoring hidden directories and `node_modules`. A typical layout:

```
vault/
  gotchas/
    bevy-system-ordering.md
    rust-lifetime-elision.md
  decisions/
    use-bun-over-node.md
  patterns/
    ts-builder-pattern.md
    rust-error-handling.md
  references/
    bevy-query-cheatsheet.md
```

Notes with missing or invalid frontmatter are silently skipped.

## Installation

Requires [Bun](https://bun.sh/).

```bash
git clone <repo-url>
cd claude-code-memory
bun install
```

### Register as an MCP server

```bash
claude mcp add --transport stdio --scope user ccm -- \
  bun run /path/to/claude-code-memory/src/index.ts \
  --vault "/path/to/your/vault"
```

The vault path can also be set via the `OBSIDIAN_VAULT_PATH` environment variable.

## MCP Tools

### `index`

Returns a compressed markdown table of all notes in the vault (or filtered by project). This is the primary way Claude discovers what knowledge is available.

**Parameters:**


| Name      | Type   | Required | Description                                   |
|-----------|--------|----------|-----------------------------------------------|
| `project` | string | No       | Filter to notes tagged with this project name |


**Example output:**

```
| T           | Title                              | Path                            | ~Tok |
|-------------|------------------------------------|---------------------------------|------|
| Red circle  | Bevy system ordering matters       | gotchas/bevy-system-ordering.md | ~70  |
| Blue circle | Rust error handling with thiserror | patterns/rust-error-handling.md | ~40  |
```

### `search`

Keyword search across note titles, tags, and body text. Results are ranked by relevance score (title match: +10, tag match: +5, body match: +1).

**Parameters:**

| Name    | Type     | Required | Description                     |
|---------|----------|----------|---------------------------------|
| `query` | string   | Yes      | Space-separated keywords        |
| `types` | string[] | No       | Filter to specific note types   |
| `tags`  | string[] | No       | Filter to notes with these tags |
| `limit` | number   | No       | Max results (default 10)        |

**Example output:**

```
| T          | Title                        | Path                            | ~Tok | Score |
|------------|------------------------------|---------------------------------|------|-------|
| Red circle | Bevy system ordering matters | gotchas/bevy-system-ordering.md | ~70  | 16    |
```

### `read`

Fetches the full markdown content of a note by its relative path. Use paths from `index` or `search` results.

**Parameters:**

| Name   | Type   | Required | Description                                                         |
|--------|--------|----------|---------------------------------------------------------------------|
| `path` | string | Yes      | Relative path within vault (e.g. `gotchas/bevy-system-ordering.md`) |

Path traversal (`..`) and absolute paths are rejected.

### `sync`

Generates or updates a `## Knowledge Index` section in a project's `CLAUDE.md`. This injects the index table directly into the file so Claude Code sees it automatically at conversation start — no tool call needed.

**Parameters:**

| Name        | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `targetDir` | string | No       | Project directory (defaults to CWD) |

Existing content in `CLAUDE.md` outside the Knowledge Index section is preserved.

## Project-Level Filtering

Drop a `.context.toml` in any project root to control which notes are visible when working in that project:

```toml
[project]
name = "bevy-game"

[filter]
tags = ["rust", "bevy"]          # only notes with at least one of these tags
types = ["gotcha", "pattern"]    # only these note types
exclude = ["drafts/*"]           # glob patterns to exclude
```

The filters apply to `index`, `search`, and `sync` tools automatically.

## Running Tests

```bash
bun test
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) via `@modelcontextprotocol/sdk`
- **Frontmatter parsing:** gray-matter
- **Token counting:** tiktoken (cl100k_base)
- **Schema validation:** Zod
- **Config parsing:** smol-toml
