# Implementation Plan: obsidian-context-mcp

## Stack
> TypeScript, Bun, @modelcontextprotocol/sdk, gray-matter (frontmatter parsing), globby (file discovery), tiktoken (token counting)

## Scope
> **In scope:** MCP server exposing Obsidian vault as structured context for Claude Code. Keyword search, compressed index generation, per-project CLAUDE.md sync, vault conventions (frontmatter schema, folder structure, typed categories), auto token counting.
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

- [ ] Run `bun init` and add dependencies: `@modelcontextprotocol/sdk`, `gray-matter`, `globby`, `tiktoken`, `zod` (input validation)
- [ ] Create module structure: `src/index.ts` (entrypoint), `src/vault/parser.ts`, `src/vault/types.ts`, `src/index-engine/index.ts`, `src/tools/index-tool.ts`, `src/tools/read-tool.ts`, `src/tools/search-tool.ts`, `src/tools/sync-tool.ts`
- [ ] Set up `tsconfig.json` targeting Bun

### 1.2 Core Types
> Define the data model for vault notes and index entries.

- [ ] Define `NoteType` enum: `gotcha`, `decision`, `pattern`, `guide`, `reference`
- [ ] Define `NoteFrontmatter`: type, projects (string[]), tags (string[]), created (date), updated (date)
- [ ] Define `NoteEntry`: frontmatter + filePath, title (derived from filename or first H1), body (raw markdown), tokenCount (number)
- [ ] Define `IndexEntry`: type icon, title, relative path, token count — the minimal row that appears in CLAUDE.md
- [ ] Define `ProjectConfig` schema: vault path, project name, include tags, include types, exclude patterns
- [ ] Create Zod schemas for all types to validate frontmatter and config at parse time

### 1.3 Configuration
> Server and per-project configuration loading.

- [ ] MCP server accepts vault path via `--vault` CLI arg, falls back to `OBSIDIAN_VAULT_PATH` env var
- [ ] Per-project config read from `.context.toml` in working directory (optional — if absent, index the entire vault)
- [ ] Define `.context.toml` schema:
  ```toml
  [project]
  name = "my-bevy-game"
  
  [filter]
  tags = ["rust", "bevy", "ecs"]     # include notes matching ANY of these tags
  types = ["gotcha", "decision", "pattern"]  # include these note types
  exclude = ["drafts/*"]              # glob patterns to skip
  ```
- [ ] Write TOML parser using Bun-compatible library (or hand-parse — TOML subset is small)

---

## Epic 2: Vault Parser
> Read and parse Obsidian vault into structured NoteEntry objects.
> Depends on: Project Scaffold

### 2.1 File Discovery
> Find all markdown files in the vault that match conventions.

- [ ] Recursively discover `.md` files in vault path using globby
- [ ] Ignore hidden directories (`.obsidian`, `.trash`, `.context`), `node_modules`
- [ ] Return list of absolute file paths

### 2.2 Frontmatter Parser
> Extract and validate frontmatter from each note.

- [ ] Parse frontmatter using gray-matter
- [ ] Validate against Zod schema — notes with missing/invalid frontmatter get logged as warnings and skipped
- [ ] Extract title: use frontmatter `title` field if present, else first `# heading`, else filename without extension
- [ ] Extract body: everything after frontmatter

### 2.3 Token Counter
> Calculate approximate token count for each note body.

- [ ] Use tiktoken with `cl100k_base` encoding (Claude-compatible)
- [ ] Count tokens for the note body only (not frontmatter)
- [ ] Round to nearest 10 and prefix with `~` for display (e.g., `~150`)
- [ ] Cache token counts — only recompute if file mtime changed since last parse

### 2.4 Vault Loader
> Orchestrate discovery → parsing → token counting into a full vault representation.

- [ ] Combine file discovery, frontmatter parsing, and token counting into a single `loadVault(vaultPath): NoteEntry[]` function
- [ ] Apply project config filters (tags, types, excludes) when a ProjectConfig is provided
- [ ] Sort entries by type priority: gotcha > decision > pattern > guide > reference
- [ ] Write tests: vault with valid notes, notes with missing frontmatter, empty vault, notes that should be filtered out

---

## Epic 3: Index Engine
> Generate compressed index tables from parsed vault data.
> Depends on: Vault Parser

### 3.1 Index Builder
> Transform NoteEntry[] into the compressed index format.

- [ ] Map NoteType to icon: `gotcha→🔴`, `decision→🟤`, `pattern→🔵`, `guide→🟡`, `reference→🟢`
- [ ] Generate index as markdown table: `| T | Title | Path | ~Tok |`
- [ ] Paths should be relative to vault root
- [ ] Total index token count should be tracked — warn if index itself exceeds ~1500 tokens (signal that vault needs pruning or stricter project filters)

### 3.2 CLAUDE.md Formatter
> Format the index into a complete CLAUDE.md knowledge section.

- [ ] Output format:
  ```markdown
  ## Knowledge Index
  Use MCP tool `read` with the note path to fetch full details on demand.
  🔴 = gotcha  🟤 = decision  🔵 = pattern  🟡 = guide  🟢 = reference

  | T | Title | Path | ~Tok |
  |---|-------|------|------|
  | 🔴 | Bevy system ordering | gotchas/bevy-system-order.md | ~120 |
  ...
  ```
- [ ] If a CLAUDE.md already exists in the target directory, inject/replace only the `## Knowledge Index` section — preserve everything else in the file
- [ ] If no CLAUDE.md exists, create one with only the knowledge index section

---

## Epic 4: MCP Server
> Wire up the MCP server with all four tools.
> Depends on: Index Engine

### 4.1 Server Bootstrap
> Initialize MCP server using the SDK with stdio transport.

- [ ] Create MCP server instance with name `obsidian-context` and version from package.json
- [ ] Configure stdio transport (Claude Code communicates over stdin/stdout)
- [ ] Load vault on startup, store parsed NoteEntry[] in memory
- [ ] Register all four tools with the server
- [ ] Handle graceful shutdown

### 4.2 `index` Tool
> Return the compressed index for the current project.

- [ ] Input schema: `{ project?: string }` — optional project name to filter by
- [ ] If project specified, load `.context.toml` from CWD or filter vault entries by project tag
- [ ] Return the markdown index table (same format as CLAUDE.md section, without the header)
- [ ] If no matching notes, return a clear message ("No knowledge entries match this project's filters")

### 4.3 `read` Tool
> Fetch the full content of a specific vault note.

- [ ] Input schema: `{ path: string }` — relative path within vault
- [ ] Resolve path against vault root, validate it's within vault (prevent path traversal)
- [ ] Return full markdown content including frontmatter
- [ ] If note doesn't exist, return error with suggestion to run `index` to see available notes

### 4.4 `search` Tool
> Keyword search across vault notes.

- [ ] Input schema: `{ query: string, types?: NoteType[], tags?: string[], limit?: number }`
- [ ] Search strategy: split query into keywords, match against title + tags + body
- [ ] Scoring: title match > tag match > body match (simple weighted scoring)
- [ ] Return matching IndexEntry rows (not full content) — agent uses `read` to fetch details
- [ ] Default limit: 10 results
- [ ] Apply project filters if `.context.toml` present in CWD

### 4.5 `sync` Tool
> Generate/update CLAUDE.md in the current project directory.

- [ ] Input schema: `{ targetDir?: string }` — defaults to CWD
- [ ] Load project config from `.context.toml` in target dir (if exists)
- [ ] Generate index using Index Engine
- [ ] Write/update CLAUDE.md in target dir using the CLAUDE.md Formatter (section injection, not overwrite)
- [ ] Return summary: "Synced N entries to CLAUDE.md (~X total index tokens)"

---

## Epic 5: Developer Experience
> Documentation, vault scaffolding, and onboarding.
> Depends on: MCP Server

### 5.1 Vault Scaffolding Command
> Optional CLI command to bootstrap vault structure.

- [ ] Add a `--init-vault` flag to the server CLI
- [ ] Creates the folder structure: `patterns/`, `decisions/`, `gotchas/`, `guides/`, `references/`, `.context/`
- [ ] Creates a template note in each folder with correct frontmatter schema as an example
- [ ] Creates a `README.md` in vault root explaining the conventions

### 5.2 Claude Code Configuration Docs
> Document how to wire this into Claude Code.

- [ ] Write setup instructions: how to add the MCP server to Claude Code's config (`~/.claude/claude_desktop_config.json` or project-level `.mcp.json`)
- [ ] Document the `.context.toml` schema with examples
- [ ] Document the frontmatter schema with examples for each note type
- [ ] Include a "writing good titles" guide (from the progressive disclosure principles — specific, actionable, searchable, self-contained)

---

## Epic 6: Integration & Verification
> End-to-end testing and real-world validation.
> Depends on: all above

### 6.1 Integration Tests
> Test the full flow from vault to Claude Code consumption.

- [ ] Create a test vault fixture with ~20 notes across all types, some with overlapping project tags
- [ ] Test: `index` returns correct filtered table for a project
- [ ] Test: `read` returns full content, rejects path traversal attempts
- [ ] Test: `search` returns ranked results matching keywords in title, tags, body
- [ ] Test: `sync` creates CLAUDE.md with correct index, preserves existing CLAUDE.md content outside the knowledge section
- [ ] Test: vault with notes missing frontmatter doesn't crash, logs warnings

### 6.2 Real-World Validation
> Test with your actual Obsidian vault and a real Claude Code session.

- [ ] Create 5-10 real notes in your vault following the conventions (mix of Bevy gotchas, architecture decisions, TS patterns)
- [ ] Configure `.context.toml` for one of your projects
- [ ] Run `sync`, verify CLAUDE.md looks correct
- [ ] Start a Claude Code session, verify the index appears in context
- [ ] Test that Claude Code can use `read` and `search` tools to pull knowledge on demand
- [ ] Measure: does the index stay under ~1500 tokens? Does Claude Code use the tools appropriately without over-fetching?