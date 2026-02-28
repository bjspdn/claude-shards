# obsidian-context-mcp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an MCP server that exposes an Obsidian vault as structured context for Claude Code — compressed index for passive awareness, on-demand tools for retrieval.

**Architecture:** Load-on-startup stdio MCP server. Vault parsed into `NoteEntry[]` on startup, held in memory. 4 tools: `index`, `read`, `search`, `sync`. Per-project filtering via `.context.toml`. CLAUDE.md section injection for passive context.

**Tech Stack:** TypeScript, Bun, @modelcontextprotocol/sdk, gray-matter, globby, tiktoken, zod, smol-toml

---

### Task 1: Scaffold + Core Types

**Files:**
- Create: `src/vault/types.ts`
- Create: `src/vault/config.ts` (empty)
- Create: `src/vault/parser.ts` (empty)
- Create: `src/vault/loader.ts` (empty)
- Create: `src/index-engine/index.ts` (empty)
- Create: `src/tools/index-tool.ts` (empty)
- Create: `src/tools/read-tool.ts` (empty)
- Create: `src/tools/search-tool.ts` (empty)
- Create: `src/tools/sync-tool.ts` (empty)
- Create: `src/index.ts` (empty, replaces root index.ts)
- Modify: `package.json`

**Step 1: Install smol-toml**

Run: `bun add smol-toml`

**Step 2: Create directory structure**

Run: `mkdir -p src/vault src/index-engine src/tools tests/fixtures/vault/{gotchas,decisions,patterns,references,drafts} tests/fixtures/with-config tests/fixtures/no-config tests/fixtures/invalid-config`

**Step 3: Write core types**

```typescript
// src/vault/types.ts
import { z } from "zod"

export const NoteType = z.enum(["gotcha", "decision", "pattern", "reference"])
export type NoteType = z.infer<typeof NoteType>

export const NOTE_TYPE_ICONS: Record<NoteType, string> = {
  gotcha: "🔴",
  decision: "🟤",
  pattern: "🔵",
  reference: "🟢",
}

export const NOTE_TYPE_PRIORITY: Record<NoteType, number> = {
  gotcha: 0,
  decision: 1,
  pattern: 2,
  reference: 3,
}

export const NoteFrontmatter = z.object({
  type: NoteType,
  projects: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  created: z.coerce.date(),
  updated: z.coerce.date(),
  title: z.string().optional(),
})
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>

export interface NoteEntry {
  frontmatter: NoteFrontmatter
  filePath: string
  relativePath: string
  title: string
  body: string
  tokenCount: number
}

export interface IndexEntry {
  icon: string
  title: string
  relativePath: string
  tokenDisplay: string
}

export const ProjectConfigSchema = z.object({
  project: z.object({
    name: z.string(),
  }).optional(),
  filter: z.object({
    tags: z.array(z.string()).optional(),
    types: z.array(NoteType).optional(),
    exclude: z.array(z.string()).optional(),
  }).optional(),
})
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>
```

**Step 4: Update package.json**

Change `"module"` field from `"index.ts"` to `"src/index.ts"`. Delete root `index.ts`.

**Step 5: Create empty module files**

Each file gets a single placeholder export comment so imports don't break during incremental development. Just create each file empty.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold project structure and core types"
```

---

### Task 2: Test Fixture Vault

**Files:**
- Create: `tests/fixtures/vault/gotchas/bevy-system-ordering.md`
- Create: `tests/fixtures/vault/gotchas/rust-lifetime-elision.md`
- Create: `tests/fixtures/vault/decisions/chose-ecs-over-oop.md`
- Create: `tests/fixtures/vault/decisions/use-bun-over-node.md`
- Create: `tests/fixtures/vault/patterns/rust-error-handling.md`
- Create: `tests/fixtures/vault/patterns/ts-builder-pattern.md`
- Create: `tests/fixtures/vault/references/bevy-query-cheatsheet.md`
- Create: `tests/fixtures/vault/references/bun-serve-api.md`
- Create: `tests/fixtures/vault/no-frontmatter.md`
- Create: `tests/fixtures/vault/invalid-type.md`
- Create: `tests/fixtures/vault/drafts/wip-note.md`
- Create: `tests/fixtures/with-config/.context.toml`
- Create: `tests/fixtures/invalid-config/.context.toml`

**Step 1: Create vault fixture notes**

Each note has realistic frontmatter and a short body. Here are all 11:

```markdown
<!-- tests/fixtures/vault/gotchas/bevy-system-ordering.md -->
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

Systems in Bevy run in parallel by default. If System A writes to a component and System B reads it, you need explicit ordering with `.before()` or `.after()`.

```rust
app.add_systems(Update, (
    move_player.before(check_collisions),
    check_collisions,
));
```
```

```markdown
<!-- tests/fixtures/vault/gotchas/rust-lifetime-elision.md -->
---
type: gotcha
projects:
  - shared
tags:
  - rust
created: 2026-01-15
updated: 2026-01-15
---

# Rust lifetime elision can surprise you

When a function takes multiple references, the compiler can't always infer lifetimes. Explicitly annotate when the return borrows from a specific parameter.
```

```markdown
<!-- tests/fixtures/vault/decisions/chose-ecs-over-oop.md -->
---
type: decision
projects:
  - bevy-game
tags:
  - bevy
  - architecture
created: 2026-01-10
updated: 2026-01-10
---

# Chose ECS over OOP for game architecture

ECS gives better cache performance and composability. Inheritance hierarchies become rigid and hard to refactor. Bevy's ECS is idiomatic Rust.
```

```markdown
<!-- tests/fixtures/vault/decisions/use-bun-over-node.md -->
---
type: decision
projects:
  - web-api
tags:
  - typescript
  - bun
created: 2026-02-01
updated: 2026-02-01
---

# Use Bun over Node.js for TypeScript projects

Bun has native TypeScript support, faster startup, built-in test runner, and built-in SQLite. Less tooling friction.
```

```markdown
<!-- tests/fixtures/vault/patterns/rust-error-handling.md -->
---
type: pattern
projects:
  - shared
tags:
  - rust
created: 2026-01-20
updated: 2026-02-10
---

# Rust error handling with thiserror + anyhow

Use `thiserror` for library error types, `anyhow` for application code. Define domain errors with `#[derive(Error)]`.
```

```markdown
<!-- tests/fixtures/vault/patterns/ts-builder-pattern.md -->
---
type: pattern
projects:
  - web-api
tags:
  - typescript
created: 2026-02-05
updated: 2026-02-05
---

# TypeScript builder pattern for complex configs

Use method chaining with `this` return type. Generic builder with `Partial<Config>` accumulation.
```

```markdown
<!-- tests/fixtures/vault/references/bevy-query-cheatsheet.md -->
---
type: reference
projects:
  - bevy-game
tags:
  - bevy
  - rust
created: 2026-01-25
updated: 2026-02-20
---

# Bevy query cheatsheet

Common query patterns: `Query<&Transform>`, `Query<(&mut Health, &Player)>`, `Query<Entity, With<Enemy>>`, `Query<&Name, Changed<Score>>`.
```

```markdown
<!-- tests/fixtures/vault/references/bun-serve-api.md -->
---
type: reference
projects:
  - web-api
tags:
  - bun
  - typescript
created: 2026-02-10
updated: 2026-02-10
---

# Bun.serve() API reference

`Bun.serve({ routes, websocket, development })`. Routes support path params: `/api/users/:id`. WebSocket upgrade via `server.upgrade(req)`.
```

```markdown
<!-- tests/fixtures/vault/no-frontmatter.md -->

This file has no frontmatter and should be skipped during parsing.
```

```markdown
<!-- tests/fixtures/vault/invalid-type.md -->
---
type: invalid-not-real
tags:
  - test
created: 2026-01-01
updated: 2026-01-01
---

This file has an invalid type and should be skipped.
```

```markdown
<!-- tests/fixtures/vault/drafts/wip-note.md -->
---
type: gotcha
projects:
  - bevy-game
tags:
  - draft
created: 2026-02-28
updated: 2026-02-28
---

# Work in progress

This note is in drafts and should be excluded by config.
```

**Step 2: Create config fixtures**

```toml
# tests/fixtures/with-config/.context.toml
[project]
name = "test-project"

[filter]
tags = ["rust", "bevy"]
types = ["gotcha", "pattern"]
exclude = ["drafts/*"]
```

```
# tests/fixtures/invalid-config/.context.toml
this is not valid toml [[[
```

**Step 3: Commit**

```bash
git add tests/fixtures/
git commit -m "feat: add test fixture vault and config files"
```

---

### Task 3: Config Parser (TDD)

**Files:**
- Test: `tests/vault/config.test.ts`
- Create: `src/vault/config.ts`

**Step 1: Write the failing test**

```typescript
// tests/vault/config.test.ts
import { test, expect } from "bun:test"
import { loadProjectConfig } from "../../src/vault/config"
import { join } from "path"

const FIXTURES = join(import.meta.dir, "../fixtures")

test("loadProjectConfig parses valid .context.toml", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "with-config"))
  expect(config).not.toBeNull()
  expect(config!.project!.name).toBe("test-project")
  expect(config!.filter!.tags).toEqual(["rust", "bevy"])
  expect(config!.filter!.types).toEqual(["gotcha", "pattern"])
  expect(config!.filter!.exclude).toEqual(["drafts/*"])
})

test("loadProjectConfig returns null when no .context.toml", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "no-config"))
  expect(config).toBeNull()
})

test("loadProjectConfig returns null for invalid TOML", async () => {
  const config = await loadProjectConfig(join(FIXTURES, "invalid-config"))
  expect(config).toBeNull()
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/vault/config.test.ts`
Expected: FAIL — `loadProjectConfig` not exported

**Step 3: Write minimal implementation**

```typescript
// src/vault/config.ts
import { parse } from "smol-toml"
import { ProjectConfigSchema, type ProjectConfig } from "./types"
import { join } from "path"

export async function loadProjectConfig(dir: string): Promise<ProjectConfig | null> {
  const configPath = join(dir, ".context.toml")
  const file = Bun.file(configPath)

  if (!(await file.exists())) return null

  try {
    const raw = await file.text()
    const parsed = parse(raw)
    const result = ProjectConfigSchema.safeParse(parsed)
    if (!result.success) {
      console.error(`Warning: Invalid .context.toml in ${dir}`)
      return null
    }
    return result.data
  } catch {
    console.error(`Warning: Failed to parse .context.toml in ${dir}`)
    return null
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/vault/config.test.ts`
Expected: 3 tests pass

**Step 5: Commit**

```bash
git add src/vault/config.ts tests/vault/config.test.ts
git commit -m "feat: config parser with TOML loading and validation"
```

---

### Task 4: Note Parser (TDD)

**Files:**
- Test: `tests/vault/parser.test.ts`
- Create: `src/vault/parser.ts`

**Step 1: Write the failing tests**

```typescript
// tests/vault/parser.test.ts
import { test, expect } from "bun:test"
import { parseNote, extractTitle, countTokens } from "../../src/vault/parser"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("parseNote extracts frontmatter, body, and metadata", async () => {
  const entry = await parseNote(
    join(VAULT, "gotchas/bevy-system-ordering.md"),
    VAULT,
  )
  expect(entry).not.toBeNull()
  expect(entry!.frontmatter.type).toBe("gotcha")
  expect(entry!.frontmatter.tags).toContain("bevy")
  expect(entry!.frontmatter.projects).toContain("bevy-game")
  expect(entry!.title).toBe("Bevy system ordering matters")
  expect(entry!.relativePath).toBe("gotchas/bevy-system-ordering.md")
  expect(entry!.body).toContain("Systems in Bevy")
  expect(entry!.tokenCount).toBeGreaterThan(0)
})

test("parseNote returns null for missing frontmatter", async () => {
  const entry = await parseNote(join(VAULT, "no-frontmatter.md"), VAULT)
  expect(entry).toBeNull()
})

test("parseNote returns null for invalid note type", async () => {
  const entry = await parseNote(join(VAULT, "invalid-type.md"), VAULT)
  expect(entry).toBeNull()
})

test("extractTitle prefers frontmatter title field", () => {
  expect(extractTitle({ title: "FM Title" }, "# Heading\nBody", "file.md"))
    .toBe("FM Title")
})

test("extractTitle falls back to first H1 heading", () => {
  expect(extractTitle({}, "# My Heading\nBody", "file.md"))
    .toBe("My Heading")
})

test("extractTitle falls back to filename without extension", () => {
  expect(extractTitle({}, "No heading here", "my-note.md"))
    .toBe("my-note")
})

test("countTokens returns positive count for non-empty text", () => {
  const count = countTokens("Hello world, this is a test sentence.")
  expect(count).toBeGreaterThan(0)
  expect(count).toBeLessThan(20)
})

test("countTokens returns 0 for empty text", () => {
  expect(countTokens("")).toBe(0)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/vault/parser.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write minimal implementation**

```typescript
// src/vault/parser.ts
import matter from "gray-matter"
import { get_encoding } from "tiktoken"
import { NoteFrontmatter, type NoteEntry } from "./types"
import { relative, basename } from "path"

const encoder = get_encoding("cl100k_base")

export function countTokens(text: string): number {
  if (!text) return 0
  return encoder.encode(text).length
}

export function extractTitle(
  frontmatter: { title?: string },
  content: string,
  filePath: string,
): string {
  if (frontmatter.title) return frontmatter.title

  const headingMatch = content.match(/^#\s+(.+)$/m)
  if (headingMatch) return headingMatch[1]!.trim()

  return basename(filePath, ".md")
}

export async function parseNote(
  filePath: string,
  vaultPath: string,
): Promise<NoteEntry | null> {
  const raw = await Bun.file(filePath).text()
  const { data, content } = matter(raw)

  const result = NoteFrontmatter.safeParse(data)
  if (!result.success) {
    console.error(`Skipping ${relative(vaultPath, filePath)}: invalid frontmatter`)
    return null
  }

  const body = content.trim()

  return {
    frontmatter: result.data,
    filePath,
    relativePath: relative(vaultPath, filePath),
    title: extractTitle(data, content, filePath),
    body,
    tokenCount: countTokens(body),
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/vault/parser.test.ts`
Expected: 8 tests pass

**Step 5: Commit**

```bash
git add src/vault/parser.ts tests/vault/parser.test.ts
git commit -m "feat: note parser with frontmatter validation, title extraction, token counting"
```

---

### Task 5: Vault Loader (TDD)

**Files:**
- Test: `tests/vault/loader.test.ts`
- Create: `src/vault/loader.ts`

**Step 1: Write the failing tests**

```typescript
// tests/vault/loader.test.ts
import { test, expect } from "bun:test"
import { discoverFiles, loadVault, filterEntries } from "../../src/vault/loader"
import type { NoteEntry, ProjectConfig } from "../../src/vault/types"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("discoverFiles finds .md files and ignores hidden dirs", async () => {
  const files = await discoverFiles(VAULT)
  expect(files.length).toBeGreaterThan(0)
  expect(files.every((f) => f.endsWith(".md"))).toBe(true)
  expect(files.some((f) => f.includes(".obsidian"))).toBe(false)
})

test("loadVault parses all valid notes and skips invalid ones", async () => {
  const entries = await loadVault(VAULT)
  const titles = entries.map((e) => e.title)
  expect(titles).toContain("Bevy system ordering matters")
  expect(titles).toContain("Chose ECS over OOP for game architecture")
  expect(titles).not.toContain("no-frontmatter")
  expect(titles).not.toContain("invalid-type")
})

test("loadVault sorts by type priority: gotcha > decision > pattern > reference", async () => {
  const entries = await loadVault(VAULT)
  const types = entries.map((e) => e.frontmatter.type)
  const gotchaIdx = types.indexOf("gotcha")
  const decisionIdx = types.indexOf("decision")
  const patternIdx = types.indexOf("pattern")
  const referenceIdx = types.indexOf("reference")
  expect(gotchaIdx).toBeLessThan(decisionIdx)
  expect(decisionIdx).toBeLessThan(patternIdx)
  expect(patternIdx).toBeLessThan(referenceIdx)
})

test("filterEntries with null config returns all entries", async () => {
  const entries = await loadVault(VAULT)
  const filtered = filterEntries(entries, null)
  expect(filtered.length).toBe(entries.length)
})

test("filterEntries by tags keeps notes matching ANY tag", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { tags: ["bevy"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.every((e) => e.frontmatter.tags.includes("bevy"))).toBe(true)
  expect(filtered.length).toBeGreaterThan(0)
  expect(filtered.length).toBeLessThan(entries.length)
})

test("filterEntries by types keeps only matching types", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { types: ["gotcha"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.every((e) => e.frontmatter.type === "gotcha")).toBe(true)
})

test("filterEntries with exclude patterns removes matching paths", async () => {
  const entries = await loadVault(VAULT)
  const config: ProjectConfig = {
    filter: { exclude: ["drafts/*"] },
  }
  const filtered = filterEntries(entries, config)
  expect(filtered.some((e) => e.relativePath.startsWith("drafts/"))).toBe(false)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/vault/loader.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write minimal implementation**

```typescript
// src/vault/loader.ts
import { globby } from "globby"
import { parseNote } from "./parser"
import { NOTE_TYPE_PRIORITY, type NoteEntry, type ProjectConfig } from "./types"

export async function discoverFiles(vaultPath: string): Promise<string[]> {
  return globby("**/*.md", {
    cwd: vaultPath,
    absolute: true,
    ignore: ["**/node_modules/**", "**/.*/**"],
  })
}

export async function loadVault(vaultPath: string): Promise<NoteEntry[]> {
  const files = await discoverFiles(vaultPath)
  const results = await Promise.all(
    files.map((f) => parseNote(f, vaultPath)),
  )

  return results
    .filter((entry): entry is NoteEntry => entry !== null)
    .sort(
      (a, b) =>
        NOTE_TYPE_PRIORITY[a.frontmatter.type] -
        NOTE_TYPE_PRIORITY[b.frontmatter.type],
    )
}

function matchesGlob(path: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regex}$`).test(path)
}

export function filterEntries(
  entries: NoteEntry[],
  config: ProjectConfig | null,
): NoteEntry[] {
  if (!config?.filter) return entries

  const { tags, types, exclude } = config.filter

  return entries.filter((entry) => {
    if (types?.length && !types.includes(entry.frontmatter.type)) return false

    if (
      tags?.length &&
      !entry.frontmatter.tags.some((t) => tags.includes(t))
    )
      return false

    if (
      exclude?.length &&
      exclude.some((pattern) => matchesGlob(entry.relativePath, pattern))
    )
      return false

    return true
  })
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/vault/loader.test.ts`
Expected: 7 tests pass

**Step 5: Commit**

```bash
git add src/vault/loader.ts tests/vault/loader.test.ts
git commit -m "feat: vault loader with file discovery, filtering, and type-priority sorting"
```

---

### Task 6: Index Engine (TDD)

**Files:**
- Test: `tests/index-engine/index.test.ts`
- Create: `src/index-engine/index.ts`

**Step 1: Write the failing tests**

```typescript
// tests/index-engine/index.test.ts
import { test, expect } from "bun:test"
import {
  buildIndexTable,
  formatKnowledgeSection,
  injectKnowledgeSection,
} from "../../src/index-engine/index"
import type { NoteEntry } from "../../src/vault/types"

const MOCK_ENTRIES: NoteEntry[] = [
  {
    frontmatter: {
      type: "gotcha",
      projects: ["bevy-game"],
      tags: ["bevy"],
      created: new Date(),
      updated: new Date(),
    },
    filePath: "/vault/gotchas/ordering.md",
    relativePath: "gotchas/ordering.md",
    title: "System ordering matters",
    body: "Some body text",
    tokenCount: 127,
  },
  {
    frontmatter: {
      type: "decision",
      projects: ["web-api"],
      tags: ["typescript"],
      created: new Date(),
      updated: new Date(),
    },
    filePath: "/vault/decisions/bun.md",
    relativePath: "decisions/bun.md",
    title: "Use Bun over Node",
    body: "Reasons here",
    tokenCount: 83,
  },
]

test("buildIndexTable generates markdown table rows", () => {
  const table = buildIndexTable(MOCK_ENTRIES)
  expect(table).toContain("| 🔴 | System ordering matters | gotchas/ordering.md | ~130 |")
  expect(table).toContain("| 🟤 | Use Bun over Node | decisions/bun.md | ~80 |")
  expect(table).toContain("| T | Title | Path | ~Tok |")
})

test("buildIndexTable returns empty message for no entries", () => {
  const table = buildIndexTable([])
  expect(table).toContain("No knowledge entries")
})

test("formatKnowledgeSection wraps table with header and legend", () => {
  const section = formatKnowledgeSection(MOCK_ENTRIES)
  expect(section).toContain("## Knowledge Index")
  expect(section).toContain("🔴 = gotcha")
  expect(section).toContain("| T | Title | Path | ~Tok |")
})

test("injectKnowledgeSection appends to file without existing section", () => {
  const existing = "# My Project\n\nSome content here.\n"
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).toContain("# My Project")
  expect(result).toContain("Some content here.")
  expect(result).toContain("## Knowledge Index")
})

test("injectKnowledgeSection replaces existing Knowledge Index section", () => {
  const existing = [
    "# My Project",
    "",
    "## Knowledge Index",
    "Old index content here.",
    "| old | table |",
    "",
    "## Other Section",
    "Keep this.",
  ].join("\n")
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).not.toContain("Old index content")
  expect(result).toContain("## Knowledge Index")
  expect(result).toContain("System ordering matters")
  expect(result).toContain("## Other Section")
  expect(result).toContain("Keep this.")
})

test("injectKnowledgeSection replaces section at end of file", () => {
  const existing = "# My Project\n\n## Knowledge Index\nOld stuff.\n"
  const result = injectKnowledgeSection(existing, MOCK_ENTRIES)
  expect(result).not.toContain("Old stuff")
  expect(result).toContain("## Knowledge Index")
  expect(result).toContain("System ordering matters")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/index-engine/index.test.ts`
Expected: FAIL — functions not exported

**Step 3: Write minimal implementation**

```typescript
// src/index-engine/index.ts
import {
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type IndexEntry,
} from "../vault/types"

export function formatTokenCount(count: number): string {
  return `~${Math.round(count / 10) * 10}`
}

export function toIndexEntry(entry: NoteEntry): IndexEntry {
  return {
    icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
    title: entry.title,
    relativePath: entry.relativePath,
    tokenDisplay: formatTokenCount(entry.tokenCount),
  }
}

export function buildIndexTable(entries: NoteEntry[]): string {
  if (entries.length === 0) {
    return "No knowledge entries match the current filters."
  }

  const rows = entries.map((e) => {
    const idx = toIndexEntry(e)
    return `| ${idx.icon} | ${idx.title} | ${idx.relativePath} | ${idx.tokenDisplay} |`
  })

  return [
    "| T | Title | Path | ~Tok |",
    "|---|-------|------|------|",
    ...rows,
  ].join("\n")
}

export function formatKnowledgeSection(entries: NoteEntry[]): string {
  const table = buildIndexTable(entries)

  return [
    "## Knowledge Index",
    "Use MCP tool `read` with the note path to fetch full details on demand.",
    "🔴 = gotcha  🟤 = decision  🔵 = pattern  🟢 = reference",
    "",
    table,
  ].join("\n")
}

export function injectKnowledgeSection(
  existingContent: string,
  entries: NoteEntry[],
): string {
  const newSection = formatKnowledgeSection(entries)
  const sectionStart = existingContent.indexOf("## Knowledge Index")

  if (sectionStart === -1) {
    return existingContent.trimEnd() + "\n\n" + newSection + "\n"
  }

  const beforeSection = existingContent.substring(0, sectionStart)
  const afterSectionStart = existingContent.indexOf(
    "\n## ",
    sectionStart + "## Knowledge Index".length,
  )

  if (afterSectionStart === -1) {
    return beforeSection + newSection + "\n"
  }

  return (
    beforeSection + newSection + "\n" + existingContent.substring(afterSectionStart + 1)
  )
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/index-engine/index.test.ts`
Expected: 6 tests pass

**Step 5: Commit**

```bash
git add src/index-engine/index.ts tests/index-engine/index.test.ts
git commit -m "feat: index engine with table builder and CLAUDE.md section injection"
```

---

### Task 7: Read Tool (TDD)

**Files:**
- Test: `tests/tools/read-tool.test.ts`
- Create: `src/tools/read-tool.ts`

Each tool exports an `execute*` function (testable business logic) and a `register*` function (MCP wiring).

**Step 1: Write the failing tests**

```typescript
// tests/tools/read-tool.test.ts
import { test, expect } from "bun:test"
import { executeRead } from "../../src/tools/read-tool"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

test("executeRead returns full note content for valid path", async () => {
  const result = await executeRead("gotchas/bevy-system-ordering.md", VAULT)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.content).toContain("type: gotcha")
    expect(result.content).toContain("Systems in Bevy")
  }
})

test("executeRead rejects path traversal with ..", async () => {
  const result = await executeRead("../../../etc/passwd", VAULT)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toContain("outside vault")
  }
})

test("executeRead rejects absolute paths", async () => {
  const result = await executeRead("/etc/passwd", VAULT)
  expect(result.ok).toBe(false)
})

test("executeRead returns error for nonexistent note", async () => {
  const result = await executeRead("does-not-exist.md", VAULT)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toContain("not found")
  }
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/read-tool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/tools/read-tool.ts
import { join, resolve, relative } from "path"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

type ReadResult =
  | { ok: true; content: string }
  | { ok: false; error: string }

export async function executeRead(
  notePath: string,
  vaultPath: string,
): Promise<ReadResult> {
  if (notePath.startsWith("/")) {
    return { ok: false, error: "Absolute paths not allowed. Use paths relative to vault root." }
  }

  const resolved = resolve(vaultPath, notePath)
  const rel = relative(vaultPath, resolved)

  if (rel.startsWith("..")) {
    return { ok: false, error: "Path resolves outside vault. Use paths relative to vault root." }
  }

  const file = Bun.file(resolved)
  if (!(await file.exists())) {
    return { ok: false, error: `Note not found: ${notePath}. Run the 'index' tool to see available notes.` }
  }

  return { ok: true, content: await file.text() }
}

export function registerReadTool(server: McpServer, vaultPath: string) {
  server.tool(
    "read",
    "Fetch full content of a vault note by its relative path",
    { path: z.string().describe("Relative path within vault (e.g. gotchas/bevy-system-ordering.md)") },
    async ({ path }) => {
      const result = await executeRead(path, vaultPath)
      if (result.ok) {
        return { content: [{ type: "text" as const, text: result.content }] }
      }
      return { content: [{ type: "text" as const, text: result.error }], isError: true }
    },
  )
}
```

> **Note:** The MCP SDK's `McpServer` uses `.tool()` method for registration. Check import path — it may be `@modelcontextprotocol/sdk/server/mcp.js` or `@modelcontextprotocol/sdk/server`. Verify at implementation time and adjust.

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/read-tool.test.ts`
Expected: 4 tests pass

**Step 5: Commit**

```bash
git add src/tools/read-tool.ts tests/tools/read-tool.test.ts
git commit -m "feat: read tool with path traversal protection"
```

---

### Task 8: Search Tool (TDD)

**Files:**
- Test: `tests/tools/search-tool.test.ts`
- Create: `src/tools/search-tool.ts`

**Step 1: Write the failing tests**

```typescript
// tests/tools/search-tool.test.ts
import { test, expect } from "bun:test"
import { executeSearch } from "../../src/tools/search-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: Awaited<ReturnType<typeof loadVault>>

// Load vault once for all tests
const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeSearch finds notes matching title keywords", async () => {
  await setup
  const results = executeSearch({ query: "Bevy system ordering" }, entries, null)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("executeSearch scores title matches higher than body matches", async () => {
  await setup
  const results = executeSearch({ query: "bevy" }, entries, null)
  expect(results.length).toBeGreaterThan(1)
  const firstTitle = results[0]!.title.toLowerCase()
  expect(firstTitle).toContain("bevy")
})

test("executeSearch filters by types param", async () => {
  await setup
  const results = executeSearch(
    { query: "rust", types: ["gotcha"] },
    entries,
    null,
  )
  expect(results.every((r) => r.type === "gotcha")).toBe(true)
})

test("executeSearch filters by tags param", async () => {
  await setup
  const results = executeSearch(
    { query: "bun", tags: ["typescript"] },
    entries,
    null,
  )
  expect(results.length).toBeGreaterThan(0)
})

test("executeSearch respects limit", async () => {
  await setup
  const results = executeSearch({ query: "bevy", limit: 2 }, entries, null)
  expect(results.length).toBeLessThanOrEqual(2)
})

test("executeSearch returns empty array for no matches", async () => {
  await setup
  const results = executeSearch(
    { query: "xyznonexistent" },
    entries,
    null,
  )
  expect(results).toEqual([])
})

test("executeSearch applies project config filters", async () => {
  await setup
  const config = { filter: { types: ["gotcha" as const] } }
  const results = executeSearch({ query: "bevy" }, entries, config)
  expect(results.every((r) => r.type === "gotcha")).toBe(true)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/search-tool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/tools/search-tool.ts
import { z } from "zod"
import {
  NoteType,
  NOTE_TYPE_ICONS,
  type NoteEntry,
  type ProjectConfig,
} from "../vault/types"
import { filterEntries } from "../vault/loader"
import { formatTokenCount } from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface SearchArgs {
  query: string
  types?: NoteType[]
  tags?: string[]
  limit?: number
}

interface SearchResult {
  icon: string
  title: string
  type: NoteType
  relativePath: string
  tokenDisplay: string
  score: number
}

function scoreEntry(entry: NoteEntry, keywords: string[]): number {
  let score = 0
  const titleLower = entry.title.toLowerCase()
  const tagsLower = entry.frontmatter.tags.map((t) => t.toLowerCase())
  const bodyLower = entry.body.toLowerCase()

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase()
    if (titleLower.includes(kwLower)) score += 10
    if (tagsLower.some((t) => t.includes(kwLower))) score += 5
    if (bodyLower.includes(kwLower)) score += 1
  }
  return score
}

export function executeSearch(
  args: SearchArgs,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
): SearchResult[] {
  let filtered = filterEntries(entries, projectConfig)

  if (args.types?.length) {
    filtered = filtered.filter((e) => args.types!.includes(e.frontmatter.type))
  }
  if (args.tags?.length) {
    filtered = filtered.filter((e) =>
      e.frontmatter.tags.some((t) => args.tags!.includes(t)),
    )
  }

  const keywords = args.query.split(/\s+/).filter(Boolean)
  if (keywords.length === 0) return []

  const scored = filtered
    .map((entry) => ({
      icon: NOTE_TYPE_ICONS[entry.frontmatter.type],
      title: entry.title,
      type: entry.frontmatter.type,
      relativePath: entry.relativePath,
      tokenDisplay: formatTokenCount(entry.tokenCount),
      score: scoreEntry(entry, keywords),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)

  const limit = args.limit ?? 10
  return scored.slice(0, limit)
}

export function registerSearchTool(
  server: McpServer,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
) {
  server.tool(
    "search",
    "Keyword search across vault notes. Returns index entries — use 'read' tool to fetch full content.",
    {
      query: z.string().describe("Space-separated keywords to search for"),
      types: z.array(NoteType).optional().describe("Filter to these note types"),
      tags: z.array(z.string()).optional().describe("Filter to notes with these tags"),
      limit: z.number().optional().describe("Max results (default 10)"),
    },
    async (args) => {
      const results = executeSearch(args, entries, projectConfig)
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: "No notes match that query." }] }
      }
      const table = [
        "| T | Title | Path | ~Tok | Score |",
        "|---|-------|------|------|-------|",
        ...results.map(
          (r) => `| ${r.icon} | ${r.title} | ${r.relativePath} | ${r.tokenDisplay} | ${r.score} |`,
        ),
      ].join("\n")
      return { content: [{ type: "text" as const, text: table }] }
    },
  )
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/search-tool.test.ts`
Expected: 7 tests pass

**Step 5: Commit**

```bash
git add src/tools/search-tool.ts tests/tools/search-tool.test.ts
git commit -m "feat: search tool with weighted keyword scoring and filtering"
```

---

### Task 9: Index Tool (TDD)

**Files:**
- Test: `tests/tools/index-tool.test.ts`
- Create: `src/tools/index-tool.ts`

**Step 1: Write the failing tests**

```typescript
// tests/tools/index-tool.test.ts
import { test, expect } from "bun:test"
import { executeIndex } from "../../src/tools/index-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeIndex returns full index table with no filters", async () => {
  await setup
  const result = executeIndex({}, entries, null)
  expect(result).toContain("| T | Title | Path | ~Tok |")
  expect(result).toContain("🔴")
  expect(result).toContain("🟤")
})

test("executeIndex filters by project tag", async () => {
  await setup
  const result = executeIndex({ project: "bevy-game" }, entries, null)
  expect(result).toContain("Bevy")
  expect(result).not.toContain("Bun over Node")
})

test("executeIndex applies project config filters", async () => {
  await setup
  const config = { filter: { types: ["gotcha" as const, "pattern" as const] } }
  const result = executeIndex({}, entries, config)
  expect(result).toContain("🔴")
  expect(result).toContain("🔵")
  expect(result).not.toContain("🟤")
})

test("executeIndex returns message when no entries match", async () => {
  await setup
  const result = executeIndex({ project: "nonexistent-project" }, entries, null)
  expect(result).toContain("No knowledge entries")
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/index-tool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/tools/index-tool.ts
import { z } from "zod"
import type { NoteEntry, ProjectConfig } from "../vault/types"
import { filterEntries } from "../vault/loader"
import { buildIndexTable } from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface IndexArgs {
  project?: string
}

export function executeIndex(
  args: IndexArgs,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
): string {
  let filtered = filterEntries(entries, projectConfig)

  if (args.project) {
    filtered = filtered.filter((e) =>
      e.frontmatter.projects.includes(args.project!),
    )
  }

  return buildIndexTable(filtered)
}

export function registerIndexTool(
  server: McpServer,
  entries: NoteEntry[],
  projectConfig: ProjectConfig | null,
) {
  server.tool(
    "index",
    "Return the compressed knowledge index table for the current project or vault",
    {
      project: z.string().optional().describe("Filter to notes tagged with this project name"),
    },
    async (args) => {
      const result = executeIndex(args, entries, projectConfig)
      return { content: [{ type: "text" as const, text: result }] }
    },
  )
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/index-tool.test.ts`
Expected: 4 tests pass

**Step 5: Commit**

```bash
git add src/tools/index-tool.ts tests/tools/index-tool.test.ts
git commit -m "feat: index tool with project and config filtering"
```

---

### Task 10: Sync Tool (TDD)

**Files:**
- Test: `tests/tools/sync-tool.test.ts`
- Create: `src/tools/sync-tool.ts`

**Step 1: Write the failing tests**

```typescript
// tests/tools/sync-tool.test.ts
import { test, expect, beforeEach } from "bun:test"
import { executeSync } from "../../src/tools/sync-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"

const VAULT = join(import.meta.dir, "../fixtures/vault")
let entries: Awaited<ReturnType<typeof loadVault>>
const setup = loadVault(VAULT).then((e) => (entries = e))

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sync-test-"))
})

test("executeSync creates CLAUDE.md when none exists", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT)
  expect(result.summary).toContain("Synced")

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("| T | Title | Path | ~Tok |")
})

test("executeSync preserves existing CLAUDE.md content outside Knowledge Index", async () => {
  await setup
  await Bun.write(
    join(tempDir, "CLAUDE.md"),
    "# My Project\n\nImportant rules here.\n\n## Other Section\n\nKeep this.\n",
  )

  await executeSync(tempDir, entries, VAULT)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("# My Project")
  expect(content).toContain("Important rules here.")
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("## Other Section")
  expect(content).toContain("Keep this.")
})

test("executeSync replaces existing Knowledge Index section", async () => {
  await setup
  await Bun.write(
    join(tempDir, "CLAUDE.md"),
    "# Project\n\n## Knowledge Index\nOld stuff.\n\n## Other\nKeep.\n",
  )

  await executeSync(tempDir, entries, VAULT)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).not.toContain("Old stuff")
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("## Other")
  expect(content).toContain("Keep.")
})

test("executeSync applies .context.toml filters when present", async () => {
  await setup
  const configDir = join(import.meta.dir, "../fixtures/with-config")

  const result = await executeSync(configDir, entries, VAULT)
  expect(result.entryCount).toBeGreaterThan(0)
  expect(result.entryCount).toBeLessThan(entries.length)
})

test("executeSync returns entry count and token summary", async () => {
  await setup
  const result = await executeSync(tempDir, entries, VAULT)
  expect(result.entryCount).toBeGreaterThan(0)
  expect(result.totalTokens).toBeGreaterThan(0)
  expect(result.summary).toMatch(/Synced \d+ entries/)
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/tools/sync-tool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// src/tools/sync-tool.ts
import { z } from "zod"
import { join } from "path"
import type { NoteEntry } from "../vault/types"
import { loadProjectConfig } from "../vault/config"
import { filterEntries } from "../vault/loader"
import {
  formatKnowledgeSection,
  injectKnowledgeSection,
} from "../index-engine/index"
import { formatTokenCount } from "../index-engine/index"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"

interface SyncResult {
  entryCount: number
  totalTokens: number
  summary: string
}

export async function executeSync(
  targetDir: string,
  allEntries: NoteEntry[],
  vaultPath: string,
): Promise<SyncResult> {
  const config = await loadProjectConfig(targetDir)
  const filtered = filterEntries(allEntries, config)
  const totalTokens = filtered.reduce((sum, e) => sum + e.tokenCount, 0)

  const claudeMdPath = join(targetDir, "CLAUDE.md")
  const file = Bun.file(claudeMdPath)
  const existing = (await file.exists()) ? await file.text() : ""

  const updated = existing
    ? injectKnowledgeSection(existing, filtered)
    : formatKnowledgeSection(filtered) + "\n"

  await Bun.write(claudeMdPath, updated)

  return {
    entryCount: filtered.length,
    totalTokens,
    summary: `Synced ${filtered.length} entries to CLAUDE.md (${formatTokenCount(totalTokens)} total index tokens)`,
  }
}

export function registerSyncTool(
  server: McpServer,
  entries: NoteEntry[],
  vaultPath: string,
) {
  server.tool(
    "sync",
    "Generate or update the Knowledge Index section in a project's CLAUDE.md",
    {
      targetDir: z.string().optional().describe("Project directory (defaults to server CWD)"),
    },
    async ({ targetDir }) => {
      const dir = targetDir ?? process.cwd()
      const result = await executeSync(dir, entries, vaultPath)
      return { content: [{ type: "text" as const, text: result.summary }] }
    },
  )
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/tools/sync-tool.test.ts`
Expected: 5 tests pass

**Step 5: Commit**

```bash
git add src/tools/sync-tool.ts tests/tools/sync-tool.test.ts
git commit -m "feat: sync tool with CLAUDE.md section injection and config filtering"
```

---

### Task 11: MCP Server + CLI Entrypoint

**Files:**
- Create: `src/index.ts`
- Modify: `package.json` (add `bin` field)

**Step 1: Write the server entrypoint**

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { loadVault } from "./vault/loader"
import { loadProjectConfig } from "./vault/config"
import { registerIndexTool } from "./tools/index-tool"
import { registerReadTool } from "./tools/read-tool"
import { registerSearchTool } from "./tools/search-tool"
import { registerSyncTool } from "./tools/sync-tool"

function parseVaultPath(): string {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--vault" && args[i + 1]) {
      return args[i + 1]!
    }
  }

  if (process.env.OBSIDIAN_VAULT_PATH) {
    return process.env.OBSIDIAN_VAULT_PATH
  }

  console.error(
    "Error: Vault path required.\n" +
    "  Use: --vault /path/to/vault\n" +
    "  Or set OBSIDIAN_VAULT_PATH environment variable",
  )
  process.exit(1)
}

async function main() {
  const vaultPath = parseVaultPath()
  const entries = await loadVault(vaultPath)
  const projectConfig = await loadProjectConfig(process.cwd())

  console.error(`Loaded ${entries.length} notes from ${vaultPath}`)

  const server = new McpServer({
    name: "obsidian-context",
    version: "0.1.0",
  })

  registerIndexTool(server, entries, projectConfig)
  registerReadTool(server, vaultPath)
  registerSearchTool(server, entries, projectConfig)
  registerSyncTool(server, entries, vaultPath)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
```

> **Note:** Verify exact MCP SDK import paths at implementation time. The server constructor may take `{ name, version }` directly or as a nested `serverInfo` object — check `McpServer` constructor signature. The transport might be from `@modelcontextprotocol/sdk/server/stdio.js` or another subpath.

**Step 2: Add bin field to package.json**

Add to `package.json`:
```json
"bin": {
  "obsidian-context": "src/index.ts"
}
```

**Step 3: Manually test the server starts**

Run: `bun src/index.ts --vault tests/fixtures/vault 2>&1 | head -1`
Expected: `Loaded 9 notes from tests/fixtures/vault` (or similar count — 9 valid notes in fixture vault)

The server will hang waiting for stdio input — that's correct. Kill it with Ctrl+C.

**Step 4: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat: MCP server entrypoint with CLI arg parsing and tool registration"
```

---

### Task 12: Integration Tests

**Files:**
- Create: `tests/integration.test.ts`

**Step 1: Write the integration tests**

These test the full flow from vault loading through tool execution.

```typescript
// tests/integration.test.ts
import { test, expect, beforeAll } from "bun:test"
import { loadVault, filterEntries } from "../src/vault/loader"
import { loadProjectConfig } from "../src/vault/config"
import { executeIndex } from "../src/tools/index-tool"
import { executeRead } from "../src/tools/read-tool"
import { executeSearch } from "../src/tools/search-tool"
import { executeSync } from "../src/tools/sync-tool"
import type { NoteEntry } from "../src/vault/types"
import { join } from "path"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"

const VAULT = join(import.meta.dir, "fixtures/vault")
const CONFIG_DIR = join(import.meta.dir, "fixtures/with-config")

let allEntries: NoteEntry[]
let projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>

beforeAll(async () => {
  allEntries = await loadVault(VAULT)
  projectConfig = await loadProjectConfig(CONFIG_DIR)
})

test("full vault loads expected number of valid notes", () => {
  expect(allEntries.length).toBe(9)
})

test("index tool returns filtered table for project config", () => {
  const table = executeIndex({}, allEntries, projectConfig)
  expect(table).toContain("| T | Title | Path | ~Tok |")
  expect(table).not.toContain("drafts/")
})

test("index tool filters by project name", () => {
  const table = executeIndex({ project: "bevy-game" }, allEntries, null)
  expect(table).toContain("Bevy")
  expect(table).not.toContain("Bun over Node")
  expect(table).not.toContain("TypeScript builder")
})

test("read tool returns full content for valid note", async () => {
  const result = await executeRead("gotchas/bevy-system-ordering.md", VAULT)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.content).toContain("type: gotcha")
    expect(result.content).toContain("bevy-game")
  }
})

test("read tool blocks path traversal", async () => {
  const result = await executeRead("../../etc/passwd", VAULT)
  expect(result.ok).toBe(false)
})

test("search finds relevant notes and ranks by score", () => {
  const results = executeSearch({ query: "bevy ordering" }, allEntries, null)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("search respects project config filters", () => {
  const results = executeSearch({ query: "bun" }, allEntries, projectConfig)
  const types = results.map((r) => r.type)
  expect(types.every((t) => projectConfig!.filter!.types!.includes(t))).toBe(true)
})

test("sync creates valid CLAUDE.md in temp directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "integration-test-"))
  const result = await executeSync(tempDir, allEntries, VAULT)

  expect(result.entryCount).toBe(9)
  expect(result.totalTokens).toBeGreaterThan(0)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("🔴 = gotcha")
  expect(content).toContain("| T | Title | Path | ~Tok |")
})

test("sync with config filters produces smaller index", async () => {
  const result = await executeSync(CONFIG_DIR, allEntries, VAULT)
  expect(result.entryCount).toBeLessThan(allEntries.length)
  expect(result.entryCount).toBeGreaterThan(0)
})

test("vault notes with missing frontmatter are skipped without crashing", () => {
  const titles = allEntries.map((e) => e.title)
  expect(titles).not.toContain("no-frontmatter")
  expect(titles).not.toContain("invalid-type")
})
```

**Step 2: Run all tests**

Run: `bun test`
Expected: All tests pass across all test files

**Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "feat: integration tests covering full vault-to-tool flow"
```

---

## Post-Implementation Notes

**MCP config for Claude Code** — after building, add to `.mcp.json` in your project or `~/.claude.json` globally:

```json
{
  "mcpServers": {
    "obsidian-context": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/src/index.ts", "--vault", "/absolute/path/to/vault"]
    }
  }
}
```

**Future enhancements** (not in this plan):
- `--init-vault` scaffolding command
- File watcher for hot reload
- Smarter search (fuzzy matching, TF-IDF)
- Multi-vault support
