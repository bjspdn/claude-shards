import { test, expect } from "bun:test"
import { executeResearch, buildResearchOutput } from "../../src/tools/research-tool"
import { loadVault } from "../../src/vault/loader"
import { join } from "path"

const VAULT = join(import.meta.dir, "../fixtures/vault")

let entries: Awaited<ReturnType<typeof loadVault>>

const setup = loadVault(VAULT).then((e) => (entries = e))

test("executeResearch returns matching notes with full content", async () => {
  await setup
  const result = await executeResearch(
    { query: "Bevy system ordering" },
    entries,
    VAULT,
  )
  expect(result.notes.length).toBeGreaterThan(0)
  expect(result.table).toContain("Score")
  expect(result.notes[0]!.content).toContain("---")
})

test("executeResearch returns empty result for no matches", async () => {
  await setup
  const result = await executeResearch(
    { query: "xyznonexistent" },
    entries,
    VAULT,
  )
  expect(result.notes).toEqual([])
  expect(result.table).toBe("")
  expect(result.truncated).toBe(false)
})

test("executeResearch respects limit", async () => {
  await setup
  const result = await executeResearch(
    { query: "bevy", limit: 1 },
    entries,
    VAULT,
  )
  expect(result.notes.length).toBeLessThanOrEqual(1)
})

test("executeResearch truncates when maxTokens exceeded", async () => {
  await setup
  const allResults = await executeResearch({ query: "bevy" }, entries, VAULT)
  if (allResults.notes.length <= 1) return

  const result = await executeResearch(
    { query: "bevy", maxTokens: 1 },
    entries,
    VAULT,
  )
  expect(result.notes.length).toBeLessThan(allResults.notes.length)
  expect(result.truncated).toBe(true)
})

test("executeResearch always includes at least one note even if over budget", async () => {
  await setup
  const result = await executeResearch(
    { query: "Bevy system ordering", maxTokens: 1 },
    entries,
    VAULT,
  )
  expect(result.notes.length).toBeGreaterThanOrEqual(1)
})

test("executeResearch filters by types", async () => {
  await setup
  const result = await executeResearch(
    { query: "rust", types: ["gotchas"] },
    entries,
    VAULT,
  )
  expect(result.table).toContain("🔴")
  if (result.table.includes("|")) {
    expect(result.table).not.toContain("🟤")
    expect(result.table).not.toContain("🟢")
  }
})

test("buildResearchOutput formats correctly", () => {
  const output = buildResearchOutput({
    table: "| T | Title |\n|---|-------|\n| 🔴 | Test |",
    notes: [
      { relativePath: "gotchas/test.md", content: "# Test\nBody" },
    ],
    totalTokens: 50,
    truncated: false,
  })
  expect(output).toContain("## Research Results (1 notes)")
  expect(output).toContain("### gotchas/test.md")
  expect(output).toContain("# Test\nBody")
})

test("buildResearchOutput shows truncation info", () => {
  const output = buildResearchOutput({
    table: "| T | Title |\n|---|-------|",
    notes: [
      { relativePath: "gotchas/test.md", content: "# Test" },
    ],
    totalTokens: 50,
    truncated: true,
    maxTokenBudget: 100,
  })
  expect(output).toContain("truncated to ~100 tokens")
})
