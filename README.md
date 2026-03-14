<div align="center">

# Claude Shards

**Structured knowledge base for Claude Code, built for Obsidian.**

![npm](https://img.shields.io/npm/v/@bjspdn/claude-shards?style=flat-square&logo=npm)
![Claude Compatible](https://img.shields.io/badge/Claude_Code-Compatible-D97706?style=flat-square&logo=anthropic)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

</div>

---

## The idea

Claude Shards is an MCP server that gives Claude Code persistent knowledge through an Obsidian-compatible vault. Knowledge is captured as markdown notes with typed YAML frontmatter (architecture, decisions, patterns, gotchas, references) and linked together with wikilinks. The `sync` tool gathers, summarize & writes relevant notes into your project's `docs/knowledge/` folder and injects a Knowledge Index table into CLAUDE.md, so Claude has the right context at session start.

### About Summarization

Syncing works in two steps. First, `sync` runs in **gather mode** — it collects the requested notes along with their forward-linked dependencies and formats everything into a single prompt constrained by a token budget that Claude will roughly respect (`gatherMaxTokens`, configurable via `--config`). Dependencies are truncated proportionally if the budget is tight, and notes already being synced directly are flagged to avoid duplication. This gathered output goes back to Claude for synthesis. Then in **sync mode**, Claude provides the summarized versions, and the tool writes them into `docs/knowledge/`, updates the Knowledge Index in CLAUDE.md, and cleans up any previously-synced notes no longer requested.


## Install
> Upon initialization, it will create a `~/.claude-shards` containing the vault.

```sh
bun install -g @bjspdn/claude-shards && claude-shards --init
```

Then start a Claude Code session — the MCP tools are available immediately.

### Allowing tools

By default, Claude Code will prompt you each time an MCP tool is invoked. To auto-allow all claude-shards tools, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__claude-shards__*"
    ]
  }
}
```

Or allow specific tools only:

```json
{
  "permissions": {
    "allow": [
      "mcp__claude-shards__read",
      "mcp__claude-shards__search",
      "mcp__claude-shards__sync"
    ]
  }
}
```

## Uninstall

```sh
claude-shards --uninstall
```

This removes the MCP server registration, prompts whether to delete `~/.claude-shards` (vault + config), and uninstalls the global package.

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

The CLI handles setup and configuration. When stdin is piped, it starts the MCP server instead.

| Flag          | Description                                      |
|---------------|--------------------------------------------------|
| `--init`      | Scaffold a new vault and register the MCP server |
| `--config`    | Interactive configuration editor                 |
| `--uninstall` | Remove MCP registration and vault (with confirmation) |

### Configuration

`claude-shards --config` opens a terminal UI for tuning how search, sync, and similarity behave. Configuration is stored in `~/.claude-shards/config.toml`. The defaults work well for most vaults — you only need to touch these if you have specific needs.

**Search** controls how notes are found when Claude uses the `search` tool. Search blends two strategies: keyword matching and semantic matching. These settings control that blend.

| Setting         | Default | Description                                                                                                                                                                                      |
|-----------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Semantic Weight | 0.35    | How much to trust meaning-based search vs exact keyword matches. At 0 it's pure keywords, at 1 it's pure meaning. 0.35 leans keyword-heavy because vault notes tend to have precise terminology. |
| Candidate K     | 50      | How many notes to consider before picking the best ones. Higher means more thorough but slower. 50 is plenty for vaults under a few hundred notes.                                               |
| Alpha           | 0.3     | Multiplier for the link-graph bonus added to each note's score. If a note is linked to by other high-scoring results, it gets a boost equal to `alpha × link_bonus`. At 0 links are ignored entirely, at 0.5 the bonus is weighted half as strong as the base search score. 0.3 gives well-connected notes a gentle nudge without letting popularity overrule relevance. |
| Default Limit   | 10      | How many results to return. Claude can override this per-query.                                                                                                                                  |

**Similarity** controls how the tool detects when a new note is too close to an existing one, and how note slugs and context previews are generated.

| Setting         | Default | Description                                                                                                                                                                                                                         |
|-----------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Threshold       | 0.7     | How similar two notes need to be before suggesting you update the existing one instead of creating a duplicate. 0.7 means "pretty similar". Lower it if you want stricter dedup, raise it if you want more freedom to create notes. |
| Slug Max Len    | 60      | Max length for auto-generated filenames. Keeps paths readable and avoids filesystem issues.                                                                                                                                         |
| Context Max Len | 120     | Max length for the short preview shown when comparing similar notes. Just enough to tell them apart at a glance.                                                                                                                    |

**Sync** controls the gather step when syncing notes into a project.

| Setting           | Default | Description                                                                                                                                                                                                                                       |
|-------------------|---------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Gather Max Tokens | 250     | Token budget for each gathered note. This is the size target Claude aims for when summarizing a note for your project's `docs/knowledge/`. Lower means more concise synced notes (fewer tokens in CLAUDE.md), higher means more detail preserved. |

**Capture** controls how aggressively Claude suggests saving knowledge to the vault during conversations.

| Setting        | Default | Description                                                                                                                                                                                                                                     |
|----------------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Aggressiveness | 0.5     | How eager Claude is to suggest capturing knowledge. At 0 the tool is disabled entirely. Low values (0.1–0.3) limit suggestions to critical, highly reusable knowledge. Mid values (0.4–0.6) are the balanced default. High values (0.7–1.0) capture aggressively — any insight that might be useful later. |

**Updates**

| Setting     | Default | Description                                                                                                                |
|-------------|---------|----------------------------------------------------------------------------------------------------------------------------|
| Auto Update | true    | Check for new versions and update automatically when the MCP server starts. Disable if you want to pin a specific version. |


## How it works

1. **Capture** — Claude proactively suggests creating notes during conversations. Notes are saved to the vault with typed frontmatter and wikilinks to related notes.
2. **Sync** — The `sync` tool gathers notes and their linked dependencies, produces a tight summary, and writes it into your project's `docs/knowledge/` folder. It also injects a Knowledge Index table into CLAUDE.md.
3. **Search** — Hybrid BM25 keyword scoring + semantic embeddings (all-MiniLM-L6-v2), boosted by the wikilink graph. Use this to find vault notes that aren't synced to the current project.

The Knowledge Index table in CLAUDE.md controls which notes are auto-loaded into Claude's context at session start. Synced notes are kept concise to minimize token usage — the vault holds the full detail, accessible via `read` and `search`.

The vault is fully Obsidian-compatible — browse and edit notes in Obsidian or let Claude manage everything through MCP tools.

## License

MIT
