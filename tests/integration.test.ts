import { test, expect, beforeAll } from "bun:test"
import { loadVault } from "../src/vault/loader"
import { executeRead } from "../src/tools/read-tool"
import { executeSearch } from "../src/tools/search-tool"
import { executeSync } from "../src/tools/sync-tool"
import { markStaleNotes } from "../src/tools/index-tool"
import { buildIndexTable } from "../src/index-engine/index"
import type { NoteEntry } from "../src/vault/types"
import { join } from "path"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"

const VAULT = join(import.meta.dir, "fixtures/vault")

let allEntries: NoteEntry[]

beforeAll(async () => {
  allEntries = await loadVault(VAULT)
})

test("full vault loads expected number of valid notes", () => {
  expect(allEntries.length).toBe(11)
})

test("index table has 4 columns", () => {
  const table = buildIndexTable(allEntries)
  expect(table).toContain("| T")
  const headerLine = table.split("\n")[0]!
  const cols = headerLine.split("|").filter((c) => c.trim() !== "")
  expect(cols.length).toBe(4)
})

test("read tool returns full content for valid note", async () => {
  const result = await executeRead("gotchas/bevy-system-ordering.md", VAULT)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.content).toContain("type: gotchas")
    expect(result.content).toContain("bevy-game")
  }
})

test("read tool blocks path traversal", async () => {
  const result = await executeRead("../../etc/passwd", VAULT)
  expect(result.ok).toBe(false)
})

test("read tool returns stale notes with warning", async () => {
  const staleEntries: NoteEntry[] = [
    {
      title: "Stale Note",
      relativePath: "gotchas/bevy-system-ordering.md",
      filePath: join(VAULT, "gotchas/bevy-system-ordering.md"),
      tokenCount: 100,
      body: "body",
      frontmatter: { type: "gotchas", tags: [], created: new Date(), updated: new Date(), status: "stale", staleAt: new Date() },
    },
  ]
  const result = await executeRead("gotchas/bevy-system-ordering.md", VAULT, staleEntries)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.content).toContain("⚠ This note is stale")
  }
})

test("search finds relevant notes and ranks by score", () => {
  const results = executeSearch({ query: "bevy ordering" }, allEntries)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("sync with note paths copies files and updates CLAUDE.md", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "integration-test-"))
  const entries = allEntries.slice(0, 2)
  const notePaths = entries.map((e) => e.relativePath)
  const synthesized = Object.fromEntries(entries.map((e) => [e.relativePath, `# ${e.title}\n\nSynthesized.`]))
  const result = await executeSync(notePaths, allEntries, tempDir, { synthesized })

  expect(result.entryCount).toBe(2)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")
  expect(content).toContain("@docs/knowledge/")
})

test("sync with empty notes returns prompt", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "integration-test-"))
  const result = await executeSync([], allEntries, tempDir)
  expect(result.summary).toContain("No notes specified")
})

test("vault notes with missing frontmatter are skipped without crashing", () => {
  const titles = allEntries.map((e) => e.title)
  expect(titles).not.toContain("no-frontmatter")
  expect(titles).not.toContain("invalid-type")
})
