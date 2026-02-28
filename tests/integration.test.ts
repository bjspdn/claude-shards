import { test, expect, beforeAll } from "bun:test"
import { loadVault } from "../src/vault/loader"
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
  expect(allEntries.length).toBe(10)
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

  expect(result.entryCount).toBe(1)
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
