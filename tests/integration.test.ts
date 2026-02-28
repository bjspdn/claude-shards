import { test, expect, beforeAll } from "bun:test"
import { loadVault } from "../src/vault/loader"
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

beforeAll(async () => {
  allEntries = await loadVault(VAULT)
})

test("full vault loads expected number of valid notes", () => {
  expect(allEntries.length).toBe(10)
})

test("index tool returns full table", () => {
  const table = executeIndex({}, allEntries)
  expect(table).toContain("| T")
})

test("index tool filters by project name", () => {
  const table = executeIndex({ project: "bevy-game" }, allEntries)
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
  const results = executeSearch({ query: "bevy ordering" }, allEntries)
  expect(results.length).toBeGreaterThan(0)
  expect(results[0]!.title).toContain("Bevy system ordering")
})

test("sync creates valid CLAUDE.md and .context.toml in temp directory", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "integration-test-"))
  const globalDir = await mkdtemp(join(tmpdir(), "integration-global-"))
  const result = await executeSync(tempDir, allEntries, VAULT, { globalClaudeDir: globalDir })

  expect(result.entryCount).toBe(0)

  const content = await Bun.file(join(tempDir, "CLAUDE.md")).text()
  expect(content).toContain("## Knowledge Index")

  const configExists = await Bun.file(join(tempDir, ".context.toml")).exists()
  expect(configExists).toBe(true)
})

test("sync with config filters produces smaller index", async () => {
  const globalDir = await mkdtemp(join(tmpdir(), "integration-global-"))
  const result = await executeSync(CONFIG_DIR, allEntries, VAULT, { globalClaudeDir: globalDir })
  expect(result.entryCount).toBeLessThan(allEntries.length)
  expect(result.entryCount).toBeGreaterThan(0)
})

test("vault notes with missing frontmatter are skipped without crashing", () => {
  const titles = allEntries.map((e) => e.title)
  expect(titles).not.toContain("no-frontmatter")
  expect(titles).not.toContain("invalid-type")
})
