# Implementation Plan: obsidian-context-mcp

## Stack
> TypeScript, Bun, @modelcontextprotocol/sdk, gray-matter (frontmatter parsing), globby (file discovery), tiktoken (token counting), smol-toml (config parsing), zod (schema validation)

## Scope
> **In scope:** MCP server exposing Obsidian vault as structured context for Claude Code. Keyword search, compressed index generation, per-project CLAUDE.md sync, vault conventions (frontmatter schema, folder structure, typed categories), auto token counting, note creation from Claude Code.
> **Out of scope:** Semantic/embedding search, web UI for vault management, multi-vault support, auto-generating notes from code.

## Blockers
> None

## Dependency Graph
1. Project Scaffold — no dependencies
2. Vault Parser — depends on: Project Scaffold
3. Index Engine — depends on: Vault Parser
4. MCP Server — depends on: Index Engine
5. Sync Command — depends on: Index Engine
6. Integration & Verification — depends on: all above

---

## Epic 1: Project Scaffold
> Initialize the project, define core types, and set up the MCP server skeleton.
> Depends on: none

### 1.1 Project Setup
> Bun project with dependencies and module structure.

- [x] Run `bun init` and add dependencies: `@modelcontextprotocol/sdk`, `gray-matter`, `globby`, `tiktoken`, `zod`, `smol-toml`
- [x] Create module structure: `src/index.ts` (entrypoint), `src/vault/parser.ts`, `src/vault/types.ts`, `src/vault/config.ts`, `src/vault/loader.ts`, `src/index-engine/index.ts`, `src/tools/index-tool.ts`, `src/tools/read-tool.ts`, `src/tools/search-tool.ts`, `src/tools/sync-tool.ts`, `src/tools/write-tool.ts`
- [x] Set up `tsconfig.json` targeting Bun

### 1.2 Core Types
> Define the data model for vault notes and index entries.

- [x] Define `NoteType` zod enum: `gotcha`, `decision`, `pattern`, `reference`
- [x] Define `NoteFrontmatter`: type, projects (string[]), tags (string[]), created (date), updated (date), title (optional override)
- [x] Define `NoteEntry`: frontmatter + filePath, relativePath, title (derived from frontmatter title, first H1, or filename), body (raw markdown), tokenCount (number)
- [x] Define `IndexEntry`: icon, title, relativePath, tokenDisplay — the minimal row that appears in CLAUDE.md
- [x] Define `ProjectConfig` schema: project name, filter (tags, types, exclude globs)
- [x] Create Zod schemas for all types to validate frontmatter and config at parse time
- [x] Define `NOTE_TYPE_PRIORITY` and `NOTE_TYPE_ICONS` lookup tables

### 1.3 Configuration
> Server and per-project configuration loading.

- [x] MCP server accepts vault path via `--vault` CLI arg, falls back to `OBSIDIAN_VAULT_PATH` env var
- [x] Per-project config read from `.context.toml` in working directory (optional — if absent, index the entire vault)
- [x] Define `.context.toml` schema:
  ```toml
  [project]
  name = "my-bevy-game"

  [filter]
  tags = ["rust", "bevy", "ecs"]     # include notes matching ANY of these tags
  types = ["gotcha", "decision", "pattern"]  # include these note types
  exclude = ["drafts/*"]              # glob patterns to skip
  ```
- [x] Parse TOML using `smol-toml`, validate with Zod schema

---

## Epic 2: Vault Parser
> Read and parse Obsidian vault into structured NoteEntry objects.
> Depends on: Project Scaffold

### 2.1 File Discovery
> Find all markdown files in the vault that match conventions.

- [x] Recursively discover `.md` files in vault path using globby
- [x] Ignore hidden directories and `node_modules`
- [x] Return list of absolute file paths

### 2.2 Frontmatter Parser
> Extract and validate frontmatter from each note.

- [x] Parse frontmatter using gray-matter
- [x] Validate against Zod schema — notes with missing/invalid frontmatter get logged as warnings and skipped
- [x] Extract title: use frontmatter `title` field if present, else first `# heading`, else filename without extension
- [x] Extract body: everything after frontmatter, trimmed

### 2.3 Token Counter
> Calculate approximate token count for each note body.

- [x] Use tiktoken with `cl100k_base` encoding (Claude-compatible)
- [x] Count tokens for the note body only (not frontmatter)
- [x] Round to nearest 10 and prefix with `~` for display (e.g., `~150`)

### 2.4 Vault Loader
> Orchestrate discovery → parsing → token counting into a full vault representation.

- [x] Combine file discovery, frontmatter parsing, and token counting into a single `loadVault(vaultPath): NoteEntry[]` function
- [x] `filterEntries()` applies project config filters (tags, types, excludes) with glob matching
- [x] Sort entries by type priority: gotcha > decision > pattern > reference
- [x] Write tests: vault with valid notes, notes with missing frontmatter, empty vault, notes that should be filtered out

---

## Epic 3: Index Engine
> Generate compressed index tables from parsed vault data.
> Depends on: Vault Parser

### 3.1 Index Builder
> Transform NoteEntry[] into the compressed index format.

- [x] Map NoteType to icon: `gotcha→🔴`, `decision→🟤`, `pattern→🔵`, `reference→🟢`
- [x] Generate index as markdown table: `| T | Title | Path | ~Tok |`
- [x] Paths are relative to vault root
- [x] Return "No knowledge entries match the current filters." for empty results

### 3.2 CLAUDE.md Formatter
> Format the index into a complete CLAUDE.md knowledge section.

- [x] Output format:
  ```markdown
  ## Knowledge Index
  Use MCP tool `read` with the note path to fetch full details on demand.
  🔴 = gotcha  🟤 = decision  🔵 = pattern  🟢 = reference

  | T | Title | Path | ~Tok |
  |---|-------|------|------|
  | 🔴 | Bevy system ordering | gotchas/bevy-system-order.md | ~120 |
  ...
  ```
- [x] If a CLAUDE.md already exists in the target directory, inject/replace only the `## Knowledge Index` section — preserve everything else in the file
- [x] If no CLAUDE.md exists, create one with only the knowledge index section

---

## Epic 4: MCP Server
> Wire up the MCP server with all five tools.
> Depends on: Index Engine

### 4.1 Server Bootstrap
> Initialize MCP server using the SDK with stdio transport.

- [x] Create MCP server instance with name `ccm` and version `0.1.0`
- [x] Configure stdio transport (Claude Code communicates over stdin/stdout)
- [x] Load vault on startup, store parsed NoteEntry[] in memory
- [x] Register all five tools with the server

### 4.2 `index` Tool
> Return the compressed index for the current project.

- [x] Input schema: `{ project?: string }` — optional project name to filter by
- [x] If project specified, filter vault entries by project tag
- [x] Return the markdown index table
- [x] If no matching notes, return "No knowledge entries match the current filters."

### 4.3 `read` Tool
> Fetch the full content of a specific vault note.

- [x] Input schema: `{ path: string }` — relative path within vault
- [x] Resolve path against vault root, validate it's within vault (prevent path traversal)
- [x] Return full markdown content including frontmatter
- [x] If note doesn't exist, return error with suggestion to run `index` to see available notes

### 4.4 `search` Tool
> Keyword search across vault notes.

- [x] Input schema: `{ query: string, types?: NoteType[], tags?: string[], limit?: number }`
- [x] Search strategy: split query into keywords, match against title + tags + body
- [x] Scoring: title match (+10) > tag match (+5) > body match (+1)
- [x] Return matching rows with score (not full content) — agent uses `read` to fetch details
- [x] Default limit: 10 results
- [x] Apply project filters if `.context.toml` present in CWD

### 4.5 `sync` Tool
> Generate/update CLAUDE.md in the current project directory.

- [x] Input schema: `{ targetDir?: string }` — defaults to CWD
- [x] Load project config from `.context.toml` in target dir (if exists)
- [x] Generate index using Index Engine
- [x] Write/update CLAUDE.md in target dir using the CLAUDE.md Formatter (section injection, not overwrite)
- [x] Return summary: "Synced N entries to CLAUDE.md (~X total index tokens)"

### 4.6 `write` Tool
> Create a new note in the vault with structured frontmatter.

- [x] Input schema: `{ path: string, type: NoteType, title: string, body: string, tags?: string[], projects?: string[] }`
- [x] Path safety: reject absolute paths, reject `..` traversal via `relative()` check
- [x] Existence check: reject if file already exists (create-only, no overwrites)
- [x] Create parent directories with `mkdir -p` if needed
- [x] Build YAML frontmatter from structured fields, auto-set `created` and `updated` to today
- [x] Write file: frontmatter + `\n# ${title}\n\n${body}\n`
- [x] Parse back with `parseNote()` and push to shared entries array, re-sort by `NOTE_TYPE_PRIORITY`
- [x] Return `{ ok: true, path }` or `{ ok: false, error }`

---

## Epic 5: Developer Experience
> Documentation, vault scaffolding, and onboarding.
> Depends on: MCP Server

### 5.1 Vault Scaffolding Command
> CLI command to bootstrap vault structure and register with Obsidian + Claude Code.

- [x] Add `--init` flag to CLI routing (discriminated union: init vs serve)
- [x] Creates vault at `~/.ccm/knowledge-base/` with subfolders: `gotchas/`, `decisions/`, `patterns/`, `references/`, `_templates/`
- [x] Creates seed notes: `patterns/obsidian-flavored-markdown.md`, `_templates/note.md`
- [x] Registers vault with Obsidian (idempotent, graceful when not installed)
- [x] Registers MCP server with Claude Code via `claude mcp add` (graceful fallback with manual command)
- [x] All steps idempotent — re-running `--init` reports "skipped" for existing items
- [x] Graceful shutdown on SIGINT/SIGTERM

### 5.2 npm Publishing & Distribution
> Publish to npm for `bunx` distribution.

- [x] Build pipeline with bunup (`target: "bun"`, ESM output)
- [x] Package config: bin, files, main, prepublishOnly
- [x] `.npmignore` excludes tests, docs, source
- [x] Default vault path `~/.ccm/knowledge-base/` when no `--vault` flag
- [x] Install via `bunx -y claude-code-memory --init` or `claude mcp add`
- [x] Updated README with Quick Start instructions

---

## Epic 6: Integration & Verification
> End-to-end testing and real-world validation.
> Depends on: all above

### 6.1 Integration Tests
> Test the full flow from vault to Claude Code consumption.

- [x] Create a test vault fixture with notes across all types, some with overlapping project tags
- [x] Test: `index` returns correct filtered table for a project
- [x] Test: `read` returns full content, rejects path traversal attempts
- [x] Test: `search` returns ranked results matching keywords in title, tags, body
- [x] Test: `sync` creates CLAUDE.md with correct index, preserves existing CLAUDE.md content outside the knowledge section
- [x] Test: vault with notes missing frontmatter doesn't crash, logs warnings

### 6.2 Real-World Validation
> Test with your actual Obsidian vault and a real Claude Code session.

- [ ] Create 5-10 real notes in your vault following the conventions (mix of Bevy gotchas, architecture decisions, TS patterns)
- [ ] Configure `.context.toml` for one of your projects
- [ ] Run `sync`, verify CLAUDE.md looks correct
- [ ] Start a Claude Code session, verify the index appears in context
- [ ] Test that Claude Code can use `read` and `search` tools to pull knowledge on demand
- [ ] Measure: does the index stay under ~1500 tokens? Does Claude Code use the tools appropriately without over-fetching?
