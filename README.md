# claude-code-memory (ccm)

MCP server that gives Claude Code persistent memory via an Obsidian-compatible knowledge vault. Notes you write — gotchas, decisions, patterns, references — become queryable context across sessions without manual copy-pasting.

## Quick Start

Requires [Bun](https://bun.sh/) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

```bash
bunx @bennys001/claude-code-memory --init
```

This scaffolds the vault at `~/.ccm/knowledge-base/`, registers it with Obsidian (if installed), and adds the MCP server to Claude Code.

### Manual setup

If `--init` can't reach the `claude` CLI, register manually:

```bash
claude mcp add --transport stdio --scope user ccm -- bunx @bennys001/claude-code-memory --stdio
```

## MCP Tools

### `research`

Batched search+read in one call. Finds matching notes by keyword and returns the results table plus full note content.

| Param       | Type     | Required | Description                                         |
|-------------|----------|----------|-----------------------------------------------------|
| `query`     | string   | Yes      | Space-separated keywords                            |
| `types`     | string[] | No       | Filter by note type                                 |
| `tags`      | string[] | No       | Filter by tag                                       |
| `limit`     | number   | No       | Max results (default 10)                            |
| `maxTokens` | number   | No       | Token budget — stops including bodies once exceeded |

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

### `sync`

Generates/updates a `## Knowledge Index` section in a project's `CLAUDE.md`. Injects the index table so Claude sees relevant notes at conversation start without a tool call.

| Param       | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `targetDir` | string | No       | Project directory (defaults to CWD) |

### `fetch-page`

Fetches a web page, extracts main content via Readability, converts to markdown. Returns a temp file path — read it, then `write` to vault.

| Param | Type   | Required | Description  |
|-------|--------|----------|--------------|
| `url` | string | Yes      | URL to fetch |

## Note Format

```markdown
---
type: gotcha
projects:
  - my-next-app
tags:
  - nextjs
  - react
created: 2026-02-01
updated: 2026-02-15
---

# Next.js fetch cache persists across requests

By default fetch() in Next.js App Router caches responses indefinitely.
Add { cache: 'no-store' } or use revalidate to avoid stale data...
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
~/.ccm/knowledge-base/
  gotchas/
    nextjs-fetch-cache.md
  decisions/
    chose-app-router-over-pages.md
  patterns/
    react-compound-components.md
  references/
    tailwind-cheatsheet.md
```

Invalid frontmatter notes are silently skipped.

## Project Filtering

Drop a `.context.toml` in any project root:

```toml
[project]
name = "my-next-app"

[filter]
tags = ["typescript", "react", "nextjs"]
types = ["gotcha", "pattern"]
exclude = ["drafts/*"]
```

Applies to `index`, `research`, and `sync` automatically.

## Use Cases

### Capture mistakes as you hit them

> Write a gotcha note about Next.js fetch cache persisting across requests
> in production. Tag it with nextjs and react.

Next session, the gotcha surfaces via Knowledge Index — no re-explaining.

### Preserve architecture decisions

> Write a decision note about why we chose App Router over Pages Router
> for my-next-app. Tag it with nextjs and architecture.

### Build a personal reference library

> Write a reference note with common Tailwind responsive breakpoints
> and utility patterns.

### Import web pages into vault

> Fetch https://nextjs.org/docs/app/api-reference/functions/revalidatePath
> and save it as a reference note

### Scope notes to projects

Notes with no `projects` field are global — they sync to `~/.claude/CLAUDE.md`. Project-tagged notes sync to matching project `CLAUDE.md` files.

> Write a gotcha note about keeping CLAUDE.md under 200 lines.

> Write a pattern note about React Server Components data fetching,
> tag it with the my-next-app project.

## Development

```bash
git clone https://github.com/bennys001/claude-code-memory.git
cd claude-code-memory
bun install
bun test
```

## Tech Stack

- **Runtime:** Bun
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) via `@modelcontextprotocol/sdk`
- **Frontmatter:** gray-matter
- **Tokens:** tiktoken (cl100k_base)
- **Validation:** Zod
- **Config:** smol-toml
- **Web extraction:** linkedom + Readability + Turndown
