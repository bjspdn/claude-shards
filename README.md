<div align="center">

# Claude Shards

**Structured knowledge base for Claude Code, built on Obsidian.**

![npm](https://img.shields.io/npm/v/claude-shards?style=flat-square&logo=npm)
![Claude Compatible](https://img.shields.io/badge/Claude_Code-Compatible-D97706?style=flat-square&logo=anthropic)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

Each shard is a markdown note — a gotcha, a decision, a pattern, a reference — stored in an Obsidian vault that Claude can query across sessions. Not a conversation log or auto-memory dump. Sharp, curated fragments of knowledge you actually want Claude to remember.

## Core Features

- **Obsidian-native** — the vault is a real Obsidian vault. Browse, edit, and organize shards with a proper knowledge management UI.
- **Structured shards** — four typed categories (gotchas, decisions, patterns, references) with frontmatter, tags, and project scoping.
- **Real-time sync** — file watcher picks up edits from Obsidian or any editor instantly. No restart needed.
- **Knowledge Index** — `sync` injects an index table into your project's `CLAUDE.md` so Claude sees relevant shards at conversation start, zero tool calls needed.
- **Project filtering** — `.context.toml` scopes which shards surface per project. Global shards sync to `~/.claude/CLAUDE.md`.

## Roadmap

Planned features, not ordered by priority:

- **Wikilink graph** — parse `[[links]]`, build a lightweight graph, expose a `related` tool for context traversal
- **Staleness detection** — flag shards that haven't been updated in months during `sync` or `index`
- **Richer frontmatter** — `status`, `confidence`, `last-validated` fields that work with Obsidian's Properties UI
- **Canvas generation** — auto-generate `.canvas` shard maps of codebase architecture, color-coded by type
- **Dataview integration** — ship starter queries for vault analytics (staleness, coverage gaps, tag distribution)

## Quick Start

Requires [Bun](https://bun.sh/) and [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

```bash
bun install -g claude-shards && claude-shards --init
```

This scaffolds the vault at `~/.claude-shards/knowledge-base/`, registers it with Obsidian (if installed), and adds the MCP server to Claude Code.

```bash
claude-shards --update       # upgrade to latest
claude-shards --uninstall    # remove everything (prompts before deleting vault)
```

Manual MCP setup if `--init` can't reach the `claude` CLI:

```bash
claude mcp add --transport stdio --scope user claude-shards -- claude-shards --stdio
```

## How It Works

The MCP server watches the vault for changes while running. Edits in Obsidian or your editor are picked up automatically — no restart needed.

Shards are organized by type:

| Type         | Icon | Purpose                            |
|--------------|------|------------------------------------|
| `gotchas`    | 🔴   | Pitfalls and common mistakes       |
| `decisions`  | 🟤   | Architecture and tooling decisions |
| `patterns`   | 🔵   | Reusable code patterns             |
| `references` | 🟢   | Cheatsheets and quick-reference    |

Each shard has structured frontmatter that makes it searchable and filterable:

```markdown
---
type: gotchas
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

## MCP Tools

### `research`

Batched search+read in one call. Finds matching shards by keyword, returns the results table plus full content.

| Param       | Type     | Required | Description                                         |
|-------------|----------|----------|-----------------------------------------------------|
| `query`     | string   | Yes      | Space-separated keywords                            |
| `types`     | string[] | No       | Filter by shard type                                |
| `tags`      | string[] | No       | Filter by tag                                       |
| `limit`     | number   | No       | Max results (default 10)                            |
| `maxTokens` | number   | No       | Token budget — stops including bodies once exceeded |

### `index`

Compressed markdown table of all vault shards (or filtered by project). Primary way Claude discovers available knowledge.

| Param     | Type   | Required | Description                               |
|-----------|--------|----------|-------------------------------------------|
| `project` | string | No       | Filter to shards tagged with this project |

### `write`

Creates or updates a shard. Three modes: `create` (default) adds a new shard with structured frontmatter, `append` adds content to the end, `patch` replaces a single section by heading.

| Param      | Type     | Required | Description                                         |
|------------|----------|----------|-----------------------------------------------------|
| `path`     | string   | Yes      | Relative path in the vault                          |
| `type`     | string   | Yes      | `gotchas`, `decisions`, `patterns`, or `references` |
| `title`    | string   | Yes      | Shard title (becomes H1)                            |
| `body`     | string   | Yes      | Markdown body                                       |
| `tags`     | string[] | No       | Searchable tags                                     |
| `projects` | string[] | No       | Project names                                       |
| `mode`     | string   | No       | `create` (default), `append`, or `patch`            |
| `section`  | string   | No       | Heading text to match when using `patch` mode       |

### `sync`

Generates a `## Knowledge Index` section in a project's `CLAUDE.md`. Injects the index table so Claude sees relevant shards at conversation start without a tool call.

| Param       | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `targetDir` | string | No       | Project directory (defaults to CWD) |

### `diagnostics`

Live runtime diagnostics — vault stats (shard counts by type, total tokens), file watcher activity, process metrics, and server version. No parameters.

## Vault Structure

Organize however you like. The server finds all `.md` files recursively, ignoring hidden dirs and `node_modules`.

```
~/.claude-shards/knowledge-base/
  gotchas/
    nextjs-fetch-cache.md
  decisions/
    chose-app-router-over-pages.md
  patterns/
    react-compound-components.md
  references/
    tailwind-cheatsheet.md
```

### Frontmatter Fields

| Field      | Required | Description                                             |
|------------|----------|---------------------------------------------------------|
| `type`     | Yes      | One of the 4 shard types                                |
| `projects` | No       | Project names (defaults to `[]`)                        |
| `tags`     | No       | Searchable tags (defaults to `[]`)                      |
| `created`  | Yes      | Creation date                                           |
| `updated`  | Yes      | Last updated date                                       |
| `title`    | No       | Overrides default title (first `#` heading or filename) |

Invalid frontmatter shards are silently skipped.

## Project Filtering

Drop a `.context.toml` in any project root:

```toml
[project]
name = "my-next-app"

[filter]
tags = ["typescript", "react", "nextjs"]
types = ["gotchas", "patterns"]
exclude = ["drafts/*"]
```

Applies to `index`, `research`, and `sync` automatically.

Shards with no `projects` field are global — they sync to `~/.claude/CLAUDE.md`. Project-tagged shards sync to matching project `CLAUDE.md` files.

## Examples

> Write a gotcha about Next.js fetch cache persisting across requests in production. Tag it with nextjs and react.

Next session, the gotcha surfaces via Knowledge Index — no re-explaining.

> Write a decision about why we chose App Router over Pages Router for my-next-app.

> Write a pattern about React Server Components data fetching, tag it with the my-next-app project.

## Development

```bash
git clone https://github.com/0xspdn/claude-shards.git
cd claude-shards
bun install
bun test
```

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for branching model, commit conventions, and release workflow. [CHANGELOG.md](CHANGELOG.md) tracks what shipped in each version.

## Tech Stack

- **Runtime:** Bun
- **Protocol:** [Model Context Protocol](https://modelcontextprotocol.io/) via `@modelcontextprotocol/sdk`
- **Frontmatter:** gray-matter
- **Tokens:** tiktoken (cl100k_base)
- **Validation:** Zod
- **Config:** smol-toml
