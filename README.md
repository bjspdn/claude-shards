# claude-code-memory (ccm)

An MCP server that gives Claude Code access to your Obsidian knowledge vault. Write notes in Obsidian, query them from Claude Code — gotchas you keep hitting, architecture decisions, useful patterns, and quick-reference cheatsheets all stay in context without manual copy-pasting.

## How It Works

1. You maintain an Obsidian vault of categorized markdown notes with YAML frontmatter
2. The MCP server loads the vault on startup and exposes five tools: `index`, `search`, `read`, `write`, and `sync`
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

### `write`

Creates a new note in the vault with structured frontmatter. Claude provides individual fields and the tool generates the markdown file with proper YAML frontmatter. Create-only — rejects writes to existing paths.

**Parameters:**

| Name       | Type     | Required | Description                                                |
|------------|----------|----------|------------------------------------------------------------|
| `path`     | string   | Yes      | Relative path within vault (e.g. `gotchas/my-new-note.md`) |
| `type`     | string   | Yes      | One of `gotcha`, `decision`, `pattern`, `reference`        |
| `title`    | string   | Yes      | Note title (becomes the H1 heading)                        |
| `body`     | string   | Yes      | Markdown body content (after the H1)                       |
| `tags`     | string[] | No       | Searchable tags                                            |
| `projects` | string[] | No       | Project names this note relates to                         |

Dates (`created` and `updated`) are set automatically to today. Path traversal (`..`) and absolute paths are rejected. Parent directories are created if they don't exist. After writing, the note is immediately available to `index`, `search`, and `read`.

### `sync`

Generates or updates a `## Knowledge Index` section in a project's `CLAUDE.md`. This injects the index table directly into the file so Claude Code sees it automatically at conversation start — no tool call needed.

**Parameters:**

| Name        | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `targetDir` | string | No       | Project directory (defaults to CWD) |

Existing content in `CLAUDE.md` outside the Knowledge Index section is preserved. Notes are filtered by project scope: if the target directory has a `.context.toml` with `project.name`, only notes tagged with that project (plus untagged notes) are included. Directories without a project config only get untagged notes.

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

## Use Cases

### Avoiding repeated mistakes

You hit a subtle Rust lifetime issue, spend an hour debugging, and finally figure it out. Write a `gotcha` note so Claude catches it next time:

```
Write a gotcha note about Rust lifetime elision not applying when the return
type has multiple references — I keep getting burned by this.
```

Next session, when Claude sees similar code, the gotcha surfaces via the Knowledge Index in `CLAUDE.md` — no need to explain the problem again.

### Preserving architecture decisions

Your team chose ECS over OOP for the game engine. Six months later, you're wondering why. A `decision` note captures the rationale:

```
Write a decision note about why we chose ECS over OOP for the bevy-game project.
Tag it with architecture and bevy.
```

### Building a personal reference library

You always forget the exact Bun.serve API signature, or which Bevy query filters exist. `reference` notes act as cheatsheets that Claude can pull up instantly instead of searching docs.

### Cross-project knowledge sharing

Some notes apply everywhere (general Rust gotchas, TypeScript patterns). Leave their `projects` field empty — they'll appear in every project's Knowledge Index when you `sync`. Project-specific notes only sync to their tagged projects.

### Onboarding Claude to a new project

Starting a new conversation in an unfamiliar project? Run `sync` to inject the Knowledge Index into `CLAUDE.md`, giving Claude immediate awareness of all relevant notes without burning context tokens on full content.

## Workflows

### Setting up a new project

1. Create a `.context.toml` in the project root to scope which notes are relevant:

```toml
[project]
name = "my-project"

[filter]
tags = ["typescript", "react"]
types = ["gotcha", "pattern", "reference"]
exclude = ["drafts/*"]
```

2. Ask Claude to sync the Knowledge Index:

```
Sync the knowledge index to CLAUDE.md
```

This injects a compact table into `CLAUDE.md` that Claude loads automatically in every conversation.

### Writing notes during a session

As you work, ask Claude to capture knowledge directly into the vault:

```
Write a gotcha note about React useEffect cleanup not running on fast remount
in dev mode. Tag it with react and hooks.
```

The note is immediately available to `index`, `search`, and `read` — no server restart needed.

### Searching for relevant knowledge

When you need to find something specific:

```
Search the vault for notes about error handling
```

Claude uses the `search` tool to find notes ranked by relevance, then can `read` the full content of the most relevant match.

### Global vs project-scoped notes

Notes with no `projects` field are global — they sync to any `CLAUDE.md`, including `~/.claude/CLAUDE.md`. Notes tagged with specific projects only sync to directories where `.context.toml` declares a matching `project.name`.

```
# This note syncs everywhere (no projects field)
Write a gotcha note about keeping CLAUDE.md under 200 lines.

# This note only syncs to the bevy-game project
Write a pattern note about Bevy system ordering, tag it with the bevy-game project.
```

### Keeping the index fresh

After adding or removing notes, re-sync to update `CLAUDE.md`:

```
Sync the knowledge index
```

For your global `CLAUDE.md`:

```
Sync the knowledge index to ~/.claude
```

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
