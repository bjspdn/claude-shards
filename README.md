<div align="center">

# Claude Shards

**Structured knowledge base for Claude Code, built on Obsidian.**

![npm](https://img.shields.io/npm/v/@bjspdn/claude-shards?style=flat-square&logo=npm)
![Claude Compatible](https://img.shields.io/badge/Claude_Code-Compatible-D97706?style=flat-square&logo=anthropic)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

## What it does

Claude Shards is an MCP server that gives Claude Code persistent knowledge through an Obsidian-compatible vault. Knowledge is captured as markdown notes with typed YAML frontmatter (architecture, decisions, patterns, gotchas, references) and linked together with wikilinks. The `sync` tool writes relevant notes into your project's `docs/knowledge/` folder and injects a Knowledge Index table into CLAUDE.md, so Claude has the right context at session start.

## Install

```sh
bun install -g @bjspdn/claude-shards && claude-shards --init
```

Then start a Claude Code session — the MCP tools are available immediately.

## Tools

| Tool              | Description                                                      |
|-------------------|------------------------------------------------------------------|
| `read`            | Fetch a note by its relative vault path                          |
| `search`          | Hybrid BM25 + semantic search across all notes                   |
| `write`           | Create or update notes (create / replace / append / patch modes) |
| `sync`            | Gather notes for synthesis or write them into project context    |
| `health`          | Lifecycle hygiene and vault health report                        |
| `suggest-capture` | Proactive knowledge capture suggestions                          |

## CLI

| Flag          | Description                                      |
|---------------|--------------------------------------------------|
| `--init`      | Scaffold a new vault and register the MCP server |
| `--update`    | Update to the latest version                     |
| `--uninstall` | Remove MCP server registration and config        |
| `--version`   | Print the installed version                      |
| `--logging`   | View structured server logs                      |

## How it works

1. **Capture** — Claude proactively suggests creating notes during conversations. Notes are saved to the vault with typed frontmatter and wikilinks to related notes.
2. **Sync** — The `sync` tool gathers notes and their linked dependencies, produces a tight summary, and writes it into your project's `docs/knowledge/` folder. It also injects a Knowledge Index table into CLAUDE.md.
3. **Search** — Hybrid BM25 keyword scoring + semantic embeddings (all-MiniLM-L6-v2), boosted by the wikilink graph. Use this to find vault notes that aren't synced to the current project.

The Knowledge Index table in CLAUDE.md controls which notes are auto-loaded into Claude's context at session start. Synced notes are kept concise to minimize token usage — the vault holds the full detail, accessible via `read` and `search`.

The vault is fully Obsidian-compatible — browse and edit notes in Obsidian or let Claude manage everything through MCP tools.

## License

MIT
